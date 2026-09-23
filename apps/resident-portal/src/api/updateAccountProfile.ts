import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { getIdentity, parseInput } from '../server/identity';

/**
 * A resident updates the phone number on their tenant record. Scoped entirely
 * by the verified email: the tenant is whoever that email belongs to, never an
 * id from the browser.
 */
const Input = z.object({ phone: z.string().max(40, 'That phone number is too long.') });

export default createEndpoint({
  description: 'Update the phone number on the signed-in resident’s tenant record',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ phone: z.string() }),
  execute: async ({ input, context }) => {
    const { phone: raw } = parseInput(Input, input);
    const identity = await getIdentity(context);
    if (!identity) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
    if (!identity.tenant) throw new ZiteError('Your account isn’t linked to a lease, so there’s no resident phone number to update.', 'FORBIDDEN');
    const phone = raw.trim().replace(/\s+/g, ' ');
    const digits = phone.replace(/\D/g, '');
    if (!phone) throw new ZiteError('Enter a phone number so the office and maintenance can reach you.', 'BAD_REQUEST');
    if (digits.length < 10 || digits.length > 15 || /[^\d\s()+.\-x#ext]/i.test(phone)) throw new ZiteError('Enter a phone number with area code, like (303) 555-0142.', 'BAD_REQUEST');
    if (phone === identity.tenant.phone) return { phone };

    await zite.tenants.update({ id: identity.tenant.id, record: { phone } });
    await logActivity({
      entityType: 'tenant',
      entityId: identity.tenant.id,
      action: 'phone_updated',
      summary: 'updated their phone number in the portal',
      actorName: identity.tenant.name || identity.name,
      tenantId: identity.tenant.id,
      leaseId: identity.leases[0]?.id ?? null,
      data: { from: identity.tenant.phone || null, to: phone, source: 'Portal' },
    });
    return { phone };
  },
});
