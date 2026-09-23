import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildLeasingFunnel } from '../server/reports/leasing';

/** Leasing funnel for a period: inquiries, applications, approvals, leases and conversion. See `components/reports/catalog.ts` for its parameters and `server/reports/leasing.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Leasing funnel for a period: inquiries, applications, approvals, leases and conversion.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildLeasingFunnel(await openReport('leasing-funnel', context, input)),
});
