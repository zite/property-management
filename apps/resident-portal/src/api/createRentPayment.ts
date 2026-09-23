import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { leaseLedger } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { homeLabel, nextRecurringCharges, paymentCeiling, residentFor } from '../server/resident';
import { stripeClient, toOnlinePaymentRow } from '../server/stripe';

/**
 * Start an online rent payment: a Stripe PaymentIntent for the amount the
 * resident chose, tied to their Stripe customer and to this lease, plus a
 * Pending OnlinePayments row. The browser confirms it with the returned
 * client secret; nothing is recorded in the books until Stripe says it succeeded.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish(), amount: z.number().finite() });

export default createEndpoint({
  description: 'Create a Stripe PaymentIntent for a rent payment',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId, amount } = parseInput(Input, input, 'Enter the amount you want to pay.');
    const me = await residentFor(context, leaseId);
    const { lease, tenantId } = me;
    const settings = await getSettings();
    const stripe = stripeClient();
    if (!settings.onlinePayments || !stripe) throw new ZiteError("Online payments aren't available yet. See the other ways to pay on this page.", 'BAD_REQUEST');
    if (lease.status !== 'Active' && lease.status !== 'Ended') throw new ZiteError('Payments open once your lease is active.', 'BAD_REQUEST');

    const [ledger, next] = await Promise.all([leaseLedger(lease.id), nextRecurringCharges(lease, settings.timezone)]);
    const cents = toCents(amount);
    if (cents < 100) throw new ZiteError(`The smallest online payment is ${formatMoney(1, settings.currency)}.`, 'BAD_REQUEST');
    const ceiling = paymentCeiling(ledger.balance, next);
    if (cents > toCents(ceiling)) throw new ZiteError(`That's more than we can take online in one payment (${formatMoney(ceiling, settings.currency)}). Check the amount, or call the office.`, 'BAD_REQUEST');
    if (!settings.allowPartialPayments) {
      const expected = ledger.balance > 0 ? toCents(ledger.balance) : toCents(next?.total ?? 0);
      if (expected === 0) throw new ZiteError('There’s nothing to pay right now.', 'BAD_REQUEST');
      if (cents !== expected) throw new ZiteError(`Please pay the full amount of ${formatMoney(fromCents(expected), settings.currency)}.`, 'BAD_REQUEST');
    }

    // Reuse an unfinished intent for the same amount rather than leaving a trail of abandoned ones.
    const { rows: pending } = await zite.sql({
      query: `SELECT * FROM "OnlinePayments" WHERE "leaseId" = $1 AND "tenantId" = $2 AND "purpose" = 'Rent' AND "status" = 'Pending' AND "amount" = $3 AND created_at > now() - interval '12 hours' ORDER BY created_at DESC LIMIT 1`,
      params: [lease.id, tenantId, fromCents(cents)],
    });
    if (pending[0]) {
      const row = toOnlinePaymentRow(pending[0]);
      const existing = await stripe.paymentIntents.retrieve(row.intentId).catch(() => null);
      if (existing && existing.client_secret && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existing.status) && existing.amount === cents) {
        return { intentId: existing.id, clientSecret: existing.client_secret, amount: fromCents(cents), currency: settings.currency };
      }
    }

    const email = me.email;
    const found = await stripe.customers.list({ email, limit: 1 });
    const customer =
      found.data[0] ??
      (await stripe.customers.create({ email, name: me.name, metadata: { tenantId } }));

    const intent = await stripe.paymentIntents.create({
      amount: cents,
      currency: settings.currency.toLowerCase(),
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      description: `Rent payment — ${homeLabel(lease) || lease.name}`.slice(0, 200),
      metadata: { purpose: 'Rent', leaseId: lease.id, tenantId },
    });
    if (!intent.client_secret) throw new ZiteError("We couldn't start the payment. Try again in a moment.", 'INTERNAL_ERROR');

    await zite.onlinePayments.create({
      record: { intentId: intent.id, leaseId: lease.id, tenantId, purpose: 'Rent', amount: fromCents(cents), status: 'Pending', payerEmail: email },
    });

    return { intentId: intent.id, clientSecret: intent.client_secret, amount: fromCents(cents), currency: settings.currency };
  },
});
