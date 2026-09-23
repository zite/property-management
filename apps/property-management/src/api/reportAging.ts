import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildAging } from '../server/reports/aging';

/** Delinquency and aging as of a date, bucketed by days past due. See `components/reports/catalog.ts` for its parameters and `server/reports/aging.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Delinquency and aging as of a date, bucketed by days past due.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildAging(await openReport('aging', context, input)),
});
