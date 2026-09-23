import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PAYMENT_METHODS } from '@project/shared/constants';
import { formatDay } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { leaseRecipients, sendTriggered } from '@project/shared/server/email';
import { applyDeposit, leaseBalances, postCharge, postCredit, receivePayment, refundCredit, refundDeposit } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Money on a lease, from staff: receive a payment, post a charge or credit,
 * refund a credit balance, apply or return the security deposit. Everything
 * goes through the double-entry engine; this endpoint adds permission checks,
 * activity and the payment receipt email.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.');
const money = z.number().positive('Enter an amount greater than zero.').max(10_000_000);
const common = { leaseId: z.string().min(1), date: day, amount: money, description: z.string().max(250).optional(), reference: z.string().max(80).optional(), notes: z.string().max(2000).optional() };
const allocations = z.array(z.object({ chargeId: z.string().min(1), amount: z.number().min(0) })).max(200).optional();

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('payment'), ...common, paymentMethod: z.enum(PAYMENT_METHODS), bankAccountId: z.string().optional(), tenantId: z.string().optional(), allocations, sendReceipt: z.boolean().optional() }),
  z.object({ action: z.literal('charge'), ...common, accountId: z.string().min(1, 'Choose what the charge is for.'), dueDate: day.optional() }),
  z.object({ action: z.literal('credit'), ...common, accountId: z.string().optional(), allocations }),
  z.object({ action: z.literal('refundCredit'), ...common, paymentMethod: z.enum(PAYMENT_METHODS), bankAccountId: z.string().optional() }),
  z.object({ action: z.literal('applyDeposit'), ...common }),
  z.object({ action: z.literal('refundDeposit'), ...common, paymentMethod: z.enum(PAYMENT_METHODS), bankAccountId: z.string().optional() }),
]);

const SUMMARY: Record<z.infer<typeof Input>['action'], string> = {
  payment: 'received a payment of',
  charge: 'charged',
  credit: 'credited',
  refundCredit: 'refunded a credit balance of',
  applyDeposit: 'applied deposit of',
  refundDeposit: 'returned deposit of',
};

export default createEndpoint({
  description: 'Post a payment, charge, credit, refund or deposit movement on a lease',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), number: z.number(), balance: z.number(), receipt: z.enum(['Sent', 'Failed', 'Skipped']) }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'receivables.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const { rows } = await zite.sql({ query: `SELECT id, "name", "status", "propertyId", "unitId" FROM "Leases" WHERE id::text = $1`, params: [data.leaseId] });
    const lease = rows[0];
    if (!lease) throw new ZiteError('That lease no longer exists.', 'NOT_FOUND');
    if (lease.status === 'Draft' || lease.status === 'Canceled') throw new ZiteError(`This lease is ${String(lease.status).toLowerCase()}, so it has no ledger to post to.`, 'BAD_REQUEST');
    const base = { date: data.date, description: data.description, reference: data.reference ?? null, notes: data.notes ?? null, createdById: actor.id };

    let posted: { id: string; number: number };
    switch (data.action) {
      case 'payment':
        posted = await receivePayment({ ...base, leaseId: data.leaseId, amount: data.amount, paymentMethod: data.paymentMethod, bankAccountId: data.bankAccountId ?? null, tenantId: data.tenantId ?? null, allocations: data.allocations?.filter(a => a.amount > 0) });
        break;
      case 'charge': {
        const chart = await getChart();
        const account = chart.byId.get(data.accountId);
        if (!account || !(account.accountType === 'Income' || account.subtype === 'Deposits held' || account.subtype === 'Other liability')) throw new ZiteError('Choose an income account for the charge.', 'BAD_REQUEST');
        posted = await postCharge({ ...base, leaseId: data.leaseId, accountId: data.accountId, amount: data.amount, dueDate: data.dueDate ?? data.date });
        break;
      }
      case 'credit':
        posted = await postCredit({ ...base, leaseId: data.leaseId, amount: data.amount, accountId: data.accountId ?? null, allocations: data.allocations?.filter(a => a.amount > 0) });
        break;
      case 'refundCredit':
        posted = await refundCredit({ ...base, leaseId: data.leaseId, amount: data.amount, paymentMethod: data.paymentMethod, bankAccountId: data.bankAccountId ?? null });
        break;
      case 'applyDeposit':
        posted = await applyDeposit({ ...base, leaseId: data.leaseId, amount: data.amount });
        break;
      case 'refundDeposit':
        posted = await refundDeposit({ ...base, leaseId: data.leaseId, amount: data.amount, paymentMethod: data.paymentMethod, bankAccountId: data.bankAccountId ?? null });
        break;
    }

    const balance = (await leaseBalances([data.leaseId])).get(data.leaseId)?.balance ?? 0;
    await logActivity({
      entityType: 'lease', entityId: data.leaseId, leaseId: data.leaseId, propertyId: str(lease.propertyId), unitId: str(lease.unitId),
      action: `ledger_${data.action}`, summary: `${SUMMARY[data.action]} ${formatMoney(data.amount, settings.currency)}${data.action === 'charge' && data.description ? ` for ${data.description}` : ''}`,
      actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id, number: posted.number },
    });

    let receipt: 'Sent' | 'Failed' | 'Skipped' = 'Skipped';
    if (data.action === 'payment' && data.sendReceipt) {
      const recipients = (await leaseRecipients(data.leaseId)).filter(r => r.email);
      const to = (data.tenantId && recipients.find(r => r.id === data.tenantId)) || recipients[0];
      if (to) {
        const sent = await sendTriggered({
          trigger: 'Payment receipt', settings, recipient: to, leaseId: data.leaseId, propertyId: str(lease.propertyId), senderMemberId: actor.id,
          context: { amount_paid: formatMoney(data.amount, settings.currency), payment_date: formatDay(data.date, 'long'), payment_method: data.paymentMethod, receipt_number: String(posted.number), balance_due: formatMoney(Math.max(0, balance), settings.currency) },
        }).catch(() => null);
        receipt = sent ? (sent.delivery === 'Failed' ? 'Failed' : 'Sent') : 'Skipped';
      }
    }
    return { id: posted.id, number: posted.number, balance, receipt };
  },
});
