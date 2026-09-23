import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { day, iso, json, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * A bank account's reconciliation workspace: the one in progress (statement
 * date and balance, and the transactions checked off so far), the beginning
 * balance carried from completed reconciliations, every uncleared transaction
 * through the statement date, and the history.
 *
 * While in progress, checked transactions live on the Reconciliations row
 * (`notes` holds `{ "cleared": [transactionId…] }`) so checking a box is one
 * small write; lines only get their `reconciliationId` when it's finished.
 */

const Input = z.object({ accountId: z.string().min(1) });

export default createEndpoint({
  description: 'Get the reconciliation in progress and history for a bank account',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const { accountId } = parseInput(Input, input);
    const chart = await getChart();
    const account = chart.byId.get(accountId);
    if (!account || account.subtype !== 'Bank') throw new ZiteError('That isn’t a bank account.', 'NOT_FOUND');

    const { rows: recRows } = await zite.sql({
      query: `
        SELECT r.*, m."name" AS "completedByName",
          (SELECT COUNT(DISTINCT jl."transactionId") FROM "JournalLines" jl WHERE jl."reconciliationId" = r.id::text AND jl."accountId" = $1) AS "transactions"
        FROM "Reconciliations" r LEFT JOIN "Members" m ON m.id::text = r."completedById"
        WHERE r."bankAccountId" = $1
        ORDER BY r."statementDate" DESC, r.created_at DESC`,
      params: [accountId],
    });
    const recs = recRows.map(r => ({
      id: String(r.id),
      statementDate: day(r.statementDate) ?? '',
      statementBalance: num(r.statementBalance),
      clearedBalance: num(r.clearedBalance),
      status: r.status === 'Completed' ? ('Completed' as const) : ('In progress' as const),
      completedAt: iso(r.completedAt),
      completedByName: ref(r.completedByName),
      transactions: num(r.transactions),
      cleared: json<{ cleared?: string[] }>(r.notes, {}).cleared ?? [],
      createdAt: iso(r.created_at),
    }));
    const completedIds = recs.filter(r => r.status === 'Completed').map(r => r.id);
    const inProgress = recs.find(r => r.status === 'In progress') ?? null;

    const { rows: begin } = completedIds.length
      ? await zite.sql({
          query: `SELECT SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS balance FROM "JournalLines" jl WHERE jl."accountId" = $1 AND COALESCE(jl."void", false) = false AND jl."reconciliationId" = ANY($2)`,
          params: [accountId, completedIds],
        })
      : { rows: [] as Array<Record<string, unknown>> };
    const beginningBalance = fromCents(toCents(num(begin[0]?.balance)));

    let candidates: Array<{ id: string; number: number; kind: string; date: string; description: string; reference: string | null; paymentMethod: string | null; party: string; propertyId: string | null; propertyCount: number; amount: number }> = [];
    let laterCount = 0;
    if (inProgress) {
      const [{ rows }, later] = await Promise.all([
        zite.sql({
          query: `
            SELECT t.id, t."number", t."kind", t."date", t."description", t."reference", t."paymentMethod",
              COALESCE(v."name", o."name", tn."name", l."name", '') AS party,
              MIN(COALESCE(jl."propertyId", '')) AS "propertyId", COUNT(DISTINCT COALESCE(jl."propertyId", '')) AS "propertyCount",
              SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS amount
            FROM "JournalLines" jl
            JOIN "Transactions" t ON t.id::text = jl."transactionId"
            LEFT JOIN "Vendors" v ON v.id::text = t."vendorId"
            LEFT JOIN "Owners" o ON o.id::text = t."ownerId"
            LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
            LEFT JOIN "Leases" l ON l.id::text = t."leaseId"
            WHERE jl."accountId" = $1 AND COALESCE(jl."void", false) = false AND jl."date" <= $2
              AND (COALESCE(jl."reconciliationId", '') = '' OR jl."reconciliationId" = $3)
            GROUP BY t.id, t."number", t."kind", t."date", t."description", t."reference", t."paymentMethod", v."name", o."name", tn."name", l."name"
            HAVING SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) <> 0
            ORDER BY t."date" ASC, t."number" ASC
            LIMIT 2000`,
          params: [accountId, inProgress.statementDate, inProgress.id],
        }),
        zite.sql({
          query: `SELECT COUNT(DISTINCT jl."transactionId") AS n FROM "JournalLines" jl WHERE jl."accountId" = $1 AND COALESCE(jl."void", false) = false AND jl."date" > $2 AND COALESCE(jl."reconciliationId", '') = ''`,
          params: [accountId, inProgress.statementDate],
        }),
      ]);
      candidates = rows.map(r => ({
        id: String(r.id),
        number: num(r.number),
        kind: String(r.kind ?? ''),
        date: day(r.date) ?? '',
        description: str(r.description) ?? '',
        reference: ref(r.reference),
        paymentMethod: ref(r.paymentMethod),
        party: str(r.party) ?? '',
        propertyId: ref(r.propertyId),
        propertyCount: num(r.propertyCount),
        amount: fromCents(toCents(num(r.amount))),
      }));
      laterCount = num(later.rows[0]?.n);
    }
    const candidateIds = new Set(candidates.map(c => c.id));

    return {
      account: { id: account.id, name: account.name, number: account.number, bankName: account.bankName, accountLast4: account.accountLast4 },
      beginningBalance,
      inProgress: inProgress ? { ...inProgress, cleared: inProgress.cleared.filter(id => candidateIds.has(id)) } : null,
      lastCompleted: recs.find(r => r.status === 'Completed') ?? null,
      candidates,
      laterCount,
      history: recs.filter(r => r.status === 'Completed').map(({ cleared: _c, ...r }) => r),
    };
  },
});
