import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { SCHEDULE_FREQUENCIES, WORK_ORDER_CATEGORIES } from '@project/shared/constants';
import { formatDay, isDay } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { assertMaintenance, loadSchedule } from '../server/maintenance';

/**
 * Create, edit, pause, resume or delete a preventive maintenance schedule.
 * The daily automation turns an active schedule into a work order `leadDays`
 * before `nextDueOn`. Deleting a schedule keeps the work orders it created.
 */

const Fields = z.object({
  title: z.string().trim().min(1, 'Give the schedule a title.').max(200, 'Keep the title under 200 characters.'),
  description: z.string().max(10000),
  propertyId: z.string().min(1, 'Choose a property.'),
  unitId: z.string().nullable(),
  // Schedules store category as text, but it becomes a work order's single-select category.
  category: z.enum(WORK_ORDER_CATEGORIES),
  priority: z.enum(['High', 'Normal', 'Low']),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  nextDueOn: z.string().refine(isDay, 'Choose when it’s next due.'),
  leadDays: z.number().int('Lead time is whole days.').min(0, 'Lead time can’t be negative.').max(180, 'Lead time can be at most 180 days.'),
  vendorId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  estimateAmount: z.number().min(0, 'The estimate can’t be negative.').max(10_000_000).nullable(),
  active: z.boolean(),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), schedule: Fields }),
  z.object({ action: z.literal('update'), id: z.string().min(1), patch: Fields.partial() }),
  z.object({ action: z.literal('setActive'), id: z.string().min(1), active: z.boolean() }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Create, update, pause, resume or delete a maintenance schedule',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'recurring maintenance');
    const data = parseInput(Input, input);

    const checkRefs = async (f: Partial<z.infer<typeof Fields>>, current: { propertyId: string | null; unitId: string | null }) => {
      const propertyId = f.propertyId ?? current.propertyId;
      const unitId = f.unitId !== undefined ? f.unitId : current.unitId;
      if (f.propertyId) {
        const { rows } = await zite.sql({ query: `SELECT id FROM "Properties" WHERE id::text = $1`, params: [f.propertyId] });
        if (!rows[0]) throw new ZiteError('That property no longer exists.', 'BAD_REQUEST');
      }
      if (unitId && (f.unitId !== undefined || f.propertyId)) {
        const { rows } = await zite.sql({ query: `SELECT "propertyId" FROM "Units" WHERE id::text = $1`, params: [unitId] });
        if (!rows[0] || String(rows[0].propertyId) !== propertyId) throw new ZiteError('That unit isn’t part of the property.', 'BAD_REQUEST');
      }
      if (f.vendorId) {
        const { rows } = await zite.sql({ query: `SELECT "status" FROM "Vendors" WHERE id::text = $1`, params: [f.vendorId] });
        if (!rows[0]) throw new ZiteError('That vendor no longer exists.', 'BAD_REQUEST');
        if (rows[0].status === 'Inactive') throw new ZiteError('That vendor is inactive. Choose another vendor or reactivate them.', 'BAD_REQUEST');
      }
      if (f.assigneeId) {
        const { rows } = await zite.sql({ query: `SELECT "status" FROM "Members" WHERE id::text = $1`, params: [f.assigneeId] });
        if (!rows[0] || rows[0].status === 'Deactivated') throw new ZiteError('That teammate isn’t active anymore. Choose someone else.', 'BAD_REQUEST');
      }
    };

    if (data.action === 'create') {
      const s = data.schedule;
      await checkRefs(s, { propertyId: null, unitId: null });
      const created = await zite.maintenanceSchedules.create({
        record: {
          title: s.title,
          description: s.description || null,
          propertyId: s.propertyId,
          unitId: s.unitId,
          category: s.category,
          priority: s.priority,
          frequency: s.frequency,
          nextDueOn: s.nextDueOn,
          leadDays: s.leadDays,
          vendorId: s.vendorId,
          assigneeId: s.assigneeId,
          estimateAmount: s.estimateAmount,
          active: s.active,
        },
      });
      await logActivity({ entityType: 'property', entityId: created.id, propertyId: s.propertyId, unitId: s.unitId, action: 'schedule_created', summary: `created the “${s.title}” maintenance schedule (${s.frequency.toLowerCase()}, next due ${formatDay(s.nextDueOn)})`, actorId: actor.id, actorName: actor.name });
      return { id: created.id };
    }

    const { schedule: before } = await loadSchedule(data.id);
    const log = (summary: string, action: string) =>
      logActivity({ entityType: 'property', entityId: before.id, propertyId: before.propertyId, unitId: before.unitId, action, summary, actorId: actor.id, actorName: actor.name });

    if (data.action === 'delete') {
      await zite.maintenanceSchedules.delete({ id: before.id });
      await log(`deleted the “${before.title}” maintenance schedule`, 'schedule_deleted');
      return { id: before.id };
    }

    if (data.action === 'setActive') {
      if (data.active === before.active) return { id: before.id };
      if (data.active) await checkRefs({ vendorId: before.vendorId, assigneeId: before.assigneeId }, before);
      await zite.maintenanceSchedules.update({ id: before.id, record: { active: data.active } });
      await log(`${data.active ? 'resumed' : 'paused'} the “${before.title}” maintenance schedule`, data.active ? 'schedule_resumed' : 'schedule_paused');
      return { id: before.id };
    }

    const p = data.patch;
    await checkRefs({ ...p, vendorId: p.vendorId !== undefined && p.vendorId !== before.vendorId ? p.vendorId : undefined, assigneeId: p.assigneeId !== undefined && p.assigneeId !== before.assigneeId ? p.assigneeId : undefined }, before);
    const record: Record<string, unknown> = {};
    for (const k of Object.keys(p) as Array<keyof typeof p>) {
      const next = p[k];
      if (next === undefined) continue;
      const prev = (before as unknown as Record<string, unknown>)[k];
      if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null) || (k === 'description' && str(prev) === next)) continue;
      record[k] = next === '' ? null : next;
    }
    if (p.propertyId && p.propertyId !== before.propertyId && p.unitId === undefined) record.unitId = null;
    if (!Object.keys(record).length) return { id: before.id };
    await zite.maintenanceSchedules.update({ id: before.id, record: record as never });
    await log(record.nextDueOn ? `moved the next “${p.title ?? before.title}” due date to ${formatDay(String(record.nextDueOn))}` : `updated the “${p.title ?? before.title}” maintenance schedule`, 'schedule_updated');
    return { id: before.id };
  },
});
