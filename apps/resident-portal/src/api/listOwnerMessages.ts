import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { threadKey } from '@project/shared/server/email';
import { iso, json, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { ownerScope } from '../server/owner';

/**
 * The owner's conversation with the office — their own thread, never staff
 * notes — and who at the office looks after their properties.
 */

const Input = z.object({});

export default createEndpoint({
  description: "The owner's conversation with the office",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await ownerScope(context);
    const [messages, managers] = await Promise.all([
      zite.sql({
        query: `
          SELECT id, "subject", "body", "direction", "channel", "senderName", "sentAt", "readAt", "attachments", "delivery", created_at
          FROM "Messages"
          WHERE "thread" = $1 AND "ownerId" = $2 AND "direction" <> 'Internal' AND "channel" <> 'Note'
          ORDER BY COALESCE("sentAt", created_at) DESC
          LIMIT 300`,
        params: [threadKey('owner', scope.ownerId), scope.ownerId],
      }),
      scope.propertyIds.length
        ? zite.sql({
            query: `SELECT DISTINCT m.id, m."name", m."title", m."email", m."phone" FROM "Properties" p JOIN "Members" m ON m.id::text = p."managerId" WHERE p.id::text = ANY($1) AND COALESCE(m."status", '') <> 'Deactivated'`,
            params: [scope.propertyIds],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);
    return {
      organizationName: scope.settings.organizationName,
      ownerName: scope.owner.contactName || scope.owner.name,
      managers: managers.rows.map(m => ({ id: String(m.id), name: str(m.name) ?? '', title: str(m.title) ?? '', email: str(m.email) ?? '', phone: str(m.phone) ?? '' })),
      messages: messages.rows
        .map(m => ({
          id: String(m.id),
          mine: m.direction === 'Inbound',
          subject: str(m.subject) ?? '',
          body: str(m.body) ?? '',
          senderName: str(m.senderName) ?? '',
          sentAt: iso(m.sentAt) ?? iso(m.created_at) ?? '',
          unread: m.direction === 'Outbound' && !m.readAt,
          attachments: json<Array<{ name?: string; url?: string }>>(m.attachments, []).filter(a => a && typeof a.url === 'string').map(a => ({ name: String(a.name ?? 'Attachment'), url: String(a.url) })),
        }))
        .reverse(),
    };
  },
});
