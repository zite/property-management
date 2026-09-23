import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { assertReasonable, parseInput } from '../server/identity';
import { ownerContacts, ownerScope } from '../server/owner';

/** The owner writes to the office. Their property managers get it in their inbox. */

const Input = z.object({
  body: z.string().trim().min(1, 'Write a message before sending.').max(5000, 'Keep messages under 5,000 characters.'),
  subject: z.string().trim().max(200).nullish(),
});

export default createEndpoint({
  description: 'Send a message to the office as an owner',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    assertReasonable(req.body, 5000);
    const scope = await ownerScope(context);
    const who = scope.owner.contactName || scope.owner.name;
    const now = new Date().toISOString();
    const subject = req.subject?.trim() || req.body.split('\n')[0].slice(0, 80);
    const created = await zite.messages.create({
      record: {
        subject,
        body: req.body,
        thread: threadKey('owner', scope.ownerId),
        direction: 'Inbound',
        channel: 'Portal',
        ownerId: scope.ownerId,
        senderName: who,
        delivery: 'Received',
        sentAt: now,
      },
    });
    const managers = await ownerContacts(scope.propertyIds);
    await notify({
      recipientIds: managers,
      kind: 'message_received',
      title: `Message from ${who}${scope.owner.name && scope.owner.name !== who ? ` (${scope.owner.name})` : ''}`,
      body: req.body.slice(0, 280),
      link: `/owners/${scope.ownerId}`,
      entityType: 'owner',
      entityId: scope.ownerId,
      actorName: who,
    });
    return { id: created.id, mine: true, subject, body: req.body, senderName: who, sentAt: now, unread: false, attachments: [] as Array<{ name: string; url: string }> };
  },
});
