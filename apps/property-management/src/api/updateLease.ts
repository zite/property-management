import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { LEASE_TENANT_ROLES, LEASE_TYPES } from '@project/shared/constants';
import { addPeriods, formatDay, isDay, periodOf, periodStart } from '@project/shared/dates';
import { ordinal } from '@project/shared/merge';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { overlappingLeases, refreshLeaseName, upsertTenant } from '@project/shared/server/leases';
import { getSettings } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { leasePeople, loadStaffLease } from '../server/leaseStaff';

/**
 * Edit a lease in place. Anything can change on a draft; once it's out for
 * signature or active, the terms residents agreed to are fixed (renewals and
 * recurring charges change them instead) and only the office's own settings
 * move: rent due day, late-fee exemption, notes and who's on the lease.
 */

const dayStr = z.string().refine(isDay, 'Choose a valid date.');

const Patch = z.object({
  lateFeeExempt: z.boolean().optional(),
  rentDueDay: z.number().int().min(1, 'Rent is due between the 1st and the 28th.').max(28, 'Rent is due between the 1st and the 28th.').optional(),
  notes: z.string().max(5000).optional(),
  // Draft only:
  leaseType: z.enum(LEASE_TYPES).optional(),
  startDate: dayStr.optional(),
  endDate: dayStr.nullable().optional(),
  rent: z.number().positive('Enter the monthly rent.').max(1_000_000).optional(),
  deposit: z.number().min(0).max(1_000_000).optional(),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('patch'), leaseId: z.string().min(1), patch: Patch }),
  z.object({ action: z.literal('addPerson'), leaseId: z.string().min(1), tenantId: z.string().nullish(), name: z.string().trim().max(120).optional(), email: z.string().trim().max(200).optional(), phone: z.string().trim().max(40).optional(), role: z.enum(LEASE_TENANT_ROLES) }),
  z.object({ action: z.literal('setRole'), leaseId: z.string().min(1), tenantId: z.string().min(1), role: z.enum(LEASE_TENANT_ROLES) }),
  z.object({ action: z.literal('removePerson'), leaseId: z.string().min(1), tenantId: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Edit a lease’s settings, draft terms, or the people on it',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const lease = await loadStaffLease(data.leaseId);
    if (lease.status === 'Ended' || lease.status === 'Canceled') throw new ZiteError(`This lease is ${lease.status.toLowerCase()} and can’t be edited.`, 'BAD_REQUEST');
    const base = { entityType: 'lease' as const, entityId: lease.id, leaseId: lease.id, propertyId: lease.propertyId || null, unitId: lease.unitId || null, actorId: actor.id, actorName: actor.name };
    const money = (n: number) => formatMoney(n, settings.currency);

    if (data.action === 'patch') {
      const p = data.patch;
      const draftOnly = (['leaseType', 'startDate', 'endDate', 'rent', 'deposit'] as const).filter(k => p[k] !== undefined);
      if (draftOnly.length && lease.status !== 'Draft') throw new ZiteError('The terms are fixed once a lease is sent for signature. Offer a renewal or change a recurring charge instead.', 'BAD_REQUEST');
      const record: Record<string, unknown> = {};
      const summaries: string[] = [];
      if (p.lateFeeExempt !== undefined && p.lateFeeExempt !== lease.lateFeeExempt) {
        record.lateFeeExempt = p.lateFeeExempt;
        summaries.push(p.lateFeeExempt ? 'exempted the lease from late fees' : 'turned late fees back on');
      }
      if (p.notes !== undefined && p.notes !== lease.notes) record.notes = p.notes || null;
      if (p.rentDueDay !== undefined && p.rentDueDay !== lease.rentDueDay) {
        record.rentDueDay = p.rentDueDay;
        summaries.push(`moved the rent due day to the ${ordinal(p.rentDueDay)}`);
      }
      const next = { leaseType: p.leaseType ?? lease.leaseType, startDate: p.startDate ?? lease.startDate, endDate: p.endDate !== undefined ? p.endDate : lease.endDate, rent: p.rent ?? lease.rent, deposit: p.deposit ?? lease.deposit };
      if (draftOnly.length) {
        if (next.leaseType === 'Month-to-month') next.endDate = null;
        if (next.leaseType === 'Fixed term' && !next.endDate) throw new ZiteError('A fixed-term lease needs an end date.', 'BAD_REQUEST');
        if (next.startDate && next.endDate && next.endDate < next.startDate) throw new ZiteError('The lease can’t end before it starts.', 'BAD_REQUEST');
        if (next.startDate !== lease.startDate || next.endDate !== lease.endDate) {
          const conflicts = await overlappingLeases(lease.unitId, next.startDate ?? '', next.endDate, [lease.id]);
          if (conflicts.length) throw new ZiteError(`${conflicts[0].name || 'Another lease'} already covers those dates for this unit.`, 'CONFLICT');
        }
        Object.assign(record, { leaseType: next.leaseType, startDate: next.startDate, moveInDate: next.startDate, endDate: next.endDate, rent: next.rent, deposit: next.deposit });
        summaries.push(`updated the draft terms — ${money(next.rent)}/mo from ${formatDay(next.startDate)}${next.endDate ? ` to ${formatDay(next.endDate)}` : ', month-to-month'}`);
      }
      if (!Object.keys(record).length) return { ok: true, message: 'Nothing changed' };
      await withRetry(() => zite.leases.update({ id: lease.id, record: record as never }));

      // Keep what bills in step: a draft's rent charge follows its terms; a new due day moves every active charge.
      const { rows: rcs } = await zite.sql({ query: `SELECT id, "accountId", "description", "startDate" FROM "RecurringCharges" WHERE "leaseId" = $1 AND COALESCE("active", false) = true`, params: [lease.id] });
      if (draftOnly.length && next.startDate) {
        const chart = await getChart();
        const firstFull = Number(next.startDate.slice(8, 10)) === 1 ? next.startDate : periodStart(addPeriods(periodOf(next.startDate), 1));
        for (const rc of rcs) {
          const isRent = String(rc.accountId) === chart.key('rent_income').id && /^rent$/i.test(String(rc.description ?? ''));
          await withRetry(() => zite.recurringCharges.update({ id: String(rc.id), record: { startDate: firstFull, ...(isRent ? { amount: next.rent } : {}) } }));
        }
      }
      if (record.rentDueDay !== undefined) for (const rc of rcs) await withRetry(() => zite.recurringCharges.update({ id: String(rc.id), record: { dayOfMonth: p.rentDueDay } }));
      if (summaries.length) await logActivity(summaries.map(summary => ({ ...base, action: 'updated', summary })));
      return { ok: true, message: 'Lease updated' };
    }

    const people = await leasePeople(lease.id);
    const signing = lease.status === 'Pending signature';

    if (data.action === 'addPerson') {
      if (!data.tenantId && !data.name?.trim()) throw new ZiteError('Enter the person’s name.', 'BAD_REQUEST');
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) throw new ZiteError('That email address doesn’t look right.', 'BAD_REQUEST');
      const tenantId = data.tenantId || (await withRetry(() => upsertTenant({ name: data.name, email: data.email, phone: data.phone })));
      if (people.some(p => p.id === tenantId)) throw new ZiteError('That person is already on this lease.', 'CONFLICT');
      if (data.role === 'Primary' && people.some(p => p.role === 'Primary')) throw new ZiteError('This lease already has a primary resident. Add them as a co-tenant, or change roles first.', 'BAD_REQUEST');
      await withRetry(() => zite.leaseTenants.create({ record: { leaseId: lease.id, tenantId, role: data.role } }));
      await refreshLeaseName(lease.id);
      const { rows } = await zite.sql({ query: `SELECT "name" FROM "Tenants" WHERE id::text = $1`, params: [tenantId] });
      const name = String(rows[0]?.name ?? 'someone');
      await logActivity({ ...base, tenantId, action: 'person_added', summary: `added ${name} as ${data.role === 'Occupant' ? 'an occupant' : data.role === 'Guarantor' ? 'a guarantor' : data.role === 'Primary' ? 'the primary resident' : 'a co-tenant'}` });
      return { ok: true, message: signing && (data.role === 'Primary' || data.role === 'Co-tenant') ? `${name} added — send the signature request again so they can sign` : `${name} added` };
    }

    const person = people.find(p => p.id === data.tenantId);
    if (!person) throw new ZiteError('That person isn’t on this lease.', 'NOT_FOUND');

    if (data.action === 'setRole') {
      if (person.role === data.role) return { ok: true, message: 'Nothing changed' };
      if (person.role === 'Primary' && !people.some(p => p.id !== person.id && p.role === 'Primary') && data.role !== 'Primary') throw new ZiteError('Make someone else the primary resident first.', 'BAD_REQUEST');
      if (data.role === 'Primary') {
        for (const p of people.filter(x => x.role === 'Primary' && x.id !== person.id)) await withRetry(() => zite.leaseTenants.update({ id: p.linkId, record: { role: 'Co-tenant' } }));
      }
      await withRetry(() => zite.leaseTenants.update({ id: person.linkId, record: { role: data.role } }));
      await refreshLeaseName(lease.id);
      await logActivity({ ...base, tenantId: person.id, action: 'person_role', summary: `made ${person.name} ${data.role === 'Primary' ? 'the primary resident' : `a ${data.role.toLowerCase()}`}` });
      return { ok: true, message: `${person.name} is now ${data.role === 'Primary' ? 'the primary resident' : `a ${data.role.toLowerCase()}`}` };
    }

    // removePerson
    if (person.role === 'Primary') throw new ZiteError('Make someone else the primary resident before removing them.', 'BAD_REQUEST');
    await withRetry(() => zite.leaseTenants.delete({ id: person.linkId }));
    await refreshLeaseName(lease.id);
    await logActivity({ ...base, tenantId: person.id, action: 'person_removed', summary: `removed ${person.name} from the lease` });
    return { ok: true, message: `${person.name} removed from the lease` };
  },
});
