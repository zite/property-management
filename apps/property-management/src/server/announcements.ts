import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import type { Actor } from '@project/shared/server/actor';
import { sendEmail, threadKey } from '@project/shared/server/email';
import { portalLink, type OrgSettings } from '@project/shared/server/settings';
import { iso, json, num, ref, str, withRetry } from '@project/shared/server/sql';
import { deliverMessage, loadPeople, mergeContexts, personKey, render, type Person } from './comms';

/**
 * Announcements: one message per recipient, sent in resumable batches.
 *
 * Storage within today's schema (see the lead's "Shared changes needed"):
 *   - audience + propertyIds encode six audiences. Resident and owner audiences
 *     scoped to properties keep `propertyIds` a JSON array, which is what the
 *     resident portal's news panel reads. Unit-scoped notices store
 *     `{"unitIds": [...]}` so the portal's building-wide news panel skips them —
 *     those residents get the message in their own conversation instead.
 *   - A Draft with `sentAt` set is scheduled for that time.
 *   - A Sent announcement has as many Messages rows as it has recipients; fewer
 *     means sending is still going (or stopped and can resume). A recipient
 *     who already has a row for this announcement is never sent to again, so
 *     every retry continues where the last one stopped.
 */

export const AUDIENCES = ['residents', 'residents_properties', 'residents_units', 'owners', 'owners_properties', 'vendors'] as const;
export type AudienceKey = (typeof AUDIENCES)[number];
export type AudienceConfig = { audience: AudienceKey; propertyIds: string[]; unitIds: string[] };

export const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  residents: 'All current residents',
  residents_properties: 'Residents of selected properties',
  residents_units: 'Residents of selected units',
  owners: 'All owners',
  owners_properties: 'Owners of selected properties',
  vendors: 'All active vendors',
};

export function encodeAudience(cfg: AudienceConfig): { audience: string; propertyIds: string } {
  switch (cfg.audience) {
    case 'residents':
      return { audience: 'All residents', propertyIds: '[]' };
    case 'residents_properties':
      return { audience: 'Selected properties', propertyIds: JSON.stringify(cfg.propertyIds) };
    case 'residents_units':
      return { audience: 'Selected properties', propertyIds: JSON.stringify({ unitIds: cfg.unitIds }) };
    case 'owners':
      return { audience: 'Owners', propertyIds: '[]' };
    case 'owners_properties':
      return { audience: 'Owners', propertyIds: JSON.stringify(cfg.propertyIds) };
    case 'vendors':
      return { audience: 'Vendors', propertyIds: '[]' };
  }
}

export function decodeAudience(audience: unknown, propertyIds: unknown): AudienceConfig {
  const raw = json<unknown>(propertyIds, []);
  const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  const units = !Array.isArray(raw) && raw && typeof raw === 'object' && Array.isArray((raw as { unitIds?: unknown }).unitIds) ? ((raw as { unitIds: unknown[] }).unitIds.map(String).filter(Boolean)) : [];
  switch (str(audience)) {
    case 'Selected properties':
      return units.length || (!Array.isArray(raw) && raw) ? { audience: 'residents_units', propertyIds: [], unitIds: units } : { audience: 'residents_properties', propertyIds: list, unitIds: [] };
    case 'Owners':
      return list.length ? { audience: 'owners_properties', propertyIds: list, unitIds: [] } : { audience: 'owners', propertyIds: [], unitIds: [] };
    case 'Vendors':
      return { audience: 'vendors', propertyIds: [], unitIds: [] };
    default:
      return { audience: 'residents', propertyIds: [], unitIds: [] };
  }
}

export const audienceKind = (a: AudienceKey) => (a.startsWith('residents') ? 'tenant' : a.startsWith('owners') ? 'owner' : 'vendor');

/** Everyone an audience reaches today, in a stable order (so batches are stable), looked up with their merge links. */
export async function audiencePeople(cfg: AudienceConfig): Promise<Person[]> {
  let ids: string[] = [];
  const kind = audienceKind(cfg.audience);
  if (kind === 'tenant') {
    if (cfg.audience === 'residents_properties' && !cfg.propertyIds.length) return [];
    if (cfg.audience === 'residents_units' && !cfg.unitIds.length) return [];
    const scope = cfg.audience === 'residents_properties' ? `AND l."propertyId" = ANY($1)` : cfg.audience === 'residents_units' ? `AND l."unitId" = ANY($1)` : '';
    const { rows } = await zite.sql({
      query: `
        SELECT DISTINCT t.id::text AS id
        FROM "Leases" l
        JOIN "LeaseTenants" lt ON lt."leaseId" = l.id::text
        JOIN "Tenants" t ON t.id::text = lt."tenantId"
        WHERE l."status" = 'Active' AND lt."role" IN ('Primary', 'Co-tenant') AND COALESCE(t."archived", false) = false ${scope}
        ORDER BY 1
        LIMIT 5000`,
      params: scope ? [cfg.audience === 'residents_units' ? cfg.unitIds : cfg.propertyIds] : [],
    });
    ids = rows.map(r => String(r.id));
  } else if (kind === 'owner') {
    if (cfg.audience === 'owners_properties' && !cfg.propertyIds.length) return [];
    const scope = cfg.audience === 'owners_properties' ? `AND o.id::text IN (SELECT p."ownerId" FROM "Properties" p WHERE p.id::text = ANY($1))` : '';
    const { rows } = await zite.sql({
      query: `SELECT o.id::text AS id FROM "Owners" o WHERE COALESCE(o."status", '') <> 'Archived' ${scope} ORDER BY 1 LIMIT 5000`,
      params: scope ? [cfg.propertyIds] : [],
    });
    ids = rows.map(r => String(r.id));
  } else {
    const { rows } = await zite.sql({ query: `SELECT v.id::text AS id FROM "Vendors" v WHERE COALESCE(v."status", '') <> 'Inactive' ORDER BY 1 LIMIT 5000`, params: [] });
    ids = rows.map(r => String(r.id));
  }
  const people = await loadPeople(ids.map(id => ({ kind, id })));
  return ids.map(id => people.get(personKey(kind, id))).filter((p): p is Person => Boolean(p));
}

export type AnnouncementRow = ReturnType<typeof toAnnouncement>;

export function toAnnouncement(r: Record<string, unknown>) {
  const status = str(r.status) === 'Sent' ? 'Sent' : 'Draft';
  const cfg = decodeAudience(r.audience, r.propertyIds);
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    body: str(r.body) ?? '',
    status: status as 'Draft' | 'Sent',
    audience: cfg.audience,
    propertyIds: cfg.propertyIds,
    unitIds: cfg.unitIds,
    channel: str(r.channel) === 'Portal only' ? ('Portal only' as const) : ('Email and portal' as const),
    sentAt: iso(r.sentAt),
    sentById: ref(r.sentById),
    recipientCount: num(r.recipientCount),
    pinnedUntil: r.pinnedUntil ? String(r.pinnedUntil).slice(0, 10) : null,
    createdAt: iso(r.created_at),
  };
}

export async function loadAnnouncement(id: string) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Announcements" WHERE id::text = $1`, params: [id] });
  if (!rows[0]) throw new ZiteError('That announcement no longer exists.', 'NOT_FOUND');
  return toAnnouncement(rows[0]);
}

/** Delivery tallies per announcement, from its Messages rows. */
export async function deliveryStats(ids: string[]) {
  if (!ids.length) return new Map<string, DeliveryStats>();
  const { rows } = await zite.sql({
    query: `
      SELECT m."announcementId" AS id, COUNT(*) AS total,
        SUM(CASE WHEN m."delivery" = 'Sent' THEN 1 ELSE 0 END) AS emailed,
        SUM(CASE WHEN m."delivery" = 'Failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN m."delivery" = 'Portal only' THEN 1 ELSE 0 END) AS "portalOnly",
        SUM(CASE WHEN m."readAt" IS NOT NULL THEN 1 ELSE 0 END) AS "read",
        MAX(m.created_at) AS "lastAt"
      FROM "Messages" m WHERE m."announcementId" = ANY($1) GROUP BY m."announcementId"`,
    params: [ids],
  });
  return new Map(rows.map(r => [String(r.id), { total: num(r.total), emailed: num(r.emailed), failed: num(r.failed), portalOnly: num(r.portalOnly), read: num(r.read), lastAt: iso(r.lastAt) } as DeliveryStats]));
}

export type DeliveryStats = { total: number; emailed: number; failed: number; portalOnly: number; read: number; lastAt: string | null };

/**
 * Where an announcement stands. `tracked` is false for announcements sent
 * before per-recipient delivery existed (no rows, sent over a day ago), which
 * must never be picked up and "resumed".
 */
export function announcementState(a: AnnouncementRow, s: DeliveryStats | undefined, now = Date.now()) {
  const total = s?.total ?? 0;
  if (a.status === 'Draft') return { state: a.sentAt ? ('Scheduled' as const) : ('Draft' as const), tracked: true, incomplete: false };
  const recent = a.sentAt ? now - Date.parse(a.sentAt) < 24 * 3_600_000 : false;
  if (total === 0 && !recent) return { state: 'Sent' as const, tracked: false, incomplete: false };
  const incomplete = total < a.recipientCount;
  return { state: incomplete ? ('Sending' as const) : ('Sent' as const), tracked: true, incomplete };
}

/** Busy = something wrote a row for it in the last few minutes; a second sender would race it. */
export const isBusy = (s: DeliveryStats | undefined, now = Date.now()) => Boolean(s?.lastAt && now - Date.parse(s.lastAt) < 3 * 60_000);

export type BatchResult = { sent: number; emailed: number; failed: number; portalOnly: number; remaining: number; done: boolean; total: number };

/**
 * Send to everyone in the audience who doesn't have this announcement yet,
 * one at a time (live rejects bursts of parallel writes), until `deadline`.
 * Existence is re-checked every few recipients so two overlapping runs can
 * overlap by a handful at most — and the scheduler never picks up an
 * announcement another run touched in the last three minutes.
 */
export async function sendAnnouncementBatch(a: AnnouncementRow, opts: { settings: OrgSettings; actor: Pick<Actor, 'id' | 'name'> | null; deadline: number }): Promise<BatchResult> {
  const cfg: { audience: AudienceKey; propertyIds: string[]; unitIds: string[] } = { audience: a.audience, propertyIds: a.propertyIds, unitIds: a.unitIds };
  const people = await audiencePeople(cfg);
  const now = new Date().toISOString();

  if (a.status === 'Draft') {
    await withRetry(() => zite.announcements.update({ id: a.id, record: { status: 'Sent', sentAt: now, sentById: opts.actor?.id ?? a.sentById ?? null, recipientCount: people.length } }));
    await logActivity({
      entityType: 'announcement',
      entityId: a.id,
      action: 'announcement_sent',
      summary: `sent the announcement “${a.title.slice(0, 120)}” to ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
      actorId: opts.actor?.id ?? null,
      actorName: opts.actor?.name ?? null,
    });
  }

  const merges = await mergeContexts(people, opts.settings, { propertyIds: cfg.audience === 'owners_properties' ? cfg.propertyIds : null });
  const byEmail = a.channel === 'Email and portal';
  const kind = audienceKind(cfg.audience);
  const link = kind === 'tenant' ? portalLink(opts.settings, '/resident') : kind === 'owner' ? portalLink(opts.settings, '/owner') : portalLink(opts.settings, '/vendor');
  const result: BatchResult = { sent: 0, emailed: 0, failed: 0, portalOnly: 0, remaining: 0, done: false, total: people.length };
  let stopped = false;

  for (let i = 0; i < people.length && !stopped; i += 10) {
    const chunk = people.slice(i, i + 10);
    const { rows } = await zite.sql({
      query: `SELECT "thread" FROM "Messages" WHERE "announcementId" = $1 AND "thread" = ANY($2)`,
      params: [a.id, chunk.map(p => threadKey(p.kind, p.id))],
    });
    const already = new Set(rows.map(r => String(r.thread)));
    for (const p of chunk) {
      if (already.has(threadKey(p.kind, p.id))) continue;
      if (Date.now() > opts.deadline) {
        stopped = true;
        break;
      }
      const ctx = merges.get(personKey(p.kind, p.id)) ?? {};
      const sent = await deliverMessage({
        settings: opts.settings,
        person: p,
        subject: render(a.title, ctx),
        body: render(a.body, ctx),
        byEmail,
        senderMemberId: a.sentById ?? opts.actor?.id ?? null,
        senderName: opts.actor?.name ?? null,
        announcementId: a.id,
        button: link ? { label: 'Open the portal', href: link } : null,
      });
      result.sent++;
      if (sent.delivery === 'Sent') result.emailed++;
      else if (sent.delivery === 'Failed') result.failed++;
      else result.portalOnly++;
    }
  }

  const stats = (await deliveryStats([a.id])).get(a.id);
  const delivered = stats?.total ?? 0;
  const targeted = new Set(people.map(p => threadKey(p.kind, p.id)));
  // People can leave the audience mid-send (a lease ends); count what's left against today's audience.
  const { rows: sentRows } = await zite.sql({ query: `SELECT COUNT(DISTINCT "thread") AS n FROM "Messages" WHERE "announcementId" = $1 AND "thread" = ANY($2)`, params: [a.id, [...targeted]] });
  result.remaining = Math.max(0, targeted.size - num(sentRows[0]?.n));
  result.done = result.remaining === 0;
  if (result.done) {
    // The count becomes what was actually sent, so a finished announcement never reads as incomplete.
    await withRetry(() => zite.announcements.update({ id: a.id, record: { recipientCount: delivered } }));
  }
  return result;
}

/** Email again every recipient whose email failed; their message row is updated, never duplicated. */
export async function retryFailedEmails(a: AnnouncementRow, opts: { settings: OrgSettings; deadline: number }) {
  const { rows } = await zite.sql({
    query: `SELECT id, "subject", "body", "tenantId", "ownerId", "vendorId", "applicationId" FROM "Messages" WHERE "announcementId" = $1 AND "delivery" = 'Failed' ORDER BY created_at ASC LIMIT 500`,
    params: [a.id],
  });
  const refs = rows.map(r => (ref(r.tenantId) ? { kind: 'tenant' as const, id: String(r.tenantId) } : ref(r.ownerId) ? { kind: 'owner' as const, id: String(r.ownerId) } : ref(r.vendorId) ? { kind: 'vendor' as const, id: String(r.vendorId) } : { kind: 'applicant' as const, id: String(r.applicationId) }));
  const people = await loadPeople(refs);
  let fixed = 0;
  let stillFailed = 0;
  let noEmail = 0;
  for (let i = 0; i < rows.length; i++) {
    if (Date.now() > opts.deadline) break;
    const r = rows[i];
    const p = people.get(personKey(refs[i].kind, refs[i].id));
    if (!p?.hasEmail) {
      noEmail++;
      continue;
    }
    const home = portalLink(opts.settings);
    const delivery = await sendEmail({ to: p.email, subject: str(r.subject) ?? a.title, text: str(r.body) ?? '', settings: opts.settings, button: home ? { label: 'Open the portal', href: home } : null });
    if (delivery === 'Sent') {
      await withRetry(() => zite.messages.update({ id: String(r.id), record: { delivery: 'Sent', channel: 'Email' } }));
      fixed++;
    } else stillFailed++;
  }
  return { fixed, stillFailed, noEmail, remaining: Math.max(0, rows.length - fixed - stillFailed - noEmail) };
}
