import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { ref, str } from '@project/shared/server/sql';
import { assertReasonable, parseInput } from '../server/identity';
import { vendorScope, vendorWorkOrder } from '../server/vendor';

/** The vendor writes to the office about a job. The assignee (or the property manager) gets it in their inbox. */

const Input = z.object({
  number: z.number().int().positive(),
  body: z.string().trim().min(1, 'Write a message before sending.').max(5000, 'Keep messages under 5,000 characters.'),
});

export default createEndpoint({
  description: 'Send a message about a work order as the vendor',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    assertReasonable(req.body, 5000);
    const scope = await vendorScope(context);
    const w = await vendorWorkOrder(scope.vendorId, req.number);
    if (str(w.status) === 'Canceled') throw new ZiteError('This work order was canceled. Call the office if you need to reach someone about it.', 'CONFLICT');
    const id = String(w.id);
    const now = new Date().toISOString();
    const who = scope.vendor.name;
    const created = await zite.messages.create({
      record: {
        subject: `${workOrderRef(Number(w.number))} · ${str(w.title) ?? ''}`.slice(0, 240),
        body: req.body,
        thread: threadKey('work_order', id),
        direction: 'Inbound',
        channel: 'Portal',
        vendorId: scope.vendorId,
        workOrderId: id,
        propertyId: ref(w.propertyId),
        senderName: who,
        delivery: 'Received',
        sentAt: now,
      },
    });
    await Promise.all([
      zite.workOrders.update({ id, record: { lastActivityAt: now } }),
      notify({
        recipientIds: ref(w.assigneeId) ? [ref(w.assigneeId)] : [ref(w.managerId)],
        kind: 'work_order_message',
        title: `${who} on ${workOrderRef(Number(w.number))}`,
        body: req.body.slice(0, 280),
        link: `/work-orders/${Number(w.number)}`,
        entityType: 'work_order',
        entityId: id,
        actorName: who,
      }),
    ]);
    return { id: created.id, mine: true, senderName: who, subject: '', body: req.body, sentAt: now };
  },
});
