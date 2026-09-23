import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildDeposits } from '../server/reports/receivables';

/** Security deposits held by lease as of a date. See `components/reports/catalog.ts` for its parameters and `server/reports/receivables.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Security deposits held by lease as of a date.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildDeposits(await openReport('deposits', context, input)),
});
