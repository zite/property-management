import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { WorkOrderStatus } from '@project/shared/constants';
import { addPeriods, dueDateIn, periodOf, todayIn } from '@project/shared/dates';
import { formatAddress } from '@project/shared/merge';
import { sumMoney, toCents } from '@project/shared/money';
import { membersWith } from '@project/shared/server/actor';
import type { ActivityRow } from '@project/shared/server/activity';
import type { Recipient } from '@project/shared/server/email';
import { day, iso, json, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { requireResident } from './identity';

/**
 * The resident area's server side: one place that turns "who is signed in and
 * which lease they picked" into everything a resident endpoint needs, and
 * that shapes records into what a resident may see.
 *
 * Nothing here returns staff-only fields: internal notes, vendor costs, owner
 * approval notes, other households' data. Endpoints build their output from
 * these helpers rather than from raw rows, so a new column on a table can't
 * leak by accident.
 */

type ContextLike = Parameters<typeof requireResident>[0];

export type ResidentLeaseFull = {
  id: string;
  number: number | null;
  name: string;
  status: string;
  role: string;
  leaseType: string;
  propertyId: string;
  propertyName: string;
  propertyColor: string;
  unitId: string;
  unitName: string;
  address: string;
  managerId: string | null;
  startDate: string | null;
  endDate: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  noticeGivenOn: string | null;
  moveOutReason: string;
  forwardingAddress: string;
  rent: number;
  deposit: number;
  rentDueDay: number;
  renewalStatus: string;
  renewalRent: number | null;
  renewalTermMonths: number | null;
  renewalOfferedAt: string | null;
  renewalExpiresOn: string | null;
  renewalRespondedAt: string | null;
  terms: string;
  documentUrl: string | null;
  signatures: string;
  sentForSignatureAt: string | null;
  signedAt: string | null;
  countersignedAt: string | null;
};

export type Resident = {
  tenantId: string;
  name: string;
  email: string;
  lease: ResidentLeaseFull;
  recipient: Recipient;
};

/** The signed-in resident and the lease they're looking at, with everything about the home it's for. */
export async function residentFor(context: ContextLike, leaseId: string | null | undefined): Promise<Resident> {
  const { identity, tenantId, lease: portalLease } = await requireResident(context, leaseId || null);
  const { rows } = await zite.sql({
    query: `
      SELECT l.*, p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", p."managerId", p."color" AS "propertyColor", u."name" AS "unitName"
      FROM "Leases" l
      LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
      LEFT JOIN "Units" u ON u.id::text = l."unitId"
      WHERE l.id::text = $1 LIMIT 1`,
    params: [portalLease.id],
  });
  const r = rows[0];
  if (!r) throw new ZiteError("We couldn't find that lease.", 'NOT_FOUND');
  const unitName = str(r.unitName) ?? '';
  const lease: ResidentLeaseFull = {
    id: String(r.id),
    number: numOrNull(r.number),
    name: str(r.name) ?? '',
    status: str(r.status) ?? '',
    role: portalLease.role,
    leaseType: str(r.leaseType) || 'Fixed term',
    propertyId: ref(r.propertyId) ?? '',
    propertyName: str(r.propertyName) ?? '',
    propertyColor: str(r.propertyColor) || '#0d9488',
    unitId: ref(r.unitId) ?? '',
    unitName,
    address: formatAddress({ street: str(r.street), city: str(r.city), state: str(r.state), postalCode: str(r.postalCode) }, unitName),
    managerId: ref(r.managerId),
    startDate: day(r.startDate),
    endDate: day(r.endDate),
    moveInDate: day(r.moveInDate),
    moveOutDate: day(r.moveOutDate),
    noticeGivenOn: day(r.noticeGivenOn),
    moveOutReason: str(r.moveOutReason) ?? '',
    forwardingAddress: str(r.forwardingAddress) ?? '',
    rent: num(r.rent),
    deposit: num(r.deposit),
    rentDueDay: Math.min(28, Math.max(1, num(r.rentDueDay, 1))),
    renewalStatus: str(r.renewalStatus) || 'None',
    renewalRent: numOrNull(r.renewalRent),
    renewalTermMonths: numOrNull(r.renewalTermMonths),
    renewalOfferedAt: iso(r.renewalOfferedAt),
    renewalExpiresOn: day(r.renewalExpiresOn),
    renewalRespondedAt: iso(r.renewalRespondedAt),
    terms: str(r.terms) ?? '',
    documentUrl: ref(r.documentUrl),
    signatures: str(r.signatures) ?? '',
    sentForSignatureAt: iso(r.sentForSignatureAt),
    signedAt: iso(r.signedAt),
    countersignedAt: iso(r.countersignedAt),
  };
  const name = identity.tenant?.name || identity.name;
  return { tenantId, name, email: identity.email, lease, recipient: { kind: 'tenant', id: tenantId, name, email: identity.email } };
}

/** "The Alder 201" — how a resident names their home. */
export const homeLabel = (l: Pick<ResidentLeaseFull, 'propertyName' | 'unitName'>) =>
  [l.propertyName, l.unitName && !/^(main|house|home)$/i.test(l.unitName) ? l.unitName.replace(/^unit\s+/i, '') : ''].filter(Boolean).join(' ');

/** Staff to tell about something a resident did: the property's manager, or the people who could act if it has none. */
export async function officeRecipients(lease: Pick<ResidentLeaseFull, 'managerId'>, fallback: Parameters<typeof membersWith>[0] = 'residents.manage') {
  if (lease.managerId) {
    const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE id::text = $1 AND COALESCE("status", '') <> 'Deactivated' LIMIT 1`, params: [lease.managerId] });
    if (rows[0]) return [lease.managerId];
  }
  const people = await membersWith(fallback);
  // Prefer the people who run properties over every leasing agent.
  const leads = people.filter(p => p.role === 'Admin' || p.role === 'Property Manager');
  return (leads.length ? leads : people).map(p => p.id);
}

/** Honest per-day limits for things a resident can create, so a stuck button or a script can't flood the office. */
export async function assertDailyLimit(table: 'WorkOrders' | 'Messages' | 'Documents', column: 'leaseId' | 'tenantId', id: string, max: number, what: string) {
  const { rows } = await zite.sql({
    query: `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" = $1 AND created_at > now() - interval '1 day'`,
    params: [id],
  });
  if (num(rows[0]?.n) >= max) throw new ZiteError(`You've sent a lot of ${what} today. Please call the office if you need more help.`, 'RATE_LIMITED');
}

// ── Files ────────────────────────────────────────────────────────────────────

export type FileRef = { url: string; name: string };

export function parseFiles(raw: unknown): FileRef[] {
  const list = json<unknown[]>(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .map(f => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
    .filter(f => typeof f.url === 'string' && f.url)
    .map(f => ({ url: String(f.url), name: String(f.name ?? 'File') }));
}

export const isImageName = (name: string, url = '') => /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i.test(name) || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) || /images\.unsplash\.com/.test(url);

// ── Money ────────────────────────────────────────────────────────────────────

export type NextCharges = { dueDate: string; total: number; items: Array<{ description: string; amount: number }> };

/**
 * What the resident will owe next and when: the earliest due date, today or
 * later, of recurring charges not yet posted — rent plus parking, pets and
 * utilities that fall on the same day.
 */
export async function nextRecurringCharges(lease: Pick<ResidentLeaseFull, 'id' | 'status' | 'moveOutDate' | 'startDate'>, timezone: string): Promise<NextCharges | null> {
  if (lease.status !== 'Active' && lease.status !== 'Pending signature') return null;
  const today = todayIn(timezone);
  const { rows } = await zite.sql({
    query: `SELECT id, "description", "amount", "frequency", "dayOfMonth", "startDate", "endDate" FROM "RecurringCharges" WHERE "leaseId" = $1 AND COALESCE("active", false) = true`,
    params: [lease.id],
  });
  if (!rows.length) return null;
  const { rows: posted } = await zite.sql({
    query: `SELECT "recurringChargeId", "period" FROM "Transactions" WHERE "leaseId" = $1 AND COALESCE("recurringChargeId", '') <> '' AND "status" = 'Posted'`,
    params: [lease.id],
  });
  const done = new Set(posted.map(p => `${p.recurringChargeId}|${p.period}`));
  const candidates: Array<{ due: string; description: string; amount: number }> = [];
  const first = periodOf(lease.startDate && lease.startDate > today ? lease.startDate : today);
  for (const r of rows) {
    const rcStart = day(r.startDate) ?? lease.startDate ?? today;
    const end = day(r.endDate);
    const step = r.frequency === 'Quarterly' ? 3 : r.frequency === 'Annually' ? 12 : 1;
    for (let i = 0; i < 14; i++) {
      const p = addPeriods(first, i);
      const monthsFromStart = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - (Number(rcStart.slice(0, 4)) * 12 + Number(rcStart.slice(5, 7)));
      if (monthsFromStart < 0 || monthsFromStart % step !== 0) continue;
      const due = dueDateIn(p, num(r.dayOfMonth, 1));
      if (due < today || due < rcStart) continue;
      if (end && due > end) break;
      if (lease.moveOutDate && due > lease.moveOutDate) break;
      if (done.has(`${r.id}|${p}`)) continue;
      if (num(r.amount) > 0) candidates.push({ due, description: (str(r.description) || 'Rent').trim(), amount: num(r.amount) });
      break;
    }
  }
  if (!candidates.length) return null;
  const dueDate = candidates.map(c => c.due).sort()[0];
  const items = candidates.filter(c => c.due === dueDate).sort((a, b) => (a.description === 'Rent' ? -1 : b.description === 'Rent' ? 1 : b.amount - a.amount));
  return { dueDate, total: sumMoney(items.map(i => i.amount)), items: items.map(i => ({ description: i.description, amount: i.amount })) };
}

/** The most a resident may pay online at once: twice what they owe plus their next charges, so a typo can't charge a card $18,750. */
export function paymentCeiling(balance: number, next: NextCharges | null) {
  const cents = 2 * (Math.max(0, toCents(balance)) + toCents(next?.total ?? 0));
  return Math.max(cents, 100) / 100;
}

// ── Work orders ──────────────────────────────────────────────────────────────

export type ResidentRequestRow = {
  id: string;
  number: number;
  title: string;
  category: string;
  priority: string;
  status: WorkOrderStatus;
  scheduledFor: string | null;
  reportedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  vendorName: string | null;
  photoCount: number;
  tenantRating: number | null;
  unread: number;
};

const REQUEST_COLUMNS = `
  w.id, w."number", w."title", w."category", w."priority", w."status", w."scheduledFor", w."reportedAt", w."completedAt", w."lastActivityAt", w.created_at,
  w."photos", w."tenantRating", v."name" AS "vendorName"`;

export function toRequestRow(r: Record<string, unknown>, unread = 0): ResidentRequestRow {
  return {
    id: String(r.id),
    number: num(r.number),
    title: str(r.title) || 'Maintenance request',
    category: str(r.category) || 'General',
    priority: str(r.priority) || 'Normal',
    status: (str(r.status) || 'New') as WorkOrderStatus,
    scheduledFor: iso(r.scheduledFor),
    reportedAt: iso(r.reportedAt) ?? iso(r.created_at),
    completedAt: iso(r.completedAt),
    lastActivityAt: iso(r.lastActivityAt) ?? iso(r.created_at),
    vendorName: ref(r.vendorName),
    photoCount: parseFiles(r.photos).length,
    tenantRating: numOrNull(r.tenantRating),
    unread,
  };
}

export async function listRequests(leaseId: string, tenantId: string, limit = 500) {
  const { rows } = await zite.sql({
    query: `
      SELECT ${REQUEST_COLUMNS},
        (SELECT COUNT(*) FROM "Messages" m WHERE m."thread" = 'work_order:' || w.id::text AND m."tenantId" = $2 AND m."direction" = 'Outbound' AND m."readAt" IS NULL) AS "unread"
      FROM "WorkOrders" w
      LEFT JOIN "Vendors" v ON v.id::text = w."vendorId"
      WHERE w."leaseId" = $1
      ORDER BY CASE WHEN w."status" IN ('New', 'Scheduled', 'In progress', 'On hold') THEN 0 ELSE 1 END, COALESCE(w."lastActivityAt", w."reportedAt", w.created_at) DESC
      LIMIT ${Math.max(1, Math.min(500, limit))}`,
    params: [leaseId, tenantId],
  });
  return rows.map(r => toRequestRow(r, num(r.unread)));
}

/** One work order on this lease, by its number. Anything else is NOT_FOUND. */
export async function requestOnLease(leaseId: string, number: number) {
  if (!Number.isInteger(number) || number <= 0) throw new ZiteError("We couldn't find that request.", 'NOT_FOUND');
  const { rows } = await zite.sql({
    query: `
      SELECT w.*, v."name" AS "vendorName", v."phone" AS "vendorPhone"
      FROM "WorkOrders" w LEFT JOIN "Vendors" v ON v.id::text = w."vendorId"
      WHERE w."leaseId" = $1 AND w."number" = $2 LIMIT 1`,
    params: [leaseId, number],
  });
  const r = rows[0];
  if (!r) throw new ZiteError("We couldn't find that request.", 'NOT_FOUND');
  return r;
}

export type TimelineEvent = { id: string; label: string; detail: string | null; at: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' };

const STATUS_EVENT: Record<string, { label: string; tone: TimelineEvent['tone'] }> = {
  New: { label: 'Reopened', tone: 'info' },
  Scheduled: { label: 'Scheduled', tone: 'info' },
  'In progress': { label: 'Work started', tone: 'warning' },
  'On hold': { label: 'Put on hold', tone: 'neutral' },
  Completed: { label: 'Marked complete', tone: 'success' },
  Canceled: { label: 'Canceled', tone: 'neutral' },
};

/**
 * A work order's history in words a resident can see. Built from the action
 * and its structured data — never the staff summary, which can mention costs,
 * owner approvals or who was assigned internally. Unknown actions are left out.
 */
export function residentTimeline(activity: ActivityRow[], wo: { vendorName: string | null; tenantRating: number | null; source: string }): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const sorted = [...activity].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const lastVendor = [...sorted].reverse().find(a => a.action === 'vendor_assigned')?.id;
  for (const a of sorted) {
    let e: Omit<TimelineEvent, 'id' | 'at'> | null = null;
    switch (a.action) {
      case 'created':
        e = { label: 'Request received', detail: wo.source === 'Portal' ? (a.actorName ? `Submitted in the portal by ${a.actorName}` : 'Submitted in the portal') : 'Opened by the office', tone: 'info' };
        break;
      case 'status_changed': {
        const to = typeof a.data.to === 'string' ? a.data.to : /^moved to (.+)$/i.exec(a.summary)?.[1] ?? null;
        const s = to ? STATUS_EVENT[to] : null;
        if (s) {
          const byResident = to === 'Canceled' && /by the resident/i.test(a.summary);
          e = { label: s.label, detail: byResident ? 'You canceled this request' : null, tone: s.tone };
        }
        break;
      }
      case 'scheduled':
      case 'rescheduled': {
        const when = typeof a.data.scheduledFor === 'string' ? a.data.scheduledFor : null;
        e = { label: a.action === 'scheduled' ? 'Visit scheduled' : 'Visit rescheduled', detail: when, tone: 'info' };
        break;
      }
      case 'vendor_assigned':
        e = { label: 'Technician assigned', detail: a.id === lastVendor && wo.vendorName ? wo.vendorName : null, tone: 'neutral' };
        break;
      case 'rated': {
        const n = typeof a.data.rating === 'number' ? a.data.rating : Number(/(\d)\s*\/\s*5/.exec(a.summary)?.[1] ?? wo.tenantRating ?? 0);
        e = { label: 'Work rated', detail: n ? `${n} out of 5` : null, tone: 'success' };
        break;
      }
    }
    if (!e) continue;
    const prev = out[out.length - 1];
    if (prev && prev.label === e.label && prev.detail === e.detail) continue;
    out.push({ id: a.id, at: a.occurredAt, ...e });
  }
  return out;
}

// ── Messages ─────────────────────────────────────────────────────────────────

export type ResidentMessage = {
  id: string;
  subject: string;
  body: string;
  mine: boolean;
  senderName: string;
  sentAt: string;
  unread: boolean;
  attachments: FileRef[];
  workOrderNumber: number | null;
};

export function toResidentMessage(r: Record<string, unknown>, organizationName: string): ResidentMessage {
  const mine = r.direction === 'Inbound';
  return {
    id: String(r.id),
    subject: str(r.subject) ?? '',
    body: str(r.body) ?? '',
    mine,
    senderName: mine ? str(r.senderName) || 'You' : str(r.senderName) || organizationName,
    sentAt: iso(r.sentAt) ?? iso(r.created_at) ?? new Date().toISOString(),
    unread: !mine && !r.readAt,
    attachments: parseFiles(r.attachments),
    workOrderNumber: numOrNull(r.workOrderNumber),
  };
}

/**
 * A conversation a resident is part of. Internal notes never; in a work order
 * thread only what this resident sent or what was sent to them (the vendor's
 * and other people's messages are between them and the office).
 */
export async function residentThread(thread: string, tenantId: string, limit = 300) {
  const { rows } = await zite.sql({
    query: `
      SELECT * FROM (
        SELECT m.id, m."subject", m."body", m."direction", m."senderName", m."sentAt", m."readAt", m."attachments", m.created_at, w."number" AS "workOrderNumber"
        FROM "Messages" m
        LEFT JOIN "WorkOrders" w ON w.id::text = m."workOrderId"
        WHERE m."thread" = $1 AND m."tenantId" = $2 AND m."direction" IN ('Inbound', 'Outbound') AND m."channel" <> 'Note'
        ORDER BY COALESCE(m."sentAt", m.created_at) DESC
        LIMIT ${Math.max(1, Math.min(1000, limit))}
      ) recent ORDER BY COALESCE("sentAt", created_at) ASC`,
    params: [thread, tenantId],
  });
  return rows;
}

export const cleanAttachments = (list: FileRef[] | undefined) =>
  (list ?? []).filter(f => /^https:\/\//.test(f.url)).slice(0, 10).map(f => ({ url: f.url.slice(0, 2000), name: (f.name || 'File').slice(0, 200) }));

export const preview = (text: string, max = 140) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

