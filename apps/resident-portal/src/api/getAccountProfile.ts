import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { getIdentity } from '../server/identity';

/** The signed-in person's contact details as the company has them. */
export default createEndpoint({
  description: 'The signed-in person’s name, email and resident phone number',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    name: z.string(),
    email: z.string(),
    resident: z.object({ name: z.string(), phone: z.string() }).nullable(),
    applications: z.number(),
  }),
  execute: async ({ context }) => {
    const identity = await getIdentity(context);
    if (!identity) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
    return {
      name: identity.name,
      email: identity.email,
      resident: identity.tenant ? { name: identity.tenant.name, phone: identity.tenant.phone } : null,
      applications: identity.applications,
    };
  },
});
