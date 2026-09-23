import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildExpirations } from '../server/reports/leasing';

/** Leases expiring in the next months with renewal status and rent against market. See `components/reports/catalog.ts` for its parameters and `server/reports/leasing.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Leases expiring in the next months with renewal status and rent against market.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildExpirations(await openReport('lease-expirations', context, input)),
});
