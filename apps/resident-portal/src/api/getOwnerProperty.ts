import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { periodLabel, periodOf } from '@project/shared/dates';
import { sumMoney } from '@project/shared/money';
import { leaseBalances } from '@project/shared/server/ledger';
import { ownerStatement, statementPeriod } from '@project/shared/server/ownerStatement';
import { day, iso, json, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { ownerScope, propertyAddress, requireOwnerProperty, unitsWithOccupancy } from '../server/owner';

/**
 * One of the owner's properties: its details, the rent roll with each
 * household's balance, vacancies and how they're being marketed, repairs with
 * their costs, and income and expenses this month and this year.
 * Residents' names only — never their contact details.
 */

const Input = z.object({ id: z.string().min(1).max(64) });

export default createEndpoint({
  description: "One of the owner's properties",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { id } = parseInput(Input, input, "We couldn't find that property.");
    const scope = await ownerScope(context);
    requireOwnerProperty(scope, id);
    const { today } = scope;
    const month = statementPeriod(periodOf(today), today);
    const ytd = statementPeriod('ytd', today);

    const [propRows, units, monthSt, ytdSt, listings, workOrders, pastDue] = await Promise.all([
      zite.sql({
        query: `
          SELECT p.*, m."name" AS "managerName", m."email" AS "managerEmail", m."phone" AS "managerPhone"
          FROM "Properties" p LEFT JOIN "Members" m ON m.id::text = p."managerId"
          WHERE p.id::text = $1 LIMIT 1`,
        params: [id],
      }),
      unitsWithOccupancy([id], today),
      ownerStatement({ propertyIds: [id], periodStart: month.periodStart, periodEnd: month.periodEnd }),
      ownerStatement({ propertyIds: [id], periodStart: ytd.periodStart, periodEnd: ytd.periodEnd }),
      zite.sql({
        query: `SELECT "unitId", "status", "title", "slug", "rent", "availableOn", "publishedAt", "views" FROM "Listings" WHERE "propertyId" = $1 AND "status" <> 'Leased' ORDER BY created_at DESC`,
        params: [id],
      }),
      zite.sql({
        query: `
          SELECT w.id, w."number", w."title", w."status", w."priority", w."category", w."scheduledFor", w."completedAt", w."reportedAt", w."estimateAmount", w."actualCost", w."ownerApproval",
            u."name" AS "unitName", v."name" AS "vendorName"
          FROM "WorkOrders" w LEFT JOIN "Units" u ON u.id::text = w."unitId" LEFT JOIN "Vendors" v ON v.id::text = w."vendorId"
          WHERE w."propertyId" = $1 AND w."status" <> 'Canceled'
          ORDER BY CASE WHEN w."status" IN ('Completed') THEN 1 ELSE 0 END, COALESCE(w."completedAt", w."reportedAt", w.created_at) DESC
          LIMIT 60`,
        params: [id],
      }),
      zite.sql({
        query: `
          SELECT t."leaseId", SUM(t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0)) AS "pastDue"
          FROM "Transactions" t
          WHERE t."propertyId" = $1 AND t."kind" = 'Charge' AND t."status" = 'Posted' AND COALESCE(t."dueDate", t."date") < $2 AND COALESCE(t."leaseId", '') <> ''
          GROUP BY t."leaseId"`,
        params: [id, today],
      }),
    ]);

    const p = propRows.rows[0];
    const balances = await leaseBalances(units.filter(u => u.lease).map(u => u.lease!.id));
    const pastDueBy = new Map(pastDue.rows.map(r => [String(r.leaseId), num(r.pastDue)]));
    const listingBy = new Map<string, Record<string, unknown>>();
    for (const l of listings.rows) if (!listingBy.has(String(l.unitId))) listingBy.set(String(l.unitId), l);

    const rentRoll = units.map(u => {
      const balance = u.lease ? balances.get(u.lease.id)?.balance ?? 0 : 0;
      const overdue = u.lease ? Math.min(Math.max(0, balance), Math.max(0, pastDueBy.get(u.lease.id) ?? 0)) : 0;
      return {
        unitId: u.id,
        unitName: u.name,
        beds: u.beds,
        baths: u.baths,
        squareFeet: u.squareFeet,
        marketRent: u.marketRent,
        occupancy: u.occupancy,
        residents: u.lease?.residents ?? [],
        leaseStart: u.lease?.startDate ?? null,
        leaseEnd: u.lease?.endDate ?? null,
        leaseType: u.lease?.leaseType ?? '',
        moveOutDate: u.lease?.moveOutDate ?? null,
        rent: u.lease?.rent ?? 0,
        balance,
        pastDue: overdue,
        status: !u.lease ? 'Vacant' : overdue > 0 ? 'Past due' : 'Current',
      };
    });

    const figures = (f: typeof monthSt.combined) => ({
      income: f.income,
      expenses: f.expenses,
      netOperatingCashFlow: f.netOperatingCashFlow,
      distributions: f.ownerActivity.distributions,
      contributions: f.ownerActivity.contributions,
      endingCash: f.endingCash,
    });

    return {
      currency: scope.settings.currency,
      today,
      property: {
        id,
        name: str(p?.name) ?? 'Property',
        address: p ? propertyAddress(p) : '',
        propertyType: str(p?.propertyType) ?? '',
        yearBuilt: numOrNull(p?.yearBuilt),
        photoUrl: ref(p?.photoUrl),
        color: str(p?.color) || '#64748b',
        description: str(p?.description) ?? '',
        amenities: json<string[]>(p?.amenities, []).filter(a => typeof a === 'string'),
        petPolicy: str(p?.petPolicy) ?? '',
        parking: str(p?.parking) ?? '',
        acquiredOn: day(p?.acquiredOn),
        reserve: num(p?.reserveAmount),
        manager: ref(p?.managerName) ? { name: str(p?.managerName) ?? '', email: str(p?.managerEmail) ?? '', phone: str(p?.managerPhone) ?? '' } : null,
      },
      stats: {
        units: units.length,
        occupied: units.filter(u => u.occupancy === 'Occupied').length,
        notice: units.filter(u => u.occupancy === 'Notice').length,
        vacant: units.filter(u => u.occupancy === 'Vacant').length,
        scheduledRent: sumMoney(rentRoll.map(r => r.rent)),
        marketRent: sumMoney(units.map(u => u.marketRent)),
        pastDue: sumMoney(rentRoll.map(r => r.pastDue)),
        cash: monthSt.combined.endingCash,
        depositsHeld: monthSt.combined.depositsHeld,
        reserve: monthSt.combined.reserve,
        unpaidBills: monthSt.combined.unpaidBills,
        available: monthSt.combined.availableForDistribution,
      },
      rentRoll,
      vacancies: units
        .filter(u => u.occupancy !== 'Occupied')
        .map(u => {
          const l = listingBy.get(u.id);
          return {
            unitId: u.id,
            unitName: u.name,
            occupancy: u.occupancy,
            readiness: u.readiness,
            availableOn: u.availableOn ?? u.lease?.moveOutDate ?? null,
            marketRent: u.marketRent,
            upcomingLeaseStart: u.upcomingLease?.startDate ?? null,
            listing: l ? { status: str(l.status) ?? 'Draft', title: str(l.title) ?? '', slug: str(l.slug) ?? '', rent: num(l.rent), publishedAt: iso(l.publishedAt), views: num(l.views) } : null,
          };
        }),
      workOrders: workOrders.rows.map(w => {
        const status = str(w.status) || 'New';
        return {
          id: String(w.id),
          number: num(w.number),
          title: str(w.title) ?? '',
          status,
          priority: str(w.priority) || 'Normal',
          category: str(w.category) ?? '',
          unitName: str(w.unitName) ?? '',
          vendorName: str(w.vendorName) ?? '',
          scheduledFor: iso(w.scheduledFor),
          completedAt: iso(w.completedAt),
          reportedAt: iso(w.reportedAt),
          estimate: numOrNull(w.estimateAmount),
          cost: status === 'Completed' ? numOrNull(w.actualCost) : null,
          ownerApproval: str(w.ownerApproval) || 'Not required',
          open: status !== 'Completed',
        };
      }),
      finances: {
        month: { label: periodLabel(periodOf(today)), ...figures(monthSt.combined) },
        ytd: { label: `${today.slice(0, 4)} year to date`, ...figures(ytdSt.combined) },
      },
      warnings: [...new Set([...monthSt.warnings, ...ytdSt.warnings])],
    };
  },
});
