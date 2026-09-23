import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { LEASE_TENANT_ROLES, LEASE_TYPES } from '@project/shared/constants';
import { formatDay, isDay, todayIn } from '@project/shared/dates';
import { applicationRef, leaseRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { createLease, overlappingLeases, unitWithProperty } from '@project/shared/server/leases';
import { getSettings } from '@project/shared/server/settings';
import { day, num, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { countersignAndActivate, loadStaffLease, sendForSignature, type SendTally } from '../server/leaseStaff';

/**
 * A new lease from the staff app — the move-in flow. Saves a draft, sends it
 * for signature, or (for a lease already signed on paper) activates it at
 * once, which posts the deposit and first month. `check` reports leases that
 * would overlap before anything is saved, so the dialog can say so inline.
 */

const dayStr = z.string().refine(isDay, 'Choose a valid date.');
const email = z.string().trim().max(200).refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'One of the email addresses doesn’t look right.');

const Tenant = z.object({
  tenantId: z.string().max(64).nullish(),
  name: z.string().trim().max(120).optional(),
  email: email.optional(),
  phone: z.string().trim().max(40).optional(),
  role: z.enum(LEASE_TENANT_ROLES),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check'), unitId: z.string().min(1), startDate: dayStr, endDate: dayStr.nullable() }),
  z.object({
    action: z.literal('create'),
    unitId: z.string().min(1, 'Choose the unit.'),
    leaseType: z.enum(LEASE_TYPES),
    startDate: dayStr,
    endDate: dayStr.nullable(),
    rent: z.number().positive('Enter the monthly rent.').max(1_000_000, 'That rent is too large.'),
    deposit: z.number().min(0, 'The deposit can’t be negative.').max(1_000_000, 'That deposit is too large.'),
    rentDueDay: z.number().int().min(1).max(28).optional(),
    lateFeeExempt: z.boolean().optional(),
    tenants: z.array(Tenant).min(1, 'Add at least one resident.').max(12, 'A lease can have at most 12 people on it.'),
    recurringCharges: z.array(z.object({ accountId: z.string().min(1), description: z.string().trim().min(1, 'Describe each extra charge.').max(120), amount: z.number().positive('Extra charges need an amount.').max(100_000) })).max(20).optional(),
    next: z.enum(['draft', 'send', 'activate']),
    sendWelcome: z.boolean().optional(),
    applicationId: z.string().max(64).nullish(),
    notes: z.string().max(5000).optional(),
  }),
]);

export default createEndpoint({
  description: 'Create a lease (draft, send for signature, or activate) or check a unit for overlapping leases',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    if (data.action === 'check') {
      if (data.endDate && data.endDate < data.startDate) return { conflicts: [] };
      const conflicts = await overlappingLeases(data.unitId, data.startDate, data.endDate);
      const { rows } = conflicts.length ? await zite.sql({ query: `SELECT id, "moveOutDate", "endDate", "startDate" FROM "Leases" WHERE id::text = ANY($1)`, params: [conflicts.map(c => c.id)] }) : { rows: [] as Record<string, unknown>[] };
      const extra = new Map<string, { moveOutDate: string | null; endDate: string | null; startDate: string | null }>(rows.map(r => [String(r.id), { moveOutDate: day(r.moveOutDate), endDate: day(r.endDate), startDate: day(r.startDate) }] as const));
      return { conflicts: conflicts.map(c => ({ ...c, ref: leaseRef(c.number), ...(extra.get(c.id) ?? { moveOutDate: null, endDate: null, startDate: null }) })) };
    }

    if (data.leaseType === 'Fixed term' && !data.endDate) throw new ZiteError('A fixed-term lease needs an end date.', 'BAD_REQUEST');
    if (data.endDate && data.endDate < data.startDate) throw new ZiteError('The lease can’t end before it starts.', 'BAD_REQUEST');
    if (!data.tenants.some(t => t.role === 'Primary')) throw new ZiteError('Mark one resident as the primary resident.', 'BAD_REQUEST');
    for (const t of data.tenants) if (!t.tenantId && !t.name?.trim()) throw new ZiteError('Every new resident needs a name.', 'BAD_REQUEST');
    const existingIds = data.tenants.map(t => t.tenantId).filter(Boolean) as string[];
    if (existingIds.length) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Tenants" WHERE id::text = ANY($1)`, params: [existingIds] });
      if (rows.length !== new Set(existingIds).size) throw new ZiteError('One of the residents no longer exists. Search for them again.', 'BAD_REQUEST');
    }
    const unit = await unitWithProperty(data.unitId);
    const chart = await getChart();
    for (const c of data.recurringCharges ?? []) {
      const a = chart.byId.get(c.accountId);
      if (!a || a.accountType !== 'Income') throw new ZiteError(`Choose an income account for “${c.description}”.`, 'BAD_REQUEST');
    }
    let application: Record<string, unknown> | null = null;
    if (data.applicationId) {
      const { rows } = await zite.sql({ query: `SELECT id, "number", "status", "leaseId", "applicantName" FROM "Applications" WHERE id::text = $1`, params: [data.applicationId] });
      application = rows[0] ?? null;
      if (!application) throw new ZiteError('That application no longer exists.', 'BAD_REQUEST');
    }

    const created = await createLease({
      propertyId: unit.propertyId,
      unitId: unit.id,
      tenants: data.tenants.map(t => ({ tenantId: t.tenantId || null, name: t.name?.trim() || null, email: t.email?.trim().toLowerCase() || null, phone: t.phone?.trim() || null, role: t.role })),
      leaseType: data.leaseType,
      startDate: data.startDate,
      endDate: data.leaseType === 'Month-to-month' ? null : data.endDate,
      rent: data.rent,
      deposit: data.deposit,
      rentDueDay: data.rentDueDay ?? settings.rentDueDay,
      lateFeeExempt: data.lateFeeExempt,
      recurringCharges: data.recurringCharges,
      status: 'Draft',
      applicationId: data.applicationId ?? null,
      notes: data.notes?.trim() || null,
      createdById: actor.id,
    });

    const base = { entityType: 'lease' as const, entityId: created.id, leaseId: created.id, propertyId: unit.propertyId, unitId: unit.id, actorId: actor.id, actorName: actor.name };
    await logActivity({ ...base, action: 'created', summary: `created the lease — ${formatMoney(data.rent, settings.currency)}/mo from ${formatDay(data.startDate)}` });

    let tally: SendTally | null = null;
    let posted = 0;
    let documentUrl: string | null = null;
    if (data.next === 'send') {
      const res = await sendForSignature(actor, created.id, settings);
      tally = res.tally;
      await logActivity({ ...base, action: 'sent_for_signature', summary: 'sent the lease for signature' });
    } else if (data.next === 'activate') {
      const res = await countersignAndActivate(actor, created.id, settings, { signAll: true, sendWelcome: data.sendWelcome ?? false, today });
      posted = res.posted;
      documentUrl = res.documentUrl;
      tally = res.welcome;
      await logActivity({ ...base, action: 'activated', summary: `recorded the signatures and activated the lease${res.posted ? ` — posted ${res.posted} move-in ${res.posted === 1 ? 'charge' : 'charges'}` : ''}` });
    }

    // createLease marks the application Leased and links it; the application's own timeline records it here.
    if (application) {
      const appId = String(application.id);
      await logActivity({ entityType: 'application', entityId: appId, applicationId: appId, leaseId: created.id, propertyId: unit.propertyId, unitId: unit.id, action: 'leased', summary: `created lease ${leaseRef(created.number)} for ${applicationRef(num(application.number))}`, actorId: actor.id, actorName: actor.name });
    }

    const lease = await loadStaffLease(created.id);
    return { id: created.id, number: created.number, ref: leaseRef(created.number), name: lease.name, status: lease.status, tally, posted, documentUrl, applicationName: application ? str(application.applicantName) : null };
  },
});
