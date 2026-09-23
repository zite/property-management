import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { parseInput } from '../server/input';
import { announcementState, deliveryStats, toAnnouncement } from '../server/announcements';

/** Every announcement — drafts, scheduled and sent — with its audience and delivery tallies. */

const Input = z.object({});

const AnnouncementSummary = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['Draft', 'Sent']),
  state: z.enum(['Draft', 'Scheduled', 'Sending', 'Sent']),
  tracked: z.boolean(),
  audience: z.enum(['residents', 'residents_properties', 'residents_units', 'owners', 'owners_properties', 'vendors']),
  propertyIds: z.array(z.string()),
  unitIds: z.array(z.string()),
  channel: z.enum(['Email and portal', 'Portal only']),
  sentAt: z.string().nullable(),
  sentById: z.string().nullable(),
  recipientCount: z.number(),
  pinnedUntil: z.string().nullable(),
  createdAt: z.string().nullable(),
  stats: z.object({ total: z.number(), emailed: z.number(), failed: z.number(), portalOnly: z.number(), read: z.number(), lastAt: z.string().nullable() }),
});

export default createEndpoint({
  description: 'List announcements with delivery stats',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ announcements: z.array(AnnouncementSummary) }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'announcements.send');
    parseInput(Input, input);
    const { rows } = await zite.sql({
      query: `SELECT * FROM "Announcements" ORDER BY CASE WHEN "status" = 'Sent' THEN 1 ELSE 0 END, COALESCE("sentAt", created_at) DESC LIMIT 500`,
      params: [],
    });
    const list = rows.map(toAnnouncement);
    const stats = await deliveryStats(list.map(a => a.id));
    const now = Date.now();
    return {
      announcements: list.map(a => {
        const s = stats.get(a.id);
        const st = announcementState(a, s, now);
        return { ...a, state: st.state, tracked: st.tracked, stats: s ?? { total: 0, emailed: 0, failed: 0, portalOnly: 0, read: 0, lastAt: null } };
      }),
    };
  },
});
