import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Read, unread, archive, restore and snooze inbox notifications. Every id is
 * checked against the signed-in member first, so nobody can touch another
 * person's inbox by guessing ids. `allUnread` marks the whole inbox read.
 */

const Input = z.object({
  action: z.enum(['read', 'unread', 'archive', 'unarchive', 'snooze', 'unsnooze']),
  ids: z.array(z.string().min(1)).max(500).optional(),
  allUnread: z.boolean().optional(),
  until: z.string().optional(),
});

export default createEndpoint({
  description: 'Mark notifications read or unread, archive them or snooze them',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { action, ids = [], allUnread, until } = parseInput(Input, input);
    if (!allUnread && !ids.length) throw new ZiteError('Choose at least one notification.', 'BAD_REQUEST');
    if (allUnread && action !== 'read') throw new ZiteError('Only “mark all read” works on the whole inbox.', 'BAD_REQUEST');

    let snoozeUntil: string | null = null;
    if (action === 'snooze') {
      const t = until ? Date.parse(until) : NaN;
      if (!Number.isFinite(t) || t <= Date.now()) throw new ZiteError('Choose a time in the future to snooze until.', 'BAD_REQUEST');
      if (t > Date.now() + 366 * 86_400_000) throw new ZiteError('Snooze for less than a year.', 'BAD_REQUEST');
      snoozeUntil = new Date(t).toISOString();
    }

    const { rows } = allUnread
      ? await zite.sql({ query: `SELECT id, "readAt", "archivedAt", "snoozedUntil" FROM "Notifications" WHERE "memberId" = $1 AND "readAt" IS NULL AND "archivedAt" IS NULL LIMIT 1000`, params: [actor.id] })
      : await zite.sql({ query: `SELECT id, "readAt", "archivedAt", "snoozedUntil" FROM "Notifications" WHERE "memberId" = $1 AND id::text = ANY($2)`, params: [actor.id, ids] });
    if (!allUnread && rows.length !== new Set(ids).size) throw new ZiteError('Some of those notifications no longer exist. Reload the inbox and try again.', 'NOT_FOUND');

    const now = new Date().toISOString();
    let updated = 0;
    for (const r of rows) {
      const record: Record<string, string | null> = {};
      switch (action) {
        case 'read':
          if (!r.readAt) record.readAt = now;
          break;
        case 'unread':
          if (r.readAt) record.readAt = null;
          break;
        case 'archive':
          if (!r.archivedAt) record.archivedAt = now;
          if (!r.readAt) record.readAt = now;
          break;
        case 'unarchive':
          if (r.archivedAt) record.archivedAt = null;
          break;
        case 'snooze':
          record.snoozedUntil = snoozeUntil;
          break;
        case 'unsnooze':
          if (r.snoozedUntil) record.snoozedUntil = null;
          break;
      }
      if (!Object.keys(record).length) continue;
      await withRetry(() => zite.notifications.update({ id: String(r.id), record }));
      updated++;
    }
    return { updated };
  },
});
