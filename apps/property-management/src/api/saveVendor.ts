import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { VENDOR_TRADES } from '@project/shared/constants';
import { addDays, formatDay, isDay, todayIn } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { getChart } from '@project/shared/server/accounts';
import { assertCan, can, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { EMAIL_RE, loadVendor } from '../server/maintenance';

/**
 * Create a vendor, change its details, deactivate or reactivate it, or file a
 * certificate of insurance. Staff are the ones who verify paperwork, so
 * uploading a certificate here also sets the vendor's insurance expiration.
 */

const day = z.string().refine(isDay, 'Choose a valid date.');
const Fields = z.object({
  name: z.string().trim().min(1, 'Give the vendor a name.').max(200, 'Keep the name under 200 characters.'),
  trade: z.enum(VENDOR_TRADES),
  contactName: z.string().trim().max(200, 'Keep the contact name under 200 characters.'),
  email: z.string().trim().max(200).refine(v => !v || EMAIL_RE.test(v), 'Enter a valid email address.'),
  phone: z.string().trim().max(40, 'Keep the phone number under 40 characters.'),
  address: z.string().trim().max(1000),
  taxIdLast4: z.string().trim().refine(v => /^(\d{4})?$/.test(v), 'Enter the last four digits of the tax ID.'),
  licenseNumber: z.string().trim().max(80, 'Keep the license number under 80 characters.'),
  is1099: z.boolean(),
  w9OnFile: z.boolean(),
  insuranceExpiresOn: day.nullable(),
  hourlyRate: z.number().min(0, 'The hourly rate can’t be negative.').max(100_000).nullable(),
  rating: z.number().min(0).max(5, 'Ratings go up to 5.').nullable(),
  portalEnabled: z.boolean(),
  defaultAccountId: z.string().nullable(),
  paymentTermsDays: z.number().int('Payment terms are whole days.').min(0).max(365, 'Payment terms can be at most 365 days.').nullable(),
  color: z.string().refine(v => /^#[0-9a-f]{6}$/i.test(v), 'Choose a colour.'),
  notes: z.string().max(10000),
});

const File = z.object({ url: z.string().url('The upload didn’t finish. Try again.'), name: z.string().min(1).max(200), size: z.number().nullish(), type: z.string().max(120).nullish() });

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), vendor: Fields.partial().extend({ name: Fields.shape.name, trade: Fields.shape.trade }) }),
  z.object({ action: z.literal('update'), id: z.string().min(1), patch: Fields.partial() }),
  z.object({ action: z.literal('status'), id: z.string().min(1), status: z.enum(['Active', 'Inactive']) }),
  z.object({ action: z.literal('certificate'), id: z.string().min(1), expiresOn: day, file: File }),
]);

type Patch = Partial<z.infer<typeof Fields>>;

async function validate(patch: Patch, current: { id?: string; email: string; portalEnabled: boolean; name: string }) {
  if (patch.defaultAccountId) {
    const chart = await getChart();
    const account = chart.byId.get(patch.defaultAccountId);
    if (!account || account.accountType !== 'Expense') throw new ZiteError('Choose an expense account for the vendor’s bills.', 'BAD_REQUEST');
  }
  const email = (patch.email ?? current.email).trim();
  const portal = patch.portalEnabled ?? current.portalEnabled;
  if (portal && !email) throw new ZiteError('Add an email address before turning on portal access — vendors sign in with it.', 'BAD_REQUEST');
  if (portal && email) {
    // The portal signs a vendor in by email; two vendors sharing one would show someone the wrong company's work.
    const { rows } = await zite.sql({
      query: `SELECT "name" FROM "Vendors" WHERE LOWER("email") = LOWER($1) AND id::text <> $2 AND COALESCE("portalEnabled", false) = true AND COALESCE("status", 'Active') = 'Active' LIMIT 1`,
      params: [email, current.id ?? ''],
    });
    if (rows[0]) throw new ZiteError(`${String(rows[0].name)} already uses ${email} to sign in to the vendor portal. Use a different email.`, 'CONFLICT');
  }
}

export default createEndpoint({
  description: 'Create, update, deactivate or file insurance for a vendor',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'vendors.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const canSeeMoney = can(actor.role, 'accounting.view');

    if (data.action === 'create') {
      const v = data.vendor;
      await validate(v, { email: v.email ?? '', portalEnabled: Boolean(v.portalEnabled), name: v.name });
      const { rows: dupe } = await zite.sql({ query: `SELECT id FROM "Vendors" WHERE LOWER("name") = LOWER($1) LIMIT 1`, params: [v.name] });
      if (dupe[0]) throw new ZiteError(`There’s already a vendor called ${v.name}.`, 'CONFLICT');
      const created = await zite.vendors.create({
        record: {
          name: v.name,
          trade: v.trade,
          contactName: v.contactName || null,
          email: v.email || null,
          phone: v.phone || null,
          address: v.address || null,
          taxIdLast4: v.taxIdLast4 || null,
          licenseNumber: v.licenseNumber || null,
          is1099: Boolean(v.is1099),
          w9OnFile: Boolean(v.w9OnFile),
          insuranceExpiresOn: v.insuranceExpiresOn ?? null,
          hourlyRate: v.hourlyRate ?? null,
          rating: v.rating ?? null,
          status: 'Active',
          portalEnabled: Boolean(v.portalEnabled),
          defaultAccountId: v.defaultAccountId || null,
          paymentTermsDays: v.paymentTermsDays ?? 30,
          color: v.color || '#64748b',
          notes: v.notes || null,
        },
      });
      await logActivity({ entityType: 'vendor', entityId: created.id, vendorId: created.id, action: 'created', summary: `added ${v.name} as a vendor`, actorId: actor.id, actorName: actor.name });
      return { id: created.id };
    }

    const before = await loadVendor(data.id, today, canSeeMoney);
    const log = (summary: string, action = 'updated', extra: Record<string, unknown> = {}) =>
      logActivity({ entityType: 'vendor', entityId: before.id, vendorId: before.id, action, summary, actorId: actor.id, actorName: actor.name, data: extra });

    if (data.action === 'status') {
      if (data.status === before.status) return { id: before.id };
      if (data.status === 'Active') await validate({}, before);
      await zite.vendors.update({ id: before.id, record: { status: data.status } });
      await log(data.status === 'Inactive' ? 'deactivated the vendor' : 'reactivated the vendor', 'status_changed', { from: before.status, to: data.status });
      return { id: before.id };
    }

    if (data.action === 'certificate') {
      if (data.expiresOn < today) throw new ZiteError('That certificate has already expired. Upload the current one.', 'BAD_REQUEST');
      if (data.expiresOn > addDays(today, 366 * 3)) throw new ZiteError('Check the expiration date — it’s more than three years away.', 'BAD_REQUEST');
      const ext = /\.[a-z0-9]{2,5}$/i.exec(data.file.name)?.[0] ?? '';
      const doc = await zite.documents.create({
        record: {
          name: `Certificate of insurance — ${before.name}${ext}`.slice(0, 240),
          url: data.file.url,
          category: 'Insurance',
          vendorId: before.id,
          expiresOn: data.expiresOn,
          size: data.file.size ?? null,
          mimeType: data.file.type ?? null,
          uploadedById: actor.id,
          uploadedByName: actor.name,
          uploadedAt: new Date().toISOString(),
          sharedWithTenant: false,
          sharedWithOwner: false,
        },
      });
      await zite.vendors.update({ id: before.id, record: { insuranceExpiresOn: data.expiresOn } });
      await log(`filed a certificate of insurance that expires ${formatDay(data.expiresOn)}`, 'document_added', { documentId: doc.id, expiresOn: data.expiresOn });
      return { id: before.id };
    }

    const patch = data.patch;
    await validate(patch, before);
    if (patch.name && patch.name.toLowerCase() !== before.name.toLowerCase()) {
      const { rows: dupe } = await zite.sql({ query: `SELECT id FROM "Vendors" WHERE LOWER("name") = LOWER($1) AND id::text <> $2 LIMIT 1`, params: [patch.name, before.id] });
      if (dupe[0]) throw new ZiteError(`There’s already a vendor called ${patch.name}.`, 'CONFLICT');
    }
    const record: Record<string, unknown> = {};
    const changed = <K extends keyof Patch>(k: K) => {
      const next = patch[k];
      if (next === undefined) return false;
      const prev = (before as unknown as Record<string, unknown>)[k];
      if (JSON.stringify(prev ?? null) === JSON.stringify(next === '' ? (typeof prev === 'string' ? '' : null) : next)) return false;
      record[k] = next === '' ? null : next;
      return true;
    };
    const summaries: string[] = [];
    if (changed('name')) summaries.push(`renamed the vendor to ${patch.name}`);
    if (changed('trade')) summaries.push(`set the trade to ${patch.trade}`);
    const contact = [changed('contactName'), changed('email'), changed('phone'), changed('address')].some(Boolean);
    if (contact) summaries.push('updated contact details');
    if (changed('insuranceExpiresOn')) summaries.push(patch.insuranceExpiresOn ? `set insurance to expire ${formatDay(patch.insuranceExpiresOn)}` : 'cleared the insurance expiration');
    if (changed('w9OnFile')) summaries.push(patch.w9OnFile ? 'marked the W-9 as on file' : 'marked the W-9 as missing');
    if (changed('is1099')) summaries.push(patch.is1099 ? 'marked the vendor as a 1099 vendor' : 'marked the vendor as not needing a 1099');
    if (changed('portalEnabled')) summaries.push(patch.portalEnabled ? 'turned on vendor portal access' : 'turned off vendor portal access');
    if (changed('paymentTermsDays')) summaries.push(patch.paymentTermsDays != null ? `set payment terms to net ${patch.paymentTermsDays}` : 'cleared the payment terms');
    if (changed('defaultAccountId')) summaries.push('changed the default expense account');
    if (changed('rating')) summaries.push(patch.rating != null ? `rated the vendor ${patch.rating} out of 5` : 'cleared the rating');
    const other = [changed('taxIdLast4'), changed('licenseNumber'), changed('hourlyRate'), changed('color'), changed('notes')].some(Boolean);
    if (other && !summaries.length) summaries.push('updated the vendor’s details');
    if (!Object.keys(record).length) return { id: before.id };
    await zite.vendors.update({ id: before.id, record: record as never });
    await logActivity(summaries.map(summary => ({ entityType: 'vendor' as const, entityId: before.id, vendorId: before.id, action: 'updated', summary, actorId: actor.id, actorName: actor.name })));
    return { id: before.id };
  },
});
