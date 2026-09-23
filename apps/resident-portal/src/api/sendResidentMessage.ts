import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { assertDailyLimit, cleanAttachments, homeLabel, officeRecipients, preview, residentFor, toResidentMessage } from '../server/resident';

/** The resident writes to the office. It lands in the staff Messages inbox and the property manager is told. */

const Input = z.object({
  leaseId: z.string().max(64).nullish(),
  subject: z.string().trim().max(200, 'Keep the subject under 200 characters.').optional().default(''),
  body: z.string().max(10000, 'That message is a little long — please shorten it.').optional().default(''),
  attachments: z.array(z.object({ url: z.string().url().max(2000), name: z.string().max(200) })).max(10, 'Attach up to 10 files.').optional().default([]),
});

export default createEndpoint({
  description: 'A resident sends a message to the office',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    const body = data.body.trim();
    const attachments = cleanAttachments(data.attachments);
    if (!body && !attachments.length) throw new ZiteError('Write a message before sending.', 'BAD_REQUEST');
    await assertDailyLimit('Messages', 'tenantId', tenantId, 60, 'messages');

    const settings = await getSettings();
    const now = new Date().toISOString();
    const subject = data.subject || preview(body, 60) || 'Attachment';
    const created = await zite.messages.create({
      record: {
        subject,
        body: body || (attachments.length === 1 ? `Sent ${attachments[0].name}` : `Sent ${attachments.length} files`),
        thread: threadKey('tenant', tenantId),
        direction: 'Inbound',
        channel: 'Portal',
        tenantId,
        leaseId: lease.id,
        propertyId: lease.propertyId || null,
        senderName: me.name,
        delivery: 'Received',
        attachments: attachments.length ? JSON.stringify(attachments) : null,
        sentAt: now,
      },
    });

    await notify({
      recipientIds: await officeRecipients(lease, 'residents.manage'),
      kind: 'message_received',
      title: `${me.name} (${homeLabel(lease)}): ${subject}`,
      body: preview(body, 240) || null,
      link: '/messages',
      entityType: 'tenant',
      entityId: tenantId,
      actorName: me.name,
    });

    return {
      message: toResidentMessage(
        { id: created.id, subject, body: body || (attachments.length === 1 ? `Sent ${attachments[0].name}` : `Sent ${attachments.length} files`), direction: 'Inbound', senderName: me.name, sentAt: now, readAt: null, attachments: attachments.length ? JSON.stringify(attachments) : '', workOrderNumber: null },
        settings.organizationName,
      ),
    };
  },
});
