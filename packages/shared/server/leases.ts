import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { LeaseStatus } from '../constants';
import { addDays, addMonths, addPeriods, dueDateIn, periodLabel, periodOf, periodStart, prorateToMonthEnd, todayIn } from '../dates';
import { leaseLabel } from '../leases';
import { toCents } from '../money';
import { colorFor } from './actor';
import { getChart } from './accounts';
import { insertTransactions, autoApply, nextNumber, type TxnInput } from './ledger';
import { chunked, num, ref, str } from './sql';

/**
 * Creating and activating leases.
 *
 * Shared by the staff app's move-in flow, converting an approved application,
 * and a resident accepting a renewal in the portal — so a lease is built the
 * same way wherever it starts.
 */

export type NewLeaseTenant = { tenantId?: string | null; name?: string | null; email?: string | null; phone?: string | null; role: 'Primary' | 'Co-tenant' | 'Occupant' | 'Guarantor' };

export type NewLease = {
  propertyId: string;
  unitId: string;
  tenants: NewLeaseTenant[];
  leaseType: 'Fixed term' | 'Month-to-month';
  startDate: string;
  endDate: string | null;
  rent: number;
  deposit: number;
  rentDueDay?: number | null;
  lateFeeExempt?: boolean;
  recurringCharges?: Array<{ accountId: string; description: string; amount: number }>;
  status: Extract<LeaseStatus, 'Draft' | 'Pending signature' | 'Active'>;
  applicationId?: string | null;
  previousLeaseId?: string | null;
  terms?: string | null;
  notes?: string | null;
  createdById?: string | null;
};

const bad = (m: string) => new ZiteError(m, 'BAD_REQUEST');

export async function unitWithProperty(unitId: string) {
  const { rows } = await zite.sql({
    query: `SELECT u.id, u."name", u."propertyId", p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", p."managerId", p."ownerId"
            FROM "Units" u JOIN "Properties" p ON p.id::text = u."propertyId" WHERE u.id::text = $1 LIMIT 1`,
    params: [unitId],
  });
  const r = rows[0];
  if (!r) throw new ZiteError('That unit no longer exists', 'NOT_FOUND');
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    propertyId: String(r.propertyId),
    propertyName: str(r.propertyName) ?? '',
    street: str(r.street) ?? '',
    city: str(r.city) ?? '',
    state: str(r.state) ?? '',
    postalCode: str(r.postalCode) ?? '',
    managerId: ref(r.managerId),
    ownerId: ref(r.ownerId),
  };
}

/** Find a tenant by email, or create one. Names are only filled, never overwritten. */
export async function upsertTenant(t: { name?: string | null; email?: string | null; phone?: string | null }) {
  const email = (t.email ?? '').trim().toLowerCase();
  if (email) {
    const { rows } = await zite.sql({ query: `SELECT id, "name", "phone" FROM "Tenants" WHERE LOWER("email") = $1 ORDER BY created_at ASC LIMIT 1`, params: [email] });
    if (rows[0]) {
      const patch: Record<string, unknown> = {};
      if (!rows[0].name && t.name) patch.name = t.name;
      if (!rows[0].phone && t.phone) patch.phone = t.phone;
      if (Object.keys(patch).length) await zite.tenants.update({ id: String(rows[0].id), record: patch });
      return String(rows[0].id);
    }
  }
  const name = (t.name ?? '').trim();
  if (!name) throw bad('Every new tenant needs a name');
  const created = await zite.tenants.create({ record: { name, email: email || null, phone: t.phone ?? null, color: colorFor(email || name) } });
  return created.id;
}

/** Leases that would put two households in one unit at once. */
export async function overlappingLeases(unitId: string, start: string, end: string | null, ignoreLeaseIds: string[] = []) {
  const { rows } = await zite.sql({
    query: `
      SELECT id, "name", "number", "startDate", "endDate", "moveOutDate", "status" FROM "Leases"
      WHERE "unitId" = $1 AND "status" IN ('Active', 'Pending signature')
        AND ("startDate" IS NULL OR "startDate" <= COALESCE($3::date, DATE '9999-12-31'))
        AND COALESCE("moveOutDate", DATE '9999-12-31') >= $2::date
        AND NOT (id::text = ANY($4))`,
    params: [unitId, start, end, ignoreLeaseIds],
  });
  return rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', number: num(r.number), status: String(r.status) }));
}

export async function createLease(input: NewLease) {
  if (!input.tenants.length) throw bad('Add at least one tenant');
  if (!input.tenants.some(t => t.role === 'Primary')) input.tenants[0].role = 'Primary';
  if (!(toCents(input.rent) > 0)) throw bad('Enter the monthly rent');
  if (toCents(input.deposit) < 0) throw bad('The deposit can’t be negative');
  if (input.leaseType === 'Fixed term' && !input.endDate) throw bad('A fixed-term lease needs an end date');
  if (input.endDate && input.endDate < input.startDate) throw bad('The lease can’t end before it starts');

  const unit = await unitWithProperty(input.unitId);
  if (unit.propertyId !== input.propertyId) throw bad('That unit belongs to a different property');
  const conflicts = await overlappingLeases(unit.id, input.startDate, input.endDate, input.previousLeaseId ? [input.previousLeaseId] : []);
  // A renewal may start the day after its predecessor, which still shows as active until then.
  if (conflicts.length) throw new ZiteError(`${conflicts[0].name || 'Another lease'} already covers those dates for this unit`, 'CONFLICT');

  const tenantIds: Array<{ id: string; role: NewLeaseTenant['role'] }> = [];
  for (const t of input.tenants) {
    const id = t.tenantId || (await upsertTenant(t));
    if (!tenantIds.some(x => x.id === id)) tenantIds.push({ id, role: t.role });
  }
  const { rows: names } = await zite.sql({ query: `SELECT id, "name" FROM "Tenants" WHERE id::text = ANY($1)`, params: [tenantIds.map(t => t.id)] });
  const nameById = new Map(names.map(r => [String(r.id), String(r.name ?? '')]));
  const ordered = [...tenantIds].sort((a, b) => (a.role === 'Primary' ? -1 : b.role === 'Primary' ? 1 : 0));

  const number = await nextNumber('Leases', 1000);
  const dueDay = Math.min(28, Math.max(1, Math.round(input.rentDueDay ?? 1)));
  const lease = await zite.leases.create({
    record: {
      name: leaseLabel(unit.propertyName, unit.name, ordered.filter(t => t.role !== 'Guarantor').map(t => nameById.get(t.id) ?? '')),
      number,
      propertyId: unit.propertyId,
      unitId: unit.id,
      status: input.status === 'Active' ? 'Pending signature' : input.status,
      leaseType: input.leaseType,
      startDate: input.startDate,
      endDate: input.endDate,
      moveInDate: input.startDate,
      rent: input.rent,
      deposit: input.deposit,
      rentDueDay: dueDay,
      lateFeeExempt: Boolean(input.lateFeeExempt),
      renewalStatus: 'None',
      previousLeaseId: input.previousLeaseId ?? null,
      applicationId: input.applicationId ?? null,
      terms: input.terms ?? null,
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
    },
  });
  await zite.leaseTenants.bulkCreate({ records: ordered.map(t => ({ leaseId: lease.id, tenantId: t.id, role: t.role })) });

  const chart = await getChart();
  // Rent recurs from the first full period; a mid-month start is prorated once at activation.
  const firstFull = Number(input.startDate.slice(8, 10)) === 1 ? input.startDate : periodStart(addPeriods(periodOf(input.startDate), 1));
  await zite.recurringCharges.bulkCreate({
    records: [
      { description: 'Rent', leaseId: lease.id, accountId: chart.key('rent_income').id, amount: input.rent, frequency: 'Monthly', dayOfMonth: dueDay, startDate: firstFull, active: true },
      ...(input.recurringCharges ?? [])
        .filter(c => toCents(c.amount) > 0)
        .map(c => ({ description: c.description.slice(0, 120), leaseId: lease.id, accountId: c.accountId, amount: c.amount, frequency: 'Monthly', dayOfMonth: dueDay, startDate: firstFull, active: true })),
    ],
  });

  // The application that led here is done, and the unit is no longer on the market.
  if (input.applicationId) await zite.applications.update({ id: input.applicationId, record: { status: 'Leased', leaseId: lease.id } });
  const { rows: live } = await zite.sql({ query: `SELECT id FROM "Listings" WHERE "unitId" = $1 AND "status" IN ('Published', 'Paused')`, params: [unit.id] });
  for (const l of live) await zite.listings.update({ id: String(l.id), record: { status: 'Leased' } });

  if (input.status === 'Active') await activateLease(lease.id, { actorId: input.createdById ?? null });
  return { id: lease.id, number };
}

/**
 * Make a signed lease live: status Active, move-in charges posted (the
 * security deposit and a prorated first month), and any rent already due.
 * Safe to call twice — it checks what has been posted.
 */
export async function activateLease(leaseId: string, opts: { actorId?: string | null; timezone?: string | null } = {}) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Leases" WHERE id::text = $1 LIMIT 1`, params: [leaseId] });
  const l = rows[0];
  if (!l) throw new ZiteError('That lease no longer exists', 'NOT_FOUND');
  if (l.status === 'Ended' || l.status === 'Canceled') throw bad('An ended or canceled lease can’t be activated');
  const today = todayIn(opts.timezone);
  const start = String(l.startDate ?? today).slice(0, 10);
  const patch: Record<string, unknown> = {};
  if (l.status !== 'Active') patch.status = 'Active';
  if (!l.signedAt) patch.signedAt = new Date().toISOString();
  if (Object.keys(patch).length) await zite.leases.update({ id: leaseId, record: patch });

  const chart = await getChart();
  const { rows: existing } = await zite.sql({
    query: `SELECT "accountId", "period", "source" FROM "Transactions" WHERE "leaseId" = $1 AND "kind" = 'Charge' AND "status" = 'Posted'`,
    params: [leaseId],
  });
  const has = (accountId: string, period?: string) => existing.some(e => e.accountId === accountId && (period === undefined || e.period === period));
  const primaryTenant = await zite.sql({ query: `SELECT "tenantId" FROM "LeaseTenants" WHERE "leaseId" = $1 ORDER BY CASE "role" WHEN 'Primary' THEN 0 ELSE 1 END LIMIT 1`, params: [leaseId] });
  const tenantId = ref(primaryTenant.rows[0]?.tenantId);
  const base = { propertyId: ref(l.propertyId), unitId: ref(l.unitId), leaseId, tenantId, createdById: opts.actorId ?? null };
  const ar = chart.key('accounts_receivable').id;
  const txns: TxnInput[] = [];

  const deposit = num(l.deposit);
  const depositAccount = chart.key('deposits_held').id;
  if (deposit > 0 && !has(depositAccount)) {
    const date = start < today ? start : today;
    txns.push({
      ...base, kind: 'Charge', date, dueDate: start, amount: deposit, description: 'Security deposit', accountId: depositAccount, source: 'System',
      lines: [{ accountId: ar, debit: deposit }, { accountId: depositAccount, credit: deposit }],
    });
  }
  const rent = num(l.rent);
  const rentAccount = chart.key('rent_income').id;
  if (Number(start.slice(8, 10)) !== 1 && rent > 0) {
    const period = periodOf(start);
    if (!has(rentAccount, period)) {
      const amount = prorateToMonthEnd(rent, start);
      txns.push({
        ...base, kind: 'Charge', date: start < today ? start : today, dueDate: start, amount, description: `Prorated rent (${start.slice(8, 10)}–end of month)`, accountId: rentAccount, period, source: 'System',
        lines: [{ accountId: ar, debit: amount }, { accountId: rentAccount, credit: amount }],
      });
    }
  }
  if (txns.length) await insertTransactions(txns);
  await postRecurringCharges({ today, leaseId });
  await autoApply(leaseId);
  return { posted: txns.length };
}

/**
 * Post every recurring charge that has come due and not been posted yet.
 * Idempotent per (recurring charge, period). Backfills at most two missed
 * months, so a lease reactivated after a long gap doesn't flood its ledger.
 */
export async function postRecurringCharges(opts: { today: string; leaseId?: string; daysAhead?: number }) {
  const daysAhead = Math.max(0, opts.daysAhead ?? 0);
  const params: unknown[] = [];
  let leaseFilter = '';
  if (opts.leaseId) {
    params.push(opts.leaseId);
    leaseFilter = `AND rc."leaseId" = $1`;
  }
  const { rows } = await zite.sql({
    query: `
      SELECT rc.id, rc."description", rc."leaseId", rc."accountId", rc."amount", rc."frequency", rc."dayOfMonth", rc."startDate", rc."endDate", rc."lastPostedPeriod",
        l."propertyId", l."unitId", l."startDate" AS "leaseStart", l."moveOutDate", l."status" AS "leaseStatus",
        (SELECT lt."tenantId" FROM "LeaseTenants" lt WHERE lt."leaseId" = l.id::text ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END LIMIT 1) AS "tenantId"
      FROM "RecurringCharges" rc
      JOIN "Leases" l ON l.id::text = rc."leaseId"
      WHERE COALESCE(rc."active", false) = true AND l."status" = 'Active' ${leaseFilter}
      LIMIT 2000`,
    params,
  });
  if (!rows.length) return { posted: 0, leases: 0 };
  const ids = rows.map(r => String(r.id));
  const { rows: done } = await zite.sql({
    query: `SELECT "recurringChargeId", "period" FROM "Transactions" WHERE "recurringChargeId" = ANY($1) AND COALESCE("period", '') <> ''`,
    params: [ids],
  });
  const posted = new Set(done.map(d => `${d.recurringChargeId}|${d.period}`));
  const chart = await getChart();
  const ar = chart.key('accounts_receivable').id;
  const todayPeriod = periodOf(opts.today);
  const floor = addPeriods(todayPeriod, -2);
  const txns: TxnInput[] = [];
  const lastPosted = new Map<string, string>();

  for (const r of rows) {
    const rcStart = String(r.startDate ?? r.leaseStart ?? opts.today).slice(0, 10);
    const leaseStart = String(r.leaseStart ?? rcStart).slice(0, 10);
    const first = [periodOf(rcStart), periodOf(leaseStart), floor].sort().slice(-1)[0];
    const freq = String(r.frequency || 'Monthly');
    const step = freq === 'Quarterly' ? 3 : freq === 'Annually' ? 12 : 1;
    const dueDay = num(r.dayOfMonth, 1);
    const moveOut = r.moveOutDate ? String(r.moveOutDate).slice(0, 10) : null;
    const end = r.endDate ? String(r.endDate).slice(0, 10) : null;
    for (let p = first; p <= addPeriods(todayPeriod, 1); p = addPeriods(p, 1)) {
      const monthsFromStart = (Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7))) - (Number(rcStart.slice(0, 4)) * 12 + Number(rcStart.slice(5, 7)));
      if (monthsFromStart < 0 || monthsFromStart % step !== 0) continue;
      const due = dueDateIn(p, dueDay);
      if (due < rcStart) continue;
      if (end && due > end) continue;
      if (moveOut && due > moveOut) continue;
      // Posts on the due date, or `daysAhead` before it.
      const postOn = addDays(due, -daysAhead);
      if (postOn > opts.today) continue;
      const key = `${r.id}|${p}`;
      if (posted.has(key)) continue;
      posted.add(key);
      const amount = num(r.amount);
      if (!(amount > 0)) continue;
      txns.push({
        kind: 'Charge',
        date: postOn,
        dueDate: due,
        amount,
        description: `${str(r.description) || 'Rent'} — ${periodLabel(p)}`,
        propertyId: ref(r.propertyId),
        unitId: ref(r.unitId),
        leaseId: String(r.leaseId),
        tenantId: ref(r.tenantId),
        accountId: String(r.accountId),
        source: 'Recurring',
        period: p,
        recurringChargeId: String(r.id),
        lines: [{ accountId: ar, debit: amount }, { accountId: String(r.accountId), credit: amount }],
      });
      if (!lastPosted.get(String(r.id)) || p > lastPosted.get(String(r.id))!) lastPosted.set(String(r.id), p);
    }
  }
  if (!txns.length) return { posted: 0, leases: 0 };
  await insertTransactions(txns);
  await chunked([...lastPosted.entries()], async batch => {
    for (const [id, period] of batch) await zite.recurringCharges.update({ id, record: { lastPostedPeriod: period } });
  }, 25);
  const leaseIds = [...new Set(txns.map(t => t.leaseId!))];
  for (const id of leaseIds) await autoApply(id);
  return { posted: txns.length, leases: leaseIds.length };
}

/** Rebuild a lease's display name after tenants change. */
export async function refreshLeaseName(leaseId: string) {
  const { rows } = await zite.sql({
    query: `
      SELECT p."name" AS "propertyName", u."name" AS "unitName",
        (SELECT STRING_AGG(t."name", '|' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END) FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = l.id::text AND lt."role" <> 'Guarantor') AS "names"
      FROM "Leases" l LEFT JOIN "Properties" p ON p.id::text = l."propertyId" LEFT JOIN "Units" u ON u.id::text = l."unitId"
      WHERE l.id::text = $1`,
    params: [leaseId],
  });
  const r = rows[0];
  if (!r) return;
  const name = leaseLabel(str(r.propertyName) ?? '', str(r.unitName) ?? '', String(r.names ?? '').split('|').filter(Boolean));
  await zite.leases.update({ id: leaseId, record: { name } });
  return name;
}

export type Signature = { tenantId: string | null; name: string; signedAt: string; by?: 'resident' | 'staff'; ip?: string | null };

export function parseSignatures(raw: unknown): Signature[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as Signature[]) : [];
  } catch {
    return [];
  }
}

/**
 * Record one resident's signature on a lease waiting for signatures. Returns
 * whether every primary and co-tenant has now signed — the moment the office
 * is asked to countersign.
 */
export async function recordSignature(leaseId: string, tenantId: string, typedName: string, by: 'resident' | 'staff') {
  const { rows } = await zite.sql({ query: `SELECT "status", "signatures", "signedAt" FROM "Leases" WHERE id::text = $1 LIMIT 1`, params: [leaseId] });
  const l = rows[0];
  if (!l) throw new ZiteError('That lease no longer exists', 'NOT_FOUND');
  if (l.status !== 'Pending signature') throw bad('This lease isn’t waiting for signatures');
  const name = typedName.trim();
  if (name.length < 2) throw bad('Type your full name to sign');
  const { rows: signers } = await zite.sql({ query: `SELECT id, "tenantId", "role", "signedAt" FROM "LeaseTenants" WHERE "leaseId" = $1 AND "role" IN ('Primary', 'Co-tenant')`, params: [leaseId] });
  const mine = signers.find(s => String(s.tenantId) === tenantId);
  if (!mine) throw new ZiteError('You’re not a signer on this lease', 'FORBIDDEN');
  const now = new Date().toISOString();
  const signatures = parseSignatures(l.signatures).filter(s => s.tenantId !== tenantId);
  signatures.push({ tenantId, name, signedAt: now, by });
  await zite.leaseTenants.update({ id: String(mine.id), record: { signedAt: now } });
  const allSigned = signers.every(s => String(s.tenantId) === tenantId || s.signedAt);
  await zite.leases.update({ id: leaseId, record: { signatures: JSON.stringify(signatures), ...(allSigned ? { signedAt: now } : {}) } });
  return { allSigned, signatures };
}

/**
 * Accept a renewal offer. A renewal extends the SAME lease — new end date, and
 * rent that changes on the first day of the new term — rather than creating a
 * new one, so the resident's ledger, deposit and history stay continuous.
 */
export async function acceptRenewal(leaseId: string, opts: { timezone?: string | null } = {}) {
  const today = todayIn(opts.timezone ?? undefined);
  const { rows } = await zite.sql({ query: `SELECT * FROM "Leases" WHERE id::text = $1 LIMIT 1`, params: [leaseId] });
  const l = rows[0];
  if (!l) throw new ZiteError('That lease no longer exists', 'NOT_FOUND');
  if (l.status !== 'Active' || l.renewalStatus !== 'Offered') throw bad('There’s no open renewal offer on this lease');
  const expires = l.renewalExpiresOn ? String(l.renewalExpiresOn).slice(0, 10) : null;
  if (expires && expires < today) throw bad('This renewal offer has expired. Contact the office for a new one.');
  const months = Math.max(1, num(l.renewalTermMonths, 12));
  const oldEnd = l.endDate ? String(l.endDate).slice(0, 10) : today;
  const newStart = addDays(oldEnd, 1);
  const newEnd = addDays(addMonths(newStart, months), -1);
  const newRent = num(l.renewalRent, num(l.rent));
  const chart = await getChart();
  const rentAccount = chart.key('rent_income').id;
  const { rows: rcs } = await zite.sql({ query: `SELECT id, "startDate" FROM "RecurringCharges" WHERE "leaseId" = $1 AND "accountId" = $2 AND COALESCE("active", false) = true`, params: [leaseId, rentAccount] });
  // The current rent stops at the end of the current term; the renewal rent takes over the day after.
  let firstNewPeriod = Number(newStart.slice(8, 10)) === 1 ? newStart : periodStart(addPeriods(periodOf(newStart), 1));
  // Accepted after the term ended: months already billed at the old rent aren't billed again.
  if (rcs.length) {
    const { rows: billed } = await zite.sql({ query: `SELECT MAX("period") AS p FROM "Transactions" WHERE "recurringChargeId" = ANY($1) AND "status" = 'Posted' AND COALESCE("period", '') <> ''`, params: [rcs.map(r => String(r.id))] });
    const last = billed[0]?.p ? String(billed[0].p) : null;
    if (last && periodOf(firstNewPeriod) <= last) firstNewPeriod = periodStart(addPeriods(last, 1));
  }
  for (const rc of rcs) await zite.recurringCharges.update({ id: String(rc.id), record: { endDate: addDays(firstNewPeriod, -1) } });
  await zite.recurringCharges.create({ record: { description: 'Rent', leaseId, accountId: rentAccount, amount: newRent, frequency: 'Monthly', dayOfMonth: num(l.rentDueDay, 1), startDate: firstNewPeriod, active: true } });
  await zite.leases.update({ id: leaseId, record: { renewalStatus: 'Accepted', renewalRespondedAt: new Date().toISOString(), endDate: newEnd, rent: newRent, leaseType: 'Fixed term' } });
  return { newStart, newEnd, newRent, months };
}

export async function declineRenewal(leaseId: string) {
  const { rows } = await zite.sql({ query: `SELECT "status", "renewalStatus" FROM "Leases" WHERE id::text = $1 LIMIT 1`, params: [leaseId] });
  if (!rows[0]) throw new ZiteError('That lease no longer exists', 'NOT_FOUND');
  if (rows[0].renewalStatus !== 'Offered') throw bad('There’s no open renewal offer on this lease');
  await zite.leases.update({ id: leaseId, record: { renewalStatus: 'Declined', renewalRespondedAt: new Date().toISOString() } });
}

/** A resident (or the office on their behalf) gives notice to move out. */
export async function giveNotice(leaseId: string, input: { moveOutDate: string; reason?: string | null; forwardingAddress?: string | null; noticeDate?: string | null; timezone?: string | null }) {
  const today = todayIn(input.timezone ?? undefined);
  const { rows } = await zite.sql({ query: `SELECT "status", "startDate", "renewalStatus" FROM "Leases" WHERE id::text = $1 LIMIT 1`, params: [leaseId] });
  const l = rows[0];
  if (!l) throw new ZiteError('That lease no longer exists', 'NOT_FOUND');
  if (l.status !== 'Active') throw bad('Only an active lease can be given notice');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.moveOutDate) || input.moveOutDate < today) throw bad('Choose a move-out date from today onward');
  await zite.leases.update({
    id: leaseId,
    // An accepted renewal stays on record; any other open offer is declined by giving notice.
    record: { noticeGivenOn: input.noticeDate || today, moveOutDate: input.moveOutDate, moveOutReason: input.reason?.slice(0, 240) ?? null, forwardingAddress: input.forwardingAddress ?? null, ...(l.renewalStatus === 'Accepted' ? {} : { renewalStatus: 'Declined' }) },
  });
}
