import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, can, getActor } from '@project/shared/server/actor';
import { messagePerson, threadKey } from '@project/shared/server/email';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { loadVendor } from '../server/maintenance';

/**
 * The conversation with a vendor: send a message (emailed, and shown in their
 * portal when they have access), invite them to the vendor portal, or mark
 * what they sent as read. Messages about a specific job live on that work
 * order instead.
 */

const Input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('message'), vendorId: z.string().min(1), subject: z.string().trim().max(200).optional(), body: z.string().trim().min(1, 'Write something first.').max(10000) }),
  z.object({ mode: z.literal('invite'), vendorId: z.string().min(1), note: z.string().trim().max(2000).optional() }),
  z.object({ mode: z.literal('read'), vendorId: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Message a vendor, invite them to the portal, or mark their messages read',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string().nullable(), delivery: z.string().nullable(), linked: z.boolean() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'vendors.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const vendor = await loadVendor(data.vendorId, today, can(actor.role, 'accounting.view'));
    const thread = threadKey('vendor', vendor.id);

    if (data.mode === 'read') {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Messages" WHERE "thread" = $1 AND "direction" = 'Inbound' AND "readAt" IS NULL`, params: [thread] });
      const now = new Date().toISOString();
      for (const r of rows) await zite.messages.update({ id: String(r.id), record: { readAt: now } });
      return { id: null, delivery: null, linked: false };
    }

    assertCan(actor, 'communications.send');
    if (vendor.status === 'Inactive') throw new ZiteError(`${vendor.name} is inactive. Reactivate the vendor to message them.`, 'BAD_REQUEST');
    const recipient = { kind: 'vendor' as const, id: vendor.id, name: vendor.contactName || vendor.name, email: vendor.email || null };
    const link = portalLink(settings, '/vendor');

    if (data.mode === 'message') {
      if (!vendor.email && !vendor.portalEnabled) throw new ZiteError(`${vendor.name} has no email address and no portal access, so they’d never see this. Add an email first.`, 'BAD_REQUEST');
      const sent = await messagePerson({
        settings,
        recipient,
        subject: data.subject || `Message from ${settings.organizationName}`,
        body: data.body,
        deliver: Boolean(vendor.email),
        senderMemberId: actor.id,
        senderName: actor.name,
        thread,
        button: vendor.portalEnabled && link ? { label: 'Open the vendor portal', href: link } : null,
      });
      return { id: sent.id, delivery: sent.delivery, linked: Boolean(link) };
    }

    if (!vendor.email) throw new ZiteError('Add an email address first — vendors sign in to the portal with it.', 'BAD_REQUEST');
    if (!vendor.portalEnabled) {
      const { rows } = await zite.sql({
        query: `SELECT "name" FROM "Vendors" WHERE LOWER("email") = LOWER($1) AND id::text <> $2 AND COALESCE("portalEnabled", false) = true AND COALESCE("status", 'Active') = 'Active' LIMIT 1`,
        params: [vendor.email, vendor.id],
      });
      if (rows[0]) throw new ZiteError(`${String(rows[0].name)} already uses ${vendor.email} to sign in to the vendor portal. Use a different email.`, 'CONFLICT');
      await zite.vendors.update({ id: vendor.id, record: { portalEnabled: true } });
    }
    const first = (vendor.contactName || '').trim().split(/\s+/)[0];
    const body = [
      `Hi ${first || 'there'},`,
      `${settings.organizationName} uses a vendor portal for work orders. Once you sign in with ${vendor.email} you can see the jobs assigned to ${vendor.name}, update their status, message our team, send invoices and keep your W-9 and insurance certificate current.`,
      data.note ?? '',
      link ? 'Use the button below to sign in.' : `Sign in to the ${settings.organizationName} vendor portal with ${vendor.email}.`,
      settings.phone ? `Questions? Call us at ${settings.phone}.` : '',
    ].filter(Boolean).join('\n\n');
    const sent = await messagePerson({
      settings,
      recipient,
      subject: `You’re invited to the ${settings.organizationName} vendor portal`,
      body,
      deliver: true,
      senderMemberId: actor.id,
      senderName: actor.name,
      thread,
      button: link ? { label: 'Open the vendor portal', href: link } : null,
    });
    await logActivity({ entityType: 'vendor', entityId: vendor.id, vendorId: vendor.id, action: 'portal_invited', summary: `invited ${vendor.email} to the vendor portal`, actorId: actor.id, actorName: actor.name });
    return { id: sent.id, delivery: sent.delivery, linked: Boolean(link) };
  },
});
