import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildRentRoll } from '../server/reports/rentRoll';

/** Rent roll as of a date: units, residents, lease and market rent, deposits and balances. See `components/reports/catalog.ts` for its parameters and `server/reports/rentRoll.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Rent roll as of a date: units, residents, lease and market rent, deposits and balances.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildRentRoll(await openReport('rent-roll', context, input)),
});
