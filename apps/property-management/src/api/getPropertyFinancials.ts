import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addPeriods, periodLabel, periodOf, periodEnd, periodStart, todayIn } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { monthlyCashFlow } from '@project/shared/server/ownerStatement';
import { getSettings } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Income, expenses and NOI by month for one property, two ways:
 *
 *   accrual  Journal lines on Income and Expense accounts, dated in the month,
 *            void lines excluded. Income is credit − debit (concessions net it
 *            down), expenses debit − credit. Rent is income when it's charged.
 *   cash     `monthlyCashFlow` — the owner statement's definitions: income when
 *            it's collected, expenses when bills are paid.
 *
 * Plus the accrual totals by account for the whole window, for the table.
 */

const Input = z.object({ propertyId: z.string().min(1), months: z.number().int().min(1).max(36).optional() });

export default createEndpoint({
  description: 'Monthly income, expenses and NOI for a property (accrual and cash)',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const { propertyId, months = 12 } = parseInput(Input, input);
    const { rows: exists } = await zite.sql({ query: `SELECT id FROM "Properties" WHERE id::text = $1 LIMIT 1`, params: [propertyId] });
    if (!exists[0]) throw new ZiteError('That property doesn’t exist, or it was deleted.', 'NOT_FOUND');

    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const toPeriod = periodOf(today);
    const fromPeriod = addPeriods(toPeriod, -(months - 1));
    const start = periodStart(fromPeriod);
    const end = periodEnd(toPeriod);

    const [byMonth, byAccount, cash] = await Promise.all([
      zite.sql({
        query: `
          SELECT LEFT(CAST(jl."date" AS TEXT), 7) AS period, a."accountType" AS type,
            SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS net
          FROM "JournalLines" jl JOIN "Accounts" a ON a.id::text = jl."accountId"
          WHERE COALESCE(jl."void", false) = false AND jl."propertyId" = $1 AND jl."date" >= $2::date AND jl."date" <= $3::date
            AND a."accountType" IN ('Income', 'Expense')
          GROUP BY 1, 2`,
        params: [propertyId, start, end],
      }),
      zite.sql({
        query: `
          SELECT a.id, a."name", a."number", a."accountType" AS type, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS net
          FROM "JournalLines" jl JOIN "Accounts" a ON a.id::text = jl."accountId"
          WHERE COALESCE(jl."void", false) = false AND jl."propertyId" = $1 AND jl."date" >= $2::date AND jl."date" <= $3::date
            AND a."accountType" IN ('Income', 'Expense')
          GROUP BY a.id, a."name", a."number", a."accountType"
          ORDER BY a."number" ASC`,
        params: [propertyId, start, end],
      }),
      monthlyCashFlow({ propertyIds: [propertyId], fromPeriod, toPeriod, throughDay: today }),
    ]);

    const cells = new Map<string, { income: number; expenses: number }>();
    for (const r of byMonth.rows) {
      const k = String(r.period);
      const cur = cells.get(k) ?? { income: 0, expenses: 0 };
      if (r.type === 'Income') cur.income += toCents(num(r.net));
      else cur.expenses += -toCents(num(r.net));
      cells.set(k, cur);
    }
    const periods: string[] = [];
    for (let p = fromPeriod; p <= toPeriod; p = addPeriods(p, 1)) periods.push(p);

    const accrual = periods.map(p => {
      const c = cells.get(p) ?? { income: 0, expenses: 0 };
      return { period: p, label: periodLabel(p, true), income: fromCents(c.income), expenses: fromCents(c.expenses), noi: fromCents(c.income - c.expenses) };
    });

    return {
      today,
      fromPeriod,
      toPeriod,
      accrual,
      cash: cash.map(c => ({ period: c.period, label: c.label, income: c.income, expenses: c.expenses, noi: c.net, distributions: c.distributions, contributions: c.contributions })),
      accounts: byAccount.rows.map(r => {
        const income = r.type === 'Income';
        return { accountId: String(r.id), name: String(r.name ?? ''), number: String(r.number ?? ''), type: income ? 'Income' : 'Expense', amount: fromCents(income ? toCents(num(r.net)) : -toCents(num(r.net))) };
      }).filter(a => toCents(a.amount) !== 0),
    };
  },
});
