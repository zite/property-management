import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { messagePerson, threadKey } from '@project/shared/server/email';
import { mentionedIds, notify, plainMentions } from '@project/shared/server/notify';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Talk to residents from their record or their lease: a message (email and
 * portal, or portal only), an internal note on their record, marking their
 * replies read, or inviting them to the resident portal.
 */

const body = z.string().trim().min(1, 'Write something first.').max(10000, 'That message is too long.');

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), tenantIds: z.array(z.string().min(1)).min(1).max(200), subject: z.string().trim().max(200).optional(), body, leaseId: z.string().optional(), portalOnly: z.boolean().optional() }),
  z.object({ action: z.literal('note'), tenantId: z.string().min(1), body, leaseId: z.string().optional() }),
  z.object({ action: z.literal('read'), tenantIds: z.array(z.string().min(1)).min(1).max(20) }),
  z.object({ action: z.literal('invite'), tenantId: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Message residents, add a note, mark replies read, or invite a resident to the portal',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const data = parseInput(Input, input);
    const now = new Date().toISOString();

    if (data.action === 'read') {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Messages" WHERE "tenantId" = ANY($1) AND "direction" = 'Inbound' AND "readAt" IS NULL AND COALESCE("workOrderId", '') = '' LIMIT 500`, params: [data.tenantIds] });
      for (const r of rows) await withRetry(() => zite.messages.update({ id: String(r.id), record: { readAt: now } }));
      return { sent: 0, failed: 0, read: rows.length, message: '' };
    }

    const loadTenants = async (ids: string[]) => {
      const { rows } = await zite.sql({ query: `SELECT id, "name", "email" FROM "Tenants" WHERE id::text = ANY($1)`, params: [ids] });
      if (rows.length !== new Set(ids).size) throw new ZiteError('One of the residents no longer exists. Reload and try again.', 'NOT_FOUND');
      return rows.map(r => ({ kind: 'tenant' as const, id: String(r.id), name: str(r.name) || 'Resident', email: str(r.email) || null }));
    };
    const leaseOf = async (leaseId?: string) => {
      if (!leaseId) return null;
      const { rows } = await zite.sql({ query: `SELECT id, "propertyId", "unitId", "name" FROM "Leases" WHERE id::text = $1`, params: [leaseId] });
      if (!rows[0]) throw new ZiteError('That lease no longer exists.', 'NOT_FOUND');
      return { id: String(rows[0].id), propertyId: ref(rows[0].propertyId), unitId: ref(rows[0].unitId), name: str(rows[0].name) ?? '' };
    };

    if (data.action === 'note') {
      const [t] = await loadTenants([data.tenantId]);
      const lease = await leaseOf(data.leaseId);
      const created = await withRetry(() =>
        zite.messages.create({
          record: { subject: 'Note', body: data.body, thread: threadKey('tenant', t.id), direction: 'Internal', channel: 'Note', tenantId: t.id, leaseId: lease?.id ?? null, propertyId: lease?.propertyId ?? null, senderMemberId: actor.id, senderName: actor.name, sentAt: now, readAt: now },
        }),
      );
      await notify({ recipientIds: mentionedIds(data.body), kind: 'mention', title: `${actor.name} mentioned you on ${t.name}`, body: plainMentions(data.body).slice(0, 300), link: `/residents/${t.id}`, entityType: 'tenant', entityId: t.id, actorId: actor.id, actorName: actor.name });
      return { sent: 0, failed: 0, read: 0, message: 'Note added', id: created.id };
    }

    assertCan(actor, 'communications.send');
    const settings = await getSettings();

    if (data.action === 'invite') {
      const [t] = await loadTenants([data.tenantId]);
      if (!t.email) throw new ZiteError(`Add an email address for ${t.name} first — it’s how they sign in to the portal.`, 'BAD_REQUEST');
      const link = portalLink(settings, '/resident');
      const res = await withRetry(() =>
        messagePerson({
          settings, recipient: t, deliver: true, senderMemberId: actor.id, senderName: actor.name,
          subject: `Your resident portal at ${settings.organizationName}`,
          body: `Hi ${t.name.split(/\s+/)[0] || 'there'},\n\nYou can pay rent, request maintenance, sign documents and message us in the resident portal. Sign in with this email address (${t.email})${link ? `: ${link}` : '.'}\n\n${settings.organizationName}`,
          button: link ? { label: 'Open the resident portal', href: link } : null,
        }),
      );
      await withRetry(() => zite.tenants.update({ id: t.id, record: { portalInvitedAt: now } }));
      await logActivity({ entityType: 'tenant', entityId: t.id, tenantId: t.id, action: 'portal_invited', summary: `invited ${t.name} to the resident portal${res.delivery === 'Failed' ? ' (the email wasn’t delivered)' : ''}`, actorId: actor.id, actorName: actor.name });
      return { sent: res.delivery === 'Failed' ? 0 : 1, failed: res.delivery === 'Failed' ? 1 : 0, read: 0, message: res.delivery === 'Failed' ? 'The invite email couldn’t be delivered' : `Invite sent to ${t.email}` };
    }

    const recipients = await loadTenants([...new Set(data.tenantIds)]);
    const lease = await leaseOf(data.leaseId);
    const subject = data.subject?.trim() || `Message from ${settings.organizationName}`;
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const res = await withRetry(() =>
        messagePerson({ settings, recipient: r, subject, body: data.body, deliver: !data.portalOnly && Boolean(r.email), senderMemberId: actor.id, senderName: actor.name, leaseId: lease?.id ?? null, propertyId: lease?.propertyId ?? null }),
      );
      if (res.delivery === 'Failed') failed++;
      else sent++;
    }
    await logActivity(
      lease
        ? { entityType: 'lease', entityId: lease.id, leaseId: lease.id, propertyId: lease.propertyId, unitId: lease.unitId, tenantId: recipients[0]?.id ?? null, action: 'message_sent', summary: `messaged ${recipients.length === 1 ? recipients[0].name : `${recipients.length} residents`}${failed ? ` (${failed} email${failed === 1 ? '' : 's'} not delivered)` : ''}`, actorId: actor.id, actorName: actor.name }
        : recipients.map(r => ({ entityType: 'tenant' as const, entityId: r.id, tenantId: r.id, action: 'message_sent', summary: `messaged ${r.name}${!data.portalOnly && !r.email ? ' in the portal (no email on file)' : ''}`, actorId: actor.id, actorName: actor.name })),
    );
    const message = failed ? `Sent to ${sent}; ${failed} email${failed === 1 ? '' : 's'} couldn’t be delivered` : recipients.length === 1 ? `Message sent to ${recipients[0].name}` : `Message sent to ${recipients.length} residents`;
    return { sent, failed, read: 0, message };
  },
});
