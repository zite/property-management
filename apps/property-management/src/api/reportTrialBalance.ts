import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildTrialBalance } from '../server/reports/balances';

/** Trial balance as of a date: every account’s debit or credit balance. See `components/reports/catalog.ts` for its parameters and `server/reports/balances.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Trial balance as of a date: every account’s debit or credit balance.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildTrialBalance(await openReport('trial-balance', context, input)),
});
