import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PRIORITY_DUE_DAYS, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_SOURCES, WORK_ORDER_STATUSES } from '@project/shared/constants';
import { addDays, todayIn } from '@project/shared/dates';
import { unitOccupancy, workOrderRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { sendTriggered, threadKey } from '@project/shared/server/email';
import { nextNumber } from '@project/shared/server/ledger';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { day, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadWorkOrder, mergeFor, newWorkOrderRecipients, workOrderLocation } from '../server/workOrders';

/**
 * Create a work order from the staff app. When it's for an occupied unit and
 * no resident is named, the current lease's primary resident is attached (they
 * can follow it in the portal). Optionally emails the resident a confirmation.
 */

const Input = z.object({
  title: z.string().trim().min(1, 'Give the work order a title.').max(200),
  description: z.string().max(10000).optional(),
  propertyId: z.string().min(1, 'Choose a property.'),
  unitId: z.string().nullish(),
  tenantId: z.string().nullish(),
  category: z.enum(WORK_ORDER_CATEGORIES),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  source: z.enum(WORK_ORDER_SOURCES).optional(),
  assigneeId: z.string().nullish(),
  vendorId: z.string().nullish(),
  scheduledFor: z.string().nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  permissionToEnter: z.boolean().optional(),
  entryNotes: z.string().max(500).optional(),
  estimateAmount: z.number().min(0).max(10_000_000).nullish(),
  photos: z.array(z.object({ url: z.string().url(), name: z.string().max(200) })).max(20).optional(),
  notifyResident: z.boolean().optional(),
  inspectionId: z.string().nullish(),
});

export default createEndpoint({
  description: 'Create a work order',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), number: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'maintenance.create');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const { rows: prop } = await zite.sql({ query: `SELECT id FROM "Properties" WHERE id::text = $1`, params: [data.propertyId] });
    if (!prop[0]) throw new ZiteError('That property no longer exists.', 'BAD_REQUEST');
    let leaseId: string | null = null;
    let tenantId = data.tenantId ?? null;
    if (data.unitId) {
      const { rows: unit } = await zite.sql({ query: `SELECT id, "propertyId" FROM "Units" WHERE id::text = $1`, params: [data.unitId] });
      if (!unit[0] || String(unit[0].propertyId) !== data.propertyId) throw new ZiteError('That unit isn’t part of the property.', 'BAD_REQUEST');
      const { rows: leases } = await zite.sql({ query: `SELECT id, "status", "leaseType", "startDate", "endDate", "noticeGivenOn", "moveOutDate" FROM "Leases" WHERE "unitId" = $1 AND "status" IN ('Active', 'Pending signature')`, params: [data.unitId] });
      const occ = unitOccupancy(leases.map(l => ({ id: String(l.id), status: String(l.status), leaseType: str(l.leaseType), startDate: day(l.startDate), endDate: day(l.endDate), noticeGivenOn: day(l.noticeGivenOn), moveOutDate: day(l.moveOutDate) })), today);
      leaseId = occ.currentLeaseId;
      if (leaseId && !tenantId) {
        const { rows: lt } = await zite.sql({ query: `SELECT "tenantId" FROM "LeaseTenants" WHERE "leaseId" = $1 ORDER BY CASE "role" WHEN 'Primary' THEN 0 ELSE 1 END LIMIT 1`, params: [leaseId] });
        tenantId = ref(lt[0]?.tenantId);
      }
    }

    const status = data.status ?? (data.scheduledFor ? 'Scheduled' : 'New');
    const now = new Date().toISOString();
    const number = await nextNumber('WorkOrders', 1000);
    const created = await zite.workOrders.create({
      record: {
        title: data.title,
        number,
        description: data.description ?? null,
        propertyId: data.propertyId,
        unitId: data.unitId ?? null,
        leaseId,
        tenantId,
        category: data.category,
        priority: data.priority,
        status,
        source: data.source ?? 'Staff',
        assigneeId: data.assigneeId ?? null,
        vendorId: data.vendorId ?? null,
        scheduledFor: data.scheduledFor ?? null,
        dueDate: data.dueDate ?? addDays(today, PRIORITY_DUE_DAYS[data.priority]),
        permissionToEnter: Boolean(data.permissionToEnter),
        entryNotes: data.entryNotes ?? null,
        estimateAmount: data.estimateAmount ?? null,
        ownerApproval: 'Not required',
        photos: JSON.stringify(data.photos ?? []),
        createdById: actor.id,
        inspectionId: data.inspectionId ?? null,
        reportedAt: now,
        lastActivityAt: now,
        startedAt: status === 'In progress' ? now : null,
        completedAt: status === 'Completed' ? now : null,
      },
    });
    const wo = await loadWorkOrder({ id: created.id });
    const loc = await workOrderLocation(wo);

    await logActivity({ entityType: 'work_order', entityId: wo.id, workOrderId: wo.id, propertyId: wo.propertyId, unitId: wo.unitId, leaseId, tenantId, action: 'created', summary: 'created the work order', actorId: actor.id, actorName: actor.name });
    const ref_ = workOrderRef(number);
    const recipients = data.priority === 'Emergency' ? await newWorkOrderRecipients(wo.propertyId) : [];
    await notify({ recipientIds: [...recipients, data.assigneeId], kind: data.assigneeId ? 'work_order_assigned' : 'work_order_created', title: `${ref_} ${data.title}`, body: `${data.priority} · ${loc.propertyName}${loc.unitName ? ` ${loc.unitName}` : ''}`, link: `/work-orders/${number}`, entityType: 'work_order', entityId: wo.id, actorId: actor.id, actorName: actor.name });

    const merge = mergeFor(wo, settings, { propertyName: loc.propertyName, address: loc.address });
    if (data.notifyResident && tenantId) {
      const { rows } = await zite.sql({ query: `SELECT "name", "email" FROM "Tenants" WHERE id::text = $1`, params: [tenantId] });
      if (rows[0]) await sendTriggered({ trigger: 'Work order received', settings, recipient: { kind: 'tenant', id: tenantId, name: str(rows[0].name) ?? 'Resident', email: str(rows[0].email) }, context: merge, workOrderId: wo.id, leaseId, propertyId: wo.propertyId, thread: threadKey('work_order', wo.id), senderMemberId: actor.id }).catch(() => null);
    }
    if (data.vendorId) {
      const { rows } = await zite.sql({ query: `SELECT id, "name", "email", "contactName" FROM "Vendors" WHERE id::text = $1`, params: [data.vendorId] });
      if (rows[0]?.email) await sendTriggered({ trigger: 'Vendor assigned', settings, recipient: { kind: 'vendor', id: String(rows[0].id), name: str(rows[0].contactName) || str(rows[0].name) || 'there', email: str(rows[0].email) }, context: { ...merge, vendor_name: str(rows[0].name) ?? '' }, workOrderId: wo.id, propertyId: wo.propertyId, thread: threadKey('work_order', wo.id), senderMemberId: actor.id }).catch(() => null);
    }
    return { id: wo.id, number };
  },
});
