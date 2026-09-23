import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseInput } from '../server/identity';
import { ownerScope } from '../server/owner';

/** The owner has seen everything the office sent them — clears the Messages badge. */

const Input = z.object({});

export default createEndpoint({
  description: "Mark the office's messages to this owner as read",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await ownerScope(context);
    // Same rule as the badge in getPortalMe, so reading clears exactly what it counts.
    const { rows } = await zite.sql({
      query: `SELECT id FROM "Messages" WHERE "ownerId" = $1 AND "direction" = 'Outbound' AND "readAt" IS NULL AND "channel" <> 'Note' LIMIT 500`,
      params: [scope.ownerId],
    });
    const now = new Date().toISOString();
    for (const r of rows) await zite.messages.update({ id: String(r.id), record: { readAt: now } });
    return { marked: rows.length };
  },
});
