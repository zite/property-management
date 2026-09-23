import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PRIORITY_DUE_DAYS, type WorkOrderPriority, type WorkOrderStatus } from '@project/shared/constants';
import { addDays, formatDay, todayIn } from '@project/shared/dates';
import { workOrderRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { formatAddress } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import type { Actor } from '@project/shared/server/actor';
import { membersWith } from '@project/shared/server/actor';
import { sendTriggered, threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { getSettings, type OrgSettings } from '@project/shared/server/settings';
import { bool, day, iso, json, num, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * Work orders on the server: the row shape every endpoint returns, and the
 * one place status changes, assignments and scheduling have their side
 * effects (timestamps, activity, notifications, resident and vendor emails).
 */

export type WorkOrderRow = ReturnType<typeof toWorkOrder>;

export function toWorkOrder(r: Record<string, unknown>) {
  const photos = json<Array<{ url: string; name: string }>>(r.photos, []);
  return {
    id: String(r.id),
    number: num(r.number),
    title: str(r.title) ?? '',
    description: str(r.description) ?? '',
    status: (str(r.status) || 'New') as WorkOrderStatus,
    priority: (str(r.priority) || 'Normal') as WorkOrderPriority,
    category: str(r.category) || 'General',
    source: str(r.source) || 'Staff',
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    leaseId: ref(r.leaseId),
    tenantId: ref(r.residentId) ?? ref(r.tenantId),
    tenantName: ref(r.tenantName),
    assigneeId: ref(r.assigneeId),
    vendorId: ref(r.vendorId),
    scheduledFor: iso(r.scheduledFor),
    dueDate: day(r.dueDate),
    reportedAt: iso(r.reportedAt) ?? iso(r.created_at) ?? new Date().toISOString(),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    lastActivityAt: iso(r.lastActivityAt) ?? iso(r.updated_at),
    permissionToEnter: bool(r.permissionToEnter),
    entryNotes: str(r.entryNotes) ?? '',
    estimateAmount: numOrNull(r.estimateAmount),
    actualCost: numOrNull(r.actualCost),
    billId: ref(r.billId),
    tenantChargeId: ref(r.tenantChargeId),
    ownerApproval: str(r.ownerApproval) || 'Not required',
    ownerApprovalNote: str(r.ownerApprovalNote) ?? '',
    ownerRespondedAt: iso(r.ownerRespondedAt),
    photos,
    completionNotes: str(r.completionNotes) ?? '',
    tenantRating: numOrNull(r.tenantRating),
    tenantFeedback: str(r.tenantFeedback) ?? '',
    scheduleId: ref(r.scheduleId),
    inspectionId: ref(r.inspectionId),
    createdById: ref(r.createdById),
    messageCount: num(r.messageCount),
    unreadCount: num(r.unreadCount),
  };
}

// The resident is the one named on the work order, else the lease's primary resident.
export const WORK_ORDER_SELECT = `
  w.*,
  COALESCE(NULLIF(w."tenantId", ''), (SELECT lt."tenantId" FROM "LeaseTenants" lt WHERE lt."leaseId" = w."leaseId" AND COALESCE(w."leaseId", '') <> '' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 ELSE 2 END LIMIT 1)) AS "residentId",
  (SELECT t."name" FROM "Tenants" t WHERE t.id::text = COALESCE(NULLIF(w."tenantId", ''), (SELECT lt."tenantId" FROM "LeaseTenants" lt WHERE lt."leaseId" = w."leaseId" AND COALESCE(w."leaseId", '') <> '' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 ELSE 2 END LIMIT 1))) AS "tenantName",
  (SELECT COUNT(*) FROM "Messages" m WHERE m."workOrderId" = w.id::text) AS "messageCount",
  (SELECT COUNT(*) FROM "Messages" m WHERE m."workOrderId" = w.id::text AND m."direction" = 'Inbound' AND m."readAt" IS NULL) AS "unreadCount"`;

export async function loadWorkOrder(where: { id?: string; number?: number }) {
  const { rows } = await zite.sql({
    query: `SELECT ${WORK_ORDER_SELECT} FROM "WorkOrders" w WHERE ${where.id ? 'w.id::text = $1' : 'w."number" = $1'} LIMIT 1`,
    params: [where.id ?? where.number],
  });
  if (!rows[0]) throw new ZiteError('That work order no longer exists.', 'NOT_FOUND');
  return toWorkOrder(rows[0]);
}

export type WorkOrderPatch = Partial<{
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  category: string;
  propertyId: string;
  unitId: string | null;
  assigneeId: string | null;
  vendorId: string | null;
  scheduledFor: string | null;
  dueDate: string | null;
  permissionToEnter: boolean;
  entryNotes: string;
  estimateAmount: number | null;
  actualCost: number | null;
  completionNotes: string;
  photos: Array<{ url: string; name: string }>;
}>;

async function location(wo: { propertyId: string | null; unitId: string | null }) {
  const { rows } = await zite.sql({
    query: `SELECT p."name", p."street", p."city", p."state", p."postalCode", p."managerId", p."ownerId", u."name" AS "unitName" FROM "Properties" p LEFT JOIN "Units" u ON u.id::text = $2 WHERE p.id::text = $1`,
    params: [wo.propertyId ?? '', wo.unitId ?? ''],
  });
  const r = rows[0] ?? {};
  return {
    propertyName: str(r.name) ?? '',
    unitName: str(r.unitName) ?? '',
    address: formatAddress({ street: str(r.street), city: str(r.city), state: str(r.state), postalCode: str(r.postalCode) }, str(r.unitName)),
    managerId: ref(r.managerId),
    ownerId: ref(r.ownerId),
  };
}

export function mergeFor(wo: WorkOrderRow, settings: OrgSettings, extra: { vendorName?: string; propertyName?: string; address?: string } = {}) {
  return {
    work_order_number: workOrderRef(wo.number),
    work_order_title: wo.title,
    work_order_status: wo.status,
    scheduled_for: wo.scheduledFor ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(new Date(wo.scheduledFor)) : 'to be confirmed',
    vendor_name: extra.vendorName || 'our maintenance team',
    property_name: extra.propertyName ?? '',
    unit_address: extra.address ?? '',
    estimate_amount: wo.estimateAmount != null ? formatMoney(wo.estimateAmount, settings.currency) : '',
  };
}

/**
 * Apply a change to a work order with all its consequences. Returns the
 * updated row. `silent` skips resident/vendor emails (bulk edits, imports).
 */
export async function applyWorkOrderPatch(actor: Actor, before: WorkOrderRow, patch: WorkOrderPatch, opts: { silent?: boolean; settings?: OrgSettings } = {}) {
  const settings = opts.settings ?? (await getSettings());
  const now = new Date().toISOString();
  const record: Record<string, unknown> = {};
  const activities: string[] = [];
  const set = <K extends keyof WorkOrderPatch>(key: K, value: WorkOrderPatch[K]) => {
    if (value === undefined) return false;
    const current = (before as Record<string, unknown>)[key];
    const same = JSON.stringify(current ?? null) === JSON.stringify(value ?? null);
    if (same) return false;
    record[key] = value;
    return true;
  };

  if (patch.title !== undefined && !patch.title.trim()) throw new ZiteError('A work order needs a title.', 'BAD_REQUEST');
  if (set('title', patch.title?.trim())) activities.push('renamed the work order');
  if (set('description', patch.description)) activities.push('updated the description');
  if (set('category', patch.category)) activities.push(`set category to ${patch.category}`);
  if (set('priority', patch.priority)) {
    activities.push(`set priority to ${patch.priority}`);
    if (!before.dueDate && patch.priority) record.dueDate = addDays(todayIn(settings.timezone), PRIORITY_DUE_DAYS[patch.priority]);
  }
  if (set('propertyId', patch.propertyId)) activities.push('moved it to another property');
  if (set('unitId', patch.unitId)) activities.push('changed the unit');
  if (set('dueDate', patch.dueDate)) activities.push(patch.dueDate ? `set the due date to ${formatDay(patch.dueDate)}` : 'removed the due date');
  if (set('permissionToEnter', patch.permissionToEnter)) activities.push(patch.permissionToEnter ? 'noted permission to enter' : 'removed permission to enter');
  set('entryNotes', patch.entryNotes);
  if (set('estimateAmount', patch.estimateAmount)) activities.push(patch.estimateAmount != null ? `set the estimate to ${formatMoney(patch.estimateAmount, settings.currency)}` : 'removed the estimate');
  if (set('actualCost', patch.actualCost)) activities.push(patch.actualCost != null ? `recorded a cost of ${formatMoney(patch.actualCost, settings.currency)}` : 'cleared the cost');
  set('completionNotes', patch.completionNotes);
  if (set('photos', patch.photos)) activities.push('updated photos');

  const assigneeChanged = set('assigneeId', patch.assigneeId);
  if (assigneeChanged) {
    const { rows } = patch.assigneeId ? await zite.sql({ query: `SELECT "name" FROM "Members" WHERE id::text = $1`, params: [patch.assigneeId] }) : { rows: [] };
    activities.push(patch.assigneeId ? (patch.assigneeId === actor.id ? 'took the work order' : `assigned it to ${str(rows[0]?.name) ?? 'a teammate'}`) : 'unassigned it');
  }
  const vendorChanged = set('vendorId', patch.vendorId);
  let vendor: { id: string; name: string; email: string; contactName: string } | null = null;
  if (patch.vendorId) {
    const { rows } = await zite.sql({ query: `SELECT id, "name", "email", "contactName" FROM "Vendors" WHERE id::text = $1`, params: [patch.vendorId] });
    if (!rows[0]) throw new ZiteError('That vendor no longer exists.', 'BAD_REQUEST');
    vendor = { id: String(rows[0].id), name: str(rows[0].name) ?? '', email: str(rows[0].email) ?? '', contactName: str(rows[0].contactName) ?? '' };
  }
  if (vendorChanged) activities.push(patch.vendorId ? `assigned ${vendor?.name}` : 'removed the vendor');
  const scheduleChanged = set('scheduledFor', patch.scheduledFor);
  if (scheduleChanged) activities.push(patch.scheduledFor ? `scheduled it for ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(new Date(patch.scheduledFor))}` : 'cleared the schedule');

  let status = patch.status;
  // Scheduling something that's still New moves it along, like people expect.
  if (!status && scheduleChanged && patch.scheduledFor && before.status === 'New') status = 'Scheduled';
  const statusChanged = set('status', status);
  if (statusChanged && status) {
    activities.push(status === 'Completed' ? 'marked it completed' : status === 'Canceled' ? 'canceled it' : `moved it to ${status}`);
    if (status === 'In progress' && !before.startedAt) record.startedAt = now;
    if (status === 'Completed') record.completedAt = now;
    if (before.status === 'Completed' && status !== 'Completed') record.completedAt = null;
  }

  if (!Object.keys(record).length) return before;
  record.lastActivityAt = now;
  await zite.workOrders.update({ id: before.id, record: record as never });
  const after = { ...before, ...(record as Partial<WorkOrderRow>) } as WorkOrderRow;
  const loc = await location(after);

  await logActivity(
    activities.map(summary => ({
      entityType: 'work_order' as const,
      entityId: before.id,
      workOrderId: before.id,
      propertyId: after.propertyId,
      unitId: after.unitId,
      leaseId: after.leaseId,
      tenantId: after.tenantId,
      action: summary.startsWith('moved it to') || summary.startsWith('marked') || summary.startsWith('canceled') ? 'status_changed' : 'updated',
      summary,
      actorId: actor.id,
      actorName: actor.name,
      data: statusChanged ? { from: before.status, to: status } : undefined,
    })),
  );

  const ref_ = workOrderRef(after.number);
  if (assigneeChanged && patch.assigneeId && patch.assigneeId !== actor.id) {
    await notify({ recipientIds: [patch.assigneeId], kind: 'work_order_assigned', title: `${actor.name} assigned you ${ref_}`, body: after.title, link: `/work-orders/${after.number}`, entityType: 'work_order', entityId: after.id, actorId: actor.id, actorName: actor.name });
  }
  if (statusChanged) {
    await notify({ recipientIds: [after.assigneeId, loc.managerId], kind: 'work_order_updated', title: `${ref_} ${status === 'Completed' ? 'completed' : `is ${String(status).toLowerCase()}`}`, body: after.title, link: `/work-orders/${after.number}`, entityType: 'work_order', entityId: after.id, actorId: actor.id, actorName: actor.name });
  }

  if (!opts.silent) {
    const merge = mergeFor(after, settings, { vendorName: vendor?.name ?? undefined, propertyName: loc.propertyName, address: loc.address });
    if (vendorChanged && vendor?.email) {
      await sendTriggered({ trigger: 'Vendor assigned', settings, recipient: { kind: 'vendor', id: vendor.id, name: vendor.contactName || vendor.name, email: vendor.email }, context: merge, workOrderId: after.id, propertyId: after.propertyId, thread: threadKey('work_order', after.id), senderMemberId: actor.id }).catch(() => null);
    }
    if (after.tenantId && (statusChanged || scheduleChanged)) {
      const trigger = status === 'Completed' ? 'Work order completed' : (status === 'Scheduled' || (scheduleChanged && patch.scheduledFor)) ? 'Work order scheduled' : null;
      if (trigger) {
        const { rows } = await zite.sql({ query: `SELECT "name", "email" FROM "Tenants" WHERE id::text = $1`, params: [after.tenantId] });
        if (rows[0]) {
          await sendTriggered({ trigger, settings, recipient: { kind: 'tenant', id: after.tenantId, name: str(rows[0].name) ?? 'Resident', email: str(rows[0].email) }, context: merge, workOrderId: after.id, leaseId: after.leaseId, propertyId: after.propertyId, thread: threadKey('work_order', after.id), senderMemberId: actor.id }).catch(() => null);
        }
      }
    }
  }
  return after;
}

/** People who should hear about a brand-new work order. */
export async function newWorkOrderRecipients(propertyId: string | null) {
  const maintenance = await membersWith('maintenance.manage');
  const { rows } = propertyId ? await zite.sql({ query: `SELECT "managerId" FROM "Properties" WHERE id::text = $1`, params: [propertyId] }) : { rows: [] };
  return [...new Set([...maintenance.filter(m => m.role === 'Maintenance' || m.role === 'Admin').map(m => m.id), ref(rows[0]?.managerId)].filter(Boolean) as string[])];
}

export { location as workOrderLocation };
