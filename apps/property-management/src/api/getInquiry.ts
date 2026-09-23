import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { day, iso, numOrNull, ref, str } from '@project/shared/server/sql';
import { inquiryThread } from '../components/leasing/rules';
import { parseInput } from '../server/input';
import { loadInquiry } from '../server/leasing';
import { messagesWhere, timelineActivity } from '../server/timeline';

/** One lead with its conversation, history, showings and any application from the same person. */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a lead with its conversation, showings and matching applications',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { id } = parseInput(Input, input);
    const inquiry = await loadInquiry(id);
    const [settings, messages, activity, showings, applications] = await Promise.all([
      getSettings(),
      messagesWhere(`m."thread" = $1`, [inquiryThread(id)]),
      timelineActivity('entityId', id),
      zite.sql({ query: `SELECT id, "title", "status", "dueDate", "assigneeId", "systemKey" FROM "Tasks" WHERE "systemKey" LIKE $1 ORDER BY created_at DESC LIMIT 10`, params: [`showing:${id}:%`] }),
      inquiry.email
        ? zite.sql({
            query: `SELECT id, "number", "status", "listingId", "submittedAt" FROM "Applications" WHERE (LOWER("email") = $1 OR LOWER("portalEmail") = $1 OR id::text = $2) AND "status" <> 'Draft' ORDER BY COALESCE("submittedAt", created_at) DESC LIMIT 5`,
            params: [inquiry.email.toLowerCase(), inquiry.applicationId ?? ''],
          })
        : inquiry.applicationId
          ? zite.sql({ query: `SELECT id, "number", "status", "listingId", "submittedAt" FROM "Applications" WHERE id::text = $1`, params: [inquiry.applicationId] })
          : Promise.resolve({ rows: [] }),
    ]);
    return {
      inquiry,
      messages,
      activity,
      showings: showings.rows.map(t => {
        const at = String(t.systemKey ?? '').split(':').slice(2).join(':');
        return { id: String(t.id), title: str(t.title) ?? '', status: str(t.status) ?? 'To do', dueDate: day(t.dueDate), assigneeId: ref(t.assigneeId), at: iso(at) };
      }),
      applications: applications.rows.map(a => ({ id: String(a.id), number: numOrNull(a.number), status: String(a.status), listingId: ref(a.listingId), submittedAt: iso(a.submittedAt) })),
      applyUrl: inquiry.listingSlug ? portalLink(settings, `/homes/${inquiry.listingSlug}/apply`) || null : null,
      portalKnown: Boolean(settings.portalUrl),
    };
  },
});
