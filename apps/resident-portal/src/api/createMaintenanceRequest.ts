import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PRIORITY_DUE_DAYS, WORK_ORDER_CATEGORIES } from '@project/shared/constants';
import { addDays, todayIn } from '@project/shared/dates';
import { workOrderRef } from '@project/shared/leases';
import { membersWith } from '@project/shared/server/actor';
import { logActivity } from '@project/shared/server/activity';
import { sendTriggered, threadKey } from '@project/shared/server/email';
import { nextNumber } from '@project/shared/server/ledger';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { assertDailyLimit, cleanAttachments, homeLabel, residentFor } from '../server/resident';

/**
 * A resident reports something that needs fixing. It lands in the office's
 * work order queue as New, due by its priority, with the resident's photos
 * and instructions for getting in; maintenance staff and the property's
 * manager are told, and the resident gets a confirmation.
 */

const CATEGORIES = WORK_ORDER_CATEGORIES.filter(c => c !== 'Turnover') as [string, ...string[]];

const Input = z.object({
  leaseId: z.string().max(64).nullish(),
  category: z.enum(CATEGORIES),
  priority: z.enum(['Emergency', 'High', 'Normal', 'Low']),
  title: z.string().trim().min(3, 'Give the request a short title.').max(120, 'Keep the title under 120 characters.'),
  description: z.string().trim().max(5000, 'That description is a little long — please shorten it.').optional().default(''),
  photos: z.array(z.object({ url: z.string().url().max(2000), name: z.string().max(200) })).max(6, 'Add up to 6 photos.').optional().default([]),
  permissionToEnter: z.boolean(),
  entryNotes: z.string().max(500, 'Keep entry instructions under 500 characters.').optional().default(''),
  pets: z.string().max(200).optional().default(''),
});

export default createEndpoint({
  description: 'A resident submits a maintenance request',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    const settings = await getSettings();
    if (!settings.maintenanceRequests) throw new ZiteError(`Maintenance requests aren't taken online right now. Call the office at ${settings.phone || 'the number on your lease'}.`, 'BAD_REQUEST');
    if (lease.status !== 'Active') throw new ZiteError('You can request maintenance once your lease is active. For anything urgent, call the office.', 'BAD_REQUEST');
    await assertDailyLimit('WorkOrders', 'leaseId', lease.id, 12, 'requests');

    const today = todayIn(settings.timezone);
    const now = new Date().toISOString();
    const priority = data.priority;
    const entryNotes = [data.entryNotes.trim(), data.pets.trim() ? `Pets: ${data.pets.trim()}` : ''].filter(Boolean).join('\n');
    const photos = cleanAttachments(data.photos).slice(0, 6);
    const number = await nextNumber('WorkOrders', 1000);

    const wo = await zite.workOrders.create({
      record: {
        title: data.title.trim(),
        number,
        description: data.description.trim() || null,
        propertyId: lease.propertyId || null,
        unitId: lease.unitId || null,
        leaseId: lease.id,
        tenantId,
        category: data.category,
        priority,
        status: 'New',
        source: 'Portal',
        dueDate: addDays(today, PRIORITY_DUE_DAYS[priority]),
        permissionToEnter: data.permissionToEnter,
        entryNotes: entryNotes || null,
        photos: JSON.stringify(photos),
        ownerApproval: 'Not required',
        reportedAt: now,
        lastActivityAt: now,
      },
    });

    const ref = workOrderRef(number);
    const home = homeLabel(lease);
    const maintenance = await membersWith('maintenance.manage');
    await Promise.all([
      logActivity({
        entityType: 'work_order',
        entityId: wo.id,
        action: 'created',
        summary: 'submitted the request in the resident portal',
        actorName: me.name,
        data: { priority, category: data.category },
        propertyId: lease.propertyId || null,
        unitId: lease.unitId || null,
        leaseId: lease.id,
        tenantId,
        workOrderId: wo.id,
      }),
      notify({
        recipientIds: [...maintenance.map(m => m.id), lease.managerId],
        kind: 'work_order_created',
        title: `${priority === 'Emergency' ? 'Emergency — ' : ''}${ref} · ${data.title.trim()}`,
        body: `${me.name} · ${home} · ${data.category}${data.permissionToEnter ? ' · OK to enter' : ''}`,
        link: `/work-orders/${number}`,
        entityType: 'work_order',
        entityId: wo.id,
        actorName: me.name,
      }),
      sendTriggered({
        trigger: 'Work order received',
        settings,
        recipient: me.recipient,
        context: {
          work_order_number: ref,
          work_order_title: data.title.trim(),
          work_order_status: 'New',
          property_name: lease.propertyName,
          unit_name: lease.unitName,
          unit_address: lease.address,
        },
        thread: threadKey('work_order', wo.id),
        workOrderId: wo.id,
        leaseId: lease.id,
        propertyId: lease.propertyId || null,
      }).catch(e => console.error('Work order confirmation failed', e instanceof Error ? e.message : e)),
    ]);

    return { id: wo.id, number, ref, priority, emergencyPhone: settings.emergencyPhone || settings.phone };
  },
});
