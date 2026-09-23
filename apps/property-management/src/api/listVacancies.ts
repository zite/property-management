import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { daysBetween, todayIn } from '@project/shared/dates';
import { unitOccupancy } from '@project/shared/leases';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, str } from '@project/shared/server/sql';

/**
 * The leasing to-do list: every unit that is vacant today or whose residents
 * have given notice, with how long it has sat empty, what it last rented for,
 * whether it's ready to show, how it's being marketed, and who has applied.
 */

export default createEndpoint({
  description: 'Vacant and on-notice units with listing and application status',
  authenticated: true,
  inputSchema: z.object({}),
  execute: async ({ context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const [units, leases, lastLeases, listings, apps, leads] = await Promise.all([
      zite.sql({
        query: `SELECT u.id, u."propertyId", u."name", u."beds", u."baths", u."squareFeet", u."marketRent", u."depositAmount", u."readiness", u."availableOn", u.created_at
                FROM "Units" u JOIN "Properties" p ON p.id::text = u."propertyId"
                WHERE COALESCE(u."archived", false) = false AND COALESCE(p."status", 'Active') <> 'Archived' LIMIT 2000`,
        params: [],
      }),
      zite.sql({ query: `SELECT id, "unitId", "status", "leaseType", "startDate", "endDate", "noticeGivenOn", "moveOutDate", "number", "rent" FROM "Leases" WHERE "status" IN ('Active', 'Pending signature') LIMIT 2000`, params: [] }),
      zite.sql({
        query: `SELECT DISTINCT ON ("unitId") "unitId", "rent", "number", COALESCE("moveOutDate", "endDate") AS "leftOn"
                FROM "Leases" WHERE "status" = 'Ended' ORDER BY "unitId", COALESCE("moveOutDate", "endDate") DESC NULLS LAST LIMIT 2000`,
        params: [],
      }),
      zite.sql({ query: `SELECT id, "unitId", "status", "title", "publishedAt", "views" FROM "Listings" WHERE "status" IN ('Published', 'Paused', 'Draft') ORDER BY CASE "status" WHEN 'Published' THEN 0 WHEN 'Paused' THEN 1 ELSE 2 END, created_at DESC`, params: [] }),
      zite.sql({ query: `SELECT "unitId", COUNT(*) AS n, SUM(CASE WHEN "status" = 'Approved' THEN 1 ELSE 0 END) AS approved FROM "Applications" WHERE "status" IN ('Submitted', 'Screening', 'Approved') GROUP BY "unitId"`, params: [] }),
      zite.sql({ query: `SELECT "unitId", COUNT(*) AS n FROM "Inquiries" WHERE COALESCE("status", 'New') NOT IN ('Applied', 'Closed') GROUP BY "unitId"`, params: [] }),
    ]);

    const leasesByUnit = new Map<string, Array<{ id: string; status: string; leaseType: string; startDate: string | null; endDate: string | null; noticeGivenOn: string | null; moveOutDate: string | null; number: number | null; rent: number }>>();
    for (const l of leases.rows) {
      const k = String(l.unitId);
      leasesByUnit.set(k, [...(leasesByUnit.get(k) ?? []), { id: String(l.id), status: String(l.status), leaseType: str(l.leaseType) ?? '', startDate: day(l.startDate), endDate: day(l.endDate), noticeGivenOn: day(l.noticeGivenOn), moveOutDate: day(l.moveOutDate), number: numOrNull(l.number), rent: num(l.rent) }]);
    }
    const lastByUnit = new Map(lastLeases.rows.map(r => [String(r.unitId), { rent: numOrNull(r.rent), number: numOrNull(r.number), leftOn: day(r.leftOn) }]));
    const listingByUnit = new Map<string, { id: string; status: string; title: string; publishedAt: string | null; views: number }>();
    for (const l of listings.rows) {
      const k = String(l.unitId);
      if (!listingByUnit.has(k)) listingByUnit.set(k, { id: String(l.id), status: String(l.status), title: str(l.title) ?? '', publishedAt: iso(l.publishedAt), views: num(l.views) });
    }
    const appsByUnit = new Map(apps.rows.map(r => [String(r.unitId), { open: num(r.n), approved: num(r.approved) }]));
    const leadsByUnit = new Map(leads.rows.map(r => [String(r.unitId), num(r.n)]));

    const vacancies = units.rows
      .map(u => {
        const id = String(u.id);
        const ls = leasesByUnit.get(id) ?? [];
        const occ = unitOccupancy(ls, today);
        if (occ.occupancy === 'Occupied') return null;
        const current = ls.find(l => l.id === occ.currentLeaseId);
        const upcoming = ls.find(l => l.id === occ.upcomingLeaseId);
        const last = lastByUnit.get(id);
        const moveOut = current ? current.moveOutDate ?? current.endDate : null;
        const vacantSince = occ.occupancy === 'Vacant' ? (last?.leftOn && last.leftOn <= today ? last.leftOn : day(u.created_at)) : null;
        const listing = listingByUnit.get(id) ?? null;
        const a = appsByUnit.get(id) ?? { open: 0, approved: 0 };
        return {
          unitId: id,
          propertyId: String(u.propertyId),
          occupancy: occ.occupancy as 'Vacant' | 'Notice',
          readiness: str(u.readiness) || 'Ready',
          marketRent: numOrNull(u.marketRent),
          deposit: numOrNull(u.depositAmount),
          availableOn: day(u.availableOn) ?? (moveOut ? moveOut : null),
          vacantSince,
          daysVacant: vacantSince ? Math.max(0, daysBetween(vacantSince, today)) : null,
          moveOutDate: moveOut,
          daysUntilMoveOut: moveOut ? daysBetween(today, moveOut) : null,
          currentLeaseId: current?.id ?? null,
          currentRent: current?.rent ?? null,
          lastRent: current?.rent ?? last?.rent ?? null,
          upcomingLease: upcoming ? { id: upcoming.id, number: upcoming.number, startDate: upcoming.startDate, status: upcoming.status } : null,
          listing: listing ? { ...listing, daysOnMarket: listing.status === 'Published' && listing.publishedAt ? Math.max(0, daysBetween(listing.publishedAt.slice(0, 10), today)) : null } : null,
          openApplications: a.open,
          approvedApplications: a.approved,
          openLeads: leadsByUnit.get(id) ?? 0,
        };
      });

    return { vacancies: vacancies.filter(v => v !== null).map(v => v!), today };
  },
});
