import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { DISTRIBUTION_METHODS, OWNER_TYPES } from '@project/shared/constants';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logActivity } from '@project/shared/server/activity';
import { parseInput } from '../server/input';
import { loadOwner } from '../server/portfolio';

/**
 * Create, edit, archive and restore owners, and switch their portal access.
 *
 * An owner with an email and portal access can sign in to the owner portal
 * with that email. Two owners can't share an email — the portal would have
 * to guess whose statements to show. Archiving is refused while they still
 * own a property that isn't archived.
 */

const text = (max: number) => z.string().max(max, `Keep it under ${max} characters.`);

const Fields = z.object({
  name: z.string().trim().min(1, 'Give the owner a name.').max(120, 'Keep the name under 120 characters.'),
  ownerType: z.enum(OWNER_TYPES).default('Individual'),
  contactName: text(120).default(''),
  email: z.string().trim().max(200).refine(v => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), { message: 'Enter a valid email address, or leave it blank.' }).default(''),
  phone: text(40).default(''),
  mailingAddress: text(500).default(''),
  taxIdLast4: z.string().trim().refine(v => v === '' || /^\d{4}$/.test(v), { message: 'Enter just the last four digits of the tax ID.' }).default(''),
  managementFeePercent: z.number().min(0, 'Use a fee between 0 and 100%.').max(100, 'Use a fee between 0 and 100%.').nullable().default(null),
  distributionMethod: z.enum(DISTRIBUTION_METHODS).default('ACH'),
  portalEnabled: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour.').default('#64748b'),
  notes: text(5000).default(''),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), fields: Fields }),
  z.object({ action: z.literal('update'), id: z.string().min(1), fields: Fields.partial() }),
  z.object({ action: z.literal('archive'), id: z.string().min(1) }),
  z.object({ action: z.literal('unarchive'), id: z.string().min(1) }),
]);

type FieldValues = Partial<z.infer<typeof Fields>>;

/** `email`: the email after the change; `portal`: portal access after the change. */
async function validate(email: string, portal: boolean, selfId: string | null) {
  if (email) {
    const { rows } = await zite.sql({ query: `SELECT "name" FROM "Owners" WHERE LOWER("email") = $1 AND id::text <> $2 LIMIT 1`, params: [email.toLowerCase(), selfId ?? ''] });
    if (rows[0]) throw new ZiteError(`${rows[0].name} already uses ${email}. Each owner needs their own email to sign in to the portal.`, 'CONFLICT');
  }
  if (portal && !email) throw new ZiteError('Add an email address before turning on portal access — it’s how they sign in.', 'BAD_REQUEST');
}

const LABEL: Record<string, string> = {
  name: 'name', ownerType: 'type', contactName: 'contact', email: 'email', phone: 'phone', mailingAddress: 'mailing address', taxIdLast4: 'tax ID',
  managementFeePercent: 'management fee', distributionMethod: 'distribution method', portalEnabled: 'portal access', color: 'colour', notes: 'notes',
};

export default createEndpoint({
  description: 'Create, update, archive or restore an owner',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'owners.manage');
    const data = parseInput(Input, input);
    const who = { actorId: actor.id, actorName: actor.name };

    if (data.action === 'create') {
      const f = data.fields;
      await validate(f.email, f.portalEnabled, null);
      const created = await zite.owners.create({ record: { ...f, email: f.email.toLowerCase(), status: 'Active' } as never });
      await logActivity({ entityType: 'owner', entityId: created.id, action: 'created', summary: `added owner ${f.name}`, ownerId: created.id, ...who });
      return { id: created.id, changed: 1 };
    }

    const before = await loadOwner(data.id);
    if (!before) throw new ZiteError('That owner doesn’t exist, or they were deleted.', 'NOT_FOUND');

    if (data.action === 'update') {
      const f = { ...data.fields };
      if (f.email !== undefined) f.email = f.email.toLowerCase();
      await validate(f.email ?? before.email, f.portalEnabled ?? before.portalEnabled, before.id);
      const changed = (Object.keys(f) as Array<keyof FieldValues>).filter(k => f[k] !== undefined && JSON.stringify(f[k] ?? null) !== JSON.stringify((before as Record<string, unknown>)[k] ?? null));
      if (!changed.length) return { id: before.id, changed: 0 };
      await zite.owners.update({ id: before.id, record: Object.fromEntries(changed.map(k => [k, f[k]])) as never });
      const summary =
        changed.length === 1 && changed[0] === 'portalEnabled' ? (f.portalEnabled ? `turned on owner portal access for ${before.name}` : `turned off owner portal access for ${before.name}`) :
        changed.length === 1 && changed[0] === 'managementFeePercent' ? (f.managementFeePercent == null ? `set ${before.name} back to the default management fee` : `set ${before.name}’s management fee to ${f.managementFeePercent}%`) :
        `updated ${[...new Set(changed.map(k => LABEL[k] ?? k))].slice(0, 3).join(', ')} for ${f.name ?? before.name}`;
      await logActivity({ entityType: 'owner', entityId: before.id, action: 'updated', summary, ownerId: before.id, data: { fields: changed }, ...who });
      return { id: before.id, changed: changed.length };
    }

    if (data.action === 'archive') {
      if (before.status === 'Archived') return { id: before.id, changed: 0 };
      const { rows } = await zite.sql({ query: `SELECT "name" FROM "Properties" WHERE "ownerId" = $1 AND COALESCE("status", 'Active') <> 'Archived' ORDER BY "name" LIMIT 4`, params: [before.id] });
      if (rows.length) {
        const names = rows.slice(0, 3).map(r => String(r.name));
        throw new ZiteError(`${before.name} still owns ${names.join(', ')}${rows.length > 3 ? ' and more' : ''}. Change the owner or archive ${rows.length === 1 ? 'that property' : 'those properties'} first.`, 'CONFLICT');
      }
      await zite.owners.update({ id: before.id, record: { status: 'Archived', portalEnabled: false } });
      await logActivity({ entityType: 'owner', entityId: before.id, action: 'archived', summary: `archived owner ${before.name}`, ownerId: before.id, ...who });
      return { id: before.id, changed: 1 };
    }

    if (before.status !== 'Archived') return { id: before.id, changed: 0 };
    await zite.owners.update({ id: before.id, record: { status: 'Active' } });
    await logActivity({ entityType: 'owner', entityId: before.id, action: 'unarchived', summary: `restored owner ${before.name}`, ownerId: before.id, ...who });
    return { id: before.id, changed: 1 };
  },
});
