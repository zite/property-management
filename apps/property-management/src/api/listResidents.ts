import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { isOccupying } from '@project/shared/leases';
import { assertCan, getActor } from '@project/shared/server/actor';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { phaseFor } from '../server/leaseStaff';

/**
 * Residents: everyone who is, will be, or was on a lease (and anyone added
 * without one). Each shows the lease that matters most right now — the one
 * they live under, else the one they're moving into, else their latest.
 */

const Filters = z.object({
  status: z.enum(['current', 'future', 'past', 'all']).default('current'),
  propertyIds: z.array(z.string().min(1)).optional(),
  hasBalance: z.boolean().optional(),
  portal: z.array(z.enum(['active', 'invited', 'none'])).optional(),
  search: z.string().max(120).optional(),
});
const Input = z.object({ filters: Filters.default({ status: 'current' }) });

type LeaseLink = { leaseId: string; number: number | null; status: string; leaseType: string; startDate: string | null; endDate: string | null; moveInDate: string | null; moveOutDate: string | null; noticeGivenOn: string | null; propertyId: string | null; unitId: string | null; role: string; rent: number; place: string };

export default createEndpoint({
  description: 'List residents with their current lease, balance and portal status',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const { filters: f } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const [tenants, links] = await Promise.all([
      zite.sql({
        query: `SELECT id, "name", "email", "phone", "altPhone", "company", "color", "pets", "portalInvitedAt", "portalSeenAt", created_at FROM "Tenants" WHERE COALESCE("archived", false) = false ORDER BY "name" ASC LIMIT 2000`,
        params: [],
      }),
      zite.sql({
        query: `
          SELECT lt."tenantId", lt."role", l.id AS "leaseId", l."number", l."status", l."leaseType", l."startDate", l."endDate", l."moveInDate", l."moveOutDate", l."noticeGivenOn", l."propertyId", l."unitId", l."rent", u."name" AS "unitName", p."name" AS "propertyName"
          FROM "LeaseTenants" lt JOIN "Leases" l ON l.id::text = lt."leaseId"
          LEFT JOIN "Units" u ON u.id::text = l."unitId" LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
          WHERE l."status" <> 'Canceled'
          ORDER BY l."startDate" DESC NULLS LAST
          LIMIT 2000`,
        params: [],
      }),
    ]);

    const byTenant = new Map<string, LeaseLink[]>();
    for (const r of links.rows) {
      const k = String(r.tenantId);
      if (!byTenant.has(k)) byTenant.set(k, []);
      byTenant.get(k)!.push({
        leaseId: String(r.leaseId), number: numOrNull(r.number), status: str(r.status) || 'Draft', leaseType: str(r.leaseType) || 'Fixed term', startDate: day(r.startDate), endDate: day(r.endDate), moveInDate: day(r.moveInDate),
        moveOutDate: day(r.moveOutDate), noticeGivenOn: day(r.noticeGivenOn), propertyId: ref(r.propertyId), unitId: ref(r.unitId), role: str(r.role) || 'Primary', rent: num(r.rent), place: `${str(r.propertyName) ?? ''} ${str(r.unitName) ?? ''}`,
      });
    }

    const pick = (ls: LeaseLink[]) => {
      const current = ls.find(l => isOccupying(l, today));
      if (current) return { lease: current, status: 'current' as const };
      const future = ls.find(l => (l.status === 'Active' || l.status === 'Pending signature' || l.status === 'Draft') && (!l.startDate || l.startDate > today));
      if (future) return { lease: future, status: 'future' as const };
      const past = [...ls].sort((a, b) => (b.moveOutDate ?? b.endDate ?? '').localeCompare(a.moveOutDate ?? a.endDate ?? ''))[0];
      return past ? { lease: past, status: 'past' as const } : { lease: null, status: 'none' as const };
    };

    const rows = tenants.rows.map(t => {
      const leases = byTenant.get(String(t.id)) ?? [];
      const { lease, status } = pick(leases);
      const portal = t.portalSeenAt ? 'active' : t.portalInvitedAt ? 'invited' : 'none';
      return {
        id: String(t.id),
        name: str(t.name) ?? '',
        email: str(t.email) ?? '',
        phone: str(t.phone) ?? '',
        company: str(t.company) ?? '',
        color: str(t.color) ?? '',
        pets: str(t.pets) ?? '',
        portal: portal as 'active' | 'invited' | 'none',
        portalSeenAt: iso(t.portalSeenAt),
        status,
        leaseCount: leases.length,
        place: lease?.place ?? '',
        lease: lease
          ? { id: lease.leaseId, number: lease.number, status: lease.status, role: lease.role, propertyId: lease.propertyId, unitId: lease.unitId, startDate: lease.startDate, endDate: lease.endDate, moveInDate: lease.moveInDate ?? lease.startDate, moveOutDate: lease.moveOutDate, rent: lease.rent, phase: phaseFor(lease, today, settings) }
          : null,
      };
    });

    const q = f.search?.trim().toLowerCase();
    const filtered = rows
      .filter(r => f.status === 'all' || r.status === f.status)
      .filter(r => !f.propertyIds?.length || (r.lease?.propertyId && f.propertyIds.includes(r.lease.propertyId)))
      .filter(r => !f.portal?.length || f.portal.includes(r.portal))
      .filter(r => !q || `${r.name} ${r.email} ${r.phone} ${r.company} ${r.place}`.toLowerCase().includes(q) || (q.replace(/\D/g, '').length >= 4 && r.phone.replace(/\D/g, '').includes(q.replace(/\D/g, ''))));

    const balances = await leaseBalances([...new Set(filtered.map(r => r.lease?.id).filter(Boolean) as string[])]);
    const residents = filtered
      .map(r => ({ ...r, balance: r.lease ? balances.get(r.lease.id)?.balance ?? 0 : 0 }))
      .filter(r => !f.hasBalance || r.balance > 0.004);

    const counts = { current: 0, future: 0, past: 0, all: rows.length };
    for (const r of rows) if (r.status !== 'none') counts[r.status]++;
    return { residents, counts, today };
  },
});
