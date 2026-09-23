import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { officeRecipients, requestOnLease, residentFor } from '../server/resident';

/** The resident rates finished work. A low rating is flagged to whoever handled it. */

const Input = z.object({
  leaseId: z.string().max(64).nullish(),
  number: z.number().int().positive(),
  rating: z.number().int().min(1, 'Choose a rating from 1 to 5 stars.').max(5, 'Choose a rating from 1 to 5 stars.'),
  feedback: z.string().max(2000, 'Keep feedback under 2,000 characters.').optional().default(''),
});

export default createEndpoint({
  description: 'A resident rates completed maintenance work',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const w = await requestOnLease(me.lease.id, data.number);
    if (w.status !== 'Completed') throw new ZiteError('You can rate the work once the request is complete.', 'BAD_REQUEST');

    const id = String(w.id);
    const number = num(w.number);
    const feedback = data.feedback.trim();
    const now = new Date().toISOString();
    const changed = w.tenantRating != null;
    await zite.workOrders.update({ id, record: { tenantRating: data.rating, tenantFeedback: feedback || null, lastActivityAt: now } });
    await logActivity({
      entityType: 'work_order',
      entityId: id,
      action: 'rated',
      summary: `${changed ? 'changed their rating to' : 'rated the work'} ${data.rating}/5`,
      actorName: me.name,
      data: { rating: data.rating },
      propertyId: me.lease.propertyId || null,
      unitId: me.lease.unitId || null,
      leaseId: me.lease.id,
      tenantId: me.tenantId,
      workOrderId: id,
      vendorId: ref(w.vendorId),
    });

    if (data.rating <= 2) {
      const assignee = ref(w.assigneeId);
      await notify({
        recipientIds: assignee ? [assignee, me.lease.managerId] : await officeRecipients(me.lease, 'maintenance.manage'),
        kind: 'work_order_updated',
        title: `${me.name} rated ${workOrderRef(number)} ${data.rating}/5`,
        body: feedback || str(w.title) || null,
        link: `/work-orders/${number}`,
        entityType: 'work_order',
        entityId: id,
        actorName: me.name,
      });
    }
    return { rating: data.rating, feedback };
  },
});
