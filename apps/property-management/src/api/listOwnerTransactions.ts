import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Owner money for one owner, newest first: contributions, distributions and
 * management fees tagged with them or posted to a property they own. Void
 * entries are included (and marked) so the history is complete.
 */

const Input = z.object({
  ownerId: z.string().min(1),
  kinds: z.array(z.enum(['Owner contribution', 'Owner distribution', 'Management fee'])).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export default createEndpoint({
  description: 'Contributions, distributions and management fees for an owner',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'owners.manage');
    assertCan(actor, 'accounting.view');
    const { ownerId, kinds, limit = 1000 } = parseInput(Input, input);
    const { rows: exists } = await zite.sql({ query: `SELECT id FROM "Owners" WHERE id::text = $1`, params: [ownerId] });
    if (!exists[0]) throw new ZiteError('That owner doesn’t exist, or they were deleted.', 'NOT_FOUND');
    const { rows } = await zite.sql({
      query: `
        SELECT t.id, t."number", t."kind", t."date", t."amount", t."status", t."description", t."propertyId", t."paymentMethod", t."reference", t."period", t."bankAccountId", t."voidReason", t."createdById", t.created_at
        FROM "Transactions" t LEFT JOIN "Properties" p ON p.id::text = t."propertyId"
        WHERE t."kind" = ANY($2) AND (t."ownerId" = $1 OR p."ownerId" = $1)
        ORDER BY t."date" DESC, t."number" DESC
        LIMIT ${limit + 1}`,
      params: [ownerId, kinds?.length ? kinds : ['Owner contribution', 'Owner distribution', 'Management fee']],
    });
    return {
      truncated: rows.length > limit,
      transactions: rows.slice(0, limit).map(r => ({
        id: String(r.id),
        number: num(r.number),
        kind: String(r.kind),
        date: String(r.date ?? '').slice(0, 10),
        amount: num(r.amount),
        status: str(r.status) || 'Posted',
        description: str(r.description) ?? '',
        propertyId: ref(r.propertyId),
        paymentMethod: str(r.paymentMethod) ?? '',
        reference: str(r.reference) ?? '',
        period: str(r.period) ?? '',
        bankAccountId: ref(r.bankAccountId),
        voidReason: str(r.voidReason) ?? '',
        createdById: ref(r.createdById),
        createdAt: iso(r.created_at),
      })),
    };
  },
});
