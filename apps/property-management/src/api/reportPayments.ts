import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildPayments } from '../server/reports/receivables';

/** Payments received in a period by method and property, with every payment. See `components/reports/catalog.ts` for its parameters and `server/reports/receivables.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Payments received in a period by method and property, with every payment.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildPayments(await openReport('payments', context, input)),
});
