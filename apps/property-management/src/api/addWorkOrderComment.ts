import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { messagePerson, threadKey } from '@project/shared/server/email';
import { mentionedIds, notify, plainMentions } from '@project/shared/server/notify';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadWorkOrder } from '../server/workOrders';

/**
 * Write on a work order: an internal note (with @mentions), or a message to
 * the resident or the vendor — which lands in their portal and, unless
 * `portalOnly`, their email. Also marks the work order's inbound messages read.
 */

const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('note'), workOrderId: z.string().min(1), body: z.string().trim().min(1, 'Write something first.').max(10000) }),
  z.object({ mode: z.enum(['tenant', 'vendor']), workOrderId: z.string().min(1), body: z.string().trim().min(1, 'Write something first.').max(10000), portalOnly: z.boolean().optional() }),
  z.object({ mode: z.literal('read'), workOrderId: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Add a note or message to a work order, or mark its messages read',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'maintenance.create');
    const data = parseInput(Input, input);
    const wo = await loadWorkOrder({ id: data.workOrderId });
    const now = new Date().toISOString();

    if (data.mode === 'read') {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Messages" WHERE "workOrderId" = $1 AND "direction" = 'Inbound' AND "readAt" IS NULL`, params: [wo.id] });
      for (const r of rows) await zite.messages.update({ id: String(r.id), record: { readAt: now } });
      return { id: null };
    }

    if (data.mode === 'note') {
      const created = await zite.messages.create({
        record: { subject: 'Note', body: data.body, thread: threadKey('work_order', wo.id), direction: 'Internal', channel: 'Note', workOrderId: wo.id, propertyId: wo.propertyId, leaseId: wo.leaseId, senderMemberId: actor.id, senderName: actor.name, sentAt: now, readAt: now },
      });
      const mentioned = mentionedIds(data.body);
      await notify({ recipientIds: mentioned, kind: 'mention', title: `${actor.name} mentioned you on ${workOrderRef(wo.number)}`, body: plainMentions(data.body).slice(0, 300), link: `/work-orders/${wo.number}`, entityType: 'work_order', entityId: wo.id, actorId: actor.id, actorName: actor.name });
      await zite.workOrders.update({ id: wo.id, record: { lastActivityAt: now } });
      return { id: created.id };
    }

    assertCan(actor, 'communications.send');
    const settings = await getSettings();
    let recipient: { kind: 'tenant' | 'vendor'; id: string; name: string; email: string | null };
    if (data.mode === 'tenant') {
      if (!wo.tenantId) throw new ZiteError('This work order has no resident to message.', 'BAD_REQUEST');
      const { rows } = await zite.sql({ query: `SELECT id, "name", "email" FROM "Tenants" WHERE id::text = $1`, params: [wo.tenantId] });
      if (!rows[0]) throw new ZiteError('The resident on this work order no longer exists.', 'BAD_REQUEST');
      recipient = { kind: 'tenant', id: String(rows[0].id), name: str(rows[0].name) ?? 'Resident', email: str(rows[0].email) };
    } else {
      if (!wo.vendorId) throw new ZiteError('Assign a vendor before messaging one.', 'BAD_REQUEST');
      const { rows } = await zite.sql({ query: `SELECT id, "name", "contactName", "email" FROM "Vendors" WHERE id::text = $1`, params: [wo.vendorId] });
      if (!rows[0]) throw new ZiteError('The vendor on this work order no longer exists.', 'BAD_REQUEST');
      recipient = { kind: 'vendor', id: String(rows[0].id), name: str(rows[0].contactName) || str(rows[0].name) || 'there', email: str(rows[0].email) };
    }
    const deliver = !data.portalOnly && Boolean(recipient.email);
    const link = portalLink(settings, recipient.kind === 'tenant' ? `/resident/maintenance/${wo.number}` : `/vendor/work-orders/${wo.number}`);
    const sent = await messagePerson({
      settings,
      recipient,
      subject: `${workOrderRef(wo.number)}: ${wo.title}`,
      body: data.body,
      deliver,
      senderMemberId: actor.id,
      senderName: actor.name,
      workOrderId: wo.id,
      leaseId: wo.leaseId,
      propertyId: wo.propertyId,
      thread: threadKey('work_order', wo.id),
      button: link ? { label: 'View the work order', href: link } : null,
    });
    await zite.workOrders.update({ id: wo.id, record: { lastActivityAt: now } });
    await logActivity({ entityType: 'work_order', entityId: wo.id, workOrderId: wo.id, propertyId: wo.propertyId, action: 'message_sent', summary: `messaged ${recipient.kind === 'tenant' ? 'the resident' : 'the vendor'}${sent.delivery === 'Failed' ? ' (email not delivered)' : ''}`, actorId: actor.id, actorName: actor.name });
    return { id: sent.id };
  },
});
