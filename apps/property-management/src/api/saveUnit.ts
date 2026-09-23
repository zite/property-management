import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { UNIT_READINESS } from '@project/shared/constants';
import { isDay } from '@project/shared/dates';
import { formatMoney, round2 } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logActivity } from '@project/shared/server/activity';
import { getSettings } from '@project/shared/server/settings';
import { chunked } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { liveLeaseCounts, loadProperty, loadUnit } from '../server/portfolio';

/**
 * Create (one or many), edit, archive and restore units.
 *
 * Unit names are unique within a property, case-insensitively. A unit with an
 * active lease or one waiting for signature can't be archived: it would drop
 * out of the rent roll while someone still lives there.
 */

const text = (max: number) => z.string().max(max, `Keep it under ${max} characters.`);

const Fields = z.object({
  name: z.string().trim().min(1, 'Give the unit a name.').max(40, 'Keep unit names under 40 characters.'),
  beds: z.number().int().min(0, 'Beds can’t be negative.').max(20).default(0),
  baths: z.number().min(0, 'Baths can’t be negative.').max(20).default(1),
  squareFeet: z.number().int().min(0).max(1_000_000).nullable().default(null),
  marketRent: z.number().min(0, 'Market rent can’t be negative.').max(10_000_000).default(0),
  depositAmount: z.number().min(0, 'The deposit can’t be negative.').max(10_000_000).default(0),
  readiness: z.enum(UNIT_READINESS).default('Ready'),
  floor: text(20).default(''),
  unitType: text(60).default(''),
  features: z.array(z.string().trim().min(1).max(60, 'Keep each feature under 60 characters.')).max(40, 'Keep it to 40 features.').default([]),
  photoUrls: z.array(z.string().url()).max(30, 'Keep it to 30 photos.').default([]),
  description: text(5000).default(''),
  availableOn: z.string().nullable().default(null),
  notes: text(5000).default(''),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), propertyId: z.string().min(1), units: z.array(Fields).min(1).max(500, 'Add up to 500 units at a time.') }),
  z.object({ action: z.literal('update'), id: z.string().min(1), fields: Fields.partial() }),
  z.object({ action: z.literal('archive'), id: z.string().min(1) }),
  z.object({ action: z.literal('unarchive'), id: z.string().min(1) }),
]);

type FieldValues = Partial<z.infer<typeof Fields>>;

function toRecord(f: FieldValues) {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (k === 'features' || k === 'photoUrls') r[k] = JSON.stringify([...new Set(v as string[])]);
    else if (k === 'marketRent' || k === 'depositAmount') r[k] = round2(v as number);
    else if (k === 'floor' || k === 'unitType') r[k] = (v as string) || null;
    else r[k] = v;
  }
  return r;
}

async function assertNamesFree(propertyId: string, names: string[], selfId: string | null) {
  const lower = names.map(n => n.trim().toLowerCase());
  const dupe = lower.find((n, i) => lower.indexOf(n) !== i);
  if (dupe) throw new ZiteError(`Two units are both named “${names[lower.indexOf(dupe)]}”. Unit names must be unique within a property.`, 'BAD_REQUEST');
  const { rows } = await zite.sql({ query: `SELECT "name" FROM "Units" WHERE "propertyId" = $1 AND LOWER("name") = ANY($2) AND id::text <> $3 LIMIT 5`, params: [propertyId, lower, selfId ?? ''] });
  if (rows.length) {
    const taken = rows.map(r => String(r.name));
    throw new ZiteError(taken.length === 1 ? `There’s already a unit named ${taken[0]} at this property.` : `These unit names are already used at this property: ${taken.join(', ')}.`, 'CONFLICT');
  }
}

export default createEndpoint({
  description: 'Create, update, archive or restore units',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'portfolio.manage');
    const data = parseInput(Input, input);
    const who = { actorId: actor.id, actorName: actor.name };

    if (data.action === 'create') {
      const property = await loadProperty(data.propertyId);
      if (!property) throw new ZiteError('That property doesn’t exist, or it was deleted.', 'NOT_FOUND');
      if (property.status === 'Archived') throw new ZiteError(`${property.name} is archived. Restore it before adding units.`, 'CONFLICT');
      for (const u of data.units) if (u.availableOn && !isDay(u.availableOn)) throw new ZiteError('Choose a valid available date.', 'BAD_REQUEST');
      await assertNamesFree(property.id, data.units.map(u => u.name), null);
      const ids: string[] = [];
      await chunked(data.units, async batch => {
        const res = await zite.units.bulkCreate({ records: batch.map(u => ({ ...toRecord(u), propertyId: property.id, archived: false })) as never });
        for (const r of res.records as Array<{ id: string }>) ids.push(r.id);
      });
      await logActivity({
        entityType: data.units.length === 1 ? 'unit' : 'property',
        entityId: data.units.length === 1 ? ids[0] ?? property.id : property.id,
        action: 'units_added',
        summary: data.units.length === 1 ? `added unit ${data.units[0].name} to ${property.name}` : `added ${data.units.length} units to ${property.name}`,
        propertyId: property.id,
        unitId: data.units.length === 1 ? ids[0] ?? null : null,
        ...who,
      });
      return { ids, created: ids.length };
    }

    const before = await loadUnit(data.id);
    if (!before) throw new ZiteError('That unit doesn’t exist, or it was deleted.', 'NOT_FOUND');
    const property = await loadProperty(before.propertyId);
    const label = property && !['Single-family', 'Condo'].includes(property.propertyType) ? `${property.name} ${before.name}` : property?.name ?? before.name;

    if (data.action === 'update') {
      const f = data.fields;
      if (f.availableOn && !isDay(f.availableOn)) throw new ZiteError('Choose a valid available date.', 'BAD_REQUEST');
      if (f.name !== undefined && f.name.trim().toLowerCase() !== before.name.toLowerCase()) await assertNamesFree(before.propertyId, [f.name], before.id);
      const record = toRecord(f);
      const changed = Object.keys(record).filter(k => {
        const prev = (before as Record<string, unknown>)[k];
        const next = k === 'features' || k === 'photoUrls' ? JSON.parse(String(record[k])) : record[k];
        return JSON.stringify(prev === '' ? null : prev ?? null) !== JSON.stringify(next === '' ? null : next ?? null);
      });
      if (!changed.length) return { ids: [before.id], created: 0 };
      await zite.units.update({ id: before.id, record: Object.fromEntries(changed.map(k => [k, record[k]])) as never });
      const summary =
        changed.length === 1 && changed[0] === 'readiness' ? `set ${label} to ${f.readiness}` :
        changed.length === 1 && changed[0] === 'name' ? `renamed unit ${before.name} to ${f.name}` :
        changed.length === 1 && changed[0] === 'marketRent' ? `set market rent for ${label} to ${formatMoney(f.marketRent ?? 0, (await getSettings()).currency)}` :
        `updated ${label}`;
      await logActivity({ entityType: 'unit', entityId: before.id, action: 'updated', summary, propertyId: before.propertyId, unitId: before.id, data: { fields: changed }, ...who });
      return { ids: [before.id], created: 0 };
    }

    if (data.action === 'archive') {
      if (before.archived) return { ids: [before.id], created: 0 };
      const counts = (await liveLeaseCounts('unitId', [before.id])).get(before.id) ?? { active: 0, pending: 0 };
      if (counts.active || counts.pending) {
        throw new ZiteError(`${label} has ${counts.active ? 'an active lease' : 'a lease waiting for signature'}. End or cancel it before archiving the unit.`, 'CONFLICT');
      }
      await zite.units.update({ id: before.id, record: { archived: true } });
      await logActivity({ entityType: 'unit', entityId: before.id, action: 'archived', summary: `archived ${label}`, propertyId: before.propertyId, unitId: before.id, ...who });
      return { ids: [before.id], created: 0 };
    }

    if (!before.archived) return { ids: [before.id], created: 0 };
    await zite.units.update({ id: before.id, record: { archived: false } });
    await logActivity({ entityType: 'unit', entityId: before.id, action: 'unarchived', summary: `restored ${label}`, propertyId: before.propertyId, unitId: before.id, ...who });
    return { ids: [before.id], created: 0 };
  },
});
