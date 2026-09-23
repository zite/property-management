import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { LEASE_PHASES, LEASE_TYPES, RENEWAL_STATUSES } from '@project/shared/constants';
import { todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { day, num, numOrNull, ref, str, Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { daysLeft, phaseFor } from '../server/leaseStaff';

/**
 * Leases for lists and tables. Phase is derived from today's date, so phase,
 * "expiring within" and "has a balance" filter after the query; everything
 * stored filters in SQL. Ended and canceled leases only appear when asked for
 * (the closed toggle, or a phase filter that names them).
 */

const id = z.string().min(1);
export const LeaseFilters = z.object({
  phases: z.array(z.enum(LEASE_PHASES)).optional(),
  propertyIds: z.array(id).optional(),
  unitIds: z.array(id).optional(),
  tenantId: id.optional(),
  leaseTypes: z.array(z.enum(LEASE_TYPES)).optional(),
  renewalStatuses: z.array(z.enum(RENEWAL_STATUSES)).optional(),
  expiringWithin: z.enum(['30', '60', '90']).optional(),
  hasBalance: z.boolean().optional(),
  search: z.string().max(120).optional(),
  showClosed: z.boolean().optional(),
});

const Input = z.object({ filters: LeaseFilters.default({}) });

export default createEndpoint({
  description: 'List leases with derived phase, balance and deposit held',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const { filters: f } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const p = new Params();
    const where: string[] = [];
    const closedAsked = f.showClosed || f.phases?.some(x => x === 'Ended' || x === 'Canceled');
    if (!closedAsked) where.push(`l."status" NOT IN ('Ended', 'Canceled')`);
    if (f.propertyIds?.length) where.push(`l."propertyId" IN ${p.list(f.propertyIds)}`);
    if (f.unitIds?.length) where.push(`l."unitId" IN ${p.list(f.unitIds)}`);
    if (f.leaseTypes?.length) where.push(`l."leaseType" IN ${p.list(f.leaseTypes)}`);
    if (f.renewalStatuses?.length) {
      const none = f.renewalStatuses.includes('None');
      const set = f.renewalStatuses.filter(s => s !== 'None');
      const parts = [...(set.length ? [`l."renewalStatus" IN ${p.list(set)}`] : []), ...(none ? [`COALESCE(l."renewalStatus", '') IN ('', 'None')`] : [])];
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.tenantId) where.push(`EXISTS (SELECT 1 FROM "LeaseTenants" x WHERE x."leaseId" = l.id::text AND x."tenantId" = ${p.add(f.tenantId)})`);
    if (f.search?.trim()) {
      const q = p.add(`%${f.search.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
      const n = /^\s*(l-?)?\d+\s*$/i.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(l."name" ILIKE ${q} OR l."number" = ${p.add(n)}
        OR EXISTS (SELECT 1 FROM "Units" u WHERE u.id::text = l."unitId" AND u."name" ILIKE ${q})
        OR EXISTS (SELECT 1 FROM "Properties" pr WHERE pr.id::text = l."propertyId" AND pr."name" ILIKE ${q})
        OR EXISTS (SELECT 1 FROM "LeaseTenants" x JOIN "Tenants" t ON t.id::text = x."tenantId" WHERE x."leaseId" = l.id::text AND (t."name" ILIKE ${q} OR t."email" ILIKE ${q} OR t."phone" ILIKE ${q})))`);
    }

    const { rows } = await zite.sql({
      query: `
        SELECT l.id, l."name", l."number", l."status", l."leaseType", l."propertyId", l."unitId", l."startDate", l."endDate", l."moveInDate", l."moveOutDate", l."noticeGivenOn",
          l."rent", l."deposit", l."rentDueDay", l."renewalStatus", l."renewalRent", l."renewalTermMonths", l."renewalExpiresOn", l."depositSettledAt", l."sentForSignatureAt", l."signedAt", l.created_at
        FROM "Leases" l
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY l."number" DESC NULLS LAST
        LIMIT 2000`,
      params: p.values,
    });
    const ids = rows.map(r => String(r.id));

    const [people, balances] = await Promise.all([
      ids.length
        ? zite.sql({
            query: `
              SELECT lt."leaseId", lt."role", t.id, t."name", t."email"
              FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId"
              WHERE lt."leaseId" = ANY($1)
              ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 WHEN 'Occupant' THEN 2 ELSE 3 END, lt.created_at ASC
              LIMIT 2000`,
            params: [ids],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      leaseBalances(ids),
    ]);
    const byLease = new Map<string, Array<{ id: string; name: string; email: string; role: string }>>();
    for (const r of people.rows) {
      const k = String(r.leaseId);
      if (!byLease.has(k)) byLease.set(k, []);
      byLease.get(k)!.push({ id: String(r.id), name: str(r.name) ?? '', email: str(r.email) ?? '', role: str(r.role) || 'Primary' });
    }

    const leases = rows
      .map(r => {
        const l = {
          id: String(r.id),
          number: numOrNull(r.number),
          name: str(r.name) ?? '',
          status: str(r.status) || 'Draft',
          leaseType: str(r.leaseType) || 'Fixed term',
          propertyId: ref(r.propertyId),
          unitId: ref(r.unitId),
          startDate: day(r.startDate),
          endDate: day(r.endDate),
          moveInDate: day(r.moveInDate),
          moveOutDate: day(r.moveOutDate),
          noticeGivenOn: day(r.noticeGivenOn),
          rent: num(r.rent),
          deposit: num(r.deposit),
          rentDueDay: num(r.rentDueDay, 1),
          renewalStatus: str(r.renewalStatus) || 'None',
          renewalRent: numOrNull(r.renewalRent),
          renewalTermMonths: numOrNull(r.renewalTermMonths),
          renewalExpiresOn: day(r.renewalExpiresOn),
          depositSettled: Boolean(r.depositSettledAt),
          createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
        };
        const bal = balances.get(l.id);
        return {
          ...l,
          phase: phaseFor(l, today, settings),
          daysToEnd: daysLeft(l.endDate, today),
          residents: byLease.get(l.id) ?? [],
          balance: bal?.balance ?? 0,
          depositHeld: bal?.depositHeld ?? 0,
        };
      })
      .filter(l => !f.phases?.length || f.phases.includes(l.phase))
      .filter(l => !f.expiringWithin || (l.status === 'Active' && l.daysToEnd != null && l.daysToEnd >= 0 && l.daysToEnd <= Number(f.expiringWithin) && l.leaseType !== 'Month-to-month'))
      .filter(l => !f.hasBalance || l.balance > 0.004);

    return { leases, today, truncated: rows.length >= 2000 };
  },
});
