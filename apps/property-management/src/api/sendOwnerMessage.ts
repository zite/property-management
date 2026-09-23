import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logActivity } from '@project/shared/server/activity';
import { messagePerson, threadKey } from '@project/shared/server/email';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { loadOwner } from '../server/portfolio';

/**
 * The owner conversation from the staff side:
 *
 *   note     an internal note on the owner's thread (never sent)
 *   message  an email to the owner, kept in the thread and their portal
 *   invite   turns on portal access if needed and emails the owner portal link
 *
 * Everything lands in `owner:<id>`, the same thread the owner portal reads.
 */

const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('note'), ownerId: z.string().min(1), body: z.string().trim().min(1, 'Write something first.').max(10000) }),
  z.object({ mode: z.literal('message'), ownerId: z.string().min(1), subject: z.string().trim().max(200).optional(), body: z.string().trim().min(1, 'Write something first.').max(10000) }),
  z.object({ mode: z.literal('invite'), ownerId: z.string().min(1), note: z.string().trim().max(2000).optional() }),
]);

export default createEndpoint({
  description: 'Add a note, message an owner, or invite them to the owner portal',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'owners.manage');
    const data = parseInput(Input, input);
    const owner = await loadOwner(data.ownerId);
    if (!owner) throw new ZiteError('That owner doesn’t exist, or they were deleted.', 'NOT_FOUND');
    const settings = await getSettings();
    const now = new Date().toISOString();

    if (data.mode === 'note') {
      const created = await zite.messages.create({
        record: { subject: 'Note', body: data.body, thread: threadKey('owner', owner.id), direction: 'Internal', channel: 'Note', ownerId: owner.id, senderMemberId: actor.id, senderName: actor.name, sentAt: now, readAt: now },
      });
      return { id: created.id, delivery: 'Note', portalLinked: true };
    }

    assertCan(actor, 'communications.send');
    if (!owner.email) throw new ZiteError(`Add an email address for ${owner.name} first.`, 'BAD_REQUEST');
    if (owner.status === 'Archived') throw new ZiteError(`${owner.name} is archived. Restore them before sending messages.`, 'CONFLICT');
    const recipient = { kind: 'owner' as const, id: owner.id, name: owner.name, email: owner.email };
    const first = (owner.contactName || owner.name).trim().split(/\s+/)[0] || 'there';

    if (data.mode === 'message') {
      const sent = await messagePerson({
        settings,
        recipient,
        subject: data.subject || `A message from ${settings.organizationName}`,
        body: data.body,
        deliver: true,
        senderMemberId: actor.id,
        senderName: actor.name,
      });
      await logActivity({ entityType: 'owner', entityId: owner.id, action: 'messaged', summary: `emailed ${owner.name}${data.subject ? `: “${data.subject}”` : ''}`, ownerId: owner.id, actorId: actor.id, actorName: actor.name });
      return { id: sent.id, delivery: sent.delivery, portalLinked: true };
    }

    // Invite: access first, so the link works the moment the email arrives.
    if (!owner.portalEnabled) {
      await zite.owners.update({ id: owner.id, record: { portalEnabled: true } });
      await logActivity({ entityType: 'owner', entityId: owner.id, action: 'portal_enabled', summary: `turned on owner portal access for ${owner.name}`, ownerId: owner.id, actorId: actor.id, actorName: actor.name });
    }
    const link = portalLink(settings, '/owner');
    const body = [
      `Hi ${first},`,
      `You can now see your properties with ${settings.organizationName} online: monthly statements, distributions, work that needs your approval, and shared documents.`,
      link ? `Sign in with this email address (${owner.email}) — there’s no password to remember.` : `Sign in to the ${settings.organizationName} owner portal with this email address (${owner.email}) — there’s no password to remember.`,
      data.note ? data.note : '',
      'Reply to this email if you have any questions.',
    ].filter(Boolean).join('\n\n');
    const sent = await messagePerson({
      settings,
      recipient,
      subject: `Your owner portal at ${settings.organizationName}`,
      body,
      deliver: true,
      senderMemberId: actor.id,
      senderName: actor.name,
      button: link ? { label: 'Open your owner portal', href: link } : null,
    });
    await logActivity({ entityType: 'owner', entityId: owner.id, action: 'portal_invited', summary: `invited ${owner.name} to the owner portal`, ownerId: owner.id, actorId: actor.id, actorName: actor.name });
    return { id: sent.id, delivery: sent.delivery, portalLinked: Boolean(link) };
  },
});
