import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { firstName } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { sendEmail } from '@project/shared/server/email';
import { mentionedIds, notify, plainMentions } from '@project/shared/server/notify';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { loadInquiry, recordInquiryMessage } from '../server/leasing';

/**
 * Talk to a lead: email a reply, send the listing's application link, or add
 * an internal note. Every email is also a row on the lead's thread, delivered
 * or not, so the team sees exactly what the person was sent.
 */

const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('reply'), inquiryId: z.string().min(1), subject: z.string().max(200).optional(), body: z.string().trim().min(1, 'Write your reply first.').max(10000) }),
  z.object({ mode: z.literal('application_link'), inquiryId: z.string().min(1), body: z.string().max(10000).optional() }),
  z.object({ mode: z.literal('note'), inquiryId: z.string().min(1), body: z.string().trim().min(1, 'Write a note first.').max(10000) }),
]);

export default createEndpoint({
  description: 'Email a lead, send them the application link, or add a note',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const inquiry = await loadInquiry(data.inquiryId);
    const now = new Date().toISOString();

    if (data.mode === 'note') {
      const m = await recordInquiryMessage({ inquiry, direction: 'Internal', subject: 'Note', body: data.body, delivery: null, senderMemberId: actor.id, senderName: actor.name });
      const mentioned = mentionedIds(data.body);
      if (mentioned.length) {
        await notify({ recipientIds: mentioned, kind: 'mention', title: `${actor.name} mentioned you on a lead: ${inquiry.name}`, body: plainMentions(data.body).slice(0, 400), link: '/leasing/leads', entityType: 'inquiry', entityId: inquiry.id, actorId: actor.id, actorName: actor.name });
      }
      return { id: m.id, delivery: null };
    }

    assertCan(actor, 'communications.send');
    if (!inquiry.email) throw new ZiteError(`${inquiry.name} has no email address. Add one, or call ${inquiry.phone || 'them'} instead.`, 'BAD_REQUEST');
    const settings = await getSettings();
    const about = inquiry.listingTitle ?? 'your rental inquiry';
    let subject: string;
    let body: string;
    let button: { label: string; href: string } | null = null;

    if (data.mode === 'application_link') {
      if (!inquiry.listingId || !inquiry.listingSlug) throw new ZiteError('Link this lead to a listing first — the application link is the listing’s.', 'BAD_REQUEST');
      if (inquiry.listingStatus !== 'Published') throw new ZiteError('Publish the listing before sending its application link; applicants can only apply to published homes.', 'CONFLICT');
      if (!settings.applicationsOpen) throw new ZiteError('Online applications are switched off in Settings, so the link wouldn’t work.', 'CONFLICT');
      const href = portalLink(settings, `/homes/${inquiry.listingSlug}/apply`);
      if (!href) throw new ZiteError('The portal’s address isn’t known yet. Open the portal once, then send the link again.', 'CONFLICT');
      subject = `Apply for ${about}`;
      body = data.body?.trim() || `Hi ${firstName(inquiry.name) || 'there'},\n\nThanks for your interest in ${about}. You can apply online — it takes about 10 minutes, and you can save and come back:\n\n${href}\n\nLet us know if you have any questions.`;
      button = { label: 'Start your application', href };
    } else {
      subject = data.subject?.trim() || `Re: ${about}`;
      body = data.body;
      const home = inquiry.listingSlug ? portalLink(settings, `/homes/${inquiry.listingSlug}`) : '';
      button = home ? { label: 'View the listing', href: home } : null;
    }

    const delivery = await sendEmail({ to: inquiry.email, subject, text: body, settings, button });
    const m = await recordInquiryMessage({ inquiry, direction: 'Outbound', subject, body, delivery, senderMemberId: actor.id, senderName: actor.name });
    await zite.inquiries.update({ id: inquiry.id, record: { lastContactedAt: now, ...(inquiry.status === 'New' ? { status: 'Contacted' } : {}) } });
    if (data.mode === 'application_link' || inquiry.status === 'New') {
      await logActivity({
        entityType: 'inquiry',
        entityId: inquiry.id,
        action: data.mode === 'application_link' ? 'application_link_sent' : 'status_changed',
        summary: data.mode === 'application_link' ? 'sent the application link' : 'replied and moved it to Contacted',
        actorId: actor.id,
        actorName: actor.name,
        propertyId: inquiry.propertyId,
        unitId: inquiry.unitId,
        data: inquiry.status === 'New' ? { from: 'New', to: 'Contacted' } : undefined,
      });
    }
    // A failed send is still on the thread (marked Not delivered); the page says so instead of pretending it went.
    return { id: m.id, delivery };
  },
});
