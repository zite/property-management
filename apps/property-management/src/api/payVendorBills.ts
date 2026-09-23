import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { PAYMENT_METHODS } from '@project/shared/constants';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { openBills, payBills } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { Day, Id } from '../server/accounting';
import { parseInput } from '../server/input';
import { zite } from 'zitejs/db';
import { str } from '@project/shared/server/sql';

/**
 * Pay open bills — in full or in part. One payment per vendor (one check, one
 * ACH), each with its own check number, posted one vendor at a time. If a
 * vendor's payment fails, the ones already posted stay posted and the result
 * says which vendor still needs paying.
 */

const Input = z.object({
  date: Day,
  paymentMethod: z.enum(PAYMENT_METHODS),
  bankAccountId: z.string().optional(),
  memo: z.string().trim().max(250).optional(),
  /** Check number or confirmation per vendor id. */
  references: z.record(z.string(), z.string().trim().max(80)).optional(),
  items: z.array(z.object({ billId: Id, amount: z.number().positive('Enter an amount for each bill you’re paying.').max(10_000_000) })).min(1, 'Choose at least one bill to pay.').max(500),
});

export default createEndpoint({
  description: 'Pay vendor bills, one payment per vendor',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'payables.manage');
    const data = parseInput(Input, input);
    if (new Set(data.items.map(i => i.billId)).size !== data.items.length) throw new ZiteError('A bill appears twice. Reload and try again.', 'BAD_REQUEST');
    if (data.bankAccountId) {
      const chart = await getChart();
      const bank = chart.byId.get(data.bankAccountId);
      if (!bank || bank.subtype !== 'Bank' || !bank.active) throw new ZiteError('Choose an active bank account to pay from.', 'BAD_REQUEST');
    }

    const open = new Map((await openBills({ billIds: data.items.map(i => i.billId) })).map(b => [b.id, b]));
    const byVendor = new Map<string, typeof data.items>();
    for (const item of data.items) {
      const bill = open.get(item.billId);
      if (!bill) throw new ZiteError('One of those bills is already paid or was voided. Reload and try again.', 'CONFLICT');
      if (toCents(item.amount) > toCents(bill.open)) throw new ZiteError(`Bill #${bill.number} only has ${bill.open.toFixed(2)} left to pay.`, 'BAD_REQUEST');
      const v = bill.vendorId ?? '';
      byVendor.set(v, [...(byVendor.get(v) ?? []), item]);
    }

    const vendorIds = [...byVendor.keys()].filter(Boolean);
    const { rows } = vendorIds.length ? await zite.sql({ query: `SELECT id, "name" FROM "Vendors" WHERE id::text = ANY($1)`, params: [vendorIds] }) : { rows: [] as Array<Record<string, unknown>> };
    const vendorName = new Map(rows.map(r => [String(r.id), str(r.name) ?? 'Vendor']));
    const settings = await getSettings();

    const payments: Array<{ id: string; number: number; vendorId: string | null; vendorName: string; amount: number }> = [];
    const failed: Array<{ vendorId: string | null; vendorName: string; message: string }> = [];
    for (const [vendorId, items] of byVendor) {
      const name = vendorName.get(vendorId) ?? 'Vendor';
      const amount = fromCents(items.reduce((s, i) => s + toCents(i.amount), 0));
      try {
        const [posted] = await payBills({
          date: data.date,
          paymentMethod: data.paymentMethod,
          bankAccountId: data.bankAccountId || null,
          reference: data.references?.[vendorId] || null,
          description: data.memo || undefined,
          createdById: actor.id,
          items,
        });
        payments.push({ id: posted.id, number: posted.number, vendorId: vendorId || null, vendorName: name, amount });
        await logActivity({
          entityType: 'transaction', entityId: posted.id, vendorId: vendorId || null, action: 'bills_paid',
          summary: `paid ${name} ${formatMoney(amount, settings.currency)} for ${items.length === 1 ? `bill #${open.get(items[0].billId)?.number}` : `${items.length} bills`}`,
          actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id, number: posted.number, bills: items.map(i => open.get(i.billId)?.number) },
        });
      } catch (e) {
        failed.push({ vendorId: vendorId || null, vendorName: name, message: e instanceof ZiteError ? e.message : 'The payment didn’t post.' });
      }
    }
    if (!payments.length && failed.length) throw new ZiteError(failed[0].message, 'BAD_REQUEST');
    return { payments, failed, total: fromCents(payments.reduce((s, p) => s + toCents(p.amount), 0)) };
  },
});
