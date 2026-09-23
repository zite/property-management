import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PAYMENT_METHODS } from '@project/shared/constants';
import { formatMoney, fromCents, sumMoney, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { postExpense, postTransaction, postTransfer } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { ref, str } from '@project/shared/server/sql';
import { Day, existingProperties, Id, isBillableAccount, Money } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Money that moves in the bank without a bill or a resident:
 *
 *   transfer — between two bank accounts, for one property's cash
 *   expense  — a check written or a card charge on the spot, optionally to a
 *              vendor, split across expense accounts. One bank line, so it
 *              reconciles against one statement entry.
 */

const Input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('transfer'), fromBankId: Id, toBankId: Id, propertyId: Id, amount: Money, date: Day,
    description: z.string().trim().max(250).optional(), reference: z.string().trim().max(80).optional(),
  }),
  z.object({
    action: z.literal('expense'), propertyId: Id, unitId: z.string().optional(), vendorId: z.string().optional(), workOrderId: z.string().optional(),
    bankAccountId: z.string().optional(), paymentMethod: z.enum(PAYMENT_METHODS), date: Day,
    description: z.string().trim().max(250).optional(), reference: z.string().trim().max(80).optional(), attachmentUrl: z.string().url().max(2000).optional(),
    lines: z.array(z.object({ accountId: Id, amount: Money, memo: z.string().max(250).optional() })).min(1, 'Add at least one line.').max(30),
  }),
]);

export default createEndpoint({
  description: 'Record a bank transfer or a direct expense',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const chart = await getChart();
    const props = await existingProperties([data.propertyId]);
    const property = props.get(data.propertyId);
    if (!property) throw new ZiteError('That property no longer exists.', 'NOT_FOUND');

    if (data.action === 'transfer') {
      assertCan(actor, 'banking.manage');
      const from = chart.byId.get(data.fromBankId);
      const to = chart.byId.get(data.toBankId);
      if (!from || from.subtype !== 'Bank' || !from.active || !to || to.subtype !== 'Bank' || !to.active) throw new ZiteError('Choose two active bank accounts.', 'BAD_REQUEST');
      const posted = await postTransfer({ fromBankId: from.id, toBankId: to.id, amount: data.amount, date: data.date, propertyId: property.id, description: data.description || undefined, reference: data.reference || null, createdById: actor.id });
      await logActivity({ entityType: 'transaction', entityId: posted.id, propertyId: property.id, action: 'bank_transfer', summary: `moved ${formatMoney(data.amount, settings.currency)} for ${property.name} from ${from.name} to ${to.name}`, actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id, number: posted.number } });
      return { id: posted.id, number: posted.number, amount: data.amount };
    }

    assertCan(actor, 'payables.manage');
    for (const l of data.lines) {
      const a = chart.byId.get(l.accountId);
      if (!a || a.accountType !== 'Expense' || !isBillableAccount(chart, l.accountId)) throw new ZiteError('Choose an expense account for each line.', 'BAD_REQUEST');
    }
    let vendorName: string | null = null;
    if (data.vendorId) {
      const { rows } = await zite.sql({ query: `SELECT "name" FROM "Vendors" WHERE id::text = $1`, params: [data.vendorId] });
      if (!rows[0]) throw new ZiteError('That vendor no longer exists.', 'NOT_FOUND');
      vendorName = str(rows[0].name);
    }
    const amount = sumMoney(data.lines.map(l => l.amount));
    const first = chart.byId.get(data.lines[0].accountId)!;
    const common = {
      date: data.date, propertyId: property.id, unitId: data.unitId || null, vendorId: data.vendorId || null, workOrderId: data.workOrderId || null,
      paymentMethod: data.paymentMethod, reference: data.reference || null, attachmentUrl: data.attachmentUrl || null, createdById: actor.id,
    };

    let posted: { id: string; number: number };
    if (data.lines.length === 1) {
      posted = await postExpense({ ...common, accountId: first.id, amount, bankAccountId: data.bankAccountId || null, description: data.description || data.lines[0].memo || undefined });
    } else {
      // postExpense takes one account; a split check is the same entry with several expense lines and one bank line.
      let bank = data.bankAccountId ? chart.byId.get(data.bankAccountId) : property.bankAccountId ? chart.byId.get(property.bankAccountId) : undefined;
      if (data.bankAccountId && (!bank || bank.subtype !== 'Bank')) throw new ZiteError('Choose a bank account to pay from.', 'BAD_REQUEST');
      if (!bank || bank.subtype !== 'Bank' || !bank.active) bank = chart.key('operating_bank');
      posted = await postTransaction({
        kind: 'Expense',
        ...common,
        amount,
        description: data.description || `${vendorName ? `${vendorName} · ` : ''}${data.lines.length} expense lines`,
        accountId: first.id,
        bankAccountId: bank.id,
        lines: [
          ...data.lines.map(l => ({ accountId: l.accountId, debit: l.amount, vendorId: data.vendorId || null, memo: l.memo || null })),
          { accountId: bank.id, credit: amount, vendorId: data.vendorId || null },
        ],
      });
    }
    await logActivity({
      entityType: 'transaction', entityId: posted.id, propertyId: property.id, vendorId: ref(data.vendorId), workOrderId: ref(data.workOrderId),
      action: 'expense_recorded', summary: `recorded a ${formatMoney(amount, settings.currency)} expense${vendorName ? ` to ${vendorName}` : ''} for ${property.name}`,
      actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id, number: posted.number },
    });
    return { id: posted.id, number: posted.number, amount: fromCents(toCents(amount)) };
  },
});
