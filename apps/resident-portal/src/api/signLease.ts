import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { recordSignature } from '@project/shared/server/leases';
import { notify } from '@project/shared/server/notify';
import { parseInput } from '../server/identity';
import { homeLabel, officeRecipients, residentFor } from '../server/resident';

/**
 * A resident signs their lease by typing their name after agreeing to sign
 * electronically. When the last resident signs, the office is asked to countersign.
 */

const Input = z.object({
  leaseId: z.string().min(1).max(64),
  typedName: z.string().trim().min(2, 'Type your full name to sign.').max(120, 'That name is too long.'),
  consent: z.literal(true, { errorMap: () => ({ message: 'Agree to sign electronically before signing.' }) }),
});

export default createEndpoint({
  description: 'A resident signs a lease waiting for signatures',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    if (lease.status !== 'Pending signature') throw new ZiteError(lease.status === 'Active' ? 'This lease is already signed and active.' : "This lease isn't waiting for signatures.", 'BAD_REQUEST');
    const { rows } = await zite.sql({ query: `SELECT "signedAt" FROM "LeaseTenants" WHERE "leaseId" = $1 AND "tenantId" = $2 AND "role" IN ('Primary', 'Co-tenant') LIMIT 1`, params: [lease.id, tenantId] });
    if (!rows[0]) throw new ZiteError("You're listed on this lease but not as someone who signs it. Contact the office if that's wrong.", 'FORBIDDEN');
    if (rows[0].signedAt) throw new ZiteError("You've already signed this lease.", 'CONFLICT');

    const { allSigned } = await recordSignature(lease.id, tenantId, data.typedName, 'resident');
    const home = homeLabel(lease);
    await logActivity({
      entityType: 'lease',
      entityId: lease.id,
      action: 'signed',
      summary: allSigned ? `${me.name} signed — all residents have signed` : `${me.name} signed`,
      actorName: me.name,
      data: { typedName: data.typedName, allSigned },
      propertyId: lease.propertyId || null,
      unitId: lease.unitId || null,
      leaseId: lease.id,
      tenantId,
    });
    if (allSigned) {
      await notify({
        recipientIds: await officeRecipients(lease, 'leasing.manage'),
        kind: 'lease_signed',
        title: `${home} is signed and ready to countersign`,
        body: `${me.name} signed last. Countersign to activate the lease.`,
        link: `/leases/${lease.id}`,
        entityType: 'lease',
        entityId: lease.id,
        actorName: me.name,
      });
    }
    return { allSigned, signedAt: new Date().toISOString() };
  },
});
