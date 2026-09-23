import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { threadKey } from '@project/shared/server/email';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { homeLabel, residentFor, residentThread, toResidentMessage } from '../server/resident';

/** The resident's conversation with the office, oldest first. Internal notes never appear. */

const Input = z.object({ leaseId: z.string().max(64).nullish() });

export default createEndpoint({
  description: "A resident's conversation with the office",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId } = parseInput(Input, input);
    const me = await residentFor(context, leaseId);
    const settings = await getSettings();
    const rows = await residentThread(threadKey('tenant', me.tenantId), me.tenantId, 400);
    return {
      home: homeLabel(me.lease),
      organizationName: settings.organizationName,
      officeHours: settings.officeHours,
      phone: settings.phone,
      emergencyPhone: settings.emergencyPhone || settings.phone,
      myName: me.name,
      messages: rows.map(r => toResidentMessage(r, settings.organizationName)),
    };
  },
});
