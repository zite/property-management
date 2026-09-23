import { zite } from 'zitejs/db';
import { addDays } from '@project/shared/dates';
import { leasePhase } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { can, type Actor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { leaseBalances } from '@project/shared/server/ledger';
import { bool, day, json, num, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * Reads shared by the portfolio endpoints (properties, units, owners).
 *
 * Money follows one rule everywhere: figures are computed from the posted
 * books and returned as `null` to roles without `accounting.view`, so a
 * leasing agent's payload never carries a balance the UI would have to hide.
 */

export const canSeeMoney = (actor: Actor) => can(actor.role, 'accounting.view');

/** Text arrays stored as JSON (`amenities`, `features`, `photoUrls`), tolerant of comma lists typed elsewhere. */
export function stringList(v: unknown): string[] {
  const parsed = json<unknown>(v, null);
  if (Array.isArray(parsed)) return parsed.map(x => (typeof x === 'string' ? x : typeof x === 'object' && x && 'url' in x ? String((x as { url: unknown }).url) : String(x))).filter(Boolean);
  const s = str(v);
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
}

export function toPropertyDetail(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    code: str(r.code) ?? '',
    propertyType: str(r.propertyType) || 'Multifamily',
    status: str(r.status) || 'Active',
    street: str(r.street) ?? '',
    city: str(r.city) ?? '',
    state: str(r.state) ?? '',
    postalCode: str(r.postalCode) ?? '',
    ownerId: ref(r.ownerId),
    managerId: ref(r.managerId),
    bankAccountId: ref(r.bankAccountId),
    yearBuilt: numOrNull(r.yearBuilt),
    photoUrl: ref(r.photoUrl),
    description: str(r.description) ?? '',
    amenities: stringList(r.amenities),
    managementFeePercent: numOrNull(r.managementFeePercent),
    reserveAmount: num(r.reserveAmount),
    petPolicy: str(r.petPolicy) ?? '',
    parking: str(r.parking) ?? '',
    acquiredOn: day(r.acquiredOn),
    color: str(r.color) || '#0d9488',
    notes: str(r.notes) ?? '',
    createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
  };
}

export function toUnitDetail(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    propertyId: ref(r.propertyId) ?? '',
    name: str(r.name) ?? '',
    beds: num(r.beds),
    baths: num(r.baths),
    squareFeet: numOrNull(r.squareFeet),
    marketRent: num(r.marketRent),
    depositAmount: num(r.depositAmount),
    readiness: str(r.readiness) || 'Ready',
    floor: str(r.floor) ?? '',
    unitType: str(r.unitType) ?? '',
    features: stringList(r.features),
    photoUrls: stringList(r.photoUrls),
    description: str(r.description) ?? '',
    availableOn: day(r.availableOn),
    archived: bool(r.archived),
    notes: str(r.notes) ?? '',
  };
}

export function toOwnerDetail(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    ownerType: str(r.ownerType) || 'Individual',
    contactName: str(r.contactName) ?? '',
    email: str(r.email) ?? '',
    phone: str(r.phone) ?? '',
    mailingAddress: str(r.mailingAddress) ?? '',
    taxIdLast4: str(r.taxIdLast4) ?? '',
    managementFeePercent: numOrNull(r.managementFeePercent),
    distributionMethod: str(r.distributionMethod) || 'ACH',
    portalEnabled: bool(r.portalEnabled),
    status: str(r.status) || 'Active',
    color: str(r.color) || '#64748b',
    notes: str(r.notes) ?? '',
  };
}

export async function loadProperty(id: string) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Properties" WHERE id::text = $1 LIMIT 1`, params: [id] });
  return rows[0] ? toPropertyDetail(rows[0]) : null;
}

export async function loadUnit(id: string) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Units" WHERE id::text = $1 LIMIT 1`, params: [id] });
  return rows[0] ? toUnitDetail(rows[0]) : null;
}

export async function loadOwner(id: string) {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Owners" WHERE id::text = $1 LIMIT 1`, params: [id] });
  return rows[0] ? toOwnerDetail(rows[0]) : null;
}

/**
 * Charges still open past their due date, grouped by a Transactions column
 * (`propertyId` or `leaseId`) — the same definition as a lease ledger's
 * "past due": charges and credit refunds, less what's been applied to them.
 */
export async function pastDueBy(column: 'propertyId' | 'leaseId', today: string, ids?: string[]) {
  if (ids && !ids.length) return new Map<string, number>();
  const chart = await getChart();
  const params: unknown[] = [today, chart.key('accounts_receivable').id];
  let filter = '';
  if (ids) {
    params.push(ids);
    filter = `AND t."${column}" = ANY($3)`;
  }
  const { rows } = await zite.sql({
    query: `
      SELECT t."${column}" AS k, SUM(t."amount" - COALESCE(al.applied, 0)) AS "pastDue"
      FROM "Transactions" t
      LEFT JOIN (
        SELECT a."chargeId", SUM(a."amount") AS applied FROM "Allocations" a WHERE COALESCE(a."void", false) = false GROUP BY a."chargeId"
      ) al ON al."chargeId" = t.id::text
      WHERE t."status" = 'Posted' AND (t."kind" = 'Charge' OR (t."kind" = 'Refund' AND t."accountId" = $2))
        AND t."dueDate" < $1::date AND t."amount" > COALESCE(al.applied, 0) ${filter}
      GROUP BY t."${column}"`,
    params,
  });
  return new Map(rows.map(r => [String(r.k ?? ''), fromCents(toCents(num(r.pastDue)))]));
}

/** Security deposits held per property (credit-normal liability lines). */
export async function depositsHeldByProperty(propertyIds?: string[]) {
  if (propertyIds && !propertyIds.length) return new Map<string, number>();
  const chart = await getChart();
  const accounts = chart.all.filter(a => a.subtype === 'Deposits held').map(a => a.id);
  if (!accounts.length) return new Map<string, number>();
  const params: unknown[] = [accounts];
  let filter = '';
  if (propertyIds) {
    params.push(propertyIds);
    filter = `AND jl."propertyId" = ANY($2)`;
  }
  const { rows } = await zite.sql({
    query: `SELECT jl."propertyId" AS pid, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS held FROM "JournalLines" jl WHERE COALESCE(jl."void", false) = false AND jl."accountId" = ANY($1) ${filter} GROUP BY jl."propertyId"`,
    params,
  });
  return new Map(rows.map(r => [String(r.pid ?? ''), fromCents(toCents(num(r.held)))]));
}

export type LeaseSummary = {
  id: string;
  number: number | null;
  name: string;
  status: string;
  leaseType: string;
  phase: ReturnType<typeof leasePhase>;
  propertyId: string;
  unitId: string;
  startDate: string | null;
  endDate: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  noticeGivenOn: string | null;
  rent: number | null;
  deposit: number | null;
  balance: number | null;
  pastDue: number | null;
  residents: Array<{ id: string; name: string; role: string; email: string; phone: string }>;
  renewalStatus: string;
};

/**
 * Leases matching a WHERE clause on `l`, with their residents, derived phase
 * and (for money roles) balance and past due. Newest first.
 */
export async function leaseSummaries(where: string, params: unknown[], opts: { today: string; money: boolean; limit?: number }): Promise<LeaseSummary[]> {
  const { rows } = await zite.sql({
    query: `
      SELECT l.id, l."number", l."name", l."status", l."leaseType", l."propertyId", l."unitId", l."startDate", l."endDate", l."moveInDate", l."moveOutDate", l."noticeGivenOn", l."rent", l."deposit", l."renewalStatus"
      FROM "Leases" l
      WHERE ${where}
      ORDER BY l."startDate" DESC NULLS LAST, l."number" DESC NULLS LAST
      LIMIT ${Math.min(2000, opts.limit ?? 500)}`,
    params,
  });
  const ids = rows.map(r => String(r.id));
  const [people, balances, pastDue] = await Promise.all([
    ids.length
      ? zite.sql({
          query: `
            SELECT lt."leaseId", lt."role", t.id, t."name", t."email", t."phone"
            FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId"
            WHERE lt."leaseId" = ANY($1)
            ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 WHEN 'Occupant' THEN 2 ELSE 3 END, t."name" ASC`,
          params: [ids],
        })
      : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    opts.money ? leaseBalances(ids) : Promise.resolve(new Map<string, { balance: number; depositHeld: number }>()),
    opts.money ? pastDueBy('leaseId', opts.today, ids) : Promise.resolve(new Map<string, number>()),
  ]);
  const residentsBy = new Map<string, LeaseSummary['residents']>();
  for (const p of people.rows) {
    const list = residentsBy.get(String(p.leaseId)) ?? [];
    list.push({ id: String(p.id), name: str(p.name) ?? '', role: str(p.role) || 'Primary', email: str(p.email) ?? '', phone: str(p.phone) ?? '' });
    residentsBy.set(String(p.leaseId), list);
  }
  return rows.map(r => {
    const id = String(r.id);
    const dates = { status: String(r.status), leaseType: str(r.leaseType), startDate: day(r.startDate), endDate: day(r.endDate), noticeGivenOn: day(r.noticeGivenOn), moveOutDate: day(r.moveOutDate) };
    return {
      id,
      number: numOrNull(r.number),
      name: str(r.name) ?? '',
      status: dates.status,
      leaseType: dates.leaseType || 'Fixed term',
      phase: leasePhase(dates, opts.today),
      propertyId: ref(r.propertyId) ?? '',
      unitId: ref(r.unitId) ?? '',
      startDate: dates.startDate,
      endDate: dates.endDate,
      moveInDate: day(r.moveInDate),
      moveOutDate: dates.moveOutDate,
      noticeGivenOn: dates.noticeGivenOn,
      rent: opts.money ? num(r.rent) : null,
      deposit: opts.money ? num(r.deposit) : null,
      balance: opts.money ? balances.get(id)?.balance ?? 0 : null,
      pastDue: opts.money ? pastDue.get(id) ?? 0 : null,
      residents: residentsBy.get(id) ?? [],
      renewalStatus: str(r.renewalStatus) || 'None',
    };
  });
}

/** Moves in and out and lease expirations in the next `days` days, soonest first. */
export async function upcomingLeaseEvents(where: string, params: unknown[], today: string, days = 60) {
  const until = addDays(today, days);
  const p = [...params, today, until];
  const t = `$${params.length + 1}`;
  const u = `$${params.length + 2}`;
  const { rows } = await zite.sql({
    query: `
      SELECT l.id, l."number", l."name", l."status", l."leaseType", l."unitId", l."startDate", l."endDate", l."moveInDate", l."moveOutDate", l."noticeGivenOn", l."renewalStatus"
      FROM "Leases" l
      WHERE ${where} AND l."status" IN ('Active', 'Pending signature') AND (
        (COALESCE(l."moveInDate", l."startDate") >= ${t}::date AND COALESCE(l."moveInDate", l."startDate") <= ${u}::date)
        OR (l."moveOutDate" >= ${t}::date AND l."moveOutDate" <= ${u}::date)
        OR (l."endDate" >= ${t}::date AND l."endDate" <= ${u}::date)
      )
      LIMIT 200`,
    params: p,
  });
  const events: Array<{ key: string; kind: 'move_in' | 'move_out' | 'expiring'; date: string; leaseId: string; leaseName: string; unitId: string; status: string; renewalStatus: string }> = [];
  for (const r of rows) {
    const base = { leaseId: String(r.id), leaseName: str(r.name) ?? '', unitId: ref(r.unitId) ?? '', status: String(r.status), renewalStatus: str(r.renewalStatus) || 'None' };
    const moveIn = day(r.moveInDate) ?? day(r.startDate);
    const moveOut = day(r.moveOutDate);
    const end = day(r.endDate);
    if (moveIn && moveIn >= today && moveIn <= until) events.push({ ...base, key: `${base.leaseId}:in`, kind: 'move_in', date: moveIn });
    if (moveOut && moveOut >= today && moveOut <= until) events.push({ ...base, key: `${base.leaseId}:out`, kind: 'move_out', date: moveOut });
    else if (end && end >= today && end <= until && r.status === 'Active' && str(r.leaseType) !== 'Month-to-month' && !day(r.noticeGivenOn)) {
      events.push({ ...base, key: `${base.leaseId}:end`, kind: 'expiring', date: end });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Active and pending-signature leases per property, for the archive guard. */
export async function liveLeaseCounts(column: 'propertyId' | 'unitId', ids: string[]) {
  if (!ids.length) return new Map<string, { active: number; pending: number }>();
  const { rows } = await zite.sql({
    query: `SELECT l."${column}" AS k, SUM(CASE WHEN l."status" = 'Active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN l."status" = 'Pending signature' THEN 1 ELSE 0 END) AS pending FROM "Leases" l WHERE l."${column}" = ANY($1) AND l."status" IN ('Active', 'Pending signature') GROUP BY l."${column}"`,
    params: [ids],
  });
  return new Map(rows.map(r => [String(r.k), { active: num(r.active), pending: num(r.pending) }]));
}

export const PROPERTY_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,9}$/;
