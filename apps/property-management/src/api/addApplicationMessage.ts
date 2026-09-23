import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { messagePerson, threadKey } from '@project/shared/server/email';
import { mentionedIds, notify, plainMentions } from '@project/shared/server/notify';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { appLabel, applicantRecipient, loadApplicationRecord } from '../server/leasing';

/**
 * The conversation on an application: an internal note for the team, a
 * message to the applicant (emailed, and shown on their application page in
 * the portal), or marking the applicant's replies as read.
 */

const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('note'), applicationId: z.string().min(1), body: z.string().trim().min(1, 'Write a note first.').max(10000) }),
  z.object({ mode: z.literal('applicant'), applicationId: z.string().min(1), body: z.string().trim().min(1, 'Write a message first.').max(10000), subject: z.string().max(200).optional() }),
  z.object({ mode: z.literal('read'), applicationId: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Add a note or message to a rental application, or mark replies read',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const r = await loadApplicationRecord({ id: data.applicationId });
    const id = String(r.id);
    const now = new Date().toISOString();

    if (data.mode === 'read') {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Messages" WHERE ("applicationId" = $1 OR "thread" = $2) AND "direction" = 'Inbound' AND "readAt" IS NULL LIMIT 200`, params: [id, threadKey('applicant', id)] });
      for (const m of rows) await zite.messages.update({ id: String(m.id), record: { readAt: now } });
      return { id: null, delivery: null, marked: rows.length };
    }

    if (data.mode === 'note') {
      const created = await zite.messages.create({
        record: {
          subject: 'Note',
          body: data.body,
          thread: threadKey('applicant', id),
          direction: 'Internal',
          channel: 'Note',
          applicationId: id,
          propertyId: ref(r.propertyId),
          senderMemberId: actor.id,
          senderName: actor.name,
          sentAt: now,
        },
      });
      await zite.applications.update({ id, record: { lastActivityAt: now } });
      const mentioned = mentionedIds(data.body);
      if (mentioned.length) {
        await notify({ recipientIds: mentioned, kind: 'mention', title: `${actor.name} mentioned you on ${appLabel(r)}`, body: plainMentions(data.body).slice(0, 400), link: `/applications/${r.number}`, entityType: 'application', entityId: id, actorId: actor.id, actorName: actor.name });
      }
      return { id: created.id, delivery: null, marked: 0 };
    }

    assertCan(actor, 'communications.send');
    const recipient = applicantRecipient(r);
    if (!recipient.email) throw new ZiteError('This applicant has no email address, so the message can’t be sent.', 'BAD_REQUEST');
    const settings = await getSettings();
    const statusLink = portalLink(settings, `/applications/${id}`);
    const sent = await messagePerson({
      settings,
      recipient,
      subject: data.subject?.trim() || `About your application for ${str(r.listingTitle) || 'your new home'} (${appLabel(r)})`,
      body: data.body,
      deliver: true,
      senderMemberId: actor.id,
      senderName: actor.name,
      applicationId: id,
      propertyId: ref(r.propertyId),
      button: statusLink ? { label: 'Reply on your application page', href: statusLink } : null,
    });
    // The message itself is the record on the timeline; no separate activity line.
    await zite.applications.update({ id, record: { lastActivityAt: now } });
    return { id: sent.id, delivery: sent.delivery, marked: 0 };
  },
});
