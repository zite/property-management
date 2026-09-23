import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildCashFlow } from '../server/reports/statements';

/** Cash flow for a period by property, tied to the bank balances. See `components/reports/catalog.ts` for its parameters and `server/reports/statements.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Cash flow for a period by property, tied to the bank balances.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildCashFlow(await openReport('cash-flow', context, input)),
});
