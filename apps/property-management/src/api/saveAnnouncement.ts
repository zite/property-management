import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { AUDIENCES, encodeAudience, loadAnnouncement } from '../server/announcements';

/**
 * Create or edit an announcement draft (optionally scheduled), pin a sent one
 * to the resident portal, cancel a schedule, or delete a draft. Sent
 * announcements can't be edited — people already have them.
 */

const Id = z.string().min(1).max(64);
const Content = z.object({
  title: z.string().trim().min(1, 'Give the announcement a title.').max(200, 'Keep the title under 200 characters.'),
  body: z.string().trim().min(1, 'Write the announcement first.').max(10000, 'Keep the announcement under 10,000 characters.'),
  audience: z.enum(AUDIENCES),
  propertyIds: z.array(Id).max(500).default([]),
  unitIds: z.array(Id).max(2000).default([]),
  channel: z.enum(['Email and portal', 'Portal only']),
  pinnedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** A future time to send it; null keeps it an unscheduled draft. */
  scheduledFor: z.string().datetime({ offset: true }).nullish(),
});

const Input = z.discriminatedUnion('action', [
  Content.extend({ action: z.literal('create') }),
  Content.extend({ action: z.literal('update'), id: Id }),
  z.object({ action: z.literal('pin'), id: Id, pinnedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  z.object({ action: z.literal('unschedule'), id: Id }),
  z.object({ action: z.literal('delete'), id: Id }),
]);

export default createEndpoint({
  description: 'Create, edit, schedule, pin or delete an announcement',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'announcements.send');
    const data = parseInput(Input, input);

    if (data.action === 'create' || data.action === 'update') {
      if (data.audience === 'residents_properties' || data.audience === 'owners_properties') {
        if (!data.propertyIds.length) throw new ZiteError('Choose at least one property.', 'BAD_REQUEST');
      }
      if (data.audience === 'residents_units' && !data.unitIds.length) throw new ZiteError('Choose at least one unit.', 'BAD_REQUEST');
      if (data.scheduledFor && Date.parse(data.scheduledFor) < Date.now() + 60_000) throw new ZiteError('Pick a time at least a minute from now, or send it now.', 'BAD_REQUEST');
      const encoded = encodeAudience({ audience: data.audience, propertyIds: data.propertyIds, unitIds: data.unitIds });
      const record = {
        title: data.title,
        body: data.body,
        audience: encoded.audience,
        propertyIds: encoded.propertyIds,
        channel: data.channel,
        status: 'Draft',
        sentAt: data.scheduledFor ?? null,
        sentById: actor.id,
        pinnedUntil: data.audience.startsWith('residents') ? data.pinnedUntil ?? null : null,
      };
      if (data.action === 'update') {
        const existing = await loadAnnouncement(data.id);
        if (existing.status === 'Sent') throw new ZiteError('This announcement was already sent, so it can’t be edited.', 'CONFLICT');
        await withRetry(() => zite.announcements.update({ id: data.id, record }));
        return { id: data.id };
      }
      const created = await withRetry(() => zite.announcements.create({ record: { ...record, recipientCount: 0 } }));
      return { id: created.id };
    }

    const existing = await loadAnnouncement(data.id);
    if (data.action === 'pin') {
      await withRetry(() => zite.announcements.update({ id: data.id, record: { pinnedUntil: data.pinnedUntil } }));
      return { id: data.id };
    }
    if (existing.status === 'Sent') throw new ZiteError(data.action === 'delete' ? 'Sent announcements can’t be deleted — people already have them.' : 'This announcement was already sent.', 'CONFLICT');
    if (data.action === 'unschedule') {
      await withRetry(() => zite.announcements.update({ id: data.id, record: { sentAt: null } }));
      return { id: data.id };
    }
    await withRetry(() => zite.announcements.delete({ id: data.id }));
    await logActivity({ entityType: 'announcement', entityId: data.id, action: 'announcement_deleted', summary: `deleted the draft announcement “${existing.title.slice(0, 120)}”`, actorId: actor.id, actorName: actor.name });
    return { id: data.id };
  },
});
