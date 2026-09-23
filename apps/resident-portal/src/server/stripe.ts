import Stripe from 'stripe';
import { zite } from 'zitejs/db';
import { leaseRef } from '@project/shared/leases';
import { formatDay, todayIn } from '@project/shared/dates';
import { formatMoney, fromCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { sendTriggered } from '@project/shared/server/email';
import { leaseBalances, receivePayment, voidTransaction } from '@project/shared/server/ledger';
import { notify } from '@project/shared/server/notify';
import { getSettings, isStripeConfigured, type OrgSettings } from '@project/shared/server/settings';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { officeRecipients } from './resident';

/**
 * Rent paid online through the organization's own Stripe account.
 *
 * The browser only ever confirms a PaymentIntent this server created. Money is
 * recorded in the books from what Stripe reports server-side, exactly once per
 * intent: OnlinePayments.transactionId marks it recorded, and a posted
 * Transactions row carrying the intent id is checked right before posting and
 * de-duplicated right after — the page confirming and the hourly settlement
 * run can race, and there are no database transactions to lean on.
 *
 * Cards settle at once; bank debits (ACH) sit in `processing` for days, which
 * is why `settleOnlinePayments` runs every hour.
 */

export function stripeClient(): Stripe | null {
  const token = process.env.ZITE_STRIPE_ACCESS_TOKEN;
  if (!token || !isStripeConfigured()) return null;
  return new Stripe(token, { httpClient: Stripe.createFetchHttpClient() });
}

export type OnlinePaymentRow = {
  id: string;
  intentId: string;
  leaseId: string;
  tenantId: string;
  amount: number;
  status: string;
  transactionId: string | null;
  payerEmail: string;
  createdAt: string | null;
};

export function toOnlinePaymentRow(r: Record<string, unknown>): OnlinePaymentRow {
  return {
    id: String(r.id),
    intentId: str(r.intentId) ?? '',
    leaseId: ref(r.leaseId) ?? '',
    tenantId: ref(r.tenantId) ?? '',
    amount: num(r.amount),
    status: str(r.status) || 'Pending',
    transactionId: ref(r.transactionId),
    payerEmail: str(r.payerEmail) ?? '',
    createdAt: iso(r.created_at),
  };
}

export async function onlinePaymentByIntent(intentId: string) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "OnlinePayments" WHERE "intentId" = $1 ORDER BY created_at ASC LIMIT 1`, params: [intentId] });
  return rows[0] ? toOnlinePaymentRow(rows[0]) : null;
}

/** "Visa •••• 4242", "Bank account •••• 6789" — how the payment method reads on a receipt. */
function methodLabel(pm: Stripe.PaymentMethod | string | null | undefined): string {
  if (!pm || typeof pm === 'string') return 'Online';
  if (pm.type === 'card' && pm.card) return `${pm.card.brand ? pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1) : 'Card'} •••• ${pm.card.last4}`;
  if (pm.type === 'us_bank_account' && pm.us_bank_account) return `${pm.us_bank_account.bank_name || 'Bank account'} •••• ${pm.us_bank_account.last4}`;
  if (pm.type === 'link') return 'Link';
  return pm.type.replace(/_/g, ' ');
}

export type SettleResult = { status: 'Pending' | 'Processing' | 'Succeeded' | 'Failed' | 'Canceled'; transactionId: string | null; receiptNumber: number | null; message: string | null };

async function postedFor(intentId: string) {
  const { rows } = await zite.sql({
    query: `SELECT id, "number" FROM "Transactions" WHERE "onlinePaymentId" = $1 AND "kind" = 'Payment' AND "status" = 'Posted' ORDER BY "number" ASC`,
    params: [intentId],
  });
  return rows.map(r => ({ id: String(r.id), number: num(r.number) }));
}

/**
 * Bring one OnlinePayments row in line with its PaymentIntent. Safe to call any
 * number of times, from any caller.
 */
export async function settleIntent(intent: Stripe.PaymentIntent, row: OnlinePaymentRow, opts: { settings?: OrgSettings } = {}): Promise<SettleResult> {
  const settings = opts.settings ?? (await getSettings());
  const now = new Date().toISOString();

  if (intent.status === 'succeeded') {
    const already = await postedFor(intent.id);
    if (row.transactionId || already.length) {
      const keep = already[0] ?? null;
      if (row.status !== 'Succeeded' || (keep && row.transactionId !== keep.id)) {
        await zite.onlinePayments.update({ id: row.id, record: { status: 'Succeeded', transactionId: keep?.id ?? row.transactionId, settledAt: now, error: null } });
      }
      return { status: 'Succeeded', transactionId: keep?.id ?? row.transactionId, receiptNumber: keep?.number ?? null, message: null };
    }

    const amount = fromCents(intent.amount_received || intent.amount);
    let pm: Stripe.PaymentMethod | string | null = intent.payment_method;
    if (typeof pm === 'string') {
      const stripe = stripeClient();
      pm = stripe ? await stripe.paymentMethods.retrieve(pm).catch(() => pm) : pm;
    }
    const method = methodLabel(pm);
    const date = todayIn(settings.timezone, new Date((intent.created ?? Date.now() / 1000) * 1000));
    const posted = await receivePayment({
      leaseId: row.leaseId,
      tenantId: row.tenantId || null,
      amount,
      date,
      paymentMethod: 'Online',
      source: 'Online payment',
      onlinePaymentId: intent.id,
      description: 'Online payment',
      reference: method.slice(0, 120),
    });

    // Another caller may have posted the same intent in the same moment. Keep the first; void the rest.
    const all = await postedFor(intent.id);
    const keep = all[0] ?? posted;
    for (const dup of all.slice(1)) await voidTransaction(dup.id, 'Duplicate record of the same online payment', null).catch(() => undefined);
    await zite.onlinePayments.update({ id: row.id, record: { status: 'Succeeded', transactionId: keep.id, settledAt: now, method: method.slice(0, 120), error: null } });
    if (keep.id !== posted.id) return { status: 'Succeeded', transactionId: keep.id, receiptNumber: keep.number, message: null };

    await announcePayment({ row, amount, method, date, receiptNumber: posted.number, transactionId: posted.id, settings });
    return { status: 'Succeeded', transactionId: posted.id, receiptNumber: posted.number, message: null };
  }

  if (intent.status === 'processing') {
    if (row.status !== 'Processing') await zite.onlinePayments.update({ id: row.id, record: { status: 'Processing', error: null } });
    return { status: 'Processing', transactionId: null, receiptNumber: null, message: 'Your bank payment is on its way. Bank transfers usually take 3–5 business days to clear.' };
  }

  if (intent.status === 'canceled') {
    if (row.status !== 'Canceled') await zite.onlinePayments.update({ id: row.id, record: { status: 'Canceled' } });
    return { status: 'Canceled', transactionId: null, receiptNumber: null, message: 'This payment was canceled.' };
  }

  if (intent.status === 'requires_payment_method' && intent.last_payment_error) {
    const message = intent.last_payment_error.message || 'The payment didn’t go through.';
    const wasProcessing = row.status === 'Processing';
    if (row.status !== 'Failed') await zite.onlinePayments.update({ id: row.id, record: { status: 'Failed', error: message.slice(0, 500) } });
    // A bank debit that fails days later is news to the office; a declined card at checkout isn't.
    if (wasProcessing) await announceFailure(row, message, settings);
    return { status: 'Failed', transactionId: null, receiptNumber: null, message };
  }

  return { status: 'Pending', transactionId: null, receiptNumber: null, message: null };
}

async function leaseInfo(leaseId: string) {
  const { rows } = await zite.sql({
    query: `SELECT l.id, l."number", l."name", l."propertyId", l."unitId", p."name" AS "propertyName", p."managerId", u."name" AS "unitName"
            FROM "Leases" l LEFT JOIN "Properties" p ON p.id::text = l."propertyId" LEFT JOIN "Units" u ON u.id::text = l."unitId" WHERE l.id::text = $1`,
    params: [leaseId],
  });
  const r = rows[0] ?? {};
  return { name: str(r.name) ?? '', number: num(r.number), propertyId: ref(r.propertyId), unitId: ref(r.unitId), propertyName: str(r.propertyName) ?? '', unitName: str(r.unitName) ?? '', managerId: ref(r.managerId) };
}

async function tenantInfo(tenantId: string) {
  const { rows } = await zite.sql({ query: `SELECT id, "name", "email" FROM "Tenants" WHERE id::text = $1`, params: [tenantId] });
  return { name: str(rows[0]?.name) || 'Resident', email: str(rows[0]?.email) || null };
}

async function announcePayment(p: { row: OnlinePaymentRow; amount: number; method: string; date: string; receiptNumber: number; transactionId: string; settings: OrgSettings }) {
  const { row, settings } = p;
  const [lease, tenant, balances] = await Promise.all([leaseInfo(row.leaseId), tenantInfo(row.tenantId), leaseBalances([row.leaseId])]);
  const money = formatMoney(p.amount, settings.currency);
  const balance = Math.max(0, balances.get(row.leaseId)?.balance ?? 0);
  await Promise.all([
    sendTriggered({
      trigger: 'Payment receipt',
      settings,
      recipient: { kind: 'tenant', id: row.tenantId, name: tenant.name, email: row.payerEmail || tenant.email },
      context: {
        amount_paid: money,
        payment_date: formatDay(p.date, 'long'),
        payment_method: p.method,
        receipt_number: String(p.receiptNumber),
        balance_due: formatMoney(balance, settings.currency),
        property_name: lease.propertyName,
        unit_name: lease.unitName,
      },
      leaseId: row.leaseId,
      propertyId: lease.propertyId,
    }).catch(e => console.error('Receipt email failed', e instanceof Error ? e.message : e)),
    officeRecipients({ managerId: lease.managerId }, 'receivables.manage').then(ids =>
      notify({
        recipientIds: ids,
        kind: 'payment_received',
        title: `${tenant.name} paid ${money} online`,
        body: `${lease.name || leaseRef(lease.number)} · ${p.method}`,
        link: `/leases/${row.leaseId}`,
        entityType: 'lease',
        entityId: row.leaseId,
        actorName: tenant.name,
      }),
    ),
    logActivity({
      entityType: 'transaction',
      entityId: p.transactionId,
      action: 'payment_received',
      summary: `paid ${money} online (${p.method})`,
      actorName: tenant.name,
      data: { amount: p.amount, intentId: row.intentId },
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      leaseId: row.leaseId,
      tenantId: row.tenantId,
    }),
  ]);
}

async function announceFailure(row: OnlinePaymentRow, message: string, settings: OrgSettings) {
  const [lease, tenant] = await Promise.all([leaseInfo(row.leaseId), tenantInfo(row.tenantId)]);
  const money = formatMoney(row.amount, settings.currency);
  const ids = await officeRecipients({ managerId: lease.managerId }, 'receivables.manage');
  await Promise.all([
    notify({
      recipientIds: ids,
      kind: 'payment_failed',
      title: `${tenant.name}'s online payment of ${money} failed`,
      body: message,
      link: `/leases/${row.leaseId}`,
      entityType: 'lease',
      entityId: row.leaseId,
      actorName: tenant.name,
    }),
    logActivity({
      entityType: 'lease',
      entityId: row.leaseId,
      action: 'payment_failed',
      summary: `online payment of ${money} failed — ${message.slice(0, 120)}`,
      actorName: 'Stripe',
      propertyId: lease.propertyId,
      unitId: lease.unitId,
      leaseId: row.leaseId,
      tenantId: row.tenantId,
    }),
  ]);
}
