import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { iso, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * The signed-in member's inbox — never anyone else's. The most recent 300
 * live notifications (snoozed ones included, flagged by `snoozedUntil`) and,
 * when asked, the last 150 archived ones. The client filters unread, kind and
 * snoozed locally so switching views is instant.
 */

const Input = z.object({ includeArchived: z.boolean().optional() });

export const toNotification = (r: Record<string, unknown>) => ({
  id: String(r.id),
  title: str(r.title) ?? '',
  body: str(r.body) ?? '',
  kind: str(r.kind) || 'automation',
  link: ref(r.link),
  entityType: ref(r.entityType),
  entityId: ref(r.entityId),
  actorId: ref(r.actorId),
  actorName: ref(r.actorName),
  readAt: iso(r.readAt),
  archivedAt: iso(r.archivedAt),
  snoozedUntil: iso(r.snoozedUntil),
  occurredAt: iso(r.occurredAt) ?? iso(r.created_at) ?? new Date().toISOString(),
});

const COLUMNS = `id, "title", "body", "kind", "link", "entityType", "entityId", "actorId", "actorName", "readAt", "archivedAt", "snoozedUntil", "occurredAt", created_at`;

export default createEndpoint({
  description: 'List the signed-in member’s notifications',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { includeArchived } = parseInput(Input, input);
    const [live, archived] = await Promise.all([
      zite.sql({
        query: `SELECT ${COLUMNS} FROM "Notifications" WHERE "memberId" = $1 AND "archivedAt" IS NULL ORDER BY COALESCE("occurredAt", created_at) DESC LIMIT 300`,
        params: [actor.id],
      }),
      includeArchived
        ? zite.sql({
            query: `SELECT ${COLUMNS} FROM "Notifications" WHERE "memberId" = $1 AND "archivedAt" IS NOT NULL ORDER BY "archivedAt" DESC LIMIT 150`,
            params: [actor.id],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);
    return { notifications: [...live.rows, ...archived.rows].map(toNotification), now: new Date().toISOString() };
  },
});
