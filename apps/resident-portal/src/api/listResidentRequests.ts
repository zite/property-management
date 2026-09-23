import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { OPEN_WORK_ORDER_STATUSES } from '@project/shared/constants';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { homeLabel, listRequests, residentFor } from '../server/resident';

/** Maintenance requests for the resident's home, open ones first. */

const Input = z.object({ leaseId: z.string().max(64).nullish() });

export default createEndpoint({
  description: "A resident's maintenance requests",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId } = parseInput(Input, input);
    const { lease, tenantId } = await residentFor(context, leaseId);
    const [requests, settings] = await Promise.all([listRequests(lease.id, tenantId), getSettings()]);
    const open = requests.filter(r => OPEN_WORK_ORDER_STATUSES.includes(r.status));
    const past = requests.filter(r => !OPEN_WORK_ORDER_STATUSES.includes(r.status));
    return {
      home: homeLabel(lease),
      open,
      past,
      canRequest: settings.maintenanceRequests && lease.status === 'Active',
      emergencyPhone: settings.emergencyPhone || settings.phone,
    };
  },
});
