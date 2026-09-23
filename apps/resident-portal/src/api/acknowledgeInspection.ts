import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { iso, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { residentFor } from '../server/resident';

/** The resident confirms they've reviewed an inspection report shared with them. */

const Input = z.object({ leaseId: z.string().min(1).max(64), inspectionId: z.string().min(1).max(64) });

export default createEndpoint({
  description: 'A resident acknowledges an inspection report',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input, "We couldn't find that inspection.");
    const me = await residentFor(context, data.leaseId);
    const { rows } = await zite.sql({
      query: `SELECT id, "title", "inspectionType", "status", "tenantAcknowledgedAt", "propertyId", "unitId" FROM "Inspections" WHERE id::text = $1 AND "leaseId" = $2 AND COALESCE("sharedWithTenant", false) = true LIMIT 1`,
      params: [data.inspectionId, me.lease.id],
    });
    const i = rows[0];
    if (!i) throw new ZiteError("We couldn't find that inspection.", 'NOT_FOUND');
    if (i.status !== 'Completed') throw new ZiteError('You can acknowledge the report once the inspection is complete.', 'BAD_REQUEST');
    const existing = iso(i.tenantAcknowledgedAt);
    if (existing) return { acknowledgedAt: existing };

    const now = new Date().toISOString();
    await zite.inspections.update({ id: String(i.id), record: { tenantAcknowledgedAt: now } });
    await logActivity({
      entityType: 'inspection',
      entityId: String(i.id),
      action: 'acknowledged',
      summary: `acknowledged the ${(str(i.inspectionType) || 'inspection').toLowerCase()} inspection report`,
      actorName: me.name,
      propertyId: ref(i.propertyId),
      unitId: ref(i.unitId),
      leaseId: me.lease.id,
      tenantId: me.tenantId,
    });
    return { acknowledgedAt: now };
  },
});
