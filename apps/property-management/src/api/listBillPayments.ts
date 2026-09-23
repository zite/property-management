import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { num, Params, str } from '@project/shared/server/sql';
import { Day, like, toTxnRow, TXN_JOINS, TXN_SELECT } from '../server/accounting';
import { parseInput } from '../server/input';

/** Payments made to vendors, newest first, with the bills each one paid. */

const Input = z.object({
  from: Day.optional(),
  to: Day.optional(),
  vendorIds: z.array(z.string().min(1)).max(200).optional(),
  search: z.string().max(120).optional(),
  includeVoid: z.boolean().optional(),
});

export default createEndpoint({
  description: 'List payments made to vendors',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const f = parseInput(Input, input);
    const p = new Params();
    const where = [`t."kind" = 'Bill payment'`];
    if (!f.includeVoid) where.push(`t."status" = 'Posted'`);
    if (f.from) where.push(`t."date" >= ${p.add(f.from)}`);
    if (f.to) where.push(`t."date" <= ${p.add(f.to)}`);
    if (f.vendorIds?.length) where.push(`t."vendorId" = ANY(${p.add(f.vendorIds)})`);
    if (f.search?.trim()) {
      const q = p.add(like(f.search));
      const n = /^\s*#?\d+\s*$/.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(t."reference" ILIKE ${q} OR t."description" ILIKE ${q} OR v."name" ILIKE ${q} OR t."number" = ${p.add(n)})`);
    }
    const { rows } = await zite.sql({
      query: `
        SELECT ${TXN_SELECT},
          (SELECT STRING_AGG(b."number"::text, ', ' ORDER BY b."number") FROM "Allocations" a JOIN "Transactions" b ON b.id::text = a."chargeId" WHERE a."paymentId" = t.id::text) AS "billNumbers",
          (SELECT COUNT(*) FROM "JournalLines" jl WHERE jl."transactionId" = t.id::text AND COALESCE(jl."reconciliationId", '') <> '') AS "reconciledLines"
        FROM "Transactions" t ${TXN_JOINS}
        WHERE ${where.join(' AND ')}
        ORDER BY t."date" DESC, t."number" DESC
        LIMIT 1001`,
      params: p.values,
    });
    const payments = rows.slice(0, 1000).map(r => ({ ...toTxnRow(r), billNumbers: str(r.billNumbers) ?? '', reconciled: num(r.reconciledLines) > 0 }));
    return { payments, truncated: rows.length > 1000 };
  },
});
