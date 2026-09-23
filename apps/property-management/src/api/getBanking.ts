import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { bankBalances, propertyCash } from '@project/shared/server/ledger';
import { day, iso, num, ref } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Every bank account: its balance, how that cash splits by property, how many
 * transactions haven't cleared the bank yet, and its reconciliation state.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'Bank accounts with balances by property and reconciliation status',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    parseInput(Input, input);
    const chart = await getChart();
    const banks = chart.all.filter(a => a.subtype === 'Bank');
    const ids = banks.map(b => b.id);

    const [balances, cash, split, uncleared, recs] = await Promise.all([
      bankBalances(),
      propertyCash(),
      ids.length
        ? zite.sql({
            query: `
              SELECT jl."accountId", COALESCE(jl."propertyId", '') AS pid, SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS balance
              FROM "JournalLines" jl WHERE COALESCE(jl."void", false) = false AND jl."accountId" = ANY($1)
              GROUP BY jl."accountId", COALESCE(jl."propertyId", '')`,
            params: [ids],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      ids.length
        ? zite.sql({
            query: `
              SELECT jl."accountId", COUNT(DISTINCT jl."transactionId") AS n, SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS amount, MAX(jl."date") AS "lastDate"
              FROM "JournalLines" jl WHERE COALESCE(jl."void", false) = false AND jl."accountId" = ANY($1) AND COALESCE(jl."reconciliationId", '') = ''
              GROUP BY jl."accountId"`,
            params: [ids],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      zite.sql({ query: `SELECT * FROM "Reconciliations" ORDER BY "statementDate" DESC, created_at DESC LIMIT 500`, params: [] }),
    ]);

    const splitBy = new Map<string, Array<{ propertyId: string | null; balance: number }>>();
    for (const r of split.rows) {
      const cents = toCents(num(r.balance));
      if (cents === 0) continue;
      const list = splitBy.get(String(r.accountId)) ?? [];
      list.push({ propertyId: ref(r.pid), balance: fromCents(cents) });
      splitBy.set(String(r.accountId), list);
    }
    const unclearedBy = new Map(uncleared.rows.map(r => [String(r.accountId), { count: num(r.n), amount: fromCents(toCents(num(r.amount))) }]));
    const toRec = (r: Record<string, unknown>) => ({
      id: String(r.id),
      statementDate: day(r.statementDate) ?? '',
      statementBalance: num(r.statementBalance),
      clearedBalance: num(r.clearedBalance),
      status: r.status === 'Completed' ? ('Completed' as const) : ('In progress' as const),
      completedAt: iso(r.completedAt),
      completedById: ref(r.completedById),
    });

    const accounts = banks.map(b => {
      const mine = recs.rows.filter(r => String(r.bankAccountId) === b.id).map(toRec);
      return {
        id: b.id,
        number: b.number,
        name: b.name,
        bankName: b.bankName,
        accountLast4: b.accountLast4,
        systemKey: b.systemKey,
        active: b.active,
        description: b.description,
        balance: balances.get(b.id) ?? 0,
        byProperty: (splitBy.get(b.id) ?? []).sort((x, y) => y.balance - x.balance),
        uncleared: unclearedBy.get(b.id) ?? { count: 0, amount: 0 },
        lastReconciliation: mine.find(r => r.status === 'Completed') ?? null,
        inProgress: mine.find(r => r.status === 'In progress') ?? null,
      };
    });
    return {
      accounts: accounts.filter(a => a.active || Math.abs(a.balance) > 0.004),
      cashByProperty: Object.fromEntries(cash) as Record<string, number>,
    };
  },
});
