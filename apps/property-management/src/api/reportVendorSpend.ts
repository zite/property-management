import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildVendorSpend } from '../server/reports/operations';

/** Vendor payments for a calendar year with 1099 status and a filing table. See `components/reports/catalog.ts` for its parameters and `server/reports/operations.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Vendor payments for a calendar year with 1099 status and a filing table.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildVendorSpend(await openReport('vendor-spend', context, input)),
});
