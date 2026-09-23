import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@project/shared/constants';
import { applicationRef } from '@project/shared/leases';
import { renderMerge, type MergeContext } from '@project/shared/merge';
import { findTemplate, messagePerson, orgMergeContext, type Recipient } from '@project/shared/server/email';
import { portalLink, type OrgSettings } from '@project/shared/server/settings';
import { day, iso, json, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { householdIncome, inquiryThread, normalizeScreening, screeningDone, screeningFlags, slugify, SLUG_RE } from '../components/leasing/rules';

/**
 * Leasing on the server: the row shapes the applications, leads and listings
 * endpoints return, and the few side effects they share (decision emails,
 * unique listing links).
 */

export type CoApplicant = { name: string; email: string; relationship: string; monthlyIncome: number | null; employer: string };

export function coApplicantsOf(raw: unknown): CoApplicant[] {
  const list = json<unknown>(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(c => c && typeof c === 'object')
    .map(c => {
      const o = c as Record<string, unknown>;
      return { name: String(o.name ?? '').trim(), email: String(o.email ?? '').trim(), relationship: String(o.relationship ?? '').trim(), monthlyIncome: numOrNull(o.monthlyIncome), employer: String(o.employer ?? '').trim() };
    })
    .filter(c => c.name || c.email);
}

const asStatus = (v: unknown): ApplicationStatus => ((APPLICATION_STATUSES as readonly string[]).includes(String(v)) ? (v as ApplicationStatus) : 'Submitted');

/** Columns for application lists: the row plus its listing, unit rent and lease. */
export const APPLICATION_SELECT = `
  a.*,
  l."title" AS "listingTitle", l."rent" AS "listingRent", l."deposit" AS "listingDeposit", l."slug" AS "listingSlug", l."status" AS "listingStatus",
  u."marketRent" AS "unitMarketRent", u."depositAmount" AS "unitDeposit",
  (SELECT le.id::text FROM "Leases" le WHERE (le.id::text = a."leaseId" OR le."applicationId" = a.id::text) AND le."status" <> 'Canceled' ORDER BY le.created_at DESC LIMIT 1) AS "leaseRefId",
  (SELECT le."number" FROM "Leases" le WHERE (le.id::text = a."leaseId" OR le."applicationId" = a.id::text) AND le."status" <> 'Canceled' ORDER BY le.created_at DESC LIMIT 1) AS "leaseNumber",
  (SELECT COUNT(*) FROM "Messages" m WHERE m."applicationId" = a.id::text AND m."direction" = 'Inbound' AND m."readAt" IS NULL) AS "unreadCount"`;

export const APPLICATION_FROM = `
  FROM "Applications" a
  LEFT JOIN "Listings" l ON l.id::text = a."listingId"
  LEFT JOIN "Units" u ON u.id::text = a."unitId"`;

export function toApplication(r: Record<string, unknown>) {
  const coApplicants = coApplicantsOf(r.coApplicants);
  const screening = normalizeScreening(r.screening);
  const rent = numOrNull(r.listingRent) ?? numOrNull(r.unitMarketRent);
  return {
    id: String(r.id),
    number: numOrNull(r.number),
    applicantName: str(r.applicantName) || 'Unnamed applicant',
    email: str(r.email) || str(r.portalEmail) || '',
    phone: str(r.phone) ?? '',
    status: asStatus(r.status),
    source: str(r.source) || 'Portal',
    listingId: ref(r.listingId),
    listingTitle: ref(r.listingTitle),
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    desiredMoveIn: day(r.desiredMoveIn),
    monthlyIncome: numOrNull(r.monthlyIncome),
    householdIncome: householdIncome(numOrNull(r.monthlyIncome), coApplicants),
    coApplicantNames: coApplicants.map(c => c.name || c.email),
    rent,
    deposit: numOrNull(r.listingDeposit) ?? numOrNull(r.unitDeposit),
    screeningDone: screeningDone(screening),
    screeningFlags: screeningFlags(screening),
    screeningTotal: screening.length,
    feeAmount: numOrNull(r.feeAmount),
    feePaidAt: iso(r.feePaidAt),
    submittedAt: iso(r.submittedAt) ?? iso(r.created_at),
    decidedAt: iso(r.decidedAt),
    assigneeId: ref(r.assigneeId),
    leaseId: ref(r.leaseRefId) ?? ref(r.leaseId),
    leaseNumber: numOrNull(r.leaseNumber),
    lastActivityAt: iso(r.lastActivityAt) ?? iso(r.updated_at) ?? iso(r.created_at),
    unreadCount: num(r.unreadCount),
    occupants: numOrNull(r.occupants),
    hasPets: Boolean(str(r.pets) && !/^(none|no|n\/a)$/i.test(String(r.pets).trim())),
  };
}

export type ApplicationRow = ReturnType<typeof toApplication>;

export async function loadApplicationRecord(where: { id?: string; number?: number }) {
  const { rows } = await zite.sql({
    query: `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE ${where.id ? 'a.id::text = $1' : 'a."number" = $1'} AND a."status" <> 'Draft' LIMIT 1`,
    params: [where.id ?? where.number],
  });
  if (!rows[0]) throw new ZiteError('That application no longer exists.', 'NOT_FOUND');
  return rows[0];
}

export const applicantRecipient = (r: Record<string, unknown>): Recipient => ({
  kind: 'applicant',
  id: String(r.id),
  name: str(r.applicantName) || 'Applicant',
  email: str(r.email) || str(r.portalEmail) || null,
});

export const appLabel = (r: Record<string, unknown>) => applicationRef(numOrNull(r.number));

/**
 * Send the organization's decision template, with a paragraph of our own
 * inserted before the sign-off (approval conditions; the right to ask for the
 * reason on a denial). Nothing is sent when the template is switched off.
 */
export async function sendDecisionEmail(input: {
  trigger: 'Application approved' | 'Application denied';
  settings: OrgSettings;
  app: Record<string, unknown>;
  context: MergeContext;
  extra?: string | null;
  senderMemberId: string;
  senderName: string;
}) {
  const template = await findTemplate(input.trigger);
  if (!template) return null;
  const recipient = applicantRecipient(input.app);
  const ctx: MergeContext = {
    ...orgMergeContext(input.settings),
    recipient_name: recipient.name,
    recipient_first_name: recipient.name.trim().split(/\s+/)[0] || 'there',
    ...input.context,
  };
  let body = renderMerge(template.body, ctx);
  if (input.extra?.trim()) {
    // Before the closing lines ("We appreciate you considering us." and the company name), after the substance.
    const paragraphs = body.split(/\n{2,}/);
    const closing: string[] = [];
    while (closing.length < 2 && paragraphs.length > 2 && paragraphs[paragraphs.length - 1].trim().length < 60) closing.unshift(paragraphs.pop()!);
    body = [...paragraphs, input.extra.trim(), ...closing].join('\n\n');
  }
  const statusLink = portalLink(input.settings, `/applications/${recipient.id}`);
  return messagePerson({
    settings: input.settings,
    recipient,
    subject: renderMerge(template.subject, ctx),
    body,
    deliver: true,
    senderMemberId: input.senderMemberId,
    senderName: input.senderName,
    templateId: template.id,
    applicationId: recipient.id,
    propertyId: ref(input.app.propertyId),
    button: statusLink ? { label: 'View your application', href: statusLink } : null,
  });
}

// ─── Inquiries ──────────────────────────────────────────────────────────────

export const INQUIRY_SELECT = `
  q.*,
  l."title" AS "listingTitle", l."slug" AS "listingSlug", l."status" AS "listingStatus",
  ap."number" AS "applicationNumber", ap."status" AS "applicationStatus",
  (SELECT COUNT(*) FROM "Messages" m WHERE m."thread" = 'inquiry:' || q.id::text AND m."direction" <> 'Internal') AS "messageCount",
  (SELECT MAX(m."sentAt") FROM "Messages" m WHERE m."thread" = 'inquiry:' || q.id::text AND m."direction" = 'Outbound') AS "lastReplyAt"`;

export const INQUIRY_FROM = `
  FROM "Inquiries" q
  LEFT JOIN "Listings" l ON l.id::text = q."listingId"
  LEFT JOIN "Applications" ap ON ap.id::text = q."applicationId"`;

export function toInquiry(r: Record<string, unknown>) {
  const lastReply = iso(r.lastReplyAt);
  const lastContacted = iso(r.lastContactedAt);
  return {
    id: String(r.id),
    name: str(r.name) || 'Unnamed lead',
    email: str(r.email) ?? '',
    phone: str(r.phone) ?? '',
    message: str(r.message) ?? '',
    notes: str(r.notes) ?? '',
    status: str(r.status) || 'New',
    source: str(r.source) || 'Portal',
    listingId: ref(r.listingId),
    listingTitle: ref(r.listingTitle),
    listingSlug: ref(r.listingSlug),
    listingStatus: ref(r.listingStatus),
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    showingAt: iso(r.showingAt),
    desiredMoveIn: day(r.desiredMoveIn),
    assigneeId: ref(r.assigneeId),
    applicationId: ref(r.applicationId),
    applicationNumber: numOrNull(r.applicationNumber),
    applicationStatus: ref(r.applicationStatus),
    receivedAt: iso(r.receivedAt) ?? iso(r.created_at) ?? new Date().toISOString(),
    lastContactedAt: lastContacted && lastReply ? (lastContacted > lastReply ? lastContacted : lastReply) : lastContacted ?? lastReply,
    messageCount: num(r.messageCount),
  };
}

export type InquiryRow = ReturnType<typeof toInquiry>;

export async function loadInquiry(id: string) {
  const { rows } = await zite.sql({ query: `SELECT ${INQUIRY_SELECT} ${INQUIRY_FROM} WHERE q.id::text = $1 LIMIT 1`, params: [id] });
  if (!rows[0]) throw new ZiteError('That lead no longer exists.', 'NOT_FOUND');
  return toInquiry(rows[0]);
}

/** Write a conversation row on a lead's thread (leads aren't people in the system yet, so the thread carries the link). */
export async function recordInquiryMessage(input: { inquiry: InquiryRow; direction: 'Outbound' | 'Internal'; subject: string; body: string; delivery: string | null; senderMemberId: string; senderName: string }) {
  const now = new Date().toISOString();
  const created = await zite.messages.create({
    record: {
      subject: input.subject.slice(0, 240),
      body: input.body,
      thread: inquiryThread(input.inquiry.id),
      direction: input.direction,
      channel: input.direction === 'Internal' ? 'Note' : 'Email',
      propertyId: input.inquiry.propertyId,
      applicationId: input.inquiry.applicationId,
      senderMemberId: input.senderMemberId,
      senderName: input.senderName,
      delivery: input.delivery,
      sentAt: now,
    },
  });
  return { id: created.id, sentAt: now };
}

// ─── Listings ───────────────────────────────────────────────────────────────

export type ListingPhoto = { url: string; name: string };

/** Listing photos are stored as a JSON list of URLs or `{ url, name }`; always read back as objects. */
export function photosOf(raw: unknown): ListingPhoto[] {
  const list = json<unknown>(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .map((p, i) => {
      if (typeof p === 'string') return { url: p, name: `Photo ${i + 1}` };
      if (p && typeof p === 'object') {
        const o = p as { url?: unknown; name?: unknown };
        return { url: String(o.url ?? ''), name: String(o.name ?? '') || `Photo ${i + 1}` };
      }
      return null;
    })
    .filter((p): p is ListingPhoto => Boolean(p && /^https?:\/\//.test(p.url)));
}

export function stringsOf(raw: unknown): string[] {
  const list = json<unknown>(raw, null);
  if (Array.isArray(list)) return list.map(v => String(v ?? '').trim()).filter(Boolean);
  return String(raw ?? '')
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
}

export const LISTING_SELECT = `
  l.*,
  u."name" AS "unitName", u."beds", u."baths", u."squareFeet", u."marketRent", u."depositAmount", u."readiness", u."features" AS "unitFeatures",
  p."name" AS "propertyName", p."propertyType", p."city", p."status" AS "propertyStatus",
  (SELECT COUNT(*) FROM "Inquiries" q WHERE q."listingId" = l.id::text) AS "leadCount",
  (SELECT COUNT(*) FROM "Inquiries" q WHERE q."listingId" = l.id::text AND q."status" = 'New') AS "newLeadCount",
  (SELECT COUNT(*) FROM "Applications" a WHERE a."listingId" = l.id::text AND a."status" <> 'Draft') AS "applicationCount",
  (SELECT COUNT(*) FROM "Applications" a WHERE a."listingId" = l.id::text AND a."status" IN ('Submitted', 'Screening', 'Approved')) AS "openApplicationCount"`;

export const LISTING_FROM = `
  FROM "Listings" l
  LEFT JOIN "Units" u ON u.id::text = l."unitId"
  LEFT JOIN "Properties" p ON p.id::text = l."propertyId"`;

export function toListing(r: Record<string, unknown>, settings: Pick<OrgSettings, 'portalUrl' | 'applicationFee'>, today: string) {
  const photos = photosOf(r.photos);
  const publishedAt = iso(r.publishedAt);
  const status = str(r.status) || 'Draft';
  const startDay = publishedAt ? publishedAt.slice(0, 10) : null;
  const daysOnMarket = startDay && (status === 'Published' || status === 'Paused') ? Math.max(0, Math.round((Date.parse(today) - Date.parse(startDay)) / 86_400_000)) : null;
  const slug = str(r.slug) ?? '';
  return {
    id: String(r.id),
    title: str(r.title) || 'Untitled listing',
    slug,
    status,
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    unitName: str(r.unitName) ?? '',
    propertyName: str(r.propertyName) ?? '',
    beds: numOrNull(r.beds),
    baths: numOrNull(r.baths),
    squareFeet: numOrNull(r.squareFeet),
    marketRent: numOrNull(r.marketRent),
    rent: numOrNull(r.rent),
    deposit: numOrNull(r.deposit),
    availableOn: day(r.availableOn),
    description: str(r.description) ?? '',
    photos,
    cover: photos[0]?.url ?? null,
    amenities: stringsOf(r.amenities),
    leaseTerm: str(r.leaseTerm) ?? '',
    petPolicy: str(r.petPolicy) ?? '',
    applicationFee: numOrNull(r.applicationFee),
    effectiveFee: Math.max(0, numOrNull(r.applicationFee) ?? settings.applicationFee ?? 0),
    showingInstructions: str(r.showingInstructions) ?? '',
    contactMemberId: ref(r.contactMemberId),
    publishedAt,
    views: num(r.views),
    leadCount: num(r.leadCount),
    newLeadCount: num(r.newLeadCount),
    applicationCount: num(r.applicationCount),
    openApplicationCount: num(r.openApplicationCount),
    daysOnMarket,
    createdAt: iso(r.created_at),
    publicUrl: slug ? portalLink(settings, `/homes/${slug}`) || null : null,
    applyUrl: slug ? portalLink(settings, `/homes/${slug}/apply`) || null : null,
  };
}

export type ListingRow = ReturnType<typeof toListing>;

export async function loadListingRecord(id: string) {
  const { rows } = await zite.sql({ query: `SELECT ${LISTING_SELECT} ${LISTING_FROM} WHERE l.id::text = $1 LIMIT 1`, params: [id] });
  if (!rows[0]) throw new ZiteError('That listing no longer exists.', 'NOT_FOUND');
  return rows[0];
}

/** A slug nobody else is using: the base, then base-2, base-3… */
export async function uniqueSlug(wanted: string, excludeId: string | null) {
  const base = slugify(wanted) || 'home-for-rent';
  if (!SLUG_RE.test(base)) throw new ZiteError('Use letters, numbers and dashes for the link.', 'BAD_REQUEST');
  const { rows } = await zite.sql({
    query: `SELECT LOWER("slug") AS slug FROM "Listings" WHERE (LOWER("slug") = $1 OR LOWER("slug") LIKE $2) AND id::text <> $3`,
    params: [base, `${base}-%`, excludeId ?? ''],
  });
  const taken = new Set(rows.map(r => String(r.slug)));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base.slice(0, 64)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 56)}-${Date.now().toString(36)}`;
}
