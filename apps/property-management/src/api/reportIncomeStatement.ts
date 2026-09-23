import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildIncomeStatement } from '../server/reports/incomeStatement';

/** Income statement for a period, cash or accrual, by month or property. See `components/reports/catalog.ts` for its parameters and `server/reports/incomeStatement.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Income statement for a period, cash or accrual, by month or property.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildIncomeStatement(await openReport('income-statement', context, input)),
});
