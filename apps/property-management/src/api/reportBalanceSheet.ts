import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildBalanceSheet } from '../server/reports/balances';

/** Balance sheet as of a date with an assets = liabilities + equity check. See `components/reports/catalog.ts` for its parameters and `server/reports/balances.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Balance sheet as of a date with an assets = liabilities + equity check.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildBalanceSheet(await openReport('balance-sheet', context, input)),
});
