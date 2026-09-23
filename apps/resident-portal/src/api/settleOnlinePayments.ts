import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getSettings } from '@project/shared/server/settings';
import { settleIntent, stripeClient, toOnlinePaymentRow } from '../server/stripe';

/**
 * Hourly: bring every unfinished online rent payment in line with Stripe.
 * Bank debits sit in `processing` for days and a resident may close the tab
 * before the page confirms, so this is what makes sure every payment that
 * succeeded lands in the books exactly once. Abandoned checkouts are tidied
 * after three days.
 */

export default createEndpoint({
  description: 'Settle pending and processing online rent payments with Stripe',
  inputSchema: z.object({}),
  schedule: { scheduleType: 'recurring', schedule: { frequency: 'hourly', interval: 1, minute: 20 }, timezone: 'America/Denver' },
  execute: async ({ context }) => {
    // A schedule, not a button: signed-in callers can't trigger a sweep of everyone's payments.
    if (context.user) throw new ZiteError('This runs automatically every hour.', 'FORBIDDEN');
    const stripe = stripeClient();
    if (!stripe) return { checked: 0, succeeded: 0, failed: 0, canceled: 0, skipped: 'Stripe is not connected' };

    const settings = await getSettings();
    const { rows } = await zite.sql({
      query: `SELECT * FROM "OnlinePayments" WHERE "purpose" = 'Rent' AND "status" IN ('Pending', 'Processing') AND created_at > now() - interval '45 days' ORDER BY created_at ASC LIMIT 200`,
      params: [],
    });
    let succeeded = 0;
    let failed = 0;
    let canceled = 0;
    for (const raw of rows) {
      const row = toOnlinePaymentRow(raw);
      try {
        const intent = await stripe.paymentIntents.retrieve(row.intentId, { expand: ['payment_method'] });
        if (intent.metadata?.purpose !== 'Rent' || intent.metadata?.leaseId !== row.leaseId) continue;
        const stale = row.createdAt && Date.now() - Date.parse(row.createdAt) > 3 * 86_400_000;
        if (stale && intent.status === 'requires_payment_method' && !intent.last_payment_error) {
          await stripe.paymentIntents.cancel(intent.id).catch(() => undefined);
          await zite.onlinePayments.update({ id: row.id, record: { status: 'Canceled', error: 'Checkout was not completed' } });
          canceled++;
          continue;
        }
        const result = await settleIntent(intent, row, { settings });
        if (result.status === 'Succeeded') succeeded++;
        if (result.status === 'Failed') failed++;
      } catch (e) {
        console.error('Settling online payment failed', row.intentId, e instanceof Error ? e.message : e);
      }
    }
    return { checked: rows.length, succeeded, failed, canceled, skipped: null };
  },
});
