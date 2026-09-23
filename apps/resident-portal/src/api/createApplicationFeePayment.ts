import Stripe from 'stripe';
import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { toCents } from '@project/shared/money';
import { getSettings, isStripeConfigured } from '@project/shared/server/settings';
import { num, str } from '@project/shared/server/sql';
import { findListingById, isPublished, listingFee } from '../server/applications';
import { parseInput, requireOwnApplication, sessionEmail } from '../server/identity';

/**
 * Start paying an application fee by card, before the application is sent.
 *
 * Only reachable when the organization has switched online payments on AND
 * connected Stripe. One PaymentIntent per application is reused while it can
 * still be paid, so reopening the review step never creates a pile of intents.
 * Cards only, no redirects: the portal is a hash-routed app.
 */
const Input = z.object({ id: z.string().min(1).max(64) });

export default createEndpoint({
  description: 'Create or reuse a Stripe PaymentIntent for an application fee',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    status: z.enum(['requires_payment', 'processing', 'succeeded', 'paid', 'free']),
    clientSecret: z.string().nullable(),
    paymentIntentId: z.string().nullable(),
    amount: z.number(),
  }),
  execute: async ({ input, context }) => {
    const { id } = parseInput(Input, input);
    const settings = await getSettings();
    if (!settings.onlinePayments || !isStripeConfigured()) throw new ZiteError('Online payments aren’t set up, so there’s nothing to pay here. The office will explain how to pay the fee.', 'BAD_REQUEST');
    const email = sessionEmail(context)!;
    const app = await requireOwnApplication(context, id);
    if (app.status !== 'Draft') throw new ZiteError('This application has already been submitted.', 'CONFLICT');
    const listing = await findListingById(String(app.listingId ?? ''));
    if (!listing || !isPublished(listing)) throw new ZiteError('This home is no longer taking applications.', 'CONFLICT');

    const fee = listingFee(listing, settings);
    if (app.feePaidAt) return { status: 'paid' as const, clientSecret: null, paymentIntentId: null, amount: fee };
    if (!(toCents(fee) > 0)) return { status: 'free' as const, clientSecret: null, paymentIntentId: null, amount: 0 };
    const amount = toCents(fee);
    const currency = settings.currency.toLowerCase();
    const stripe = new Stripe(process.env.ZITE_STRIPE_ACCESS_TOKEN!, { httpClient: Stripe.createFetchHttpClient() });

    const { rows: previous } = await zite.sql({
      query: `SELECT id, "intentId", "status" FROM "OnlinePayments" WHERE "applicationId" = $1 AND "purpose" = 'Application fee' ORDER BY created_at DESC LIMIT 20`,
      params: [id],
    });
    const open = previous.find(r => ['Pending', 'Processing', 'Succeeded'].includes(String(r.status)) && str(r.intentId));
    if (open) {
      const intent = await stripe.paymentIntents.retrieve(String(open.intentId));
      if (intent.status === 'succeeded') return { status: 'succeeded' as const, clientSecret: null, paymentIntentId: intent.id, amount: fee };
      if (intent.status === 'processing') return { status: 'processing' as const, clientSecret: null, paymentIntentId: intent.id, amount: fee };
      const payable = ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status);
      if (payable && intent.amount === amount && intent.currency === currency && intent.client_secret) {
        return { status: 'requires_payment' as const, clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: fee };
      }
      // The fee changed or the intent was canceled: retire it and start again.
      if (payable) await stripe.paymentIntents.cancel(intent.id).catch(() => undefined);
      await zite.onlinePayments.update({ id: String(open.id), record: { status: 'Canceled' } });
    }

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] ?? (await stripe.customers.create({ email, name: str(app.applicantName) || undefined }));
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency,
        customer: customer.id,
        receipt_email: email,
        description: `Application fee — ${str(listing.title) || 'rental application'}`.slice(0, 200),
        metadata: { purpose: 'Application fee', applicationId: id, listingId: String(listing.id) },
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      },
      // Two tabs (or a double render) asking at once get the same intent.
      { idempotencyKey: `resident-portal-appfee-${id}-${amount}-${previous.length}` },
    );
    const { rows: known } = await zite.sql({ query: `SELECT 1 FROM "OnlinePayments" WHERE "intentId" = $1 LIMIT 1`, params: [intent.id] });
    if (!known.length) {
      await zite.onlinePayments.create({
        record: { intentId: intent.id, applicationId: id, purpose: 'Application fee', amount: fee, status: 'Pending', payerEmail: email },
      });
    }
    return { status: 'requires_payment' as const, clientSecret: intent.client_secret ?? null, paymentIntentId: intent.id, amount: num(fee) };
  },
});
