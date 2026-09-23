import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildOwnerStatement } from '../server/reports/statements';

/** Owner statement for an owner and period, per property, cash basis. See `components/reports/catalog.ts` for its parameters and `server/reports/statements.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Owner statement for an owner and period, per property, cash basis.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildOwnerStatement(await openReport('owner-statement', context, input)),
});
