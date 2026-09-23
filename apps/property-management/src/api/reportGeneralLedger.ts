import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildGeneralLedger } from '../server/reports/generalLedger';

/** General ledger for a period: account summary, or paged lines with running balances. See `components/reports/catalog.ts` for its parameters and `server/reports/generalLedger.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'General ledger for a period: account summary, or paged lines with running balances.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildGeneralLedger(await openReport('general-ledger', context, input)),
});
