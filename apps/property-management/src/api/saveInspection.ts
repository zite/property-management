import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { CONDITIONS, INSPECTION_TYPES, ITEM_CONDITIONS } from '@project/shared/constants';
import { todayIn } from '@project/shared/dates';
import { areaStats, defaultAreas, parseAreas, type InspectionArea, type InspectionItem } from '@project/shared/inspections';
import { logActivity } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { messagePerson } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { assertMaintenance, blankAreas, FLAGGED_CONDITIONS, loadInspectionRow, slug, unitPlace } from '../server/maintenance';

/**
 * Everything that changes an inspection: schedule one, reschedule or
 * reassign it, rate one checklist item at a time (the walkthrough autosaves
 * item by item), add or remove rooms and items, complete it, reopen it, share
 * the report with the residents, or delete one that never started.
 *
 * A completed inspection is a record the resident may have acknowledged, so
 * its checklist is locked until someone reopens it — and reopening clears the
 * acknowledgement, because the report they saw may change.
 */

const id = z.string().min(1);
const Photo = z.object({ url: z.string().url('The photo didn’t upload. Try again.'), name: z.string().max(200) });
const ItemPatch = z.object({
  condition: z.enum(ITEM_CONDITIONS).nullable().optional(),
  notes: z.string().max(4000, 'Keep notes under 4,000 characters.').optional(),
  photos: z.array(Photo).max(30, 'An item can have up to 30 photos.').optional(),
});
const when = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Choose a valid date and time.');

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), unitId: z.string().min(1, 'Choose a unit.'), type: z.enum(INSPECTION_TYPES), scheduledFor: when, inspectorId: z.string().nullish(), leaseId: z.string().nullish(), title: z.string().trim().max(200).optional() }),
  z.object({
    action: z.literal('update'),
    id,
    patch: z.object({
      title: z.string().trim().min(1, 'Give the inspection a title.').max(200).optional(),
      type: z.enum(INSPECTION_TYPES).optional(),
      scheduledFor: when.optional(),
      inspectorId: z.string().nullable().optional(),
      leaseId: z.string().nullable().optional(),
      status: z.enum(['Scheduled', 'In progress', 'Canceled']).optional(),
      summary: z.string().max(10000).optional(),
      overallCondition: z.enum(CONDITIONS).nullable().optional(),
    }),
  }),
  z.object({ action: z.literal('item'), id, areaId: id, itemId: id, patch: ItemPatch }),
  z.object({ action: z.literal('fillArea'), id, areaId: id, condition: z.enum(ITEM_CONDITIONS) }),
  z.object({ action: z.literal('addItem'), id, areaId: id, name: z.string().trim().min(1, 'Name the item.').max(80, 'Keep the name under 80 characters.') }),
  z.object({ action: z.literal('removeItem'), id, areaId: id, itemId: id }),
  z.object({ action: z.literal('addArea'), id, name: z.string().trim().min(1, 'Name the area.').max(80, 'Keep the name under 80 characters.') }),
  z.object({ action: z.literal('removeArea'), id, areaId: id }),
  z.object({ action: z.literal('complete'), id, summary: z.string().trim().max(10000), overallCondition: z.enum(CONDITIONS), share: z.boolean().optional() }),
  z.object({ action: z.literal('reopen'), id }),
  z.object({ action: z.literal('share'), id, shared: z.boolean() }),
  z.object({ action: z.literal('delete'), id }),
]);

const typeWord = (type: string) => type.toLowerCase();

export default createEndpoint({
  description: 'Schedule, walk through, complete, share or delete an inspection',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'inspections');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const now = new Date().toISOString();

    const checkInspector = async (memberId: string | null | undefined) => {
      if (!memberId) return null;
      const { rows } = await zite.sql({ query: `SELECT id, "name", "role", "status" FROM "Members" WHERE id::text = $1`, params: [memberId] });
      if (!rows[0] || rows[0].status === 'Deactivated') throw new ZiteError('That teammate isn’t active anymore. Choose someone else.', 'BAD_REQUEST');
      return { id: String(rows[0].id), name: str(rows[0].name) ?? 'A teammate' };
    };
    const checkLease = async (leaseId: string | null | undefined, unitId: string | null) => {
      if (!leaseId) return null;
      const { rows } = await zite.sql({ query: `SELECT id, "unitId", "name" FROM "Leases" WHERE id::text = $1`, params: [leaseId] });
      if (!rows[0] || String(rows[0].unitId) !== unitId) throw new ZiteError('That lease isn’t for this unit.', 'BAD_REQUEST');
      return { id: String(rows[0].id), name: str(rows[0].name) ?? '' };
    };

    if (data.action === 'create') {
      const place = await unitPlace(data.unitId);
      const inspector = await checkInspector(data.inspectorId);
      const lease = await checkLease(data.leaseId, place.unitId);
      // A move-out uses the move-in's checklist, so every item lines up for the comparison.
      let areas: InspectionArea[] = defaultAreas(place.beds, place.baths);
      if (data.type === 'Move-out') {
        const { rows } = await zite.sql({
          query: `SELECT "areas" FROM "Inspections" WHERE "unitId" = $1 AND "inspectionType" = 'Move-in' AND "status" = 'Completed' ORDER BY CASE WHEN "leaseId" = $2 THEN 0 ELSE 1 END, "completedAt" DESC NULLS LAST LIMIT 1`,
          params: [place.unitId, lease?.id ?? '__none__'],
        });
        const moveIn = parseAreas(rows[0]?.areas);
        if (moveIn.length) areas = blankAreas(moveIn);
      }
      const title = data.title || `${data.type} inspection — ${place.label}`;
      const created = await zite.inspections.create({
        record: {
          title,
          propertyId: place.propertyId,
          unitId: place.unitId,
          leaseId: lease?.id ?? null,
          inspectionType: data.type,
          status: 'Scheduled',
          scheduledFor: new Date(data.scheduledFor).toISOString(),
          inspectorId: inspector?.id ?? null,
          areas: JSON.stringify(areas),
          sharedWithTenant: false,
        },
      });
      await logActivity({ entityType: 'inspection', entityId: created.id, propertyId: place.propertyId, unitId: place.unitId, leaseId: lease?.id ?? null, action: 'created', summary: `scheduled the ${typeWord(data.type)} inspection`, actorId: actor.id, actorName: actor.name });
      if (inspector) {
        const whenLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(new Date(data.scheduledFor));
        await notify({ recipientIds: [inspector.id], kind: 'inspection_due', title: `${actor.name} scheduled you for an inspection`, body: `${title} · ${whenLabel}`, link: `/inspections/${created.id}`, entityType: 'inspection', entityId: created.id, actorId: actor.id, actorName: actor.name });
      }
      return { id: created.id };
    }

    const { inspection: before, areas } = await loadInspectionRow(data.id);
    const base = { entityType: 'inspection' as const, entityId: before.id, propertyId: before.propertyId, unitId: before.unitId, leaseId: before.leaseId, actorId: actor.id, actorName: actor.name };
    const locked = () => {
      if (before.status === 'Completed') throw new ZiteError('This inspection is complete. Reopen it to make changes.', 'CONFLICT');
      if (before.status === 'Canceled') throw new ZiteError('This inspection was canceled. Reopen it to make changes.', 'CONFLICT');
    };
    const findArea = (areaId: string) => {
      const area = areas.find(a => a.id === areaId);
      if (!area) throw new ZiteError('That area was removed. Reload the inspection.', 'NOT_FOUND');
      return area;
    };

    const shareWithResidents = async () => {
      if (!before.leaseId) throw new ZiteError('Link the inspection to a lease before sharing it with residents.', 'BAD_REQUEST');
      const { rows } = await zite.sql({
        query: `SELECT t.id, t."name", t."email" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END`,
        params: [before.leaseId],
      });
      const link = portalLink(settings, '/resident/lease');
      let sent = 0;
      for (const t of rows) {
        const name = str(t.name) ?? 'there';
        const email = str(t.email) || null;
        await messagePerson({
          settings,
          recipient: { kind: 'tenant', id: String(t.id), name, email },
          subject: `Your ${typeWord(before.type)} inspection report is ready`,
          body: `Hi ${name.split(/\s+/)[0]},\n\nThe report from your ${typeWord(before.type)} inspection is ready. Please look through it in the resident portal and confirm you’ve reviewed it. If anything doesn’t match what you see, reply to this message and let us know.`,
          deliver: Boolean(email),
          senderMemberId: actor.id,
          senderName: actor.name,
          leaseId: before.leaseId,
          propertyId: before.propertyId,
          button: link ? { label: 'Review the report', href: link } : null,
        });
        sent++;
      }
      return sent;
    };

    switch (data.action) {
      case 'update': {
        const p = data.patch;
        const record: Record<string, unknown> = {};
        const summaries: string[] = [];
        if (p.title !== undefined && p.title !== before.title) {
          record.title = p.title;
          summaries.push('renamed the inspection');
        }
        if (p.type && p.type !== before.type) {
          record.inspectionType = p.type;
          summaries.push(`changed it to a ${typeWord(p.type)} inspection`);
        }
        if (p.scheduledFor && new Date(p.scheduledFor).toISOString() !== before.scheduledFor) {
          record.scheduledFor = new Date(p.scheduledFor).toISOString();
          summaries.push(`rescheduled it for ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(new Date(p.scheduledFor))}`);
        }
        let newInspector: { id: string; name: string } | null = null;
        if (p.inspectorId !== undefined && (p.inspectorId ?? null) !== before.inspectorId) {
          newInspector = await checkInspector(p.inspectorId);
          record.inspectorId = newInspector?.id ?? null;
          summaries.push(newInspector ? (newInspector.id === actor.id ? 'took the inspection' : `assigned it to ${newInspector.name}`) : 'unassigned the inspector');
        }
        if (p.leaseId !== undefined && (p.leaseId ?? null) !== before.leaseId) {
          const lease = await checkLease(p.leaseId, before.unitId);
          record.leaseId = lease?.id ?? null;
          if (!lease) record.sharedWithTenant = false;
          summaries.push(lease ? `linked it to ${lease.name || 'a lease'}` : 'unlinked the lease');
        }
        if (p.status && p.status !== before.status) {
          if (before.status === 'Completed') throw new ZiteError('Reopen the inspection before changing its status.', 'CONFLICT');
          record.status = p.status;
          summaries.push(p.status === 'Canceled' ? 'canceled the inspection' : p.status === 'In progress' ? 'started the inspection' : 'moved it back to scheduled');
        }
        if (p.summary !== undefined && p.summary !== before.summary) record.summary = p.summary;
        if (p.overallCondition !== undefined && (p.overallCondition ?? null) !== before.overallCondition) record.overallCondition = p.overallCondition;
        if (!Object.keys(record).length) return { id: before.id };
        await zite.inspections.update({ id: before.id, record: record as never });
        if (summaries.length) await logActivity(summaries.map(summary => ({ ...base, action: 'updated', summary })));
        if (newInspector && newInspector.id !== actor.id) {
          await notify({ recipientIds: [newInspector.id], kind: 'inspection_due', title: `${actor.name} assigned you an inspection`, body: before.title, link: `/inspections/${before.id}`, entityType: 'inspection', entityId: before.id, actorId: actor.id, actorName: actor.name });
        }
        return { id: before.id };
      }

      case 'item': {
        locked();
        const area = findArea(data.areaId);
        const item = area.items.find(i => i.id === data.itemId);
        if (!item) throw new ZiteError('That item was removed. Reload the inspection.', 'NOT_FOUND');
        const next: InspectionItem = {
          ...item,
          ...(data.patch.condition !== undefined ? { condition: data.patch.condition } : {}),
          ...(data.patch.notes !== undefined ? { notes: data.patch.notes } : {}),
          ...(data.patch.photos !== undefined ? { photos: data.patch.photos } : {}),
        };
        area.items = area.items.map(i => (i.id === item.id ? next : i));
        const record: Record<string, unknown> = { areas: JSON.stringify(areas) };
        const starting = before.status === 'Scheduled' && Boolean(next.condition);
        if (starting) record.status = 'In progress';
        await zite.inspections.update({ id: before.id, record: record as never });
        if (starting) await logActivity({ ...base, action: 'started', summary: 'started the walkthrough' });
        return { id: before.id, status: starting ? 'In progress' : before.status, item: next, stats: areaStats(areas) };
      }

      case 'fillArea': {
        // "Everything else in this room is fine": rates only the items nobody has rated yet.
        locked();
        const area = findArea(data.areaId);
        const filled = area.items.filter(i => !i.condition).length;
        if (!filled) return { id: before.id, status: before.status, filled: 0, stats: areaStats(areas) };
        area.items = area.items.map(i => (i.condition ? i : { ...i, condition: data.condition }));
        const starting = before.status === 'Scheduled';
        await zite.inspections.update({ id: before.id, record: { areas: JSON.stringify(areas), ...(starting ? { status: 'In progress' } : {}) } });
        if (starting) await logActivity({ ...base, action: 'started', summary: 'started the walkthrough' });
        return { id: before.id, status: starting ? 'In progress' : before.status, filled, stats: areaStats(areas) };
      }

      case 'addItem': {
        locked();
        const area = findArea(data.areaId);
        let itemId = `${area.id}.${slug(data.name)}`;
        for (let n = 2; area.items.some(i => i.id === itemId); n++) itemId = `${area.id}.${slug(data.name)}-${n}`;
        area.items.push({ id: itemId, name: data.name, condition: null, notes: '', photos: [] });
        await zite.inspections.update({ id: before.id, record: { areas: JSON.stringify(areas) } });
        return { id: before.id, areas };
      }

      case 'removeItem': {
        locked();
        const area = findArea(data.areaId);
        area.items = area.items.filter(i => i.id !== data.itemId);
        await zite.inspections.update({ id: before.id, record: { areas: JSON.stringify(areas) } });
        return { id: before.id, areas };
      }

      case 'addArea': {
        locked();
        let areaId = slug(data.name);
        for (let n = 2; areas.some(a => a.id === areaId); n++) areaId = `${slug(data.name)}-${n}`;
        areas.push({ id: areaId, name: data.name, items: [] });
        await zite.inspections.update({ id: before.id, record: { areas: JSON.stringify(areas) } });
        await logActivity({ ...base, action: 'updated', summary: `added ${data.name} to the checklist` });
        return { id: before.id, areas };
      }

      case 'removeArea': {
        locked();
        const area = findArea(data.areaId);
        const next = areas.filter(a => a.id !== area.id);
        await zite.inspections.update({ id: before.id, record: { areas: JSON.stringify(next) } });
        await logActivity({ ...base, action: 'updated', summary: `removed ${area.name} from the checklist` });
        return { id: before.id, areas: next };
      }

      case 'complete': {
        if (before.status === 'Completed') return { id: before.id, shared: before.sharedWithTenant, notified: 0 };
        if (before.status === 'Canceled') throw new ZiteError('This inspection was canceled. Reopen it first.', 'CONFLICT');
        const stats = areaStats(areas);
        if (stats.rated === 0) throw new ZiteError('Rate at least one item before completing the inspection.', 'BAD_REQUEST');
        if (data.share && !before.leaseId) throw new ZiteError('Link the inspection to a lease before sharing it with residents.', 'BAD_REQUEST');
        await zite.inspections.update({
          id: before.id,
          record: { status: 'Completed', completedAt: now, summary: data.summary || null, overallCondition: data.overallCondition, ...(data.share ? { sharedWithTenant: true } : {}) },
        });
        const flagged = areas.flatMap(a => a.items).filter(i => i.condition && FLAGGED_CONDITIONS.includes(i.condition)).length;
        await logActivity({ ...base, action: 'completed', summary: `completed the inspection — ${data.overallCondition.toLowerCase()} overall${flagged ? `, ${flagged} ${flagged === 1 ? 'item' : 'items'} flagged` : ''}`, data: { overallCondition: data.overallCondition, flagged } });
        let notified = 0;
        if (data.share) {
          notified = await shareWithResidents();
          await logActivity({ ...base, action: 'shared', summary: 'shared the report with the residents' });
        }
        return { id: before.id, shared: Boolean(data.share) || before.sharedWithTenant, notified };
      }

      case 'reopen': {
        if (before.status !== 'Completed' && before.status !== 'Canceled') return { id: before.id };
        const record: Record<string, unknown> = before.status === 'Completed' ? { status: 'In progress', completedAt: null, tenantAcknowledgedAt: null } : { status: before.stats.rated > 0 ? 'In progress' : 'Scheduled' };
        await zite.inspections.update({ id: before.id, record: record as never });
        await logActivity({ ...base, action: 'reopened', summary: before.tenantAcknowledgedAt ? 'reopened the inspection (the resident will need to acknowledge it again)' : 'reopened the inspection' });
        return { id: before.id };
      }

      case 'share': {
        if (data.shared === before.sharedWithTenant) return { id: before.id, notified: 0 };
        if (data.shared && !before.leaseId) throw new ZiteError('Link the inspection to a lease before sharing it with residents.', 'BAD_REQUEST');
        await zite.inspections.update({ id: before.id, record: { sharedWithTenant: data.shared } });
        await logActivity({ ...base, action: data.shared ? 'shared' : 'unshared', summary: data.shared ? 'shared the report with the residents' : 'stopped sharing the report with the residents' });
        // Residents only see completed reports; sharing earlier just lines it up for when it's done.
        const notified = data.shared && before.status === 'Completed' ? await shareWithResidents() : 0;
        return { id: before.id, notified };
      }

      case 'delete': {
        if (before.status === 'Completed' || before.stats.rated > 0) throw new ZiteError('This inspection has results, so it can’t be deleted. Cancel it instead.', 'CONFLICT');
        await zite.inspections.delete({ id: before.id });
        await logActivity({ ...base, action: 'deleted', summary: `deleted the ${typeWord(before.type)} inspection “${before.title}”`, data: { scheduledFor: before.scheduledFor, today: todayIn(settings.timezone) } });
        return { id: before.id };
      }
    }
  },
});
