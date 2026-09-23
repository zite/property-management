import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { iso, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { announcementState, audiencePeople, deliveryStats, isBusy, loadAnnouncement } from '../server/announcements';

/**
 * One announcement: its content and audience, delivery tallies, every
 * recipient's message with its delivery and read state, and — while it's a
 * draft or still sending — how many people it reaches today.
 */

const Input = z.object({ id: z.string().min(1).max(64) });

export default createEndpoint({
  description: 'Get an announcement with its recipients and delivery status',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    announcement: z.object({
      id: z.string(), title: z.string(), body: z.string(), status: z.enum(['Draft', 'Sent']), state: z.enum(['Draft', 'Scheduled', 'Sending', 'Sent']), tracked: z.boolean(), busy: z.boolean(),
      audience: z.enum(['residents', 'residents_properties', 'residents_units', 'owners', 'owners_properties', 'vendors']), propertyIds: z.array(z.string()), unitIds: z.array(z.string()),
      channel: z.enum(['Email and portal', 'Portal only']), sentAt: z.string().nullable(), sentById: z.string().nullable(), recipientCount: z.number(), pinnedUntil: z.string().nullable(), createdAt: z.string().nullable(),
    }),
    stats: z.object({ total: z.number(), emailed: z.number(), failed: z.number(), portalOnly: z.number(), read: z.number(), lastAt: z.string().nullable() }),
    audienceNow: z.object({ total: z.number(), withoutEmail: z.number(), notYetSent: z.number() }).nullable(),
    recipients: z.array(z.object({ messageId: z.string(), kind: z.string(), personId: z.string(), thread: z.string(), name: z.string(), delivery: z.string(), channel: z.string(), readAt: z.string().nullable(), sentAt: z.string().nullable(), unitId: z.string().nullable(), propertyId: z.string().nullable() })),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'announcements.send');
    const { id } = parseInput(Input, input);
    const a = await loadAnnouncement(id);
    const [stats, rows] = await Promise.all([
      deliveryStats([a.id]),
      zite.sql({
        query: `
          SELECT m.id, m."thread", m."delivery", m."channel", m."readAt", m."sentAt", m."tenantId", m."ownerId", m."vendorId", m."applicationId", m."leaseId", m."propertyId",
            COALESCE(NULLIF(t."name", ''), NULLIF(o."name", ''), NULLIF(v."name", ''), NULLIF(ap."applicantName", '')) AS "name", l."unitId" AS "unitId"
          FROM "Messages" m
          LEFT JOIN "Tenants" t ON t.id::text = m."tenantId"
          LEFT JOIN "Owners" o ON o.id::text = m."ownerId"
          LEFT JOIN "Vendors" v ON v.id::text = m."vendorId"
          LEFT JOIN "Applications" ap ON ap.id::text = m."applicationId"
          LEFT JOIN "Leases" l ON l.id::text = m."leaseId"
          WHERE m."announcementId" = $1
          ORDER BY CASE m."delivery" WHEN 'Failed' THEN 0 ELSE 1 END, "name" ASC
          LIMIT 2000`,
        params: [a.id],
      }),
    ]);
    const s = stats.get(a.id);
    const st = announcementState(a, s);
    let audienceNow: { total: number; withoutEmail: number; notYetSent: number } | null = null;
    if (a.status === 'Draft' || st.incomplete) {
      const people = await audiencePeople({ audience: a.audience, propertyIds: a.propertyIds, unitIds: a.unitIds });
      const sentThreads = new Set(rows.rows.map(r => String(r.thread)));
      audienceNow = { total: people.length, withoutEmail: people.filter(p => !p.hasEmail).length, notYetSent: people.filter(p => !sentThreads.has(`${p.kind}:${p.id}`)).length };
    }
    return {
      announcement: { ...a, state: st.state, tracked: st.tracked, busy: isBusy(s) },
      stats: s ?? { total: 0, emailed: 0, failed: 0, portalOnly: 0, read: 0, lastAt: null },
      audienceNow,
      recipients: rows.rows.map(r => {
        const kind = ref(r.tenantId) ? 'tenant' : ref(r.ownerId) ? 'owner' : ref(r.vendorId) ? 'vendor' : 'applicant';
        return {
          messageId: String(r.id),
          kind,
          personId: String(r.tenantId || r.ownerId || r.vendorId || r.applicationId || ''),
          thread: str(r.thread) ?? '',
          name: str(r.name) || 'Former contact',
          delivery: str(r.delivery) || 'Portal only',
          channel: str(r.channel) || 'Portal',
          readAt: iso(r.readAt),
          sentAt: iso(r.sentAt),
          unitId: ref(r.unitId),
          propertyId: ref(r.propertyId),
        };
      }),
    };
  },
});
