import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart, isDebitNormal } from '@project/shared/server/accounts';
import { day, num, Params, ref, str } from '@project/shared/server/sql';
import { Day, like } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * An account's register: one row per transaction that touched it, newest
 * first, with a running balance on the account's normal side (a bank grows
 * with deposits, a payable with bills). The running balance counts every line
 * in the date range even when a cleared filter or search hides some rows, so
 * the balance column always means the account's balance on that day.
 */

const Input = z.object({
  accountId: z.string().min(1),
  from: Day.optional(),
  to: Day.optional(),
  propertyId: z.string().optional(),
  cleared: z.enum(['all', 'cleared', 'uncleared']).default('all'),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(1500).default(500),
});

export default createEndpoint({
  description: "An account's register with running balance",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const f = parseInput(Input, input);
    const chart = await getChart();
    const account = chart.byId.get(f.accountId);
    if (!account) throw new ZiteError('That account no longer exists.', 'NOT_FOUND');
    const sign = isDebitNormal(account.accountType) ? 1 : -1;

    const p = new Params();
    const lineWhere = [`jl."accountId" = ${p.add(account.id)}`, `COALESCE(jl."void", false) = false`];
    if (f.from) lineWhere.push(`jl."date" >= ${p.add(f.from)}`);
    if (f.to) lineWhere.push(`jl."date" <= ${p.add(f.to)}`);
    if (f.propertyId) lineWhere.push(`jl."propertyId" = ${p.add(f.propertyId)}`);
    const lineParams = [...p.values];
    const outer: string[] = [];
    if (f.cleared === 'cleared') outer.push(`g."reconciliationId" <> ''`);
    if (f.cleared === 'uncleared') outer.push(`g."reconciliationId" = ''`);
    if (f.search?.trim()) {
      const q = p.add(like(f.search));
      const n = /^\s*#?\d+\s*$/.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      outer.push(`(g."description" ILIKE ${q} OR g."reference" ILIKE ${q} OR g."vendorName" ILIKE ${q} OR g."tenantName" ILIKE ${q} OR g."ownerName" ILIKE ${q} OR g."number" = ${p.add(n)})`);
    }
    const limit = p.add(f.limit);

    const openingParams: unknown[] = [account.id];
    let openingWhere = '';
    if (f.from) {
      openingParams.push(f.from);
      openingWhere += ` AND jl."date" < $${openingParams.length}`;
    }
    if (f.propertyId) {
      openingParams.push(f.propertyId);
      openingWhere += ` AND jl."propertyId" = $${openingParams.length}`;
    }

    const [{ rows }, opening, totals] = await Promise.all([
      zite.sql({
        query: `
          SELECT * FROM (
            SELECT g.*, ROW_NUMBER() OVER (ORDER BY g."date" DESC, g."number" DESC, g.id DESC) AS rn, COUNT(*) OVER () AS "matching"
            FROM (
              SELECT t.id, t."number", t."kind", t."date", t."description", COALESCE(t."reference", '') AS "reference", t."paymentMethod",
                COALESCE(v."name", '') AS "vendorName", COALESCE(tn."name", '') AS "tenantName", COALESCE(o."name", '') AS "ownerName", l."name" AS "leaseName",
                SUM(COALESCE(jl."debit", 0)) AS debit, SUM(COALESCE(jl."credit", 0)) AS credit,
                MIN(COALESCE(jl."propertyId", '')) AS "propertyId", COUNT(DISTINCT COALESCE(jl."propertyId", '')) AS "propertyCount",
                MAX(COALESCE(jl."reconciliationId", '')) AS "reconciliationId", MAX(jl."clearedAt") AS "clearedAt", MIN(jl."memo") AS memo,
                SUM(SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0))) OVER (ORDER BY t."date" ASC, t."number" ASC, t.id ASC) AS running
              FROM "JournalLines" jl
              JOIN "Transactions" t ON t.id::text = jl."transactionId"
              LEFT JOIN "Vendors" v ON v.id::text = t."vendorId"
              LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
              LEFT JOIN "Owners" o ON o.id::text = t."ownerId"
              LEFT JOIN "Leases" l ON l.id::text = t."leaseId"
              WHERE ${lineWhere.join(' AND ')}
              GROUP BY t.id, t."number", t."kind", t."date", t."description", t."reference", t."paymentMethod", v."name", tn."name", o."name", l."name"
            ) g
            ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
          ) x
          WHERE x.rn <= ${limit}
          ORDER BY x.rn ASC`,
        params: p.values,
      }),
      zite.sql({ query: `SELECT SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS balance FROM "JournalLines" jl WHERE jl."accountId" = $1 AND COALESCE(jl."void", false) = false ${openingWhere}`, params: openingParams }),
      zite.sql({ query: `SELECT SUM(COALESCE(jl."debit", 0)) AS debit, SUM(COALESCE(jl."credit", 0)) AS credit, COUNT(DISTINCT jl."transactionId") AS n FROM "JournalLines" jl WHERE ${lineWhere.join(' AND ')}`, params: lineParams }),
    ]);

    const openingCents = f.from ? toCents(num(opening.rows[0]?.balance)) : 0;
    const debitCents = toCents(num(totals.rows[0]?.debit));
    const creditCents = toCents(num(totals.rows[0]?.credit));
    const signed = (cents: number) => fromCents(sign * cents);

    const entries = rows.map(r => {
      const d = toCents(num(r.debit));
      const c = toCents(num(r.credit));
      const kind = String(r.kind ?? '');
      return {
        id: String(r.id),
        number: num(r.number),
        kind,
        date: day(r.date) ?? '',
        description: str(r.description) ?? '',
        memo: str(r.memo) ?? '',
        reference: ref(r.reference),
        paymentMethod: ref(r.paymentMethod),
        party: str(r.vendorName) || str(r.ownerName) || str(r.tenantName) || str(r.leaseName) || '',
        propertyId: ref(r.propertyId),
        propertyCount: num(r.propertyCount),
        debit: fromCents(d),
        credit: fromCents(c),
        amount: signed(d - c),
        running: signed(openingCents + toCents(num(r.running))),
        reconciled: Boolean(ref(r.reconciliationId)),
        clearedAt: day(r.clearedAt),
      };
    });

    return {
      account: { id: account.id, number: account.number, name: account.name, accountType: account.accountType, subtype: account.subtype, systemKey: account.systemKey, bankName: account.bankName, accountLast4: account.accountLast4, active: account.active, description: account.description },
      normal: sign === 1 ? ('debit' as const) : ('credit' as const),
      openingBalance: signed(openingCents),
      closingBalance: signed(openingCents + debitCents - creditCents),
      debits: fromCents(debitCents),
      credits: fromCents(creditCents),
      transactionCount: num(totals.rows[0]?.n),
      matching: num(rows[0]?.matching),
      entries,
      truncated: num(rows[0]?.matching) > entries.length,
    };
  },
});
