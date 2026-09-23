import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PROPERTY_TYPES } from '@project/shared/constants';
import { isDay } from '@project/shared/dates';
import { round2 } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { logActivity } from '@project/shared/server/activity';
import { chunked } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { liveLeaseCounts, loadProperty, PROPERTY_CODE_RE } from '../server/portfolio';

/**
 * Create, edit, archive and restore a property.
 *
 * A new property can bring its units in the same call (the dialog's generator
 * previews "101–108" before saving); they're written in batches of 100. A
 * single-family home or condo always gets exactly one unit, so it can be
 * leased straight away. Archiving is refused while any lease is active or
 * waiting for signature — the rent roll and owner statements depend on it.
 */

const SINGLE_UNIT_TYPES = ['Single-family', 'Condo'];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour.');
const text = (max: number) => z.string().max(max, `Keep it under ${max} characters.`);

const Fields = z.object({
  name: z.string().trim().min(1, 'Give the property a name.').max(120, 'Keep the name under 120 characters.'),
  code: z.string().trim().transform(v => v.toUpperCase()).refine(v => PROPERTY_CODE_RE.test(v), { message: 'Use 1–10 letters, numbers or dashes for the short code.' }),
  propertyType: z.enum(PROPERTY_TYPES),
  street: text(200).default(''),
  city: text(100).default(''),
  state: text(40).default(''),
  postalCode: text(20).default(''),
  ownerId: z.string().nullable().default(null),
  managerId: z.string().nullable().default(null),
  bankAccountId: z.string().nullable().default(null),
  reserveAmount: z.number().min(0, 'The reserve can’t be negative.').max(100_000_000).default(0),
  managementFeePercent: z.number().min(0, 'Use a fee between 0 and 100%.').max(100, 'Use a fee between 0 and 100%.').nullable().default(null),
  yearBuilt: z.number().int().min(1600, 'Enter a four-digit year.').max(2200, 'Enter a four-digit year.').nullable().default(null),
  amenities: z.array(z.string().trim().min(1).max(60, 'Keep each amenity under 60 characters.')).max(40, 'Keep it to 40 amenities.').default([]),
  photoUrl: z.string().url().nullable().default(null),
  color: hex.default('#0d9488'),
  description: text(5000).default(''),
  petPolicy: text(300).default(''),
  parking: text(300).default(''),
  acquiredOn: z.string().nullable().default(null),
  notes: text(5000).default(''),
});

const NewUnit = z.object({
  name: z.string().trim().min(1, 'Every unit needs a name.').max(40, 'Keep unit names under 40 characters.'),
  beds: z.number().int().min(0).max(20).default(0),
  baths: z.number().min(0).max(20).default(1),
  squareFeet: z.number().int().min(0).max(1_000_000).nullable().default(null),
  marketRent: z.number().min(0).max(10_000_000).default(0),
  depositAmount: z.number().min(0).max(10_000_000).default(0),
  unitType: text(60).default(''),
  floor: text(20).default(''),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), fields: Fields, units: z.array(NewUnit).max(500, 'Add up to 500 units at a time.').default([]) }),
  z.object({ action: z.literal('update'), id: z.string().min(1), fields: Fields.partial() }),
  z.object({ action: z.literal('archive'), id: z.string().min(1) }),
  z.object({ action: z.literal('unarchive'), id: z.string().min(1) }),
]);

type FieldValues = Partial<z.infer<typeof Fields>>;

async function validate(fields: FieldValues, selfId: string | null) {
  if (fields.code !== undefined) {
    const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Properties" WHERE UPPER("code") = $1 AND id::text <> $2 LIMIT 1`, params: [fields.code, selfId ?? ''] });
    if (rows[0]) throw new ZiteError(`${rows[0].name} already uses the code ${fields.code}. Choose another.`, 'CONFLICT');
  }
  if (fields.ownerId) {
    const { rows } = await zite.sql({ query: `SELECT id FROM "Owners" WHERE id::text = $1 LIMIT 1`, params: [fields.ownerId] });
    if (!rows[0]) throw new ZiteError('That owner no longer exists. Choose another.', 'BAD_REQUEST');
  }
  if (fields.managerId) {
    const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE id::text = $1 AND COALESCE("status", '') <> 'Deactivated' LIMIT 1`, params: [fields.managerId] });
    if (!rows[0]) throw new ZiteError('That manager isn’t an active teammate. Choose another.', 'BAD_REQUEST');
  }
  if (fields.bankAccountId) {
    const chart = await getChart();
    const a = chart.byId.get(fields.bankAccountId);
    if (!a || a.subtype !== 'Bank' || !a.active) throw new ZiteError('Choose an active bank account for the property’s operating cash.', 'BAD_REQUEST');
  }
  if (fields.acquiredOn && !isDay(fields.acquiredOn)) throw new ZiteError('Choose a valid acquisition date.', 'BAD_REQUEST');
}

function toRecord(fields: FieldValues) {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (k === 'amenities') r[k] = JSON.stringify([...new Set(v as string[])]);
    else if (k === 'reserveAmount') r[k] = round2(v as number);
    else r[k] = v;
  }
  return r;
}

const FIELD_LABEL: Record<string, string> = {
  name: 'name', code: 'short code', propertyType: 'type', street: 'address', city: 'address', state: 'address', postalCode: 'address', ownerId: 'owner', managerId: 'manager',
  bankAccountId: 'operating account', reserveAmount: 'reserve', managementFeePercent: 'management fee', yearBuilt: 'year built', amenities: 'amenities', photoUrl: 'photo',
  color: 'colour', description: 'description', petPolicy: 'pet policy', parking: 'parking', acquiredOn: 'acquisition date', notes: 'notes',
};

export default createEndpoint({
  description: 'Create, update, archive or restore a property',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'portfolio.manage');
    const data = parseInput(Input, input);
    const who = { actorId: actor.id, actorName: actor.name };

    if (data.action === 'create') {
      const fields = data.fields;
      await validate(fields, null);
      const names = data.units.map(u => u.name.toLowerCase());
      const dupe = names.find((n, i) => names.indexOf(n) !== i);
      if (dupe) throw new ZiteError(`Two units are both named “${data.units[names.indexOf(dupe)].name}”. Unit names must be unique within a property.`, 'BAD_REQUEST');
      let units = data.units;
      if (SINGLE_UNIT_TYPES.includes(fields.propertyType)) {
        const one = units[0];
        units = [{ name: 'Main', beds: one?.beds ?? 0, baths: one?.baths ?? 1, squareFeet: one?.squareFeet ?? null, marketRent: one?.marketRent ?? 0, depositAmount: one?.depositAmount ?? 0, unitType: one?.unitType || (fields.propertyType === 'Condo' ? 'Condo' : 'Single-family home'), floor: one?.floor ?? '' }];
      }
      const created = await zite.properties.create({ record: { ...toRecord(fields), status: 'Active' } as never });
      await chunked(units, async batch => {
        await zite.units.bulkCreate({
          records: batch.map(u => ({
            name: u.name,
            propertyId: created.id,
            beds: u.beds,
            baths: u.baths,
            squareFeet: u.squareFeet,
            marketRent: round2(u.marketRent),
            depositAmount: round2(u.depositAmount),
            unitType: u.unitType || null,
            floor: u.floor || null,
            readiness: 'Ready',
            archived: false,
            features: '[]',
            photoUrls: '[]',
          })) as never,
        });
      });
      await logActivity({
        entityType: 'property',
        entityId: created.id,
        action: 'created',
        summary: units.length > 1 ? `added ${fields.name} with ${units.length} units` : `added ${fields.name}`,
        propertyId: created.id,
        ownerId: fields.ownerId,
        ...who,
      });
      return { id: created.id, unitsCreated: units.length };
    }

    const before = await loadProperty(data.id);
    if (!before) throw new ZiteError('That property doesn’t exist, or it was deleted.', 'NOT_FOUND');

    if (data.action === 'update') {
      const fields = data.fields;
      await validate(fields, before.id);
      const record = toRecord(fields);
      const changed = Object.keys(record).filter(k => {
        const prev = (before as Record<string, unknown>)[k];
        const next = k === 'amenities' ? JSON.parse(String(record[k])) : record[k];
        return JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null) && !(prev === '' && next == null);
      });
      if (!changed.length) return { id: before.id, changed: 0 };
      await zite.properties.update({ id: before.id, record: Object.fromEntries(changed.map(k => [k, record[k]])) as never });
      const labels = [...new Set(changed.map(k => FIELD_LABEL[k] ?? k))];
      const shown = labels.length > 3 ? [...labels.slice(0, 3), `${labels.length - 3} more`] : labels;
      const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
      let summary = `changed the ${list} of ${fields.name ?? before.name}`;
      if (changed.length === 1 && changed[0] === 'name') summary = `renamed ${before.name} to ${fields.name}`;
      if (changed.length === 1 && changed[0] === 'ownerId') {
        const { rows } = fields.ownerId ? await zite.sql({ query: `SELECT "name" FROM "Owners" WHERE id::text = $1`, params: [fields.ownerId] }) : { rows: [] };
        summary = rows[0] ? `changed the owner of ${before.name} to ${rows[0].name}` : `removed the owner of ${before.name}`;
      }
      await logActivity({ entityType: 'property', entityId: before.id, action: 'updated', summary, propertyId: before.id, ownerId: fields.ownerId ?? before.ownerId, data: { fields: changed }, ...who });
      return { id: before.id, changed: changed.length };
    }

    if (data.action === 'archive') {
      if (before.status === 'Archived') return { id: before.id, changed: 0 };
      const counts = (await liveLeaseCounts('propertyId', [before.id])).get(before.id) ?? { active: 0, pending: 0 };
      if (counts.active || counts.pending) {
        const parts = [counts.active ? `${counts.active} active ${counts.active === 1 ? 'lease' : 'leases'}` : '', counts.pending ? `${counts.pending} ${counts.pending === 1 ? 'lease' : 'leases'} waiting for signature` : ''].filter(Boolean);
        throw new ZiteError(`${before.name} can’t be archived while it has ${parts.join(' and ')}. End or cancel ${counts.active + counts.pending === 1 ? 'it' : 'them'} first.`, 'CONFLICT');
      }
      await zite.properties.update({ id: before.id, record: { status: 'Archived' } });
      await logActivity({ entityType: 'property', entityId: before.id, action: 'archived', summary: `archived ${before.name}`, propertyId: before.id, ownerId: before.ownerId, ...who });
      return { id: before.id, changed: 1 };
    }

    if (before.status !== 'Archived') return { id: before.id, changed: 0 };
    await zite.properties.update({ id: before.id, record: { status: 'Active' } });
    await logActivity({ entityType: 'property', entityId: before.id, action: 'unarchived', summary: `restored ${before.name} from the archive`, propertyId: before.id, ownerId: before.ownerId, ...who });
    return { id: before.id, changed: 1 };
  },
});
