import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildOccupancy } from '../server/reports/occupancy';

/** Occupancy by property as of a date, with the 12-month trend. See `components/reports/catalog.ts` for its parameters and `server/reports/occupancy.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Occupancy by property as of a date, with the 12-month trend.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildOccupancy(await openReport('occupancy', context, input)),
});
