import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { membersWith } from '@project/shared/server/actor';
import type { OrgSettings } from '@project/shared/server/settings';
import { day, iso, json, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { coerceForm, type ApplicationForm } from '../lib/applyRules';

/**
 * What the public may see of a listing, and how a rental application moves
 * between the database and the apply page.
 *
 * Listings are the only place the public touches the portfolio, so every read
 * here picks columns explicitly: the unit's size and the building's street
 * address and amenities, never its occupancy, leases, owner or notes.
 */

// ── Listings ────────────────────────────────────────────────────────────────

export const SLUG = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9-]*$/i, "That home's link isn't valid.");

export const ListingCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  rent: z.number(),
  deposit: z.number().nullable(),
  availableOn: z.string().nullable(),
  petPolicy: z.string(),
  cover: z.string().nullable(),
  photoCount: z.number(),
  beds: z.number().nullable(),
  baths: z.number().nullable(),
  squareFeet: z.number().nullable(),
  propertyName: z.string(),
  propertyType: z.string(),
  city: z.string(),
  state: z.string(),
  publishedAt: z.string().nullable(),
  amenities: z.array(z.string()),
});
export type ListingCard = z.infer<typeof ListingCardSchema>;

export const ListingDetailSchema = ListingCardSchema.extend({
  photos: z.array(z.string()),
  description: z.string(),
  leaseTerm: z.string(),
  applicationFee: z.number(),
  showingInstructions: z.string(),
  street: z.string(),
  unitName: z.string(),
  postalCode: z.string(),
  buildingDescription: z.string(),
  buildingAmenities: z.array(z.string()),
  buildingPetPolicy: z.string(),
  parking: z.string(),
  yearBuilt: z.number().nullable(),
  contact: z.object({ name: z.string(), title: z.string() }).nullable(),
});
export type ListingDetail = z.infer<typeof ListingDetailSchema>;

export const LISTING_COLUMNS = `
  l.id, l."slug", l."title", l."rent", l."deposit", l."availableOn", l."petPolicy", l."photos", l."amenities", l."publishedAt", l.created_at,
  l."description", l."leaseTerm", l."applicationFee", l."showingInstructions", l."contactMemberId", l."views", l."status", l."propertyId", l."unitId",
  u."name" AS "unitName", u."beds", u."baths", u."squareFeet",
  p."name" AS "propertyName", p."propertyType", p."street", p."city", p."state", p."postalCode", p."photoUrl" AS "propertyPhoto",
  p."description" AS "buildingDescription", p."amenities" AS "buildingAmenities", p."petPolicy" AS "buildingPetPolicy", p."parking", p."yearBuilt"`;

export const LISTING_FROM = `
  FROM "Listings" l
  LEFT JOIN "Units" u ON u.id::text = l."unitId"
  LEFT JOIN "Properties" p ON p.id::text = l."propertyId"`;

/** Published, with a link, on a building that hasn't been archived. */
export const PUBLISHED = `l."status" = 'Published' AND COALESCE(l."slug", '') <> '' AND COALESCE(p."status", 'Active') <> 'Archived'`;

/** Photo columns hold a JSON list of URLs or of `{ url, name }`; only https links are shown. */
export function photoList(raw: unknown): string[] {
  const list = json<unknown[]>(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .map(p => (typeof p === 'string' ? p : p && typeof p === 'object' ? String((p as { url?: unknown }).url ?? '') : ''))
    .filter(u => /^https:\/\//.test(u))
    .slice(0, 40);
}

export function stringList(raw: unknown): string[] {
  const list = json<unknown>(raw, []);
  if (Array.isArray(list)) return list.map(v => String(v ?? '').trim()).filter(Boolean).slice(0, 40);
  // Older rows may hold a comma or line separated list.
  return String(raw ?? '')
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function toListingCard(r: Record<string, unknown>): ListingCard {
  const photos = photoList(r.photos);
  const fallback = str(r.propertyPhoto) && /^https:\/\//.test(String(r.propertyPhoto)) ? String(r.propertyPhoto) : null;
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: str(r.title) || str(r.propertyName) || 'Home for rent',
    rent: num(r.rent),
    deposit: numOrNull(r.deposit),
    availableOn: day(r.availableOn),
    petPolicy: str(r.petPolicy) ?? '',
    cover: photos[0] ?? fallback,
    photoCount: photos.length || (fallback ? 1 : 0),
    beds: numOrNull(r.beds),
    baths: numOrNull(r.baths),
    squareFeet: numOrNull(r.squareFeet),
    propertyName: str(r.propertyName) ?? '',
    propertyType: str(r.propertyType) ?? '',
    city: str(r.city) ?? '',
    state: str(r.state) ?? '',
    publishedAt: iso(r.publishedAt) ?? iso(r.created_at),
    amenities: stringList(r.amenities).slice(0, 12),
  };
}

export function toListingDetail(r: Record<string, unknown>, settings: OrgSettings, contact: { name: string; title: string } | null): ListingDetail {
  const card = toListingCard(r);
  const photos = photoList(r.photos);
  return {
    ...card,
    photos: photos.length ? photos : card.cover ? [card.cover] : [],
    description: str(r.description) ?? '',
    leaseTerm: str(r.leaseTerm) ?? '',
    applicationFee: listingFee(r, settings),
    showingInstructions: str(r.showingInstructions) ?? '',
    street: str(r.street) ?? '',
    unitName: str(r.unitName) ?? '',
    postalCode: str(r.postalCode) ?? '',
    buildingDescription: str(r.buildingDescription) ?? '',
    buildingAmenities: stringList(r.buildingAmenities),
    buildingPetPolicy: str(r.buildingPetPolicy) ?? '',
    parking: str(r.parking) ?? '',
    yearBuilt: numOrNull(r.yearBuilt),
    contact,
  };
}

/** The listing's own application fee, else the organization's. */
export function listingFee(r: Record<string, unknown>, settings: Pick<OrgSettings, 'applicationFee'>) {
  const own = numOrNull(r.applicationFee);
  return Math.max(0, own ?? settings.applicationFee ?? 0);
}

export async function findListingBySlug(slug: string, opts: { publishedOnly: boolean }) {
  const { rows } = await zite.sql({
    query: `SELECT ${LISTING_COLUMNS} ${LISTING_FROM} WHERE LOWER(l."slug") = LOWER($1) ${opts.publishedOnly ? `AND ${PUBLISHED}` : ''} LIMIT 1`,
    params: [slug],
  });
  return rows[0] ?? null;
}

export async function findListingById(id: string) {
  const { rows } = await zite.sql({ query: `SELECT ${LISTING_COLUMNS} ${LISTING_FROM} WHERE l.id::text = $1 LIMIT 1`, params: [id] });
  return rows[0] ?? null;
}

export const isPublished = (r: Record<string, unknown>) => r.status === 'Published' && !!str(r.slug);

/**
 * Who hears about a new inquiry or application: the listing's leasing contact
 * when they're still active and can manage leasing, otherwise everyone who can.
 */
export async function leasingRecipients(contactMemberId: string | null | undefined) {
  const people = await membersWith('leasing.manage');
  const contact = contactMemberId ? people.find(p => p.id === contactMemberId) : undefined;
  return contact ? [contact] : people;
}

export async function contactFor(contactMemberId: string | null | undefined) {
  if (!contactMemberId) return null;
  const { rows } = await zite.sql({ query: `SELECT "name", "title", "status" FROM "Members" WHERE id::text = $1 LIMIT 1`, params: [contactMemberId] });
  const m = rows[0];
  if (!m || m.status === 'Deactivated' || !str(m.name)) return null;
  return { name: String(m.name), title: str(m.title) ?? '' };
}

// ── Applications ────────────────────────────────────────────────────────────

const CoApplicantSchema = z.object({ name: z.string(), email: z.string(), relationship: z.string(), monthlyIncome: z.number().nullable(), employer: z.string() });
const ReferenceSchema = z.object({ name: z.string(), relationship: z.string(), phone: z.string(), email: z.string() });

export const FormSchema = z.object({
  applicantName: z.string(),
  phone: z.string(),
  desiredMoveIn: z.string(),
  occupants: z.number().nullable(),
  currentAddress: z.string(),
  currentRent: z.number().nullable(),
  currentLandlord: z.string(),
  landlordPhone: z.string(),
  residenceMonths: z.number().nullable(),
  reasonForMoving: z.string(),
  priorEviction: z.boolean().nullable(),
  employer: z.string(),
  jobTitle: z.string(),
  employmentMonths: z.number().nullable(),
  monthlyIncome: z.number().nullable(),
  coApplicants: z.array(CoApplicantSchema),
  hasPets: z.boolean().nullable(),
  pets: z.string(),
  hasVehicles: z.boolean().nullable(),
  vehicles: z.string(),
  references: z.array(ReferenceSchema),
  emergencyContact: z.object({ name: z.string(), relationship: z.string(), phone: z.string() }),
});

/** An Applications row as the form the apply page edits. */
export function formFromRecord(r: Record<string, unknown>): ApplicationForm {
  const details = json<Record<string, unknown>>(r.details, {});
  const pets = str(r.pets) ?? '';
  const vehicles = str(r.vehicles) ?? '';
  const none = (s: string) => /^(none|no|n\/a)$/i.test(s.trim());
  const flag = (stored: unknown, value: string, touched: boolean) =>
    typeof stored === 'boolean' ? stored : value ? !none(value) : touched ? false : null;
  const submitted = r.status && r.status !== 'Draft';
  const form = coerceForm({
    applicantName: str(r.applicantName) ?? '',
    phone: str(r.phone) ?? '',
    desiredMoveIn: day(r.desiredMoveIn) ?? '',
    occupants: numOrNull(r.occupants),
    currentAddress: str(r.currentAddress) ?? '',
    currentRent: numOrNull(r.currentRent),
    currentLandlord: str(r.currentLandlord) ?? '',
    landlordPhone: str(r.landlordPhone) ?? '',
    residenceMonths: numOrNull(r.residenceMonths),
    reasonForMoving: str(r.reasonForMoving) ?? '',
    priorEviction: typeof details.priorEvictionAnswered === 'boolean' || submitted ? r.priorEviction === true || r.priorEviction === 'true' : null,
    employer: str(r.employer) ?? '',
    jobTitle: str(r.jobTitle) ?? '',
    employmentMonths: numOrNull(r.employmentMonths),
    monthlyIncome: numOrNull(r.monthlyIncome),
    coApplicants: json<unknown[]>(r.coApplicants, []),
    hasPets: flag(details.hasPets, pets, Boolean(submitted)),
    pets: none(pets) ? '' : pets,
    hasVehicles: flag(details.hasVehicles, vehicles, Boolean(submitted)),
    vehicles: none(vehicles) ? '' : vehicles,
    references: Array.isArray(details.references) ? details.references : [],
    emergencyContact: details.emergencyContact ?? {},
  });
  if (!submitted && form.references.length === 0) form.references = [{ name: '', relationship: '', phone: '', email: '' }];
  return form;
}

/** The form as Applications columns. Blank numbers are written as null so a draft never pretends to know them. */
export function recordFromForm(form: ApplicationForm) {
  const t = (s: string) => s.trim();
  return {
    applicantName: t(form.applicantName),
    phone: t(form.phone),
    desiredMoveIn: form.desiredMoveIn || null,
    occupants: form.occupants,
    currentAddress: t(form.currentAddress),
    currentRent: form.currentRent,
    currentLandlord: t(form.currentLandlord),
    landlordPhone: t(form.landlordPhone),
    residenceMonths: form.residenceMonths,
    reasonForMoving: t(form.reasonForMoving),
    priorEviction: form.priorEviction === true,
    employer: t(form.employer),
    jobTitle: t(form.jobTitle),
    employmentMonths: form.employmentMonths,
    monthlyIncome: form.monthlyIncome,
    pets: form.hasPets === false ? 'None' : form.hasPets ? t(form.pets) : '',
    vehicles: form.hasVehicles === false ? 'None' : form.hasVehicles ? t(form.vehicles) : '',
    coApplicants: JSON.stringify(
      form.coApplicants
        .filter(c => c.name.trim() || c.email.trim())
        .map(c => ({ name: t(c.name), email: t(c.email).toLowerCase(), relationship: t(c.relationship), monthlyIncome: c.monthlyIncome, employer: t(c.employer) })),
    ),
    details: JSON.stringify({
      references: form.references.filter(r => r.name.trim() || r.phone.trim()).map(r => ({ name: t(r.name), relationship: t(r.relationship), phone: t(r.phone), email: t(r.email) })),
      emergencyContact: { name: t(form.emergencyContact.name), relationship: t(form.emergencyContact.relationship), phone: t(form.emergencyContact.phone) },
      hasPets: form.hasPets,
      hasVehicles: form.hasVehicles,
      ...(form.priorEviction != null ? { priorEvictionAnswered: true } : {}),
    }),
  };
}

/** The applicant's newest application for a listing that's still in play (anything but withdrawn). */
export async function activeApplicationFor(email: string, listingId: string) {
  const { rows } = await zite.sql({
    query: `SELECT id, "status", "number" FROM "Applications" WHERE LOWER("portalEmail") = $1 AND "listingId" = $2 AND "status" <> 'Withdrawn' ORDER BY CASE WHEN "status" = 'Draft' THEN 1 ELSE 0 END, created_at DESC LIMIT 1`,
    params: [email, listingId],
  });
  const r = rows[0];
  return r ? { id: String(r.id), status: String(r.status), number: numOrNull(r.number) } : null;
}

export const ACCEPTS_MESSAGES = ['Submitted', 'Screening', 'Approved', 'Denied', 'Leased', 'Withdrawn'];
export const WITHDRAWABLE = ['Draft', 'Submitted', 'Screening', 'Approved'];

export function todayFor(settings: Pick<OrgSettings, 'timezone'>) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** A person can post a few things an hour; a script can't post hundreds. */
export async function assertNotFlooding(table: 'Inquiries' | 'Messages', column: string, value: string, limit: number) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS n FROM "${table}" WHERE LOWER("${column}") = $1 AND created_at >= $2`, params: [value.toLowerCase(), since] });
  if (num(rows[0]?.n) >= limit) throw new ZiteError('You’ve sent a lot of messages in the last hour. Please wait a little and try again.', 'RATE_LIMITED');
}

export const PortalMessageSchema = z.object({
  id: z.string(),
  mine: z.boolean(),
  senderName: z.string(),
  subject: z.string(),
  body: z.string(),
  sentAt: z.string().nullable(),
  unread: z.boolean(),
});
export type PortalMessage = z.infer<typeof PortalMessageSchema>;

/** A conversation row as the applicant sees it: internal notes never reach this function's callers. */
export function toPortalMessage(r: Record<string, unknown>, organizationName: string): PortalMessage {
  const mine = r.direction === 'Inbound';
  return {
    id: String(r.id),
    mine,
    senderName: mine ? 'You' : str(r.senderName) || organizationName,
    subject: str(r.subject) ?? '',
    body: str(r.body) ?? '',
    sentAt: iso(r.sentAt) ?? iso(r.created_at),
    unread: !mine && !r.readAt,
  };
}

/** The applicant's side of their conversation: anything but internal notes. */
export async function applicantMessages(applicationId: string) {
  const { rows } = await zite.sql({
    query: `
      SELECT id, "direction", "senderName", "subject", "body", "sentAt", "readAt", created_at FROM "Messages"
      WHERE ("thread" = $1 OR "applicationId" = $2) AND "direction" IN ('Inbound', 'Outbound') AND COALESCE("channel", '') <> 'Note'
      ORDER BY COALESCE("sentAt", created_at) ASC LIMIT 500`,
    params: [`applicant:${applicationId}`, applicationId],
  });
  return rows;
}

export { ref };
