import type { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { isDemo } from '@project/shared/server/demoPreview';
import { day, num, ref, str } from '@project/shared/server/sql';

/**
 * Who is signed in to the portal, and what they may see.
 *
 * One sign-in can be several people to the company at once: a resident on a
 * lease, the owner of a building, a vendor, an applicant. Identity is the
 * VERIFIED email on the session matched against Tenants, Owners and Vendors —
 * never an id sent by the browser — and every portal endpoint scopes its
 * queries through the helpers below. "Missing" and "not yours" return the
 * same NOT_FOUND, so ids can't be probed.
 */

type UserLike = { email?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined;

export type PortalLease = {
  id: string;
  number: number | null;
  name: string;
  status: string;
  role: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitName: string;
  startDate: string | null;
  endDate: string | null;
  moveOutDate: string | null;
};

export type PortalIdentity = {
  email: string;
  name: string;
  tenant: { id: string; name: string; phone: string } | null;
  /** Leases this person is on as a resident (primary or co-tenant), newest first. */
  leases: PortalLease[];
  owner: { id: string; name: string; contactName: string } | null;
  vendor: { id: string; name: string; contactName: string } | null;
  applications: number;
};

/** `inputSchema` isn't enforced by the runtime, so every portal endpoint re-parses its input. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, raw: unknown, fallback = "That request wasn't valid. Reload the page and try again."): z.infer<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const custom = issue && issue.code === 'custom' ? issue.message : issue?.message && /[A-Z].*\.$/.test(issue.message) ? issue.message : null;
    throw new ZiteError(custom ?? fallback, 'BAD_REQUEST');
  }
  return parsed.data;
}

export function sessionEmail(context: { user?: UserLike }) {
  return context.user?.email?.trim().toLowerCase() || null;
}

/**
 * The demo visitor's email matches nobody, so they see the sample personas: the
 * ones the seed linked to the workspace's first admin, else the oldest tenant on
 * an active lease and the oldest portal-enabled owner and vendor.
 */
const DEMO_ORDER = `ORDER BY CASE WHEN LOWER(x."email") = (SELECT LOWER(m."email") FROM "Members" m WHERE m."role" = 'Admin' AND COALESCE(m."status", '') <> 'Deactivated' ORDER BY m.created_at ASC LIMIT 1) THEN 0 ELSE 1 END, x.created_at ASC LIMIT 1`;
const demoPersonas = () => [
  zite.sql({
    query: `SELECT x.id, x."name", x."phone" FROM "Tenants" x WHERE COALESCE(x."archived", false) = false AND EXISTS (SELECT 1 FROM "LeaseTenants" lt JOIN "Leases" l ON l.id::text = lt."leaseId" WHERE lt."tenantId" = x.id::text AND lt."role" IN ('Primary', 'Co-tenant') AND l."status" = 'Active') ${DEMO_ORDER}`,
    params: [],
  }),
  zite.sql({ query: `SELECT x.id, x."name", x."contactName" FROM "Owners" x WHERE COALESCE(x."portalEnabled", false) = true AND COALESCE(x."status", 'Active') = 'Active' ${DEMO_ORDER}`, params: [] }),
  zite.sql({ query: `SELECT x.id, x."name", x."contactName" FROM "Vendors" x WHERE COALESCE(x."portalEnabled", false) = true AND COALESCE(x."status", 'Active') = 'Active' ${DEMO_ORDER}`, params: [] }),
];

export async function getIdentity(context: { user?: UserLike }): Promise<PortalIdentity | null> {
  const email = sessionEmail(context);
  if (!email) return null;
  const [tenants, owners, vendors, apps] = await Promise.all([
    ...(isDemo(context)
      ? demoPersonas()
      : [
          zite.sql({ query: `SELECT id, "name", "phone" FROM "Tenants" WHERE LOWER("email") = $1 AND COALESCE("archived", false) = false ORDER BY created_at ASC LIMIT 1`, params: [email] }),
          zite.sql({ query: `SELECT id, "name", "contactName" FROM "Owners" WHERE LOWER("email") = $1 AND COALESCE("portalEnabled", false) = true AND COALESCE("status", 'Active') = 'Active' ORDER BY created_at ASC LIMIT 1`, params: [email] }),
          zite.sql({ query: `SELECT id, "name", "contactName" FROM "Vendors" WHERE LOWER("email") = $1 AND COALESCE("portalEnabled", false) = true AND COALESCE("status", 'Active') = 'Active' ORDER BY created_at ASC LIMIT 1`, params: [email] }),
        ]),
    zite.sql({ query: `SELECT COUNT(*) AS n FROM "Applications" WHERE LOWER("portalEmail") = $1`, params: [email] }),
  ]);
  const t = tenants.rows[0];
  let leases: PortalLease[] = [];
  if (t) {
    const { rows } = await zite.sql({
      query: `
        SELECT l.id, l."number", l."name", l."status", lt."role", l."propertyId", p."name" AS "propertyName", l."unitId", u."name" AS "unitName", l."startDate", l."endDate", l."moveOutDate"
        FROM "LeaseTenants" lt
        JOIN "Leases" l ON l.id::text = lt."leaseId"
        LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
        LEFT JOIN "Units" u ON u.id::text = l."unitId"
        WHERE lt."tenantId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') AND l."status" IN ('Active', 'Pending signature', 'Ended')
        ORDER BY CASE l."status" WHEN 'Active' THEN 0 WHEN 'Pending signature' THEN 1 ELSE 2 END, l."startDate" DESC NULLS LAST`,
      params: [String(t.id)],
    });
    leases = rows.map(r => ({
      id: String(r.id),
      number: r.number == null ? null : num(r.number),
      name: str(r.name) ?? '',
      status: String(r.status),
      role: String(r.role),
      propertyId: ref(r.propertyId) ?? '',
      propertyName: str(r.propertyName) ?? '',
      unitId: ref(r.unitId) ?? '',
      unitName: str(r.unitName) ?? '',
      startDate: day(r.startDate),
      endDate: day(r.endDate),
      moveOutDate: day(r.moveOutDate),
    }));
  }
  const o = owners.rows[0];
  const v = vendors.rows[0];
  const name =
    [context.user?.firstName, context.user?.lastName].filter(Boolean).join(' ').trim() ||
    str(t?.name) ||
    str(o?.contactName) ||
    str(v?.contactName) ||
    email.split('@')[0];
  return {
    email,
    name,
    tenant: t ? { id: String(t.id), name: str(t.name) ?? name, phone: str(t.phone) ?? '' } : null,
    leases,
    owner: o ? { id: String(o.id), name: str(o.name) ?? '', contactName: str(o.contactName) ?? '' } : null,
    vendor: v ? { id: String(v.id), name: str(v.name) ?? '', contactName: str(v.contactName) ?? '' } : null,
    applications: num(apps.rows[0]?.n),
  };
}

async function requireIdentity(context: { user?: UserLike }) {
  const identity = await getIdentity(context);
  if (!identity) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
  return identity;
}

/**
 * A resident and one of their leases. With no lease id, the current one:
 * active first, then a lease waiting for signature, then the most recent that ended.
 */
const lastSeenWrite = new Map<string, number>();

export async function requireResident(context: { user?: UserLike }, leaseId?: string | null) {
  const identity = await requireIdentity(context);
  if (!identity.tenant || !identity.leases.length) throw new ZiteError("We couldn't find a lease for your account. If you just moved in, ask the office to invite you with this email address.", 'NOT_FOUND');
  const lease = leaseId ? identity.leases.find(l => l.id === leaseId) : identity.leases[0];
  if (!lease) throw new ZiteError("We couldn't find that lease.", 'NOT_FOUND');
  // Marks the resident as having used the portal, at most every ten minutes per worker.
  const seen = lastSeenWrite.get(identity.tenant.id) ?? 0;
  if (Date.now() - seen > 10 * 60 * 1000 && !isDemo(context)) {
    lastSeenWrite.set(identity.tenant.id, Date.now());
    void zite.tenants.update({ id: identity.tenant.id, record: { portalSeenAt: new Date().toISOString() } }).catch(() => undefined);
  }
  return { identity, tenantId: identity.tenant.id, lease };
}

export async function requireOwner(context: { user?: UserLike }) {
  const identity = await requireIdentity(context);
  if (!identity.owner) throw new ZiteError("Your account isn't set up for owner access. Ask your property manager to enable the owner portal for this email.", 'FORBIDDEN');
  return { identity, ownerId: identity.owner.id };
}

/** Properties an owner may see. */
export async function ownerPropertyIds(ownerId: string) {
  const { rows } = await zite.sql({ query: `SELECT id FROM "Properties" WHERE "ownerId" = $1 AND COALESCE("status", 'Active') <> 'Archived'`, params: [ownerId] });
  return rows.map(r => String(r.id));
}

export async function requireVendor(context: { user?: UserLike }) {
  const identity = await requireIdentity(context);
  if (!identity.vendor) throw new ZiteError("Your account isn't set up for vendor access. Ask the property manager to enable the vendor portal for this email.", 'FORBIDDEN');
  return { identity, vendorId: identity.vendor.id };
}

/** An application belongs to whoever's verified email it was started with. */
export async function requireOwnApplication(context: { user?: UserLike }, applicationId: string) {
  const email = sessionEmail(context);
  if (!email) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
  const { rows } = await zite.sql({ query: `SELECT * FROM "Applications" WHERE id::text = $1 AND LOWER("portalEmail") = $2 LIMIT 1`, params: [applicationId, email] });
  if (!rows[0]) throw new ZiteError("We couldn't find that application.", 'NOT_FOUND');
  return rows[0];
}

/** Honest limits for anything a stranger can post: inquiries, applications. */
export function assertReasonable(text: unknown, max = 5000) {
  if (typeof text === 'string' && text.length > max) throw new ZiteError('That’s a little too long — please shorten it.', 'BAD_REQUEST');
}
