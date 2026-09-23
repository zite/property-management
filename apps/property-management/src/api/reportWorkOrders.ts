import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildWorkOrders } from '../server/reports/operations';

/** Work orders opened and completed, days to complete, open aging and costs. See `components/reports/catalog.ts` for its parameters and `server/reports/operations.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Work orders opened and completed, days to complete, open aging and costs.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildWorkOrders(await openReport('work-orders', context, input)),
});
