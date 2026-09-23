import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, colorFor, getActor } from '@project/shared/server/actor';
import { refreshLeaseName } from '@project/shared/server/leases';
import { str, withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Create or edit a resident's record. Email is how a resident signs in to the
 * portal, so a second record with the same email is flagged (`checkEmail`) —
 * the dialog warns before it happens. Renaming someone renames their leases.
 */

const text = (max: number) => z.string().trim().max(max).optional();
const Record_ = z.object({
  name: z.string().trim().min(1, 'Enter the resident’s name.').max(120, 'Keep the name under 120 characters.'),
  email: z.string().trim().max(200).refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'That email address doesn’t look right.').optional(),
  phone: text(40),
  altPhone: text(40),
  company: text(120),
  emergencyContact: text(120),
  emergencyPhone: text(40),
  pets: text(500),
  vehicles: text(500),
  notes: text(5000),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), record: Record_ }),
  z.object({ action: z.literal('update'), id: z.string().min(1), record: Record_ }),
  z.object({ action: z.literal('checkEmail'), email: z.string().max(200), excludeId: z.string().optional() }),
]);

async function duplicates(email: string, excludeId?: string) {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Tenants" WHERE LOWER("email") = $1 AND id::text <> $2 AND COALESCE("archived", false) = false LIMIT 3`, params: [e, excludeId ?? ''] });
  return rows.map(r => ({ id: String(r.id), name: str(r.name) ?? 'Another resident' }));
}

export default createEndpoint({
  description: 'Create or update a resident, or check an email for duplicates',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const data = parseInput(Input, input);

    if (data.action === 'checkEmail') return { id: null, duplicates: await duplicates(data.email, data.excludeId) };

    const r = data.record;
    const record = {
      name: r.name,
      email: r.email ? r.email.toLowerCase() : null,
      phone: r.phone || null,
      altPhone: r.altPhone || null,
      company: r.company || null,
      emergencyContact: r.emergencyContact || null,
      emergencyPhone: r.emergencyPhone || null,
      pets: r.pets || null,
      vehicles: r.vehicles || null,
      notes: r.notes || null,
    };

    if (data.action === 'create') {
      const created = await withRetry(() => zite.tenants.create({ record: { ...record, color: colorFor(record.email || record.name), archived: false } }));
      await logActivity({ entityType: 'tenant', entityId: created.id, tenantId: created.id, action: 'created', summary: `added ${record.name} as a resident`, actorId: actor.id, actorName: actor.name });
      return { id: created.id, duplicates: await duplicates(record.email ?? '', created.id) };
    }

    const { rows } = await zite.sql({ query: `SELECT id, "name", "email" FROM "Tenants" WHERE id::text = $1`, params: [data.id] });
    const before = rows[0];
    if (!before) throw new ZiteError('That resident no longer exists.', 'NOT_FOUND');
    await withRetry(() => zite.tenants.update({ id: data.id, record }));
    const changed: string[] = [];
    if ((str(before.name) ?? '') !== record.name) changed.push('name');
    if ((str(before.email) ?? '').toLowerCase() !== (record.email ?? '')) changed.push('email');
    if (changed.includes('name')) {
      const { rows: leases } = await zite.sql({ query: `SELECT "leaseId" FROM "LeaseTenants" WHERE "tenantId" = $1`, params: [data.id] });
      for (const l of leases) await withRetry(() => refreshLeaseName(String(l.leaseId)));
    }
    await logActivity({ entityType: 'tenant', entityId: data.id, tenantId: data.id, action: 'updated', summary: changed.length ? `updated ${record.name}’s ${changed.join(' and ')}` : `updated ${record.name}’s details`, actorId: actor.id, actorName: actor.name });
    return { id: data.id, duplicates: await duplicates(record.email ?? '', data.id) };
  },
});
