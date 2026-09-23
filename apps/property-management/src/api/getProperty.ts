import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { periodOf, todayIn } from '@project/shared/dates';
import { fromCents, sumMoney, toCents } from '@project/shared/money';
import { can, getActor } from '@project/shared/server/actor';
import { bankBalances, collectedIncome } from '@project/shared/server/ledger';
import { ownerStatement } from '@project/shared/server/ownerStatement';
import { getSettings } from '@project/shared/server/settings';
import { num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canSeeMoney, liveLeaseCounts, loadProperty, pastDueBy, upcomingLeaseEvents } from '../server/portfolio';
import { timelineActivity } from '../server/timeline';

/**
 * One property with what its page needs up front: the full record, today's
 * money (for roles that may see it), what's coming up in the next 60 days,
 * open work, lease counts for the archive guard, and history.
 *
 * Cash, deposits held and available-for-distribution come from the owner
 * statement engine for the month to date, so the Overview tile and the
 * owner's statement can never disagree.
 */

const Input = z.object({ id: z.string().min(1), activityLimit: z.number().int().min(1).max(300).optional() });

export default createEndpoint({
  description: 'Get a property with its money, upcoming events, open work and history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { id, activityLimit = 150 } = parseInput(Input, input);
    const property = await loadProperty(id);
    if (!property) throw new ZiteError('That property doesn’t exist, or it was deleted.', 'NOT_FOUND');
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = canSeeMoney(actor);
    const period = periodOf(today);

    const [units, scheduled, workOrders, workCounts, events, activity, leaseCounts, docCount, statement, banks, collected, pastDue] = await Promise.all([
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "Units" u WHERE u."propertyId" = $1 AND COALESCE(u."archived", false) = false`, params: [id] }),
      zite.sql({
        query: `SELECT COALESCE(SUM(l."rent"), 0) AS rent, COUNT(*) AS n FROM "Leases" l WHERE l."propertyId" = $1 AND l."status" = 'Active' AND (l."startDate" IS NULL OR l."startDate" <= $2::date) AND (l."moveOutDate" IS NULL OR l."moveOutDate" >= $2::date)`,
        params: [id, today],
      }),
      zite.sql({
        query: `
          SELECT w.id, w."number", w."title", w."status", w."priority", w."unitId", w."dueDate", w."assigneeId", w."vendorId"
          FROM "WorkOrders" w
          WHERE w."propertyId" = $1 AND w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')
          ORDER BY CASE w."priority" WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, w."dueDate" ASC NULLS LAST, w."number" DESC
          LIMIT 6`,
        params: [id],
      }),
      zite.sql({
        query: `
          SELECT w."status", COUNT(*) AS n, SUM(CASE WHEN w."priority" = 'Emergency' THEN 1 ELSE 0 END) AS emergency,
            SUM(CASE WHEN w."dueDate" < $2::date THEN 1 ELSE 0 END) AS overdue
          FROM "WorkOrders" w WHERE w."propertyId" = $1 AND w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')
          GROUP BY w."status"`,
        params: [id, today],
      }),
      upcomingLeaseEvents(`l."propertyId" = $1`, [id], today, 60),
      timelineActivity('propertyId', id, activityLimit),
      liveLeaseCounts('propertyId', [id]),
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "Documents" WHERE "propertyId" = $1`, params: [id] }),
      money ? ownerStatement({ propertyIds: [id], periodStart: `${period}-01`, periodEnd: today }) : Promise.resolve(null),
      money ? bankBalances({ propertyId: id }) : Promise.resolve(new Map<string, number>()),
      money ? collectedIncome(period, id) : Promise.resolve(new Map<string, number>()),
      money ? pastDueBy('propertyId', today, [id]) : Promise.resolve(new Map<string, number>()),
    ]);

    const s = statement?.properties[0] ?? null;

    const counts = leaseCounts.get(id) ?? { active: 0, pending: 0 };
    const byStatus = Object.fromEntries(workCounts.rows.map(r => [String(r.status), num(r.n)]));
    const cashAccounts = [...banks.entries()].filter(([, v]) => toCents(v) !== 0).map(([accountId, balance]) => ({ accountId, balance }));

    return {
      today,
      money,
      canManage: can(actor.role, 'portfolio.manage'),
      property,
      leases: { active: counts.active, pending: counts.pending },
      unitCount: num(units.rows[0]?.n),
      documentCount: num(docCount.rows[0]?.n),
      finances: money
        ? {
            scheduledRent: fromCents(toCents(num(scheduled.rows[0]?.rent))),
            collectedThisMonth: collected.get(id) ?? 0,
            pastDue: pastDue.get(id) ?? 0,
            cash: sumMoney(cashAccounts.map(a => a.balance)),
            cashAccounts,
            depositsHeld: s?.depositsHeld ?? 0,
            reserve: s?.reserve ?? property.reserveAmount,
            unpaidBills: s?.unpaidBills ?? 0,
            availableForDistribution: s?.availableForDistribution ?? 0,
            statementReconciled: s?.reconciled ?? true,
          }
        : null,
      events,
      workOrders: {
        open: workCounts.rows.reduce((a, r) => a + num(r.n), 0),
        emergency: workCounts.rows.reduce((a, r) => a + num(r.emergency), 0),
        overdue: workCounts.rows.reduce((a, r) => a + num(r.overdue), 0),
        byStatus,
        top: workOrders.rows.map(w => ({ id: String(w.id), number: num(w.number), title: str(w.title) ?? '', status: String(w.status), priority: String(w.priority), unitId: ref(w.unitId), dueDate: w.dueDate ? String(w.dueDate).slice(0, 10) : null, assigneeId: ref(w.assigneeId), vendorId: ref(w.vendorId) })),
      },
      activity,
    };
  },
});
