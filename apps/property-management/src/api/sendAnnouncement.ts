import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { sendEmail } from '@project/shared/server/email';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { AUDIENCES, announcementState, audiencePeople, deliveryStats, isBusy, loadAnnouncement, retryFailedEmails, sendAnnouncementBatch } from '../server/announcements';
import { mergeContexts, personKey, render } from '../server/comms';

/**
 * Send an announcement, a batch at a time.
 *
 *   send        — start sending a draft (or scheduled) announcement now
 *   continue    — the next batch of a send this client started
 *   resume      — pick up a send that stopped (refused while another run is active)
 *   retryFailed — email again everyone whose email failed (rows are updated, never duplicated)
 *   test        — email the unsaved content to yourself, rendered for the first recipient
 *
 * Each call works for at most ~25 seconds and reports what's left; the client
 * calls `continue` until `done`. A recipient who already has this
 * announcement is skipped, so no retry ever double-sends.
 */

const Id = z.string().min(1).max(64);
const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.enum(['send', 'continue', 'resume', 'retryFailed']), id: Id }),
  z.object({
    mode: z.literal('test'),
    title: z.string().trim().min(1, 'Give the announcement a title first.').max(200),
    body: z.string().trim().min(1, 'Write the announcement first.').max(10000),
    audience: z.enum(AUDIENCES),
    propertyIds: z.array(Id).max(500).default([]),
    unitIds: z.array(Id).max(2000).default([]),
  }),
]);

const BUDGET_MS = 25_000;

export default createEndpoint({
  description: 'Send an announcement in batches, retry failed emails, or send a test to yourself',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    sent: z.number(),
    emailed: z.number(),
    failed: z.number(),
    portalOnly: z.number(),
    remaining: z.number(),
    total: z.number(),
    done: z.boolean(),
    testTo: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    const started = Date.now();
    const actor = await getActor(context);
    assertCan(actor, 'announcements.send');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const deadline = started + BUDGET_MS;

    if (data.mode === 'test') {
      const people = await audiencePeople({ audience: data.audience, propertyIds: data.propertyIds, unitIds: data.unitIds });
      const first = people[0];
      const ctx = first ? (await mergeContexts([first], settings, { propertyIds: data.audience === 'owners_properties' ? data.propertyIds : null })).get(personKey(first.kind, first.id)) ?? {} : {};
      const home = portalLink(settings);
      const delivery = await sendEmail({ to: actor.email, subject: `[Test] ${render(data.title, ctx)}`, text: render(data.body, ctx), settings, button: home ? { label: 'Open the portal', href: home } : null });
      if (delivery === 'Failed') throw new ZiteError(`The test email to ${actor.email} couldn’t be sent.`, 'BAD_REQUEST');
      return { sent: 1, emailed: 1, failed: 0, portalOnly: 0, remaining: 0, total: 1, done: true, testTo: actor.email };
    }

    const a = await loadAnnouncement(data.id);
    const stats = (await deliveryStats([a.id])).get(a.id);
    const state = announcementState(a, stats);

    if (data.mode === 'retryFailed') {
      if (a.status !== 'Sent') throw new ZiteError('This announcement hasn’t been sent yet.', 'CONFLICT');
      const r = await retryFailedEmails(a, { settings, deadline });
      return { sent: r.fixed, emailed: r.fixed, failed: r.stillFailed, portalOnly: r.noEmail, remaining: r.remaining, total: stats?.failed ?? 0, done: r.remaining === 0, testTo: null };
    }

    if (data.mode === 'send') {
      if (a.status === 'Sent') throw new ZiteError(state.incomplete ? 'This announcement is already sending.' : 'This announcement was already sent.', 'CONFLICT');
      const people = await audiencePeople({ audience: a.audience, propertyIds: a.propertyIds, unitIds: a.unitIds });
      if (!people.length) throw new ZiteError('No one is in this audience yet, so there’s nobody to send it to.', 'BAD_REQUEST');
    } else {
      if (a.status !== 'Sent') throw new ZiteError('Send the announcement first.', 'CONFLICT');
      if (!state.tracked) throw new ZiteError('This announcement was sent before delivery tracking, so it can’t be resumed.', 'CONFLICT');
      if (data.mode === 'resume' && isBusy(stats)) throw new ZiteError('This announcement is sending right now. Give it a minute, then check again.', 'CONFLICT');
    }

    const r = await sendAnnouncementBatch(a, { settings, actor, deadline });
    return { ...r, testTo: null };
  },
});
