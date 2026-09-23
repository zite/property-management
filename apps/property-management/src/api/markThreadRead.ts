import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { requireThread, threadSql } from '../server/comms';

/**
 * Mark a conversation read (every inbound message gets a read time) or unread
 * again (its latest inbound message loses it). Read state is the team's, not
 * one person's — the same as the sidebar count. Writes are sequential: live
 * rate-limits bursts.
 */

const Input = z.object({ thread: z.string().min(3).max(100), read: z.boolean() });

export default createEndpoint({
  description: 'Mark a message thread read or unread',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ changed: z.number(), unread: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'communications.send');
    const data = parseInput(Input, input);
    const t = requireThread(data.thread);

    if (data.read) {
      const { rows } = await zite.sql({
        query: `SELECT m.id FROM "Messages" m WHERE ${threadSql('m')} = $1 AND m."direction" = 'Inbound' AND m."readAt" IS NULL ORDER BY m.created_at ASC LIMIT 200`,
        params: [t.key],
      });
      const now = new Date().toISOString();
      for (const r of rows) await withRetry(() => zite.messages.update({ id: String(r.id), record: { readAt: now } }));
      return { changed: rows.length, unread: 0 };
    }

    const { rows } = await zite.sql({
      query: `SELECT m.id, m."readAt" FROM "Messages" m WHERE ${threadSql('m')} = $1 AND m."direction" = 'Inbound' ORDER BY COALESCE(m."sentAt", m.created_at) DESC LIMIT 1`,
      params: [t.key],
    });
    if (!rows[0]) return { changed: 0, unread: 0 };
    if (rows[0].readAt) await withRetry(() => zite.messages.update({ id: String(rows[0].id), record: { readAt: null } }));
    return { changed: rows[0].readAt ? 1 : 0, unread: 1 };
  },
});
