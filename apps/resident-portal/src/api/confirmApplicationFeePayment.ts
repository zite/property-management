import Stripe from 'stripe';
import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatMoney, toCents } from '@project/shared/money';
import { getChart } from '@project/shared/server/accounts';
import { logActivity } from '@project/shared/server/activity';
import { postJournalEntry } from '@project/shared/server/ledger';
import { getSettings, isStripeConfigured } from '@project/shared/server/settings';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { findListingById, todayFor } from '../server/applications';
import { parseInput, requireOwnApplication, sessionEmail } from '../server/identity';

/**
 * Record an application fee once Stripe says it's paid.
 *
 * The browser only reports "I paid"; this asks Stripe, and checks the intent
 * is for THIS application, this applicant and this amount. It's safe to call
 * any number of times: the income is posted once (found again by the intent id
 * on the transaction's reference) and the application's fee date is set once.
 */
const Input = z.object({ id: z.string().min(1).max(64), paymentIntentId: z.string().min(3).max(255).regex(/^pi_[A-Za-z0-9_]+$/, "That payment reference isn't valid.") });

export default createEndpoint({
  description: 'Verify a Stripe application fee payment and record it',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ status: z.enum(['succeeded', 'processing', 'failed', 'canceled']), feePaidAt: z.string().nullable(), message: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const settings = await getSettings();
    if (!settings.onlinePayments || !isStripeConfigured()) throw new ZiteError('Online payments aren’t set up.', 'BAD_REQUEST');
    const email = sessionEmail(context)!;
    const app = await requireOwnApplication(context, data.id);

    const { rows } = await zite.sql({
      query: `SELECT * FROM "OnlinePayments" WHERE "intentId" = $1 AND "applicationId" = $2 AND "purpose" = 'Application fee' LIMIT 1`,
      params: [data.paymentIntentId, data.id],
    });
    const row = rows[0];
    if (!row) throw new ZiteError("We couldn't find that payment.", 'NOT_FOUND');

    const stripe = new Stripe(process.env.ZITE_STRIPE_ACCESS_TOKEN!, { httpClient: Stripe.createFetchHttpClient() });
    const intent = await stripe.paymentIntents.retrieve(data.paymentIntentId, { expand: ['latest_charge'] });
    const belongs =
      intent.metadata?.applicationId === data.id &&
      intent.metadata?.purpose === 'Application fee' &&
      String(row.payerEmail ?? '').toLowerCase() === email &&
      (!intent.receipt_email || intent.receipt_email.toLowerCase() === email) &&
      intent.amount === toCents(num(row.amount)) &&
      intent.currency === settings.currency.toLowerCase();
    if (!belongs) throw new ZiteError("We couldn't match that payment to your application. You haven't been charged twice — contact the office if a charge appears.", 'NOT_FOUND');

    if (intent.status === 'processing') {
      if (row.status !== 'Processing' && row.status !== 'Succeeded') await zite.onlinePayments.update({ id: String(row.id), record: { status: 'Processing' } });
      return { status: 'processing' as const, feePaidAt: null, message: 'Your bank is still confirming the payment.' };
    }
    if (intent.status === 'canceled') {
      await zite.onlinePayments.update({ id: String(row.id), record: { status: 'Canceled' } });
      return { status: 'canceled' as const, feePaidAt: null, message: 'That payment was canceled. Try again.' };
    }
    if (intent.status !== 'succeeded') {
      const message = intent.last_payment_error?.message ?? 'The payment didn’t go through. Check your card details and try again.';
      await zite.onlinePayments.update({ id: String(row.id), record: { error: message.slice(0, 500) } });
      return { status: 'failed' as const, feePaidAt: null, message };
    }

    const amount = num(row.amount);
    const charge = typeof intent.latest_charge === 'object' && intent.latest_charge ? (intent.latest_charge as Stripe.Charge) : null;
    const card = charge?.payment_method_details?.card;
    const method = card ? `${card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card'} •••• ${card.last4 ?? ''}`.trim() : charge?.payment_method_details?.type ?? 'Card';
    const now = new Date().toISOString();

    let transactionId = ref(row.transactionId);
    if (!transactionId) {
      const { rows: posted } = await zite.sql({ query: `SELECT id FROM "Transactions" WHERE "reference" = $1 AND "status" = 'Posted' LIMIT 1`, params: [intent.id] });
      if (posted[0]) transactionId = String(posted[0].id);
    }
    if (!transactionId) {
      const listing = await findListingById(String(app.listingId ?? ''));
      const propertyId = ref(app.propertyId) ?? ref(listing?.propertyId);
      const chart = await getChart();
      let bankId = chart.key('operating_bank').id;
      if (propertyId) {
        const { rows: prop } = await zite.sql({ query: `SELECT "bankAccountId" FROM "Properties" WHERE id::text = $1`, params: [propertyId] });
        const own = ref(prop[0]?.bankAccountId);
        if (own && chart.byId.get(own)?.subtype === 'Bank') bankId = own;
      }
      const income = chart.key('application_fee_income').id;
      const txn = await postJournalEntry({
        date: todayFor(settings),
        description: `Application fee — ${str(app.applicantName) || email}${listing?.title ? `, ${str(listing.title)}` : ''}`.slice(0, 240),
        reference: intent.id,
        notes: `Paid online by ${email} (${method})`,
        propertyId,
        lines: [
          { accountId: bankId, debit: amount, propertyId, memo: 'Application fee received online' },
          { accountId: income, credit: amount, propertyId, memo: 'Application fee' },
        ],
      });
      transactionId = txn.id;
    }

    if (row.status !== 'Succeeded' || !ref(row.transactionId)) {
      await zite.onlinePayments.update({ id: String(row.id), record: { status: 'Succeeded', method, settledAt: now, transactionId, error: null } });
    }
    let feePaidAt = iso(app.feePaidAt);
    if (!feePaidAt) {
      feePaidAt = now;
      await zite.applications.update({ id: data.id, record: { feePaidAt: now, feeAmount: amount, lastActivityAt: now } });
      await logActivity({
        entityType: 'application',
        entityId: data.id,
        action: 'fee_paid',
        summary: `paid the ${formatMoney(amount, settings.currency)} application fee online`,
        actorName: str(app.applicantName) || email,
        applicationId: data.id,
        propertyId: ref(app.propertyId),
        data: { intentId: intent.id, transactionId, method },
      });
    }
    return { status: 'succeeded' as const, feePaidAt, message: null };
  },
});
