import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { threadKey } from '@project/shared/server/email';
import { parseInput } from '../server/identity';
import { requestOnLease, residentFor } from '../server/resident';

/**
 * Marks what the office sent this resident as read — their conversation, or
 * one maintenance request's — so the badges clear and staff can see it was seen.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish(), workOrderNumber: z.number().int().positive().nullish() });

export default createEndpoint({
  description: 'Mark messages to a resident as read',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const thread = data.workOrderNumber ? threadKey('work_order', String((await requestOnLease(me.lease.id, data.workOrderNumber)).id)) : threadKey('tenant', me.tenantId);
    const { rows } = await zite.sql({
      query: `SELECT id FROM "Messages" WHERE "thread" = $1 AND "tenantId" = $2 AND "direction" = 'Outbound' AND "readAt" IS NULL LIMIT 200`,
      params: [thread, me.tenantId],
    });
    const now = new Date().toISOString();
    for (const r of rows) await zite.messages.update({ id: String(r.id), record: { readAt: now } });
    return { marked: rows.length };
  },
});
