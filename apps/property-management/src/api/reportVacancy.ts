import { createEndpoint } from 'zitejs/backend';
import { openReport, ReportInput } from '../server/reports/common';
import { buildVacancy } from '../server/reports/leasing';

/** Vacant and on-notice units with days vacant, estimated loss, readiness and listing status. See `components/reports/catalog.ts` for its parameters and `server/reports/leasing.ts` for how every figure is derived. */
export default createEndpoint({
  description: 'Vacant and on-notice units with days vacant, estimated loss, readiness and listing status.',
  authenticated: true,
  inputSchema: ReportInput,
  execute: async ({ input, context }) => buildVacancy(await openReport('vacancy', context, input)),
});
