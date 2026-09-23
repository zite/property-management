import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { postJournalEntry } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { Day, existingProperties, Id } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * A manual journal entry: balanced debit and credit lines, each on an account
 * and optionally a property or lease. For corrections, reclassifications and
 * opening balances — resident charges and payments belong on the lease ledger,
 * where they're matched to each other.
 */

const Line = z.object({
  accountId: Id,
  debit: z.number().min(0).max(100_000_000).optional(),
  credit: z.number().min(0).max(100_000_000).optional(),
  propertyId: z.string().optional(),
  leaseId: z.string().optional(),
  memo: z.string().max(250).optional(),
});

const Input = z.object({
  date: Day,
  description: z.string().trim().min(1, 'Describe what the entry is for.').max(250),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(Line).min(2, 'A journal entry needs at least two lines.').max(100, 'A journal entry can have at most 100 lines.'),
});

export default createEndpoint({
  description: 'Post a balanced manual journal entry',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'banking.manage');
    const data = parseInput(Input, input);
    const lines = data.lines.filter(l => toCents(l.debit ?? 0) > 0 || toCents(l.credit ?? 0) > 0);
    if (lines.length < 2) throw new ZiteError('A journal entry needs at least two lines with amounts.', 'BAD_REQUEST');
    for (const l of lines) if (toCents(l.debit ?? 0) > 0 && toCents(l.credit ?? 0) > 0) throw new ZiteError('A line can be a debit or a credit, not both.', 'BAD_REQUEST');
    const dr = lines.reduce((s, l) => s + toCents(l.debit ?? 0), 0);
    const cr = lines.reduce((s, l) => s + toCents(l.credit ?? 0), 0);
    const settings = await getSettings();
    if (dr !== cr) throw new ZiteError(`Debits (${formatMoney(fromCents(dr), settings.currency)}) and credits (${formatMoney(fromCents(cr), settings.currency)}) must be equal.`, 'BAD_REQUEST');

    const chart = await getChart();
    for (const l of lines) {
      const a = chart.byId.get(l.accountId);
      if (!a || !a.active) throw new ZiteError('One of the accounts is inactive or missing. Reload and try again.', 'BAD_REQUEST');
    }
    const props = await existingProperties(lines.map(l => l.propertyId ?? ''));
    if (lines.some(l => l.propertyId && !props.has(l.propertyId))) throw new ZiteError('One of the properties no longer exists.', 'BAD_REQUEST');
    const leaseIds = [...new Set(lines.map(l => l.leaseId).filter(Boolean) as string[])];
    const leases = new Map<string, { propertyId: string; unitId: string }>();
    if (leaseIds.length) {
      const { rows } = await zite.sql({ query: `SELECT id, "propertyId", "unitId" FROM "Leases" WHERE id::text = ANY($1)`, params: [leaseIds] });
      for (const r of rows) leases.set(String(r.id), { propertyId: String(r.propertyId ?? ''), unitId: String(r.unitId ?? '') });
      if (leases.size !== leaseIds.length) throw new ZiteError('One of the leases no longer exists.', 'BAD_REQUEST');
    }
    const propertyIds = [...new Set(lines.map(l => l.propertyId || (l.leaseId ? leases.get(l.leaseId)?.propertyId : '') || '').filter(Boolean))];

    const posted = await postJournalEntry({
      date: data.date,
      description: data.description,
      reference: data.reference || null,
      notes: data.notes || null,
      createdById: actor.id,
      propertyId: propertyIds.length === 1 ? propertyIds[0] : null,
      lines: lines.map(l => {
        const lease = l.leaseId ? leases.get(l.leaseId) : undefined;
        return {
          accountId: l.accountId,
          debit: toCents(l.debit ?? 0) > 0 ? l.debit : undefined,
          credit: toCents(l.credit ?? 0) > 0 ? l.credit : undefined,
          propertyId: l.propertyId || lease?.propertyId || null,
          unitId: lease?.unitId || null,
          leaseId: l.leaseId || null,
          memo: l.memo || null,
        };
      }),
    });
    await logActivity({ entityType: 'transaction', entityId: posted.id, propertyId: propertyIds.length === 1 ? propertyIds[0] : null, action: 'journal_entry_posted', summary: `posted journal entry #${posted.number} for ${formatMoney(fromCents(dr), settings.currency)} — ${data.description}`, actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id, number: posted.number } });
    return { id: posted.id, number: posted.number, amount: fromCents(dr) };
  },
});
