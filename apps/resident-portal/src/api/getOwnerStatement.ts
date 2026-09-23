import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { periodLabel } from '@project/shared/dates';
import { ownerStatement, statementPeriod, statementTransactions } from '@project/shared/server/ownerStatement';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { StatementInput, ownerScope, statementRequest } from '../server/owner';

/**
 * An owner statement for a month (or year to date), for all of the owner's
 * properties or one: the cash-basis statement per property and combined, the
 * transactions behind it, and the year-to-date summary alongside.
 */

export default createEndpoint({
  description: 'An owner statement for a period',
  authenticated: true,
  inputSchema: StatementInput,
  execute: async ({ input, context }) => {
    const req = parseInput(StatementInput, input, 'Choose a month to see its statement.');
    const scope = await ownerScope(context);
    const { propertyIds, periods } = statementRequest(scope, req);
    const range = statementPeriod(req.period, scope.today);
    const ytd = statementPeriod('ytd', range.periodEnd);

    const [statement, transactions, ytdStatement, props] = await Promise.all([
      ownerStatement({ propertyIds, periodStart: range.periodStart, periodEnd: range.periodEnd }),
      statementTransactions({ propertyIds, periodStart: range.periodStart, periodEnd: range.periodEnd, limit: 1000, organizationName: scope.settings.organizationName }),
      req.period === 'ytd' ? Promise.resolve(null) : ownerStatement({ propertyIds, periodStart: ytd.periodStart, periodEnd: ytd.periodEnd }),
      scope.propertyIds.length
        ? zite.sql({ query: `SELECT id, "name" FROM "Properties" WHERE id::text = ANY($1) ORDER BY "name" ASC`, params: [scope.propertyIds] })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);
    const y = ytdStatement ?? statement;

    return {
      currency: scope.settings.currency,
      organization: { name: scope.settings.organizationName, address: scope.settings.address, phone: scope.settings.phone, email: scope.settings.supportEmail ?? '' },
      owner: { name: scope.owner.name, contactName: scope.owner.contactName, mailingAddress: scope.owner.mailingAddress },
      period: req.period,
      label: range.label,
      isPartial: range.isPartial,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      options: {
        periods: periods.slice(0, 12).map(p => ({ value: p, label: periodLabel(p) })),
        properties: props.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? 'Property' })),
      },
      statement,
      transactions: transactions.rows,
      truncated: transactions.truncated,
      ytd: {
        label: `${y.periodEnd.slice(0, 4)} year to date`,
        periodStart: y.periodStart,
        periodEnd: y.periodEnd,
        income: y.combined.income.total,
        expenses: y.combined.expenses.total,
        netOperatingCashFlow: y.combined.netOperatingCashFlow,
        distributions: y.combined.ownerActivity.distributions,
        contributions: y.combined.ownerActivity.contributions,
      },
    };
  },
});
