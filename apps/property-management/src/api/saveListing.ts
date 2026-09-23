import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { LISTING_STATUSES, PET_POLICIES } from '@project/shared/constants';
import { formatDay, todayIn } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { json, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { listingDescriptionTemplate, listingTitleTemplate, SLUG_RE } from '../components/leasing/rules';
import { parseInput } from '../server/input';
import { loadListingRecord, photosOf, stringsOf, uniqueSlug } from '../server/leasing';

/**
 * Create a listing from a unit, edit it field by field, and move it through
 * Draft → Published ⇄ Paused → Leased. The link (slug) is unique across all
 * listings. Publishing checks the listing is complete enough for the public
 * homes page, and that the unit isn't already advertised by another listing.
 */

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.');
const money = z.number().min(0, 'Amounts can’t be negative.').max(1_000_000, 'That amount is too large.');
const Photo = z.object({ url: z.string().url('A photo link isn’t valid.').max(2000), name: z.string().max(200) });

const Patch = z.object({
  title: z.string().trim().min(3, 'Give the listing a title.').max(120, 'Keep the title under 120 characters.'),
  slug: z.string().trim().max(80, 'Keep the link under 80 characters.'),
  description: z.string().max(8000, 'Keep the description under 8,000 characters.'),
  photos: z.array(Photo).max(40, 'A listing can have up to 40 photos.'),
  amenities: z.array(z.string().trim().min(1).max(60)).max(40, 'A listing can have up to 40 features.'),
  rent: money.nullable(),
  deposit: money.nullable(),
  availableOn: dayStr.nullable(),
  leaseTerm: z.string().max(60),
  petPolicy: z.enum(PET_POLICIES).nullable(),
  applicationFee: money.nullable(),
  showingInstructions: z.string().max(1000),
  contactMemberId: z.string().nullable(),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), unitId: z.string().min(1, 'Choose the unit to list.'), fields: Patch.partial().default({}) }),
  z.object({ action: z.literal('update'), id: z.string().min(1), patch: Patch.partial() }),
  z.object({ action: z.literal('status'), id: z.string().min(1), status: z.enum(LISTING_STATUSES) }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

function publishProblems(r: Record<string, unknown>) {
  const problems: string[] = [];
  if ((str(r.title) ?? '').trim().length < 3) problems.push('a title');
  if (!(num(r.rent) > 0)) problems.push('the rent');
  if (!ref(r.unitId)) problems.push('a unit');
  if ((str(r.description) ?? '').trim().length < 40) problems.push('a description (a few sentences)');
  return problems;
}

export default createEndpoint({
  description: 'Create, edit, publish, pause or remove a rental listing',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const now = new Date().toISOString();
    const log = (entityId: string, summary: string, action: string, r: Record<string, unknown>, extra?: Record<string, unknown>) =>
      logActivity({ entityType: 'listing', entityId, action, summary, actorId: actor.id, actorName: actor.name, propertyId: ref(r.propertyId), unitId: ref(r.unitId), data: extra });

    if (data.action === 'create') {
      const { rows } = await zite.sql({
        query: `SELECT u.*, p."name" AS "propertyName", p."propertyType", p."city", p."amenities" AS "buildingAmenities", p."parking", p."status" AS "propertyStatus"
                FROM "Units" u JOIN "Properties" p ON p.id::text = u."propertyId" WHERE u.id::text = $1`,
        params: [data.unitId],
      });
      const u = rows[0];
      if (!u) throw new ZiteError('That unit no longer exists.', 'BAD_REQUEST');
      if (u.archived === true || u.propertyStatus === 'Archived') throw new ZiteError('That unit is archived. Restore it before listing it.', 'CONFLICT');
      const f = data.fields;
      const amenities = f.amenities ?? [...new Set([...stringsOf(u.features), ...stringsOf(u.buildingAmenities)])].slice(0, 12);
      const facts = {
        propertyName: str(u.propertyName) ?? '',
        unitName: str(u.name) ?? '',
        propertyType: str(u.propertyType) ?? '',
        city: str(u.city) ?? '',
        beds: numOrNull(u.beds),
        baths: numOrNull(u.baths),
        squareFeet: numOrNull(u.squareFeet),
        amenities,
        petPolicy: f.petPolicy ?? '',
        leaseTerm: f.leaseTerm ?? '12 months',
        availableOn: f.availableOn ?? (String(u.availableOn ?? '').slice(0, 10) || null),
        parking: str(u.parking) ?? '',
      };
      const title = f.title?.trim() || listingTitleTemplate(facts);
      const slug = await uniqueSlug(f.slug?.trim() || title, null);
      const unitPhotos = json<unknown[]>(u.photoUrls, []);
      const created = await zite.listings.create({
        record: {
          title,
          slug,
          propertyId: String(u.propertyId),
          unitId: String(u.id),
          status: 'Draft',
          rent: f.rent ?? numOrNull(u.marketRent),
          deposit: f.deposit ?? numOrNull(u.depositAmount),
          availableOn: facts.availableOn,
          description: f.description?.trim() || listingDescriptionTemplate(facts, today),
          photos: JSON.stringify(f.photos ?? photosOf(JSON.stringify(unitPhotos))),
          amenities: JSON.stringify(amenities),
          leaseTerm: facts.leaseTerm,
          petPolicy: f.petPolicy ?? null,
          applicationFee: f.applicationFee ?? settings.applicationFee,
          showingInstructions: f.showingInstructions ?? null,
          contactMemberId: f.contactMemberId ?? actor.id,
          views: 0,
        },
      });
      await log(created.id, `created the listing “${title}”`, 'created', u);
      return { id: created.id, slug, status: 'Draft' };
    }

    const r = await loadListingRecord(data.id);
    const status = str(r.status) || 'Draft';

    if (data.action === 'delete') {
      if (status !== 'Draft') throw new ZiteError('Only draft listings can be deleted. Pause or mark it leased instead, so its history stays.', 'CONFLICT');
      if (num(r.applicationCount) > 0) throw new ZiteError('This listing has applications, so it can’t be deleted.', 'CONFLICT');
      await zite.listings.delete({ id: data.id });
      await log(data.id, `deleted the draft listing “${str(r.title) ?? ''}”`, 'deleted', r);
      return { id: data.id, slug: str(r.slug) ?? '', status: 'Deleted' };
    }

    if (data.action === 'status') {
      const next = data.status;
      if (next === status) return { id: data.id, slug: str(r.slug) ?? '', status };
      const record: Record<string, unknown> = { status: next };
      if (next === 'Published') {
        const problems = publishProblems(r);
        if (problems.length) throw new ZiteError(`Add ${problems.join(', ').replace(/, ([^,]*)$/, ' and $1')} before publishing.`, 'BAD_REQUEST');
        if (!SLUG_RE.test(str(r.slug) ?? '')) record.slug = await uniqueSlug(str(r.title) ?? 'home', data.id);
        const { rows: live } = await zite.sql({ query: `SELECT "title" FROM "Listings" WHERE "unitId" = $1 AND id::text <> $2 AND "status" = 'Published' LIMIT 1`, params: [ref(r.unitId) ?? '', data.id] });
        if (live[0]) throw new ZiteError(`“${str(live[0].title)}” already advertises this unit. Pause it first so applicants don’t see two listings.`, 'CONFLICT');
        if (!r.publishedAt || status === 'Leased' || status === 'Draft') record.publishedAt = now;
      }
      await zite.listings.update({ id: data.id, record: record as never });
      const verb = next === 'Published' ? (status === 'Paused' ? 'resumed the listing' : 'published the listing') : next === 'Paused' ? 'paused the listing' : next === 'Leased' ? 'marked the listing leased' : 'moved the listing back to draft';
      await log(data.id, verb, 'status_changed', r, { from: status, to: next });
      return { id: data.id, slug: String(record.slug ?? r.slug ?? ''), status: next };
    }

    // update
    const patch = data.patch;
    const record: Record<string, unknown> = {};
    const summaries: string[] = [];
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (patch.title !== undefined && patch.title !== str(r.title)) {
      record.title = patch.title;
      summaries.push('renamed the listing');
    }
    if (patch.slug !== undefined) {
      const wanted = patch.slug.trim().toLowerCase();
      if (wanted !== (str(r.slug) ?? '')) {
        if (!wanted) throw new ZiteError('The link can’t be empty.', 'BAD_REQUEST');
        if (!SLUG_RE.test(wanted)) throw new ZiteError('Use lowercase letters, numbers and dashes for the link.', 'BAD_REQUEST');
        const unique = await uniqueSlug(wanted, data.id);
        if (unique !== wanted) throw new ZiteError(`Another listing already uses “${wanted}”. Try “${unique}”.`, 'CONFLICT');
        record.slug = unique;
        summaries.push(status === 'Published' ? 'changed the public link (the old link stops working)' : 'changed the link');
      }
    }
    if (patch.description !== undefined && patch.description !== (str(r.description) ?? '')) {
      record.description = patch.description;
      summaries.push('updated the description');
    }
    if (patch.photos !== undefined && !same(patch.photos, photosOf(r.photos))) {
      record.photos = JSON.stringify(patch.photos);
      summaries.push('updated photos');
    }
    if (patch.amenities !== undefined && !same([...new Set(patch.amenities)], stringsOf(r.amenities))) {
      record.amenities = JSON.stringify([...new Set(patch.amenities)]);
      summaries.push('updated features');
    }
    const moneyField = (key: 'rent' | 'deposit' | 'applicationFee', label: string) => {
      const v = patch[key];
      if (v === undefined || same(v, numOrNull(r[key]))) return;
      if (key === 'rent' && status === 'Published' && !(v && v > 0)) throw new ZiteError('A published listing needs a rent. Pause it first to clear the rent.', 'BAD_REQUEST');
      record[key] = v;
      summaries.push(v == null ? `cleared the ${label}` : `set the ${label} to ${formatMoney(v, settings.currency)}`);
    };
    moneyField('rent', 'rent');
    moneyField('deposit', 'deposit');
    moneyField('applicationFee', 'application fee');
    if (patch.availableOn !== undefined && patch.availableOn !== (String(r.availableOn ?? '').slice(0, 10) || null)) {
      record.availableOn = patch.availableOn;
      summaries.push(patch.availableOn ? `set availability to ${formatDay(patch.availableOn)}` : 'cleared the available date');
    }
    if (patch.leaseTerm !== undefined && patch.leaseTerm.trim() !== (str(r.leaseTerm) ?? '')) {
      record.leaseTerm = patch.leaseTerm.trim();
      summaries.push(`set the lease term to ${patch.leaseTerm.trim() || 'blank'}`);
    }
    if (patch.petPolicy !== undefined && (patch.petPolicy ?? '') !== (str(r.petPolicy) ?? '')) {
      record.petPolicy = patch.petPolicy;
      summaries.push(`set the pet policy to ${patch.petPolicy ?? 'unspecified'}`);
    }
    if (patch.showingInstructions !== undefined && patch.showingInstructions !== (str(r.showingInstructions) ?? '')) {
      record.showingInstructions = patch.showingInstructions;
      summaries.push('updated showing instructions');
    }
    if (patch.contactMemberId !== undefined && patch.contactMemberId !== ref(r.contactMemberId)) {
      if (patch.contactMemberId) {
        const { rows } = await zite.sql({ query: `SELECT "status" FROM "Members" WHERE id::text = $1`, params: [patch.contactMemberId] });
        if (!rows[0] || rows[0].status === 'Deactivated') throw new ZiteError('That teammate isn’t active anymore.', 'BAD_REQUEST');
      }
      record.contactMemberId = patch.contactMemberId;
      summaries.push('changed the leasing contact');
    }
    if (status === 'Published' && record.description !== undefined && String(record.description).trim().length < 40) {
      throw new ZiteError('A published listing needs a description of at least a few sentences.', 'BAD_REQUEST');
    }
    if (!Object.keys(record).length) return { id: data.id, slug: str(r.slug) ?? '', status };
    await zite.listings.update({ id: data.id, record: record as never });
    if (summaries.length) {
      await logActivity(summaries.map((summary, i) => ({ occurredAt: new Date(Date.parse(now) + i).toISOString(), entityType: 'listing' as const, entityId: data.id, action: 'updated', summary, actorId: actor.id, actorName: actor.name, propertyId: ref(r.propertyId), unitId: ref(r.unitId) })));
    }
    return { id: data.id, slug: String(record.slug ?? r.slug ?? ''), status };
  },
});
