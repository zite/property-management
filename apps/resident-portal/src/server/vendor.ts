import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { WorkOrderPriority, WorkOrderStatus } from '@project/shared/constants';
import { todayIn } from '@project/shared/dates';
import { workOrderRef } from '@project/shared/leases';
import { formatAddress } from '@project/shared/merge';
import { formatMoney } from '@project/shared/money';
import type { Recipient } from '@project/shared/server/email';
import { getSettings, type OrgSettings } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { requireVendor } from './identity';

/**
 * The vendor area's scope and the rules for what a vendor may see and do.
 *
 * Every vendor endpoint starts from `vendorScope(context)` and reads work
 * orders only through `vendorWorkOrder(vendorId, number)`, which is scoped by
 * `vendorId` — another vendor's job is NOT_FOUND, exactly like a missing one.
 *
 * What a vendor sees on a job: the work, the full address and unit, entry
 * permission and notes, photos, the schedule, their own estimate and cost,
 * and messages exchanged with THEM (never staff notes, never the tenant's or
 * owner's side of the conversation). Never: rent, balances, owner approval
 * notes, other vendors' costs, bills that aren't theirs.
 *
 * Resident contact — decided deliberately: a vendor gets the resident's FIRST
 * NAME and PHONE only while the job is open AND the resident has NOT given
 * permission to enter. That is exactly when the vendor must arrange access
 * with the person at home. With permission to enter, the office has already
 * cleared entry, so no personal contact details are shared. Email is never shared.
 *
 * Vendors don't change the books: an invoice is a document for staff, who
 * enter the bill. They can't set their own insurance or W-9 status either —
 * they upload the paperwork and staff verify it.
 */

type UserLike = { email?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined;

export type VendorScope = Awaited<ReturnType<typeof vendorScope>>;

export async function vendorScope(context: { user?: UserLike }) {
  const { identity, vendorId } = await requireVendor(context);
  const [settings, { rows }] = await Promise.all([
    getSettings(),
    zite.sql({ query: `SELECT "name", "contactName", "email", "phone", "address", "trade" FROM "Vendors" WHERE id::text = $1`, params: [vendorId] }),
  ]);
  const v = rows[0] ?? {};
  return {
    identity,
    vendorId,
    vendor: { id: vendorId, name: str(v.name) ?? identity.vendor?.name ?? 'Vendor', contactName: str(v.contactName) ?? '', email: str(v.email) ?? '', phone: str(v.phone) ?? '', trade: str(v.trade) ?? '' },
    settings,
    today: todayIn(settings.timezone),
  };
}

export const OPEN: WorkOrderStatus[] = ['New', 'Scheduled', 'In progress', 'On hold'];
export const PRIORITY_RANK: Record<WorkOrderPriority, number> = { Emergency: 0, High: 1, Normal: 2, Low: 3 };

const WORK_ORDER_SELECT = `
  SELECT w.*, p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", p."managerId",
    u."name" AS "unitName",
    (SELECT COUNT(*) FROM "Messages" m WHERE m."workOrderId" = w.id::text AND m."vendorId" = $1 AND m."direction" = 'Outbound' AND m."readAt" IS NULL AND m."channel" <> 'Note') AS "unreadMessages"
  FROM "WorkOrders" w
  LEFT JOIN "Properties" p ON p.id::text = w."propertyId"
  LEFT JOIN "Units" u ON u.id::text = w."unitId"`;

/** One work order assigned to this vendor, by number, or NOT_FOUND. */
export async function vendorWorkOrder(vendorId: string, number: number) {
  const { rows } = await zite.sql({ query: `${WORK_ORDER_SELECT} WHERE w."vendorId" = $1 AND w."number" = $2 LIMIT 1`, params: [vendorId, number] });
  if (!rows[0]) throw new ZiteError("We couldn't find that work order. It may have been reassigned — check with the office.", 'NOT_FOUND');
  return rows[0];
}

export async function vendorWorkOrders(vendorId: string) {
  const { rows } = await zite.sql({
    query: `${WORK_ORDER_SELECT}
      WHERE w."vendorId" = $1
      ORDER BY CASE WHEN w."status" IN ('Completed', 'Canceled') THEN 1 ELSE 0 END,
        CASE w."priority" WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
        w."scheduledFor" ASC NULLS FIRST, COALESCE(w."completedAt", w."reportedAt", w.created_at) DESC
      LIMIT 500`,
    params: [vendorId],
  });
  return rows;
}

/** Waiting on the owner (or turned down by them): the vendor can't start or schedule until the office says so. */
export const awaitingApproval = (w: Record<string, unknown>) => str(w.ownerApproval) === 'Pending' || str(w.ownerApproval) === 'Declined';

export function unitLabel(unitName: string | null) {
  if (!unitName || /^(main|house|home)$/i.test(unitName)) return '';
  return /^unit\s/i.test(unitName) ? unitName : `Unit ${unitName}`;
}

/** The shape a work order takes in the vendor's list — also what an update returns, so the list can patch in place. */
export function toVendorRow(w: Record<string, unknown>) {
  const status = (str(w.status) || 'New') as WorkOrderStatus;
  const unitName = ref(w.unitName);
  return {
    id: String(w.id),
    number: num(w.number),
    ref: workOrderRef(num(w.number)),
    title: str(w.title) || 'Work order',
    category: str(w.category) || 'General',
    priority: (str(w.priority) || 'Normal') as WorkOrderPriority,
    status,
    open: OPEN.includes(status),
    propertyName: str(w.propertyName) ?? '',
    unitName: unitLabel(unitName),
    address: formatAddress({ street: str(w.street), city: str(w.city), state: str(w.state), postalCode: str(w.postalCode) }, unitName ? unitLabel(unitName) : null),
    scheduledFor: iso(w.scheduledFor),
    dueDate: day(w.dueDate),
    reportedAt: iso(w.reportedAt) ?? iso(w.created_at),
    startedAt: iso(w.startedAt),
    completedAt: iso(w.completedAt),
    permissionToEnter: w.permissionToEnter === true,
    awaitingApproval: awaitingApproval(w),
    approvalDeclined: str(w.ownerApproval) === 'Declined',
    actualCost: numOrNull(w.actualCost),
    unreadMessages: num(w.unreadMessages),
    lastActivityAt: iso(w.lastActivityAt),
  };
}

export type VendorRow = ReturnType<typeof toVendorRow>;

/** "Thursday, October 2 at 9:00 AM" in the organization's time zone, for emails. */
export function scheduleText(isoValue: string, settings: OrgSettings) {
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, hour: 'numeric', minute: '2-digit' }).format(d);
    return `${date} at ${time}`;
  } catch {
    return d.toUTCString();
  }
}

/** The resident to tell about a visit: the work order's tenant, else the lease's primary resident. */
export async function residentFor(w: Record<string, unknown>): Promise<(Recipient & { phone: string }) | null> {
  const tenantId = ref(w.tenantId);
  const leaseId = ref(w.leaseId);
  if (!tenantId && !leaseId) return null;
  const { rows } = await zite.sql({
    query: tenantId
      ? `SELECT t.id, t."name", t."email", t."phone" FROM "Tenants" t WHERE t.id::text = $1 LIMIT 1`
      : `SELECT t.id, t."name", t."email", t."phone" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at ASC LIMIT 1`,
    params: [tenantId ?? leaseId],
  });
  const t = rows[0];
  if (!t) return null;
  return { kind: 'tenant', id: String(t.id), name: str(t.name) ?? 'Resident', email: str(t.email) || null, phone: str(t.phone) ?? '' };
}

export function vendorMergeContext(w: Record<string, unknown>, vendorName: string, settings: OrgSettings) {
  const unitName = ref(w.unitName);
  return {
    work_order_number: workOrderRef(num(w.number)),
    work_order_title: str(w.title) ?? '',
    work_order_status: str(w.status) ?? '',
    scheduled_for: w.scheduledFor ? scheduleText(String(w.scheduledFor), settings) : '',
    vendor_name: vendorName,
    property_name: str(w.propertyName) ?? '',
    unit_name: unitName ?? '',
    unit_address: formatAddress({ street: str(w.street), city: str(w.city), state: str(w.state), postalCode: str(w.postalCode) }, unitName),
    estimate_amount: w.estimateAmount != null && w.estimateAmount !== '' ? formatMoney(num(w.estimateAmount), settings.currency) : '',
  };
}

export const fileList = (raw: unknown): Array<{ url: string; name: string; source?: string }> => {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(v)
      ? v.filter(p => p && typeof p.url === 'string' && /^https?:\/\//.test(p.url)).map(p => ({ url: String(p.url), name: String(p.name ?? 'Photo'), ...(p.source ? { source: String(p.source) } : {}) }))
      : [];
  } catch {
    return [];
  }
};

/** An uploaded file the browser describes. Only http(s) links, sensible names. */
export const isFileUrl = (url: string) => /^https?:\/\/\S+$/i.test(url) && url.length <= 2000;

/** What a vendor document is, from how it was filed: W-9s are named for it, certificates are Insurance. */
export const docKind = (name: string, category: string): 'W-9' | 'Insurance' | 'Other' => (category === 'Insurance' ? 'Insurance' : /^w-?9\b/i.test(name) ? 'W-9' : 'Other');
