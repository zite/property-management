import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { leaseBalances } from '@project/shared/server/ledger';
import { num } from '@project/shared/server/sql';
import { getIdentity } from '../server/identity';

/**
 * Who is signed in, which areas of the portal they have (resident, owner,
 * vendor, applicant), and the counts that badge the navigation.
 */
const Lease = z.object({
  id: z.string(), number: z.number().nullable(), name: z.string(), status: z.string(), role: z.string(), propertyId: z.string(), propertyName: z.string(),
  unitId: z.string(), unitName: z.string(), startDate: z.string().nullable(), endDate: z.string().nullable(), moveOutDate: z.string().nullable(),
});

export default createEndpoint({
  description: "The signed-in person's portal roles, leases and badge counts",
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    email: z.string(),
    name: z.string(),
    resident: z.object({ tenantId: z.string(), leases: z.array(Lease), balance: z.number(), openRequests: z.number(), unreadMessages: z.number(), toSign: z.number(), renewalOffers: z.number() }).nullable(),
    owner: z.object({ ownerId: z.string(), name: z.string(), pendingApprovals: z.number(), unreadMessages: z.number() }).nullable(),
    vendor: z.object({ vendorId: z.string(), name: z.string(), openWorkOrders: z.number(), unreadMessages: z.number() }).nullable(),
    applicant: z.object({ applications: z.number() }),
  }),
  execute: async ({ context }) => {
    const identity = await getIdentity(context);
    if (!identity) return { email: '', name: '', resident: null, owner: null, vendor: null, applicant: { applications: 0 } };

    let resident: { tenantId: string; leases: typeof identity.leases; balance: number; openRequests: number; unreadMessages: number; toSign: number; renewalOffers: number } | null = null;
    if (identity.tenant && identity.leases.length) {
      const leaseIds = identity.leases.map(l => l.id);
      const balances = await leaseBalances(identity.leases.filter(l => l.status !== 'Ended').map(l => l.id));
      const { rows } = await zite.sql({
        query: `
          SELECT
            (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."leaseId" = ANY($1) AND w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')) AS "openRequests",
            (SELECT COUNT(*) FROM "Messages" m WHERE m."tenantId" = $2 AND m."direction" = 'Outbound' AND m."readAt" IS NULL AND m."channel" <> 'Note') AS "unread",
            (SELECT COUNT(*) FROM "Leases" l JOIN "LeaseTenants" lt ON lt."leaseId" = l.id::text AND lt."tenantId" = $2 AND lt."role" IN ('Primary', 'Co-tenant')
              WHERE l.id::text = ANY($1) AND l."status" = 'Pending signature' AND lt."signedAt" IS NULL) AS "toSign",
            (SELECT COUNT(*) FROM "Leases" l WHERE l.id::text = ANY($1) AND l."status" = 'Active' AND l."renewalStatus" = 'Offered') AS "offers"`,
        params: [leaseIds, identity.tenant.id],
      });
      const r = rows[0] ?? {};
      resident = {
        tenantId: identity.tenant.id,
        leases: identity.leases,
        balance: [...balances.values()].reduce((a, b) => a + Math.max(0, b.balance), 0),
        openRequests: num(r.openRequests),
        unreadMessages: num(r.unread),
        toSign: num(r.toSign),
        renewalOffers: num(r.offers),
      };
    }

    let owner: { ownerId: string; name: string; pendingApprovals: number; unreadMessages: number } | null = null;
    if (identity.owner) {
      const { rows } = await zite.sql({
        query: `
          SELECT
            (SELECT COUNT(*) FROM "WorkOrders" w JOIN "Properties" p ON p.id::text = w."propertyId" WHERE p."ownerId" = $1 AND w."ownerApproval" = 'Pending' AND w."status" NOT IN ('Completed', 'Canceled')) AS "approvals",
            (SELECT COUNT(*) FROM "Messages" m WHERE m."ownerId" = $1 AND m."direction" = 'Outbound' AND m."readAt" IS NULL AND m."channel" <> 'Note') AS "unread"`,
        params: [identity.owner.id],
      });
      owner = { ownerId: identity.owner.id, name: identity.owner.name, pendingApprovals: num(rows[0]?.approvals), unreadMessages: num(rows[0]?.unread) };
    }

    let vendor: { vendorId: string; name: string; openWorkOrders: number; unreadMessages: number } | null = null;
    if (identity.vendor) {
      const { rows } = await zite.sql({
        query: `
          SELECT
            (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."vendorId" = $1 AND w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')) AS "open",
            (SELECT COUNT(*) FROM "Messages" m WHERE m."vendorId" = $1 AND m."direction" = 'Outbound' AND m."readAt" IS NULL AND m."channel" <> 'Note') AS "unread"`,
        params: [identity.vendor.id],
      });
      vendor = { vendorId: identity.vendor.id, name: identity.vendor.name, openWorkOrders: num(rows[0]?.open), unreadMessages: num(rows[0]?.unread) };
    }

    return { email: identity.email, name: identity.name, resident, owner, vendor, applicant: { applications: identity.applications } };
  },
});
