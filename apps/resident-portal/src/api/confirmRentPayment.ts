import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { residentFor } from '../server/resident';
import { onlinePaymentByIntent, settleIntent, stripeClient } from '../server/stripe';

/**
 * Called by the page after Stripe confirms a payment in the browser. Trusts
 * nothing from the browser but the intent id: the intent is fetched from
 * Stripe, must belong to this resident and lease, and is recorded in the
 * books at most once.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish(), intentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/).max(255) });

export default createEndpoint({
  description: 'Record a confirmed online rent payment',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId, intentId } = parseInput(Input, input, "We couldn't find that payment.");
    const { lease, tenantId } = await residentFor(context, leaseId);
    const stripe = stripeClient();
    if (!stripe) throw new ZiteError("Online payments aren't available right now.", 'BAD_REQUEST');

    const row = await onlinePaymentByIntent(intentId);
    if (!row || row.leaseId !== lease.id || row.tenantId !== tenantId) throw new ZiteError("We couldn't find that payment.", 'NOT_FOUND');
    const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['payment_method'] });
    const md = intent.metadata ?? {};
    if (md.purpose !== 'Rent' || md.leaseId !== lease.id || md.tenantId !== tenantId) throw new ZiteError("We couldn't find that payment.", 'NOT_FOUND');

    const settings = await getSettings();
    const result = await settleIntent(intent, row, { settings });
    return { ...result, amount: row.amount, currency: settings.currency };
  },
});
