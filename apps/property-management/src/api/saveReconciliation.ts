import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { getSettings } from '@project/shared/server/settings';
import { day, json, num, withRetry } from '@project/shared/server/sql';
import { Day, Id } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Reconcile a bank account against its statement.
 *
 *   start    — statement date + ending balance; one in progress per account
 *   save     — the transactions checked off so far (and statement edits)
 *   finish   — only when beginning balance + cleared = statement balance; stamps
 *              each cleared journal line with `reconciliationId` and `clearedAt`
 *   discard  — drop the reconciliation in progress
 *   undo     — reopen the latest completed one: its lines become uncleared again
 *
 * Journal lines are updated one at a time (bursts are rate-limited) and each
 * update is idempotent, so a finish or undo interrupted halfway can simply be
 * run again.
 */

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), accountId: Id, statementDate: Day, statementBalance: z.number().min(-100_000_000).max(100_000_000) }),
  z.object({ action: z.literal('save'), id: Id, statementDate: Day.optional(), statementBalance: z.number().min(-100_000_000).max(100_000_000).optional(), cleared: z.array(Id).max(5000) }),
  z.object({ action: z.literal('finish'), id: Id, cleared: z.array(Id).max(5000) }),
  z.object({ action: z.literal('discard'), id: Id }),
  z.object({ action: z.literal('undo'), id: Id }),
]);

type Rec = { id: string; bankAccountId: string; statementDate: string; statementBalance: number; status: string; cleared: string[] };

async function loadRec(id: string): Promise<Rec> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Reconciliations" WHERE id::text = $1`, params: [id] });
  const r = rows[0];
  if (!r) throw new ZiteError('That reconciliation no longer exists. Reload and try again.', 'NOT_FOUND');
  return { id: String(r.id), bankAccountId: String(r.bankAccountId ?? ''), statementDate: day(r.statementDate) ?? '', statementBalance: num(r.statementBalance), status: String(r.status ?? ''), cleared: json<{ cleared?: string[] }>(r.notes, {}).cleared ?? [] };
}

async function lastCompleted(accountId: string) {
  const { rows } = await zite.sql({ query: `SELECT id, "statementDate" FROM "Reconciliations" WHERE "bankAccountId" = $1 AND "status" = 'Completed' ORDER BY "statementDate" DESC, "completedAt" DESC LIMIT 1`, params: [accountId] });
  return rows[0] ? { id: String(rows[0].id), statementDate: day(rows[0].statementDate) ?? '' } : null;
}

async function setLines(ids: string[], record: { reconciliationId: string | null; clearedAt: string | null }) {
  for (const id of ids) await withRetry(() => zite.journalLines.update({ id, record }));
}

export default createEndpoint({
  description: 'Start, save, finish, discard or undo a bank reconciliation',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'banking.manage');
    const data = parseInput(Input, input);
    const chart = await getChart();
    const settings = await getSettings();

    if (data.action === 'start') {
      const account = chart.byId.get(data.accountId);
      if (!account || account.subtype !== 'Bank') throw new ZiteError('Choose a bank account to reconcile.', 'BAD_REQUEST');
      const { rows: open } = await zite.sql({ query: `SELECT "statementDate" FROM "Reconciliations" WHERE "bankAccountId" = $1 AND "status" = 'In progress' LIMIT 1`, params: [account.id] });
      if (open[0]) throw new ZiteError(`A reconciliation for this account is already in progress (statement ${formatDay(day(open[0].statementDate))}). Finish or discard it first.`, 'CONFLICT');
      const last = await lastCompleted(account.id);
      if (last && data.statementDate <= last.statementDate) throw new ZiteError(`This account is already reconciled through ${formatDay(last.statementDate, 'long')}. Choose a later statement date.`, 'BAD_REQUEST');
      const created = await zite.reconciliations.create({ record: { bankAccountId: account.id, statementDate: data.statementDate, statementBalance: data.statementBalance, clearedBalance: null, status: 'In progress', completedAt: null, completedById: null, notes: JSON.stringify({ cleared: [] }) } });
      return { id: created.id, status: 'In progress' as const };
    }

    const rec = await loadRec(data.id);

    if (data.action === 'save') {
      if (rec.status !== 'In progress') throw new ZiteError('This reconciliation is already finished.', 'CONFLICT');
      if (data.statementDate) {
        const last = await lastCompleted(rec.bankAccountId);
        if (last && data.statementDate <= last.statementDate) throw new ZiteError(`This account is already reconciled through ${formatDay(last.statementDate, 'long')}. Choose a later statement date.`, 'BAD_REQUEST');
      }
      await zite.reconciliations.update({
        id: rec.id,
        record: { statementDate: data.statementDate ?? rec.statementDate, statementBalance: data.statementBalance ?? rec.statementBalance, notes: JSON.stringify({ cleared: [...new Set(data.cleared)] }) },
      });
      return { id: rec.id, status: 'In progress' as const };
    }

    if (data.action === 'finish') {
      if (rec.status !== 'In progress') throw new ZiteError('This reconciliation is already finished.', 'CONFLICT');
      const cleared = [...new Set(data.cleared)];
      const { rows: completed } = await zite.sql({ query: `SELECT id FROM "Reconciliations" WHERE "bankAccountId" = $1 AND "status" = 'Completed'`, params: [rec.bankAccountId] });
      const completedIds = completed.map(r => String(r.id));
      const [{ rows: begin }, { rows: lines }] = await Promise.all([
        completedIds.length
          ? zite.sql({ query: `SELECT SUM(COALESCE("debit", 0) - COALESCE("credit", 0)) AS balance FROM "JournalLines" WHERE "accountId" = $1 AND COALESCE("void", false) = false AND "reconciliationId" = ANY($2)`, params: [rec.bankAccountId, completedIds] })
          : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
        cleared.length
          ? zite.sql({
              query: `
                SELECT id, "debit", "credit", "reconciliationId" FROM "JournalLines"
                WHERE "accountId" = $1 AND COALESCE("void", false) = false AND "transactionId" = ANY($2) AND "date" <= $3
                  AND (COALESCE("reconciliationId", '') = '' OR "reconciliationId" = $4)`,
              params: [rec.bankAccountId, cleared, rec.statementDate, rec.id],
            })
          : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      ]);
      const beginning = toCents(num(begin[0]?.balance));
      const clearedCents = lines.reduce((s, l) => s + toCents(num(l.debit)) - toCents(num(l.credit)), 0);
      const difference = toCents(rec.statementBalance) - (beginning + clearedCents);
      if (difference !== 0) {
        throw new ZiteError(`The statement and your cleared transactions are ${formatMoney(Math.abs(fromCents(difference)), settings.currency)} apart. Check off transactions until the difference is zero.`, 'BAD_REQUEST');
      }
      // Lines first, header last: an interrupted finish stays "In progress" and can be finished again.
      await setLines(lines.filter(l => String(l.reconciliationId ?? '') !== rec.id).map(l => String(l.id)), { reconciliationId: rec.id, clearedAt: rec.statementDate });
      const now = new Date().toISOString();
      await zite.reconciliations.update({ id: rec.id, record: { status: 'Completed', clearedBalance: fromCents(beginning + clearedCents), completedAt: now, completedById: actor.id, notes: JSON.stringify({ cleared }) } });
      const account = chart.byId.get(rec.bankAccountId);
      await logActivity({ entityType: 'transaction', entityId: rec.id, action: 'bank_reconciled', summary: `reconciled ${account?.name ?? 'a bank account'} through ${formatDay(rec.statementDate, 'long')} at ${formatMoney(rec.statementBalance, settings.currency)}`, actorId: actor.id, actorName: actor.name, data: { reconciliationId: rec.id, transactions: cleared.length } });
      return { id: rec.id, status: 'Completed' as const };
    }

    if (data.action === 'discard') {
      if (rec.status !== 'In progress') throw new ZiteError('Only a reconciliation in progress can be discarded. Use undo for a finished one.', 'CONFLICT');
      const { rows } = await zite.sql({ query: `SELECT id FROM "JournalLines" WHERE "reconciliationId" = $1`, params: [rec.id] });
      await setLines(rows.map(r => String(r.id)), { reconciliationId: null, clearedAt: null });
      await zite.reconciliations.delete({ id: rec.id });
      return { id: rec.id, status: 'Discarded' as const };
    }

    // undo
    if (rec.status !== 'Completed') throw new ZiteError('This reconciliation isn’t finished, so there’s nothing to undo.', 'CONFLICT');
    const last = await lastCompleted(rec.bankAccountId);
    if (!last || last.id !== rec.id) throw new ZiteError('Only the most recent reconciliation can be undone. Undo the later ones first.', 'CONFLICT');
    const { rows: open } = await zite.sql({ query: `SELECT id FROM "Reconciliations" WHERE "bankAccountId" = $1 AND "status" = 'In progress' LIMIT 1`, params: [rec.bankAccountId] });
    if (open[0]) throw new ZiteError('Another reconciliation is in progress for this account. Discard it before undoing this one.', 'CONFLICT');
    const { rows: lines } = await zite.sql({ query: `SELECT id, "transactionId" FROM "JournalLines" WHERE "reconciliationId" = $1`, params: [rec.id] });
    // Header first here: once reopened, a half-finished undo is completed by finishing or discarding.
    await zite.reconciliations.update({ id: rec.id, record: { status: 'In progress', completedAt: null, completedById: null, clearedBalance: null, notes: JSON.stringify({ cleared: [...new Set(lines.map(l => String(l.transactionId)))] }) } });
    await setLines(lines.map(l => String(l.id)), { reconciliationId: null, clearedAt: null });
    const account = chart.byId.get(rec.bankAccountId);
    await logActivity({ entityType: 'transaction', entityId: rec.id, action: 'bank_reconciliation_undone', summary: `reopened the ${formatDay(rec.statementDate, 'long')} reconciliation of ${account?.name ?? 'a bank account'}`, actorId: actor.id, actorName: actor.name });
    return { id: rec.id, status: 'In progress' as const };
  },
});
