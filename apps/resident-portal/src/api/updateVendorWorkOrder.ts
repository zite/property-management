import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { WorkOrderStatus } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { sendTriggered, threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { ref, str } from '@project/shared/server/sql';
import { assertReasonable, parseInput } from '../server/identity';
import { fileList, isFileUrl, residentFor, scheduleText, toVendorRow, vendorMergeContext, vendorScope, vendorWorkOrder } from '../server/vendor';

/**
 * A vendor moves a job along: schedule (or reschedule) the visit, start work,
 * complete it with notes, photos and the actual cost, or put it on hold with a
 * reason. Each change is logged, bumps the job's last activity, tells the
 * assignee and property manager, and — for scheduling and completion — sends
 * the resident the organization's email when there is one.
 *
 * Jobs waiting on the owner's approval can't be scheduled, started or
 * completed; the vendor can still message the office about them.
 */

const Photo = z.object({ url: z.string().max(2000), name: z.string().max(200) });

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('schedule'), number: z.number().int().positive(), scheduledFor: z.string().max(40) }),
  z.object({ action: z.literal('start'), number: z.number().int().positive() }),
  z.object({
    action: z.literal('complete'),
    number: z.number().int().positive(),
    notes: z.string().trim().min(1, 'Describe the work you did.').max(4000, 'Keep the notes under 4,000 characters.'),
    actualCost: z.number({ invalid_type_error: 'Enter the total cost.' }).min(0, 'The cost can’t be negative.').max(1_000_000, 'That cost looks too large. Check the amount.'),
    photos: z.array(Photo).max(12, 'Attach up to 12 photos.').default([]),
  }),
  z.object({ action: z.literal('hold'), number: z.number().int().positive(), reason: z.string().trim().min(1, 'Say why the job is on hold.').max(1000, 'Keep the reason under 1,000 characters.') }),
]);

const ALLOWED: Record<'schedule' | 'start' | 'complete' | 'hold', WorkOrderStatus[]> = {
  schedule: ['New', 'Scheduled', 'On hold', 'In progress'],
  start: ['New', 'Scheduled', 'On hold'],
  complete: ['New', 'Scheduled', 'In progress', 'On hold'],
  hold: ['New', 'Scheduled', 'In progress'],
};

export default createEndpoint({
  description: 'Schedule, start, complete or hold a work order as the vendor',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    if (req.action === 'complete') assertReasonable(req.notes, 4000);
    const scope = await vendorScope(context);
    const w = await vendorWorkOrder(scope.vendorId, req.number);
    const id = String(w.id);
    const number = Number(w.number);
    const refNo = workOrderRef(number);
    const status = (str(w.status) || 'New') as WorkOrderStatus;
    const approval = str(w.ownerApproval);

    if (status === 'Completed' || status === 'Canceled') throw new ZiteError(`${refNo} is ${status.toLowerCase()}, so it can't be changed. Message the office if something needs another look.`, 'CONFLICT');
    if (!ALLOWED[req.action].includes(status)) {
      throw new ZiteError(req.action === 'start' ? `${refNo} is already in progress.` : req.action === 'hold' ? `${refNo} is already on hold.` : `${refNo} can't be updated right now. Reload and try again.`, 'CONFLICT');
    }
    if (req.action !== 'hold' && (approval === 'Pending' || approval === 'Declined')) {
      throw new ZiteError(approval === 'Pending' ? `${refNo} is waiting for the owner's approval. The office will let you know when you can go ahead.` : `The owner declined the estimate for ${refNo}. Check with the office before doing any work.`, 'CONFLICT');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const who = scope.vendor.name;
    const record: Record<string, unknown> = { lastActivityAt: nowIso };
    let summary = '';
    let action = 'status_changed';
    let title = '';
    let body = '';
    let nextStatus: WorkOrderStatus = status;

    switch (req.action) {
      case 'schedule': {
        const when = new Date(req.scheduledFor);
        if (Number.isNaN(when.getTime())) throw new ZiteError('Choose a date and time for the visit.', 'BAD_REQUEST');
        if (when.getTime() < now.getTime() - 12 * 3600_000) throw new ZiteError('That time has already passed. Choose a time from today onward.', 'BAD_REQUEST');
        if (when.getTime() > now.getTime() + 366 * 86400_000) throw new ZiteError('Choose a time within the next year.', 'BAD_REQUEST');
        nextStatus = status === 'In progress' ? 'In progress' : 'Scheduled';
        record.scheduledFor = when.toISOString();
        const text = scheduleText(when.toISOString(), scope.settings);
        action = 'scheduled';
        summary = `${w.scheduledFor ? 'rescheduled' : 'scheduled'} the visit for ${text}`;
        title = `${who} ${w.scheduledFor ? 'rescheduled' : 'scheduled'} ${refNo}`;
        body = `${str(w.title)}\n${text}`;
        break;
      }
      case 'start':
        nextStatus = 'In progress';
        if (!w.startedAt) record.startedAt = nowIso;
        summary = `started work on ${refNo}`;
        title = `${who} started ${refNo}`;
        body = str(w.title) ?? '';
        break;
      case 'complete': {
        nextStatus = 'Completed';
        const photos = req.photos.filter(p => isFileUrl(p.url));
        Object.assign(record, {
          completedAt: nowIso,
          startedAt: w.startedAt ?? nowIso,
          actualCost: Math.round(req.actualCost * 100) / 100,
          completionNotes: req.notes,
          ...(photos.length ? { photos: JSON.stringify([...fileList(w.photos), ...photos.map(p => ({ url: p.url, name: p.name.slice(0, 200), source: 'Vendor' }))]) } : {}),
        });
        summary = `completed ${refNo} (${formatMoney(req.actualCost, scope.settings.currency)})`;
        title = `${who} completed ${refNo}`;
        body = `${str(w.title)} · ${formatMoney(req.actualCost, scope.settings.currency)}\n${req.notes}`;
        break;
      }
      case 'hold':
        nextStatus = 'On hold';
        summary = `put ${refNo} on hold: ${req.reason}`;
        title = `${who} put ${refNo} on hold`;
        body = req.reason;
        break;
    }
    if (nextStatus !== status) record.status = nextStatus;

    await zite.workOrders.update({ id, record: record as never });

    const links = { workOrderId: id, propertyId: ref(w.propertyId), unitId: ref(w.unitId), leaseId: ref(w.leaseId), vendorId: scope.vendorId };
    const updated = { ...w, ...record };
    await Promise.all([
      logActivity({ entityType: 'work_order', entityId: id, action, summary, actorName: who, data: { by: 'vendor', from: status, to: nextStatus, ...(req.action === 'schedule' ? { scheduledFor: record.scheduledFor } : {}), ...(req.action === 'complete' ? { actualCost: record.actualCost } : {}) }, ...links }),
      notify({ recipientIds: [ref(w.assigneeId), ref(w.managerId)], kind: 'work_order_updated', title, body, link: `/work-orders/${number}`, entityType: 'work_order', entityId: id, actorName: who }),
      // The reason goes in the job's conversation too, so the office can answer it there.
      req.action === 'hold'
        ? zite.messages.create({ record: { subject: 'On hold', body: req.reason, thread: threadKey('work_order', id), direction: 'Inbound', channel: 'Portal', vendorId: scope.vendorId, workOrderId: id, propertyId: ref(w.propertyId), senderName: who, delivery: 'Received', sentAt: nowIso } })
        : Promise.resolve(null),
      (async () => {
        if (req.action !== 'schedule' && req.action !== 'complete') return;
        const resident = await residentFor(w);
        if (!resident) return;
        await sendTriggered({
          trigger: req.action === 'schedule' ? 'Work order scheduled' : 'Work order completed',
          settings: scope.settings,
          recipient: resident,
          context: vendorMergeContext(updated, who, scope.settings),
          thread: threadKey('work_order', id),
          workOrderId: id,
          leaseId: ref(w.leaseId),
          propertyId: ref(w.propertyId),
        }).catch(e => console.error('Resident email failed', e instanceof Error ? e.message : e));
      })(),
    ]);

    return toVendorRow(await vendorWorkOrder(scope.vendorId, number));
  },
});
