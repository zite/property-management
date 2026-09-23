import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { TRANSACTION_KINDS } from '@project/shared/constants';
import { assertCan, getActor } from '@project/shared/server/actor';
import { num, Params } from '@project/shared/server/sql';
import { Day, like, toTxnRow, TXN_JOINS, TXN_SELECT } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Every transaction in the books, newest first, filtered by kind, status,
 * property, account, vendor, date and text. The client grows `limit` 300 at a
 * time up to 1,500; past that, filters narrow it.
 */

const Input = z.object({
  kinds: z.array(z.enum(TRANSACTION_KINDS)).max(20).optional(),
  status: z.enum(['Posted', 'Void', 'all']).default('Posted'),
  propertyIds: z.array(z.string().min(1)).max(200).optional(),
  accountIds: z.array(z.string().min(1)).max(200).optional(),
  vendorIds: z.array(z.string().min(1)).max(200).optional(),
  from: Day.optional(),
  to: Day.optional(),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(1500).default(300),
});

export default createEndpoint({
  description: 'List transactions in the general ledger',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const f = parseInput(Input, input);
    const p = new Params();
    const where: string[] = [];
    if (f.status !== 'all') where.push(`t."status" = ${p.add(f.status)}`);
    if (f.kinds?.length) where.push(`t."kind" = ANY(${p.add(f.kinds)})`);
    if (f.propertyIds?.length) {
      const ids = p.add(f.propertyIds);
      where.push(`(t."propertyId" = ANY(${ids}) OR EXISTS (SELECT 1 FROM "JournalLines" x WHERE x."transactionId" = t.id::text AND x."propertyId" = ANY(${ids})))`);
    }
    if (f.accountIds?.length) where.push(`EXISTS (SELECT 1 FROM "JournalLines" x WHERE x."transactionId" = t.id::text AND x."accountId" = ANY(${p.add(f.accountIds)}))`);
    if (f.vendorIds?.length) where.push(`t."vendorId" = ANY(${p.add(f.vendorIds)})`);
    if (f.from) where.push(`t."date" >= ${p.add(f.from)}`);
    if (f.to) where.push(`t."date" <= ${p.add(f.to)}`);
    if (f.search?.trim()) {
      const q = p.add(like(f.search));
      const n = /^\s*#?\d+\s*$/.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(t."description" ILIKE ${q} OR t."reference" ILIKE ${q} OR l."name" ILIKE ${q} OR tn."name" ILIKE ${q} OR v."name" ILIKE ${q} OR o."name" ILIKE ${q} OR t."number" = ${p.add(n)})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ rows }, count] = await Promise.all([
      zite.sql({
        query: `SELECT ${TXN_SELECT} FROM "Transactions" t ${TXN_JOINS} ${whereSql} ORDER BY t."date" DESC, t."number" DESC LIMIT ${f.limit + 1}`,
        params: p.values,
      }),
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "Transactions" t ${TXN_JOINS} ${whereSql}`, params: p.values }),
    ]);
    return { transactions: rows.slice(0, f.limit).map(toTxnRow), hasMore: rows.length > f.limit, total: num(count.rows[0]?.n) };
  },
});
