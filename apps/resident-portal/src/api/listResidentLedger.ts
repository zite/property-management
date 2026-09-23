import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { todayIn } from '@project/shared/dates';
import { zite } from 'zitejs/db';
import { getChart } from '@project/shared/server/accounts';
import { leaseLedger, type LedgerEntry } from '@project/shared/server/ledger';
import { getSettings, isStripeConfigured } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { homeLabel, nextRecurringCharges, paymentCeiling, residentFor } from '../server/resident';

/**
 * The lease ledger in a resident's words: what was charged, what was paid and
 * the balance after each, newest first on screen. Staff notes, who posted
 * what and why something was voided stay in the office.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish() });

const METHOD_WORDS: Record<string, string> = { ACH: 'bank transfer', Card: 'card', Check: 'check', Cash: 'cash', 'Money order': 'money order', Online: 'online', Other: '' };

function labelFor(e: LedgerEntry, ar: string): { label: string; type: 'charge' | 'payment' | 'credit' | 'refund' | 'deposit' | 'adjustment' } {
  switch (e.kind) {
    case 'Charge':
      return { label: e.description || 'Charge', type: 'charge' };
    case 'Payment': {
      if (e.source === 'Online payment' || e.paymentMethod === 'Online') return { label: 'Online payment', type: 'payment' };
      const how = METHOD_WORDS[e.paymentMethod ?? ''] ?? '';
      const ref = e.paymentMethod === 'Check' && e.reference ? ` #${e.reference}` : '';
      return { label: how ? `Payment by ${how}${ref}` : 'Payment', type: 'payment' };
    }
    case 'Credit':
      return { label: e.description && !/^concessions?$/i.test(e.description) ? `Credit — ${e.description}` : 'Credit to your account', type: 'credit' };
    case 'Refund':
      return e.accountId === ar ? { label: 'Refund of your credit balance', type: 'refund' } : { label: 'Security deposit refunded', type: 'deposit' };
    case 'Deposit application':
      return { label: 'Security deposit applied to your balance', type: 'deposit' };
    default:
      return { label: 'Balance adjustment', type: 'adjustment' };
  }
}

export default createEndpoint({
  description: "A resident's lease ledger with running balance",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId } = parseInput(Input, input);
    const { lease } = await residentFor(context, leaseId);
    const settings = await getSettings();
    const [ledger, chart, next] = await Promise.all([leaseLedger(lease.id), getChart(), nextRecurringCharges(lease, settings.timezone)]);
    const ar = chart.key('accounts_receivable').id;
    const today = todayIn(settings.timezone);

    // Journal entries (opening balances, corrections) can span many leases; show only this lease's share of them.
    const journalIds = ledger.entries.filter(e => e.kind === 'Journal entry').map(e => e.id);
    const depositShare = new Map<string, number>();
    if (journalIds.length) {
      const { rows } = await zite.sql({
        query: `SELECT "transactionId", SUM(COALESCE("credit", 0) - COALESCE("debit", 0)) AS "held" FROM "JournalLines" WHERE "leaseId" = $1 AND "accountId" = $2 AND "transactionId" = ANY($3) GROUP BY "transactionId"`,
        params: [lease.id, chart.key('deposits_held').id, journalIds],
      });
      for (const r of rows) depositShare.set(String(r.transactionId), num(r.held));
    }

    const entries = ledger.entries
      .filter(e => e.kind !== 'Journal entry' || e.effect !== 0 || (depositShare.get(e.id) ?? 0) !== 0)
      .map(e => {
        const { label, type } = labelFor(e, ar);
        const journal = e.kind === 'Journal entry';
        const held = depositShare.get(e.id) ?? 0;
        return {
          id: e.id,
          number: e.number,
          date: e.date,
          dueDate: e.dueDate,
          label: journal && e.effect === 0 ? (held > 0 ? 'Security deposit on file' : 'Security deposit adjustment') : label,
          type: journal && e.effect === 0 ? ('deposit' as const) : type,
          amount: journal ? Math.abs(e.effect !== 0 ? e.effect : held) : e.amount,
          /** + adds to what you owe, − reduces it, 0 doesn't touch the balance (deposit movements). */
          effect: e.effect,
          balance: e.runningBalance,
          reversed: e.status === 'Void',
          reversedOn: e.voidedAt ? e.voidedAt.slice(0, 10) : null,
          open: e.open,
          overdue: Boolean(e.open && e.open > 0 && e.dueDate && e.dueDate < today),
          hasReceipt: e.kind === 'Payment' && e.status === 'Posted',
        };
      });

    const years = [...new Set(entries.map(e => e.date.slice(0, 4)))].sort().reverse();
    return {
      currency: settings.currency,
      balance: ledger.balance,
      pastDue: ledger.pastDue,
      depositHeld: ledger.depositHeld,
      deposit: lease.deposit,
      nextCharges: next,
      years,
      entries,
      canPayOnline: settings.onlinePayments && isStripeConfigured() && (lease.status === 'Active' || lease.status === 'Ended'),
      allowPartialPayments: settings.allowPartialPayments,
      /** The most one online payment may be: twice the balance plus the next charges. */
      paymentCeiling: paymentCeiling(ledger.balance, next),
      leaseStatus: lease.status,
      home: homeLabel(lease),
      payableTo: settings.legalName || settings.organizationName,
      officeAddress: settings.address,
      officeHours: settings.officeHours,
    };
  },
});
