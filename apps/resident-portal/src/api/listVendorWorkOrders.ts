import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { parseInput } from '../server/identity';
import { toVendorRow, vendorScope, vendorWorkOrders } from '../server/vendor';

/**
 * Work assigned to this vendor: open jobs by priority (Emergency first), then
 * by when they're scheduled — unscheduled first, since those need a time —
 * followed by completed and canceled jobs, newest first.
 */

const Input = z.object({});

export default createEndpoint({
  description: "The vendor's assigned work orders",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await vendorScope(context);
    const rows = (await vendorWorkOrders(scope.vendorId)).map(toVendorRow);
    return {
      vendorName: scope.vendor.name,
      today: scope.today,
      office: { phone: scope.settings.phone, emergencyPhone: scope.settings.emergencyPhone },
      workOrders: rows,
    };
  },
});
