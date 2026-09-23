import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, todayIn } from '@project/shared/dates';
import { workOrderRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { sendTriggered } from '@project/shared/server/email';
import { postBill, postCharge } from '@project/shared/server/ledger';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadWorkOrder, mergeFor, workOrderLocation } from '../server/workOrders';

/**
 * The money side of a work order:
 *  - `requestApproval`: ask the owner to approve an estimate (puts it on hold, emails the owner)
 *  - `recordApproval`: record the owner's answer taken by phone or email
 *  - `bill`: enter the vendor's bill for the work (posts to payables)
 *  - `chargeResident`: bill the resident for damage they caused (posts to their ledger)
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.');
const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('requestApproval'), workOrderId: z.string().min(1), amount: z.number().positive('Enter the estimate.').max(10_000_000), note: z.string().max(2000).optional() }),
  z.object({ action: z.literal('recordApproval'), workOrderId: z.string().min(1), decision: z.enum(['Approved', 'Declined']), note: z.string().max(2000).optional() }),
  z.object({
    action: z.literal('bill'), workOrderId: z.string().min(1), vendorId: z.string().min(1, 'Choose the vendor.'), amount: z.number().positive('Enter the bill amount.').max(10_000_000),
    accountId: z.string().min(1), date: day, dueDate: day, reference: z.string().max(80).optional(), description: z.string().max(250).optional(), attachmentUrl: z.string().url().optional(),
  }),
  z.object({ action: z.literal('chargeResident'), workOrderId: z.string().min(1), amount: z.number().positive('Enter the amount.').max(1_000_000), date: day, dueDate: day.optional(), description: z.string().max(250).optional(), accountId: z.string().optional() }),
]);

export default createEndpoint({
  description: 'Owner approvals, vendor bills and resident chargebacks for a work order',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ ok: z.boolean(), transactionId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    const wo = await loadWorkOrder({ id: data.workOrderId });
    const settings = await getSettings();
    const now = new Date().toISOString();
    const ref_ = workOrderRef(wo.number);
    const base = { entityType: 'work_order' as const, entityId: wo.id, workOrderId: wo.id, propertyId: wo.propertyId, unitId: wo.unitId, actorId: actor.id, actorName: actor.name };

    if (data.action === 'requestApproval') {
      assertCan(actor, 'maintenance.manage');
      const loc = await workOrderLocation(wo);
      await zite.workOrders.update({ id: wo.id, record: { ownerApproval: 'Pending', estimateAmount: data.amount, ownerApprovalNote: data.note ?? null, ownerRespondedAt: null, status: wo.status === 'Completed' ? wo.status : 'On hold', lastActivityAt: now } });
      await logActivity({ ...base, action: 'approval_requested', summary: `asked the owner to approve ${formatMoney(data.amount, settings.currency)}` });
      if (loc.ownerId) {
        const { rows } = await zite.sql({ query: `SELECT id, "name", "contactName", "email", "portalEnabled" FROM "Owners" WHERE id::text = $1`, params: [loc.ownerId] });
        const o = rows[0];
        if (o?.email) {
          await sendTriggered({ trigger: 'Owner approval', settings, recipient: { kind: 'owner', id: String(o.id), name: str(o.contactName) || str(o.name) || 'there', email: str(o.email) }, context: { ...mergeFor({ ...wo, estimateAmount: data.amount }, settings, { propertyName: loc.propertyName, address: loc.address }) }, workOrderId: wo.id, propertyId: wo.propertyId, senderMemberId: actor.id }).catch(() => null);
        }
      }
      return { ok: true, transactionId: null };
    }

    if (data.action === 'recordApproval') {
      assertCan(actor, 'maintenance.manage');
      if (wo.ownerApproval !== 'Pending') throw new ZiteError('This work order isn’t waiting for owner approval.', 'BAD_REQUEST');
      const approved = data.decision === 'Approved';
      await zite.workOrders.update({ id: wo.id, record: { ownerApproval: data.decision, ownerApprovalNote: data.note ?? null, ownerRespondedAt: now, status: approved && wo.status === 'On hold' ? (wo.scheduledFor ? 'Scheduled' : 'New') : wo.status, lastActivityAt: now } });
      await logActivity({ ...base, action: approved ? 'approval_granted' : 'approval_declined', summary: `recorded the owner’s ${approved ? 'approval' : 'decline'}${data.note ? ` — “${data.note.slice(0, 80)}”` : ''}` });
      await notify({ recipientIds: [wo.assigneeId], kind: 'work_order_approval', title: `Owner ${approved ? 'approved' : 'declined'} ${ref_}`, body: wo.title, link: `/work-orders/${wo.number}`, entityType: 'work_order', entityId: wo.id, actorId: actor.id, actorName: actor.name });
      return { ok: true, transactionId: null };
    }

    if (data.action === 'bill') {
      assertCan(actor, 'payables.manage');
      if (wo.billId) {
        const { rows } = await zite.sql({ query: `SELECT "status" FROM "Transactions" WHERE id::text = $1`, params: [wo.billId] });
        if (rows[0]?.status === 'Posted') throw new ZiteError('This work order already has a bill. Void it first to enter a new one.', 'CONFLICT');
      }
      if (!wo.propertyId) throw new ZiteError('Set the property before entering a bill.', 'BAD_REQUEST');
      const chart = await getChart();
      if (chart.byId.get(data.accountId)?.accountType !== 'Expense') throw new ZiteError('Choose an expense account.', 'BAD_REQUEST');
      const posted = await postBill({
        vendorId: data.vendorId, propertyId: wo.propertyId, unitId: wo.unitId, workOrderId: wo.id, date: data.date, dueDate: data.dueDate,
        reference: data.reference ?? null, description: data.description || `${ref_} ${wo.title}`, attachmentUrl: data.attachmentUrl ?? null, createdById: actor.id,
        lines: [{ accountId: data.accountId, amount: data.amount }],
      });
      await zite.workOrders.update({ id: wo.id, record: { billId: posted.id, actualCost: data.amount, lastActivityAt: now } });
      await logActivity({ ...base, action: 'bill_entered', summary: `entered bill #${posted.number} for ${formatMoney(data.amount, settings.currency)}` });
      return { ok: true, transactionId: posted.id };
    }

    assertCan(actor, 'receivables.manage');
    if (!wo.leaseId) throw new ZiteError('This work order isn’t linked to a lease, so there’s no resident ledger to charge.', 'BAD_REQUEST');
    const chart = await getChart();
    const accountId = data.accountId ?? chart.key('damage_income').id;
    const posted = await postCharge({
      leaseId: wo.leaseId, accountId, amount: data.amount, date: data.date, dueDate: data.dueDate ?? addDays(todayIn(settings.timezone), 14),
      description: data.description || `Repair charge — ${wo.title}`, source: 'Work order', workOrderId: wo.id, createdById: actor.id,
    });
    await zite.workOrders.update({ id: wo.id, record: { tenantChargeId: posted.id, lastActivityAt: now } });
    await logActivity({ ...base, leaseId: wo.leaseId, action: 'resident_charged', summary: `charged the resident ${formatMoney(data.amount, settings.currency)}` });
    return { ok: true, transactionId: posted.id };
  },
});
