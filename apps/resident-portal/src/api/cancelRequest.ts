import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { officeRecipients, requestOnLease, residentFor } from '../server/resident';

/**
 * A resident withdraws a request before anyone has scheduled it. Once it's
 * scheduled a visit may already be booked, so they message the office instead.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish(), number: z.number().int().positive(), reason: z.string().max(1000).optional().default('') });

export default createEndpoint({
  description: 'A resident cancels a maintenance request that is still new',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const w = await requestOnLease(me.lease.id, data.number);
    const number = num(w.number);
    if (w.status === 'Canceled') return { status: 'Canceled' as const };
    if (w.status !== 'New') throw new ZiteError(`${workOrderRef(number)} is already ${String(w.status).toLowerCase()}. Send a message on the request if you no longer need it.`, 'CONFLICT');

    const id = String(w.id);
    const now = new Date().toISOString();
    const reason = data.reason.trim();
    await zite.workOrders.update({ id, record: { status: 'Canceled', lastActivityAt: now } });
    if (reason) {
      await zite.messages.create({
        record: {
          subject: `${workOrderRef(number)} · ${str(w.title) ?? 'Maintenance request'}`.slice(0, 240),
          body: `I canceled this request: ${reason}`,
          thread: threadKey('work_order', id),
          direction: 'Inbound',
          channel: 'Portal',
          tenantId: me.tenantId,
          workOrderId: id,
          leaseId: me.lease.id,
          propertyId: me.lease.propertyId || null,
          senderName: me.name,
          delivery: 'Received',
          sentAt: now,
        },
      });
    }
    const assignee = ref(w.assigneeId);
    await Promise.all([
      logActivity({
        entityType: 'work_order',
        entityId: id,
        action: 'status_changed',
        summary: `canceled by the resident${reason ? ` — ${reason.slice(0, 160)}` : ''}`,
        actorName: me.name,
        data: { from: 'New', to: 'Canceled' },
        propertyId: me.lease.propertyId || null,
        unitId: me.lease.unitId || null,
        leaseId: me.lease.id,
        tenantId: me.tenantId,
        workOrderId: id,
      }),
      notify({
        recipientIds: assignee ? [assignee] : await officeRecipients(me.lease, 'maintenance.manage'),
        kind: 'work_order_updated',
        title: `${me.name} canceled ${workOrderRef(number)}`,
        body: reason || str(w.title) || null,
        link: `/work-orders/${number}`,
        entityType: 'work_order',
        entityId: id,
        actorName: me.name,
      }),
    ]);
    return { status: 'Canceled' as const };
  },
});
