import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addPeriods, periodEnd, periodLabel, periodOf } from '@project/shared/dates';
import { sumMoney } from '@project/shared/money';
import { getChart } from '@project/shared/server/accounts';
import { monthlyCashFlow, ownerStatement, statementPeriod } from '@project/shared/server/ownerStatement';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { ownerScope, propertyAddress, unitsWithOccupancy } from '../server/owner';

/**
 * The owner's portfolio at a glance: occupancy, this month's rent, cash flow
 * this month and this year, what's available to distribute today, each
 * property, repairs waiting on them, recent distributions and maintenance, and
 * eight months of income against expenses. Cash basis, from the posted books.
 */

const Input = z.object({});

export default createEndpoint({
  description: "The owner's portfolio overview",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await ownerScope(context);
    const { propertyIds, today, settings } = scope;
    const period = periodOf(today);
    const month = statementPeriod(period, today);
    const ytd = statementPeriod('ytd', today);
    const chart = await getChart();

    const [props, units, monthSt, ytdSt, series, rent, approvals, distributions, maintenance] = await Promise.all([
      propertyIds.length
        ? zite.sql({ query: `SELECT id, "name", "street", "city", "state", "postalCode", "photoUrl", "color", "propertyType" FROM "Properties" WHERE id::text = ANY($1) ORDER BY "name" ASC`, params: [propertyIds] })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      unitsWithOccupancy(propertyIds, today),
      ownerStatement({ propertyIds, periodStart: month.periodStart, periodEnd: month.periodEnd }),
      ownerStatement({ propertyIds, periodStart: ytd.periodStart, periodEnd: ytd.periodEnd }),
      monthlyCashFlow({ propertyIds, fromPeriod: addPeriods(period, -7), toPeriod: period, throughDay: today }),
      zite.sql({
        query: `
          SELECT c."propertyId" AS pid, SUM(c."amount") AS charged,
            SUM(COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = c.id::text AND COALESCE(a."void", false) = false), 0)) AS collected
          FROM "Transactions" c
          WHERE c."kind" = 'Charge' AND c."status" = 'Posted' AND c."accountId" = $2 AND c."propertyId" = ANY($1) AND c."date" >= $3 AND c."date" <= $4
          GROUP BY c."propertyId"`,
        params: [propertyIds, chart.key('rent_income').id, `${period}-01`, periodEnd(period)],
      }),
      zite.sql({
        query: `
          SELECT w.id, w."number", w."title", w."estimateAmount", p."name" AS "propertyName", u."name" AS "unitName"
          FROM "WorkOrders" w JOIN "Properties" p ON p.id::text = w."propertyId" LEFT JOIN "Units" u ON u.id::text = w."unitId"
          WHERE w."propertyId" = ANY($1) AND w."ownerApproval" = 'Pending' AND w."status" NOT IN ('Completed', 'Canceled')
          ORDER BY w."reportedAt" ASC NULLS LAST`,
        params: [propertyIds],
      }),
      zite.sql({
        query: `
          SELECT t.id, t."date", t."amount", t."paymentMethod", t."reference", p."name" AS "propertyName"
          FROM "Transactions" t LEFT JOIN "Properties" p ON p.id::text = t."propertyId"
          WHERE t."kind" = 'Owner distribution' AND t."status" = 'Posted' AND t."propertyId" = ANY($1)
          ORDER BY t."date" DESC, t."number" DESC LIMIT 6`,
        params: [propertyIds],
      }),
      zite.sql({
        query: `
          SELECT w."number", w."title", w."status", w."priority", w."actualCost", w."estimateAmount", w."completedAt", w."reportedAt", w."lastActivityAt", w."scheduledFor",
            p."name" AS "propertyName", u."name" AS "unitName"
          FROM "WorkOrders" w JOIN "Properties" p ON p.id::text = w."propertyId" LEFT JOIN "Units" u ON u.id::text = w."unitId"
          WHERE w."propertyId" = ANY($1) AND w."status" <> 'Canceled'
          ORDER BY COALESCE(w."lastActivityAt", w."completedAt", w."reportedAt", w.created_at) DESC LIMIT 6`,
        params: [propertyIds],
      }),
    ]);

    const rentBy = new Map(rent.rows.map(r => [String(r.pid), { charged: num(r.charged), collected: num(r.collected) }]));
    const monthBy = new Map(monthSt.properties.map(p => [p.propertyId, p]));
    const count = (list: typeof units, o: string) => list.filter(u => u.occupancy === o).length;
    const scheduledRent = sumMoney(units.filter(u => u.lease).map(u => u.lease!.rent));
    const rentCharged = sumMoney([...rentBy.values()].map(r => r.charged));

    return {
      owner: { name: scope.owner.name, contactName: scope.owner.contactName },
      today,
      period,
      periodLabel: periodLabel(period),
      currency: settings.currency,
      kpis: {
        units: units.length,
        occupied: count(units, 'Occupied'),
        notice: count(units, 'Notice'),
        vacant: count(units, 'Vacant'),
        rentCharged,
        rentScheduled: scheduledRent,
        rentCollected: sumMoney([...rentBy.values()].map(r => r.collected)),
        incomeMonth: monthSt.combined.income.total,
        expensesMonth: monthSt.combined.expenses.total,
        netCashFlowMonth: monthSt.combined.netOperatingCashFlow,
        netCashFlowYtd: ytdSt.combined.netOperatingCashFlow,
        availableToDistribute: monthSt.combined.availableForDistribution,
        endingCash: monthSt.combined.endingCash,
        distributionsYtd: ytdSt.combined.ownerActivity.distributions,
      },
      properties: props.rows.map(p => {
        const id = String(p.id);
        const list = units.filter(u => u.propertyId === id);
        const st = monthBy.get(id);
        return {
          id,
          name: str(p.name) ?? 'Property',
          address: propertyAddress(p),
          photoUrl: ref(p.photoUrl),
          color: str(p.color) || '#64748b',
          propertyType: str(p.propertyType) ?? '',
          units: list.length,
          occupied: count(list, 'Occupied'),
          notice: count(list, 'Notice'),
          vacant: count(list, 'Vacant'),
          incomeMonth: st?.income.total ?? 0,
          netMonth: st?.netOperatingCashFlow ?? 0,
          cash: st?.endingCash ?? 0,
          available: st?.availableForDistribution ?? 0,
        };
      }),
      approvals: approvals.rows.map(r => ({
        id: String(r.id),
        number: num(r.number),
        title: str(r.title) ?? '',
        estimate: numOrNull(r.estimateAmount),
        propertyName: str(r.propertyName) ?? '',
        unitName: str(r.unitName) ?? '',
      })),
      distributions: distributions.rows.map(r => ({
        id: String(r.id),
        date: day(r.date) ?? '',
        amount: num(r.amount),
        method: str(r.paymentMethod) ?? '',
        reference: str(r.reference) ?? '',
        propertyName: str(r.propertyName) ?? '',
      })),
      maintenance: maintenance.rows.map(r => ({
        number: num(r.number),
        title: str(r.title) ?? '',
        status: str(r.status) || 'New',
        priority: str(r.priority) || 'Normal',
        cost: str(r.status) === 'Completed' ? numOrNull(r.actualCost) : null,
        estimate: numOrNull(r.estimateAmount),
        completedAt: iso(r.completedAt),
        scheduledFor: iso(r.scheduledFor),
        updatedAt: iso(r.lastActivityAt) ?? iso(r.completedAt) ?? iso(r.reportedAt),
        propertyName: str(r.propertyName) ?? '',
        unitName: str(r.unitName) ?? '',
      })),
      cashFlow: series,
      warnings: [...new Set([...monthSt.warnings, ...ytdSt.warnings])],
    };
  },
});
