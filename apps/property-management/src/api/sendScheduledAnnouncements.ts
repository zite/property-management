import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { announcementState, deliveryStats, isBusy, sendAnnouncementBatch, toAnnouncement } from '../server/announcements';

/**
 * Every 15 minutes: send announcements whose scheduled time has come, and
 * finish any send that stopped part-way in the last six hours (a closed tab,
 * a timeout) once nothing has touched it for a few minutes. Batches stop well
 * inside the platform timeout; the next run continues where this one ended.
 */

export default createEndpoint({
  description: 'Send scheduled announcements and finish interrupted sends (runs every 15 minutes)',
  schedule: {
    scheduleType: 'recurring',
    schedule: { frequency: 'minutely', interval: 15 },
    timezone: 'America/Denver',
    overlapPolicy: 'skip',
  },
  inputSchema: z.object({}),
  outputSchema: z.object({ started: z.number(), resumed: z.number(), sent: z.number(), pending: z.number(), errors: z.array(z.string()) }),
  execute: async ({ context }) => {
    // Scheduled runs have no user; anyone running it by hand must be allowed to send announcements.
    if (context?.user) assertCan(await getActor(context as never), 'announcements.send');
    const began = Date.now();
    const deadline = began + 100_000;
    const settings = await getSettings();
    const since = new Date(began - 6 * 3_600_000).toISOString();
    const { rows } = await zite.sql({
      query: `
        SELECT * FROM "Announcements"
        WHERE ("status" = 'Draft' AND "sentAt" IS NOT NULL AND "sentAt" <= NOW())
           OR ("status" = 'Sent' AND "sentAt" >= $1)
        ORDER BY "sentAt" ASC LIMIT 50`,
      params: [since],
    });
    const list = rows.map(toAnnouncement);
    const stats = await deliveryStats(list.map(a => a.id));
    const out = { started: 0, resumed: 0, sent: 0, pending: 0, errors: [] as string[] };
    for (const a of list) {
      const s = stats.get(a.id);
      const st = announcementState(a, s);
      const due = a.status === 'Draft';
      if (!due && (!st.incomplete || isBusy(s))) continue;
      if (Date.now() > deadline) {
        out.pending++;
        continue;
      }
      try {
        const r = await sendAnnouncementBatch(a, { settings, actor: null, deadline });
        if (due) out.started++;
        else out.resumed++;
        out.sent += r.sent;
        if (!r.done) out.pending++;
      } catch (e) {
        out.errors.push(`${a.title}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }
    return out;
  },
});
