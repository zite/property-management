import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { generateFromSchedule } from '@project/shared/server/automation';
import { SCHEDULE_MONTHS } from '@project/shared/constants';
import { addDays, addMonths, formatDay } from '@project/shared/dates';
import { areaStats, parseAreas, type InspectionArea } from '@project/shared/inspections';
import { workOrderRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { can, type Actor } from '@project/shared/server/actor';
import { nextNumber } from '@project/shared/server/ledger';
import { notify } from '@project/shared/server/notify';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * Vendors, inspections and preventive maintenance on the server: the row
 * shapes their endpoints return and the rules that more than one endpoint
 * needs (insurance compliance, inspection titles, generating a schedule's
 * next work order).
 */

/** Inspections and preventive maintenance need `maintenance.manage`; the refusal names what was refused. */
export function assertMaintenance(actor: Actor, what: 'inspections' | 'recurring maintenance') {
  if (!can(actor.role, 'maintenance.manage')) throw new ZiteError(`Your role can’t manage ${what}. Ask an admin or property manager.`, 'FORBIDDEN');
}

// ─── Vendors ────────────────────────────────────────────────────────────────

export type InsuranceStatus = 'Valid' | 'Expiring' | 'Expired' | 'Missing' | 'Not required';

/**
 * A certificate of insurance is expected from anyone who works on site. Payees
 * that never do — utilities, insurers and "Other" (tax offices, HOAs) — aren't
 * flagged for a missing one unless they've actually been assigned work.
 */
const OFF_SITE_TRADES = ['Utilities', 'Insurance', 'Other'];
export const requiresInsurance = (trade: string, workOrders: number) => !OFF_SITE_TRADES.includes(trade) || workOrders > 0;

/** Same 30-day window as the daily insurance alerts and the vendor portal. */
export function insuranceStatus(expiresOn: string | null, today: string, required: boolean): InsuranceStatus {
  if (expiresOn) return expiresOn < today ? 'Expired' : expiresOn <= addDays(today, 30) ? 'Expiring' : 'Valid';
  return required ? 'Missing' : 'Not required';
}

const OPEN = `('New', 'Scheduled', 'In progress', 'On hold')`;

/** A vendor with its work, money and compliance, for lists and the vendor page. `$1` is Jan 1, `$2` is today. */
export const VENDOR_SELECT = `
  v.*,
  (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."vendorId" = v.id::text AND w."status" IN ${OPEN}) AS "openWorkOrders",
  (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."vendorId" = v.id::text) AS "totalWorkOrders",
  (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."vendorId" = v.id::text AND w."status" = 'Completed' AND w."completedAt" >= $1::date) AS "completedThisYear",
  (SELECT MAX(COALESCE(w."reportedAt", w.created_at)) FROM "WorkOrders" w WHERE w."vendorId" = v.id::text) AS "lastWorkAt",
  (SELECT COALESCE(SUM(t."amount"), 0) FROM "Transactions" t WHERE t."vendorId" = v.id::text AND t."kind" IN ('Bill payment', 'Expense') AND t."status" = 'Posted' AND t."date" >= $1::date AND t."date" <= $2::date) AS "paidThisYear",
  (SELECT COALESCE(SUM(t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0)), 0)
     FROM "Transactions" t WHERE t."vendorId" = v.id::text AND t."kind" = 'Bill' AND t."status" = 'Posted') AS "openBills",
  (SELECT COUNT(*) FROM "Messages" m WHERE m."thread" = 'vendor:' || v.id::text AND m."direction" = 'Inbound' AND m."readAt" IS NULL) AS "unreadMessages",
  (SELECT MAX(d."expiresOn") FROM "Documents" d WHERE d."vendorId" = v.id::text AND d."category" = 'Insurance') AS "latestCoiExpiresOn",
  EXISTS (SELECT 1 FROM "Documents" d WHERE d."vendorId" = v.id::text AND (d."name" ILIKE 'w-9%' OR d."name" ILIKE 'w9%')) AS "hasW9Document"`;

export function toVendor(r: Record<string, unknown>, today: string, canSeeMoney: boolean) {
  const trade = str(r.trade) || 'General';
  const totalWorkOrders = num(r.totalWorkOrders);
  const insuranceExpiresOn = day(r.insuranceExpiresOn);
  const insurance = insuranceStatus(insuranceExpiresOn, today, requiresInsurance(trade, totalWorkOrders));
  const is1099 = bool(r.is1099);
  const w9OnFile = bool(r.w9OnFile);
  const latestCoi = day(r.latestCoiExpiresOn);
  const coiPendingReview = Boolean(latestCoi && (!insuranceExpiresOn || latestCoi > insuranceExpiresOn));
  const w9Missing = is1099 && !w9OnFile;
  return {
    id: String(r.id),
    name: str(r.name) || 'Unnamed vendor',
    trade,
    contactName: str(r.contactName) ?? '',
    email: str(r.email) ?? '',
    phone: str(r.phone) ?? '',
    address: str(r.address) ?? '',
    taxIdLast4: str(r.taxIdLast4) ?? '',
    is1099,
    w9OnFile,
    insuranceExpiresOn,
    licenseNumber: str(r.licenseNumber) ?? '',
    hourlyRate: numOrNull(r.hourlyRate),
    rating: numOrNull(r.rating),
    status: (str(r.status) || 'Active') as 'Active' | 'Inactive',
    portalEnabled: bool(r.portalEnabled),
    defaultAccountId: ref(r.defaultAccountId),
    paymentTermsDays: numOrNull(r.paymentTermsDays),
    color: str(r.color) || '#64748b',
    notes: str(r.notes) ?? '',
    createdAt: iso(r.created_at),
    openWorkOrders: num(r.openWorkOrders),
    totalWorkOrders,
    completedThisYear: num(r.completedThisYear),
    lastWorkAt: iso(r.lastWorkAt),
    paidThisYear: canSeeMoney ? num(r.paidThisYear) : null,
    openBills: canSeeMoney ? num(r.openBills) : null,
    unreadMessages: num(r.unreadMessages),
    compliance: {
      insurance,
      w9Missing,
      coiPendingReview,
      pendingCoiExpiresOn: coiPendingReview ? latestCoi : null,
      w9PendingReview: !w9OnFile && bool(r.hasW9Document),
      problem: insurance === 'Expired' || insurance === 'Expiring' || insurance === 'Missing' || w9Missing,
    },
  };
}

export type VendorDto = ReturnType<typeof toVendor>;

export async function loadVendor(id: string, today: string, canSeeMoney: boolean) {
  const { rows } = await zite.sql({ query: `SELECT ${VENDOR_SELECT} FROM "Vendors" v WHERE v.id::text = $3 LIMIT 1`, params: [`${today.slice(0, 4)}-01-01`, today, id] });
  if (!rows[0]) throw new ZiteError('That vendor no longer exists.', 'NOT_FOUND');
  return toVendor(rows[0], today, canSeeMoney);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ─── Places ─────────────────────────────────────────────────────────────────

/** "The Alder 201", or just "48 Cottonwood Lane" for a single-unit property — the label inspection titles use. */
export async function unitPlace(unitId: string) {
  const { rows } = await zite.sql({
    query: `
      SELECT u.id, u."name", u."beds", u."baths", u."propertyId", p."name" AS "propertyName",
        (SELECT COUNT(*) FROM "Units" x WHERE x."propertyId" = u."propertyId" AND COALESCE(x."archived", false) = false) AS "unitCount"
      FROM "Units" u LEFT JOIN "Properties" p ON p.id::text = u."propertyId" WHERE u.id::text = $1 LIMIT 1`,
    params: [unitId],
  });
  const u = rows[0];
  if (!u) throw new ZiteError('That unit no longer exists.', 'BAD_REQUEST');
  const unitName = str(u.name) ?? '';
  const propertyName = str(u.propertyName) ?? '';
  const single = num(u.unitCount) <= 1 || /^(main|house|home)$/i.test(unitName);
  return {
    unitId: String(u.id),
    propertyId: String(u.propertyId),
    propertyName,
    unitName,
    label: single ? propertyName : `${propertyName} ${unitName.replace(/^unit\s+/i, '')}`.trim(),
    beds: num(u.beds, 1),
    baths: num(u.baths, 1),
  };
}

// ─── Inspections ────────────────────────────────────────────────────────────

/** Worse conditions rank higher; N/A and unrated don't rank. */
export const CONDITION_RANK: Record<string, number> = { Good: 0, Fair: 1, Poor: 2, Damaged: 3, Missing: 3 };
export const FLAGGED_CONDITIONS = ['Poor', 'Damaged', 'Missing'];

export const INSPECTION_SELECT = `
  i.id, i."title", i."propertyId", i."unitId", i."leaseId", i."inspectionType", i."status", i."scheduledFor", i."completedAt", i."inspectorId",
  i."areas", i."summary", i."overallCondition", i."sharedWithTenant", i."tenantAcknowledgedAt", i."reportUrl", i.created_at,
  l."name" AS "leaseName", l."number" AS "leaseNumber", l."status" AS "leaseStatus",
  (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."inspectionId" = i.id::text) AS "workOrderCount"`;

export function toInspection(r: Record<string, unknown>) {
  const areas = parseAreas(r.areas);
  const stats = areaStats(areas);
  return {
    id: String(r.id),
    title: str(r.title) || `${str(r.inspectionType) || 'Unit'} inspection`,
    type: str(r.inspectionType) || 'Routine',
    status: str(r.status) || 'Scheduled',
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    leaseId: ref(r.leaseId),
    leaseName: ref(r.leaseName),
    leaseNumber: numOrNull(r.leaseNumber),
    leaseStatus: ref(r.leaseStatus),
    scheduledFor: iso(r.scheduledFor),
    completedAt: iso(r.completedAt),
    inspectorId: ref(r.inspectorId),
    summary: str(r.summary) ?? '',
    overallCondition: ref(r.overallCondition),
    sharedWithTenant: bool(r.sharedWithTenant),
    tenantAcknowledgedAt: iso(r.tenantAcknowledgedAt),
    reportUrl: ref(r.reportUrl),
    createdAt: iso(r.created_at),
    workOrderCount: num(r.workOrderCount),
    stats,
  };
}

export type InspectionDto = ReturnType<typeof toInspection>;

export async function loadInspectionRow(id: string) {
  const { rows } = await zite.sql({ query: `SELECT ${INSPECTION_SELECT} FROM "Inspections" i LEFT JOIN "Leases" l ON l.id::text = i."leaseId" WHERE i.id::text = $1 LIMIT 1`, params: [id] });
  if (!rows[0]) throw new ZiteError('That inspection no longer exists.', 'NOT_FOUND');
  return { row: rows[0], inspection: toInspection(rows[0]), areas: parseAreas(rows[0].areas) };
}

/** Areas with every condition, note and photo cleared — a fresh checklist with the same item ids. */
export function blankAreas(areas: InspectionArea[]): InspectionArea[] {
  return areas.map(a => ({ id: a.id, name: a.name, items: a.items.map(i => ({ id: i.id, name: i.name, condition: null, notes: '', photos: [] })) }));
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';

// ─── Preventive maintenance ─────────────────────────────────────────────────

export const SCHEDULE_SELECT = `
  s.*,
  (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."scheduleId" = s.id::text) AS "workOrderCount",
  (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."scheduleId" = s.id::text AND w."status" IN ${OPEN}) AS "openWorkOrders",
  (SELECT w."number" FROM "WorkOrders" w WHERE w."scheduleId" = s.id::text ORDER BY w."number" DESC LIMIT 1) AS "lastNumber",
  (SELECT w."status" FROM "WorkOrders" w WHERE w."scheduleId" = s.id::text ORDER BY w."number" DESC LIMIT 1) AS "lastStatus",
  (SELECT w."dueDate" FROM "WorkOrders" w WHERE w."scheduleId" = s.id::text ORDER BY w."number" DESC LIMIT 1) AS "lastDueDate",
  (SELECT w."title" FROM "WorkOrders" w WHERE w."scheduleId" = s.id::text ORDER BY w."number" DESC LIMIT 1) AS "lastTitle"`;

export function toSchedule(r: Record<string, unknown>) {
  const nextDueOn = day(r.nextDueOn);
  const leadDays = r.leadDays == null || r.leadDays === '' ? 7 : num(r.leadDays);
  const lastNumber = numOrNull(r.lastNumber);
  return {
    id: String(r.id),
    title: str(r.title) || 'Preventive maintenance',
    description: str(r.description) ?? '',
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    category: str(r.category) || 'General',
    priority: str(r.priority) || 'Normal',
    frequency: str(r.frequency) || 'Annually',
    nextDueOn,
    leadDays,
    /** The day the daily automation creates the next work order: lead days before it's due. */
    generatesOn: nextDueOn ? addDays(nextDueOn, -leadDays) : null,
    vendorId: ref(r.vendorId),
    assigneeId: ref(r.assigneeId),
    estimateAmount: numOrNull(r.estimateAmount),
    active: bool(r.active),
    lastGeneratedOn: day(r.lastGeneratedOn),
    workOrderCount: num(r.workOrderCount),
    openWorkOrders: num(r.openWorkOrders),
    lastWorkOrder: lastNumber ? { number: lastNumber, status: str(r.lastStatus) || 'New', dueDate: day(r.lastDueDate), title: str(r.lastTitle) ?? '' } : null,
  };
}

export type ScheduleDto = ReturnType<typeof toSchedule>;

export async function loadSchedule(id: string) {
  const { rows } = await zite.sql({ query: `SELECT ${SCHEDULE_SELECT} FROM "MaintenanceSchedules" s WHERE s.id::text = $1 LIMIT 1`, params: [id] });
  if (!rows[0]) throw new ZiteError('That schedule no longer exists.', 'NOT_FOUND');
  return { row: rows[0], schedule: toSchedule(rows[0]) };
}

/**
 * Create a schedule's next work order right now, with exactly the rules the
 * daily automation uses (`generateScheduledWorkOrders` in
 * packages/shared/server/automation.ts): the work order is due on the
 * schedule's next due date; a work order already created for that due date is
 * never duplicated; the next due date advances by the frequency — and keeps
 * advancing past today — and `lastGeneratedOn` is stamped. The only additions
 * are a person's name on it (created by, reported at, activity) because a
 * person pressed the button.
 */
export async function generateForSchedule(s: Record<string, unknown>, today: string, actor: Actor) {
  if (!day(s.nextDueOn)) throw new ZiteError('Set a next due date on the schedule first.', 'BAD_REQUEST');
  return generateFromSchedule(s, today, { id: actor.id, name: actor.name });
}
