import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { num, Params } from '@project/shared/server/sql';
import { Day, like, toTxnRow, TXN_JOINS, TXN_SELECT } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * The payments register: every payment received from residents in a date
 * range, with where it was deposited and how much is still unapplied.
 */

const Input = z.object({
  from: Day.optional(),
  to: Day.optional(),
  propertyIds: z.array(z.string().min(1)).max(200).optional(),
  search: z.string().max(120).optional(),
  includeVoid: z.boolean().optional(),
});

export default createEndpoint({
  description: 'List payments received from residents',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const f = parseInput(Input, input);
    const p = new Params();
    const where = [`t."kind" = 'Payment'`];
    if (!f.includeVoid) where.push(`t."status" = 'Posted'`);
    if (f.from) where.push(`t."date" >= ${p.add(f.from)}`);
    if (f.to) where.push(`t."date" <= ${p.add(f.to)}`);
    if (f.propertyIds?.length) where.push(`t."propertyId" = ANY(${p.add(f.propertyIds)})`);
    if (f.search?.trim()) {
      const q = p.add(like(f.search));
      const n = /^\s*#?\d+\s*$/.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(t."reference" ILIKE ${q} OR t."description" ILIKE ${q} OR l."name" ILIKE ${q} OR tn."name" ILIKE ${q} OR t."number" = ${p.add(n)})`);
    }
    const { rows } = await zite.sql({
      query: `
        SELECT ${TXN_SELECT},
          t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."paymentId" = t.id::text AND COALESCE(a."void", false) = false), 0) AS "unapplied"
        FROM "Transactions" t ${TXN_JOINS}
        WHERE ${where.join(' AND ')}
        ORDER BY t."date" DESC, t."number" DESC
        LIMIT 1001`,
      params: p.values,
    });
    const payments = rows.slice(0, 1000).map(r => ({ ...toTxnRow(r), unapplied: r.status === 'Void' ? 0 : fromCents(toCents(num(r.unapplied))) }));
    return { payments, truncated: rows.length > 1000 };
  },
});
