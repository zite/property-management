import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { num, numOrNull, ref, str } from '@project/shared/server/sql';
import { assertReasonable, parseInput } from '../server/identity';
import { ownerContacts, ownerScope } from '../server/owner';

/**
 * The owner approves or declines a repair estimate. The decision, their note
 * and the time go on the work order; the assignee and the property manager
 * hear about it; the owner's reply lands in their conversation with the office.
 * An approved job that was on hold waiting for them is released: Scheduled if
 * a vendor and a time are already set, otherwise back to New for dispatch.
 */

const Input = z.object({
  workOrderId: z.string().min(1).max(64),
  decision: z.enum(['Approved', 'Declined']),
  note: z.string().max(2000, 'Keep the note under 2,000 characters.').nullish(),
});

export default createEndpoint({
  description: 'Approve or decline a repair estimate',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    assertReasonable(req.note, 2000);
    const scope = await ownerScope(context);
    const { rows } = await zite.sql({
      query: `SELECT w.*, p."name" AS "propertyName" FROM "WorkOrders" w JOIN "Properties" p ON p.id::text = w."propertyId" WHERE w.id::text = $1 AND w."propertyId" = ANY($2) LIMIT 1`,
      params: [req.workOrderId, scope.propertyIds],
    });
    const w = rows[0];
    if (!w) throw new ZiteError("We couldn't find that repair on your properties.", 'NOT_FOUND');
    const status = str(w.status) || 'New';
    if (str(w.ownerApproval) !== 'Pending') {
      throw new ZiteError(`This repair was already ${String(w.ownerApproval).toLowerCase() || 'answered'}. Reload to see the latest.`, 'CONFLICT');
    }
    if (status === 'Completed' || status === 'Canceled') {
      throw new ZiteError(`This work order was ${status.toLowerCase()} before a decision was needed, so there's nothing to approve.`, 'CONFLICT');
    }

    const id = String(w.id);
    const number = num(w.number);
    const note = (req.note ?? '').trim();
    const now = new Date().toISOString();
    const approved = req.decision === 'Approved';
    const estimate = numOrNull(w.estimateAmount);
    const amount = estimate != null ? formatMoney(estimate, scope.settings.currency) : null;
    const nextStatus = approved && status === 'On hold' ? (ref(w.vendorId) && w.scheduledFor ? 'Scheduled' : 'New') : status;
    const who = scope.owner.contactName || scope.owner.name;

    await zite.workOrders.update({
      id,
      record: { ownerApproval: req.decision, ownerApprovalNote: note || null, ownerRespondedAt: now, lastActivityAt: now, ...(nextStatus !== status ? { status: nextStatus } : {}) },
    });

    const what = amount ? `the ${amount} estimate` : 'the repair';
    await Promise.all([
      logActivity([
        {
          entityType: 'work_order',
          entityId: id,
          action: approved ? 'approval_granted' : 'approval_declined',
          summary: `${approved ? 'approved' : 'declined'} ${what} as owner`,
          actorName: who,
          data: { by: 'owner', decision: req.decision, note: note || null, estimate },
          workOrderId: id,
          propertyId: ref(w.propertyId),
          unitId: ref(w.unitId),
          ownerId: scope.ownerId,
          vendorId: ref(w.vendorId),
        },
        ...(nextStatus !== status
          ? [{ entityType: 'work_order' as const, entityId: id, action: 'status_changed', summary: `moved ${workOrderRef(number)} to ${nextStatus} after owner approval`, actorName: who, data: { from: status, to: nextStatus }, workOrderId: id, propertyId: ref(w.propertyId), ownerId: scope.ownerId }]
          : []),
      ]),
      zite.messages.create({
        record: {
          subject: `${approved ? 'Approved' : 'Declined'}: ${str(w.title) ?? workOrderRef(number)}`.slice(0, 240),
          body: note || (approved ? `I approve ${what}.` : `I'm declining ${what}.`),
          thread: threadKey('owner', scope.ownerId),
          direction: 'Inbound',
          channel: 'Portal',
          ownerId: scope.ownerId,
          workOrderId: id,
          propertyId: ref(w.propertyId),
          senderName: who,
          delivery: 'Received',
          sentAt: now,
          readAt: null,
        },
      }),
      ownerContacts([String(w.propertyId)]).then(managers =>
        notify({
          recipientIds: [ref(w.assigneeId), ...managers],
          kind: 'work_order_approval',
          title: `${who} ${approved ? 'approved' : 'declined'} ${workOrderRef(number)}${amount ? ` (${amount})` : ''}`,
          body: [str(w.title), note ? `“${note}”` : null, approved && nextStatus !== status ? `Moved to ${nextStatus}.` : null].filter(Boolean).join('\n'),
          link: `/work-orders/${number}`,
          entityType: 'work_order',
          entityId: id,
          actorName: who,
        }),
      ),
    ]);

    return { id, number, decision: req.decision, note, respondedAt: now, status: nextStatus };
  },
});
