import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart, isDebitNormal } from '@project/shared/server/accounts';
import { day, num } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * The chart of accounts with each account's balance from the journal (void
 * lines excluded), on its normal side, plus a trial-balance check.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'Chart of accounts with balances',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    parseInput(Input, input);
    const chart = await getChart({ fresh: true });
    const { rows } = await zite.sql({
      query: `
        SELECT jl."accountId", SUM(COALESCE(jl."debit", 0)) AS debit, SUM(COALESCE(jl."credit", 0)) AS credit, COUNT(DISTINCT jl."transactionId") AS n, MAX(jl."date") AS "lastDate"
        FROM "JournalLines" jl WHERE COALESCE(jl."void", false) = false
        GROUP BY jl."accountId"`,
      params: [],
    });
    const by = new Map(rows.map(r => [String(r.accountId), r]));
    let dr = 0;
    let cr = 0;
    const accounts = chart.all.map(a => {
      const r = by.get(a.id);
      const d = toCents(num(r?.debit));
      const c = toCents(num(r?.credit));
      dr += d;
      cr += c;
      return {
        id: a.id, number: a.number, name: a.name, accountType: a.accountType, subtype: a.subtype, systemKey: a.systemKey, description: a.description,
        active: a.active, tenantCharge: a.tenantCharge, billExpense: a.billExpense, bankName: a.bankName, accountLast4: a.accountLast4,
        balance: fromCents(isDebitNormal(a.accountType) ? d - c : c - d),
        debits: fromCents(d),
        credits: fromCents(c),
        transactions: num(r?.n),
        lastDate: day(r?.lastDate),
      };
    });
    return { accounts, trialBalance: { debits: fromCents(dr), credits: fromCents(cr), balanced: dr === cr } };
  },
});
