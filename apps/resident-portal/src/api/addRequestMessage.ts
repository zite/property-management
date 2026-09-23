import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { assertDailyLimit, cleanAttachments, isImageName, officeRecipients, parseFiles, preview, requestOnLease, residentFor, toResidentMessage } from '../server/resident';

/**
 * The resident adds a message or photos to one of their requests. Photos also
 * join the work order's own photos, so whoever opens it sees them.
 */

const Input = z.object({
  leaseId: z.string().max(64).nullish(),
  number: z.number().int().positive(),
  body: z.string().max(5000, 'That message is a little long — please shorten it.').optional().default(''),
  attachments: z.array(z.object({ url: z.string().url().max(2000), name: z.string().max(200) })).max(6, 'Attach up to 6 files at a time.').optional().default([]),
});

export default createEndpoint({
  description: 'A resident adds a message or photos to a maintenance request',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const w = await requestOnLease(me.lease.id, data.number);
    const body = data.body.trim();
    const attachments = cleanAttachments(data.attachments);
    if (!body && !attachments.length) throw new ZiteError('Write a message or add a photo before sending.', 'BAD_REQUEST');
    await assertDailyLimit('Messages', 'tenantId', me.tenantId, 60, 'messages');

    const id = String(w.id);
    const number = num(w.number);
    const now = new Date().toISOString();
    const settings = await getSettings();
    const created = await zite.messages.create({
      record: {
        subject: `${workOrderRef(number)} · ${str(w.title) ?? 'Maintenance request'}`.slice(0, 240),
        body: body || (attachments.length === 1 ? 'Added a photo.' : `Added ${attachments.length} photos.`),
        thread: threadKey('work_order', id),
        direction: 'Inbound',
        channel: 'Portal',
        tenantId: me.tenantId,
        workOrderId: id,
        leaseId: me.lease.id,
        propertyId: me.lease.propertyId || null,
        senderName: me.name,
        delivery: 'Received',
        attachments: attachments.length ? JSON.stringify(attachments) : null,
        sentAt: now,
      },
    });

    const images = attachments.filter(a => isImageName(a.name, a.url));
    const photos = parseFiles(w.photos);
    const patch: Record<string, unknown> = { lastActivityAt: now };
    if (images.length) patch.photos = JSON.stringify([...photos, ...images.filter(i => !photos.some(p => p.url === i.url))].slice(0, 40));
    await zite.workOrders.update({ id, record: patch });

    const assignee = ref(w.assigneeId);
    await notify({
      recipientIds: assignee ? [assignee] : await officeRecipients(me.lease, 'maintenance.manage'),
      kind: 'work_order_message',
      title: `${me.name} replied on ${workOrderRef(number)}`,
      body: preview(body || `Added ${attachments.length === 1 ? 'a photo' : `${attachments.length} photos`}`, 200),
      link: `/work-orders/${number}`,
      entityType: 'work_order',
      entityId: id,
      actorName: me.name,
    });

    const { rows } = await zite.sql({ query: `SELECT *, NULL AS "workOrderNumber" FROM "Messages" WHERE id::text = $1`, params: [created.id] });
    return { message: toResidentMessage(rows[0] ?? { ...created, direction: 'Inbound' }, settings.organizationName) };
  },
});
