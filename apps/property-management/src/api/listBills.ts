import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { propertyCash } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { num, Params, str } from '@project/shared/server/sql';
import { like, toTxnRow, TXN_JOINS, TXN_SELECT } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Vendor bills for the payables list. `open` and `overdue` return everything
 * still owed (they're never large); `paid`, `void` and `all` return the newest
 * 1,000. Includes each property's cash so paying can warn before a building
 * goes negative.
 */

const Input = z.object({
  status: z.enum(['open', 'overdue', 'paid', 'void', 'all']).default('open'),
  propertyIds: z.array(z.string().min(1)).max(200).optional(),
  vendorIds: z.array(z.string().min(1)).max(200).optional(),
  search: z.string().max(120).optional(),
});

export default createEndpoint({
  description: 'List vendor bills with what is still owed on each',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const f = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const p = new Params();
    const where = [`t."kind" = 'Bill'`];
    const openExpr = `(t."amount" - COALESCE(paid.s, 0))`;
    if (f.status === 'void') where.push(`t."status" = 'Void'`);
    else if (f.status !== 'all') where.push(`t."status" = 'Posted'`);
    if (f.status === 'open') where.push(`${openExpr} > 0.004`);
    if (f.status === 'overdue') where.push(`${openExpr} > 0.004 AND t."dueDate" < ${p.add(today)}`);
    if (f.status === 'paid') where.push(`${openExpr} <= 0.004`);
    if (f.propertyIds?.length) {
      const ids = p.add(f.propertyIds);
      where.push(`(t."propertyId" = ANY(${ids}) OR EXISTS (SELECT 1 FROM "JournalLines" x WHERE x."transactionId" = t.id::text AND x."propertyId" = ANY(${ids})))`);
    }
    if (f.vendorIds?.length) where.push(`t."vendorId" = ANY(${p.add(f.vendorIds)})`);
    if (f.search?.trim()) {
      const q = p.add(like(f.search));
      const n = /^\s*#?\d+\s*$/.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(t."reference" ILIKE ${q} OR t."description" ILIKE ${q} OR v."name" ILIKE ${q} OR t."number" = ${p.add(n)})`);
    }

    const [{ rows }, cash] = await Promise.all([
      zite.sql({
        query: `
          SELECT ${TXN_SELECT}, w."title" AS "workOrderTitle", COALESCE(paid.s, 0) AS "paidAmount", COALESCE(paid.n, 0) AS "paymentCount",
            (SELECT COUNT(DISTINCT x."propertyId") FROM "JournalLines" x WHERE x."transactionId" = t.id::text AND COALESCE(x."debit", 0) > 0) AS "propertyCount",
            (SELECT COUNT(*) FROM "JournalLines" x WHERE x."transactionId" = t.id::text AND COALESCE(x."debit", 0) > 0) AS "lineCount"
          FROM "Transactions" t ${TXN_JOINS}
          LEFT JOIN (
            SELECT a."chargeId", SUM(a."amount") AS s, COUNT(DISTINCT a."paymentId") AS n
            FROM "Allocations" a WHERE COALESCE(a."void", false) = false GROUP BY a."chargeId"
          ) paid ON paid."chargeId" = t.id::text
          WHERE ${where.join(' AND ')}
          ORDER BY ${f.status === 'open' || f.status === 'overdue' ? 't."dueDate" ASC NULLS LAST, t."number" ASC' : 't."date" DESC, t."number" DESC'}
          LIMIT 1001`,
        params: p.values,
      }),
      propertyCash(),
    ]);

    // Each bill's payable by property: a payment splits across buildings in the same proportion (see payBills).
    const pageIds = rows.slice(0, 1000).map(r => String(r.id));
    const shares = new Map<string, Array<{ propertyId: string; amount: number }>>();
    if (pageIds.length) {
      const ap = (await getChart()).key('accounts_payable').id;
      const { rows: apRows } = await zite.sql({
        query: `SELECT jl."transactionId", COALESCE(jl."propertyId", '') AS pid, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS amount FROM "JournalLines" jl WHERE jl."transactionId" = ANY($1) AND jl."accountId" = $2 GROUP BY jl."transactionId", COALESCE(jl."propertyId", '')`,
        params: [pageIds, ap],
      });
      for (const r of apRows) {
        const list = shares.get(String(r.transactionId)) ?? [];
        if (num(r.amount) > 0) list.push({ propertyId: String(r.pid ?? ''), amount: num(r.amount) });
        shares.set(String(r.transactionId), list);
      }
    }

    const bills = rows.slice(0, 1000).map(r => {
      const base = toTxnRow(r);
      const paid = toCents(num(r.paidAmount));
      return {
        ...base,
        workOrderTitle: str(r.workOrderTitle),
        paid: fromCents(paid),
        open: base.status === 'Void' ? 0 : fromCents(Math.max(0, toCents(base.amount) - paid)),
        paymentCount: num(r.paymentCount),
        propertyCount: Math.max(1, num(r.propertyCount)),
        lineCount: num(r.lineCount),
        shares: shares.get(base.id) ?? [],
      };
    });
    return { today, bills, truncated: rows.length > 1000, cashByProperty: Object.fromEntries(cash) as Record<string, number> };
  },
});
