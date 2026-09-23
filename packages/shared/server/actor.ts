import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { ROLES, type Role } from '../constants';
import { can, capabilitiesFor, type Capability } from '../roles';
import { getSettings } from './settings';

/**
 * The signed-in staff member.
 *
 * Every staff endpoint resolves who is acting from the SESSION and never from
 * an id in the request, so nobody can post a payment or approve an
 * application as someone else. The first person to open a fresh install
 * becomes its Admin; everyone after gets the organization's default role.
 */

export type Actor = { id: string; name: string; email: string; role: Role; created: boolean };

type UserLike = { email?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined;

export const asRole = (v: unknown): Role => ((ROLES as readonly string[]).includes(String(v)) ? (v as Role) : 'Property Manager');

const AVATAR_COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#4f46e5', '#be123c'];

/** A stable colour per person, so an avatar never changes between loads. */
export function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function nameFromEmail(email: string) {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim().replace(/\b\w/g, c => c.toUpperCase()) || email;
}

const SEEN_EVERY_MS = 10 * 60 * 1000;

export async function getActor(context: { user?: UserLike }): Promise<Actor> {
  const email = context.user?.email?.trim().toLowerCase();
  if (!email) throw new ZiteError('You need to be signed in', 'UNAUTHORIZED');

  const { rows } = await zite.sql({
    query: `SELECT id, "name", "role", "status", "lastSeenAt" FROM "Members" WHERE LOWER("email") = $1 ORDER BY created_at ASC LIMIT 1`,
    params: [email],
  });
  const row = rows[0];
  if (row) {
    if (row.status === 'Deactivated') {
      throw new ZiteError('Your access has been deactivated. Ask an admin to reactivate you.', 'FORBIDDEN');
    }
    const patch: Record<string, unknown> = {};
    if (row.status === 'Invited') patch.status = 'Active';
    const seen = row.lastSeenAt ? Date.parse(String(row.lastSeenAt)) : 0;
    if (Date.now() - seen > SEEN_EVERY_MS) patch.lastSeenAt = new Date().toISOString();
    if (Object.keys(patch).length) await zite.members.update({ id: String(row.id), record: patch as never }).catch(() => undefined);
    return { id: String(row.id), name: String(row.name || nameFromEmail(email)), email, role: asRole(row.role), created: false };
  }

  const { rows: profile } = await zite.sql({ query: `SELECT "name", "image" FROM "ziteUsers" WHERE LOWER("email") = $1 LIMIT 1`, params: [email] });
  const name =
    [context.user?.firstName, context.user?.lastName].filter(Boolean).join(' ').trim() ||
    (profile[0]?.name ? String(profile[0].name) : '') ||
    nameFromEmail(email);
  const { rows: admins } = await zite.sql({ query: `SELECT 1 FROM "Members" WHERE "role" = 'Admin' AND COALESCE("status", '') <> 'Deactivated' LIMIT 1`, params: [] });
  const role: Role = admins.length ? (await getSettings()).defaultRole : 'Admin';
  const created = await zite.members.create({
    record: {
      name,
      email,
      role,
      status: 'Active',
      color: colorFor(email),
      avatarUrl: profile[0]?.image ? String(profile[0].image) : null,
      lastSeenAt: new Date().toISOString(),
    },
  });
  return { id: created.id, name, email, role, created: true };
}

const REFUSAL: Partial<Record<Capability, string>> = {
  'portfolio.manage': 'Only property managers and admins can change properties and units',
  'owners.manage': 'Your role can’t change owners',
  'leasing.manage': 'Your role can’t manage leasing',
  'residents.manage': 'Your role can’t change residents or leases',
  'maintenance.manage': 'Your role can’t manage maintenance',
  'maintenance.create': 'Your role can’t create work orders',
  'vendors.manage': 'Your role can’t change vendors',
  'accounting.view': 'Your role can’t see financials',
  'receivables.manage': 'Your role can’t post charges or payments',
  'payables.manage': 'Your role can’t enter or pay bills',
  'banking.manage': 'Only accountants and admins can do that',
  'reports.view': 'Your role can’t see reports',
  'communications.send': 'Your role can’t send messages',
  'announcements.send': 'Your role can’t send announcements',
  'settings.manage': 'Only admins can change settings',
  'members.manage': 'Only admins can manage team members',
};

export function assertCan(actor: Actor, capability: Capability) {
  if (!can(actor.role, capability)) throw new ZiteError(REFUSAL[capability] ?? 'You don’t have permission to do that', 'FORBIDDEN');
}

export function canAny(actor: Actor, ...capabilities: Capability[]) {
  return capabilities.some(c => can(actor.role, c));
}

export { can, capabilitiesFor };

/** Active members with a capability — who to notify about a new application, a bill, an approval. */
export async function membersWith(capability: Capability): Promise<Array<{ id: string; name: string; email: string; role: Role }>> {
  const { rows } = await zite.sql({ query: `SELECT id, "name", "email", "role" FROM "Members" WHERE COALESCE("status", '') <> 'Deactivated'`, params: [] });
  return rows
    .map(r => ({ id: String(r.id), name: String(r.name ?? ''), email: String(r.email ?? ''), role: asRole(r.role) }))
    .filter(m => can(m.role, capability));
}
