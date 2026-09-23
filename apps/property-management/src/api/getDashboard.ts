import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, addPeriods, daysBetween, formatDay, periodEnd, periodOf, periodStart } from '@project/shared/dates';
import { todayIn } from '@project/shared/dates';
import { applicationRef, workOrderRef } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import type { Tone } from '@project/shared/tone';
import { can, getActor } from '@project/shared/server/actor';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canManageAllTasks, TASK_FROM, TASK_SELECT, toTask } from '../server/tasks';

/**
 * Home: the first screen every morning. One call, a handful of parallel SQL
 * aggregates, and only what the signed-in role may see — maintenance never
 * receives rent figures, an accountant never receives work order queues.
 *
 * Definitions (so the numbers can be checked against the books):
 *   occupancy     units with an active lease in force today ÷ units that aren't archived
 *   billed        this month's recurring income charges (rent, pet, parking, utilities), excluding late fees
 *   collected     payments allocated to those charges, whenever the payment arrived
 *   received      payments dated this month, by day (the chart)
 *   past due      open charges whose due date has passed, capped at each lease's balance
 */

const Input = z.object({});
const OPEN_WO = `('New', 'Scheduled', 'In progress', 'On hold')`;
/** Rows sent per section. Home is a set of previews, not the lists themselves —
 *  the lead section shows 5 and the rest 3 (see Attention.tsx); "View all N" has
 *  the remainder. Kept low deliberately: ten sections at six rows each is a wall. */
const LIMIT = 5;

type Item = {
  id: string;
  to: string;
  title: string;
  meta: string | null;
  propertyId: string | null;
  unitId: string | null;
  amount: number | null;
  day: string | null;
  dayKind: 'due' | 'ends' | 'moveIn' | 'moveOut' | 'waiting' | 'expired' | null;
  priority: string | null;
  badge: { label: string; tone: Tone } | null;
  memberId: string | null;
};
type Section = { key: string; title: string; total: number; to: string | null; items: Item[] };

const item = (i: Partial<Item> & Pick<Item, 'id' | 'to' | 'title'>): Item => ({ meta: null, propertyId: null, unitId: null, amount: null, day: null, dayKind: null, priority: null, badge: null, memberId: null, ...i });
const none = { rows: [] as Record<string, unknown>[] };

export default createEndpoint({
  description: 'Home dashboard: key figures, what needs attention, charts and recent activity',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const period = periodOf(today);
    const has = (c: Parameters<typeof can>[1]) => can(actor.role, c);
    const seesWork = has('maintenance.manage');
    const seesWorkCounts = has('maintenance.create');
    const seesMoney = has('accounting.view');
    const seesLeases = has('residents.manage');
    const seesLeasing = has('leasing.manage');
    const seesBills = has('payables.manage');
    const seesVendors = has('vendors.manage');
    const seesMessages = has('communications.send') && (seesLeases || seesLeasing);
    const in14 = addDays(today, 14);
    const in60 = addDays(today, 60);
    const in7 = addDays(today, 7);

    const [units, collections, received, pastDue, woCounts, urgentWork, approvals, insurance, applications, renewals, moves, bills, messages, myTasks, expirations, woOpened, woCompleted, activity] = await Promise.all([
      zite.sql({
        query: `
          SELECT COUNT(*) AS "active", SUM(CASE WHEN x.occ THEN 1 ELSE 0 END) AS "occupied", SUM(CASE WHEN x.notice THEN 1 ELSE 0 END) AS "notice"
          FROM (
            SELECT u.id,
              EXISTS (SELECT 1 FROM "Leases" l WHERE l."unitId" = u.id::text AND l."status" = 'Active' AND (l."startDate" IS NULL OR l."startDate" <= $1::date) AND (l."moveOutDate" IS NULL OR l."moveOutDate" >= $1::date)) AS occ,
              EXISTS (SELECT 1 FROM "Leases" l WHERE l."unitId" = u.id::text AND l."status" = 'Active' AND (l."startDate" IS NULL OR l."startDate" <= $1::date) AND (l."moveOutDate" IS NULL OR l."moveOutDate" >= $1::date) AND (l."noticeGivenOn" IS NOT NULL OR l."moveOutDate" IS NOT NULL)) AS notice
            FROM "Units" u JOIN "Properties" p ON p.id::text = u."propertyId"
            WHERE COALESCE(u."archived", false) = false AND COALESCE(p."status", 'Active') <> 'Archived'
          ) x`,
        params: [today],
      }),
      seesMoney
        ? zite.sql({
            query: `
              SELECT COALESCE(SUM(x.amount), 0) AS "billed", COALESCE(SUM(x.paid), 0) AS "collected", COUNT(*) AS "charges"
              FROM (
                SELECT c."amount" AS amount,
                  COALESCE((SELECT SUM(a."amount") FROM "Allocations" a JOIN "Transactions" pay ON pay.id::text = a."paymentId"
                    WHERE a."chargeId" = c.id::text AND COALESCE(a."void", false) = false AND pay."kind" = 'Payment' AND pay."status" = 'Posted'), 0) AS paid
                FROM "Transactions" c JOIN "Accounts" acc ON acc.id::text = c."accountId"
                WHERE c."kind" = 'Charge' AND c."status" = 'Posted' AND c."period" = $1 AND acc."accountType" = 'Income' AND COALESCE(c."source", '') <> 'Late fee'
              ) x`,
            params: [period],
          })
        : none,
      seesMoney
        ? zite.sql({
            query: `SELECT t."date" AS "day", SUM(t."amount") AS "amount", COUNT(*) AS "payments" FROM "Transactions" t WHERE t."kind" = 'Payment' AND t."status" = 'Posted' AND t."date" >= $1::date AND t."date" <= $2::date GROUP BY t."date" ORDER BY t."date" ASC`,
            params: [periodStart(period), periodEnd(period)],
          })
        : none,
      seesMoney
        ? zite.sql({
            query: `
              SELECT x."leaseId", SUM(x.open) AS "open", MIN(x."dueDate") AS "oldestDue", l."name", l."status", l."propertyId", l."unitId"
              FROM (
                SELECT c."leaseId", c."dueDate", c."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = c.id::text AND COALESCE(a."void", false) = false), 0) AS open
                FROM "Transactions" c
                WHERE c."kind" = 'Charge' AND c."status" = 'Posted' AND COALESCE(c."leaseId", '') <> '' AND c."dueDate" < $1::date
              ) x
              JOIN "Leases" l ON l.id::text = x."leaseId"
              WHERE x.open > 0.004
              GROUP BY x."leaseId", l."name", l."status", l."propertyId", l."unitId"
              ORDER BY SUM(x.open) DESC
              LIMIT 500`,
            params: [today],
          })
        : none,
      seesWorkCounts
        ? zite.sql({
            query: `
              SELECT COUNT(*) AS "open",
                SUM(CASE WHEN w."priority" = 'Emergency' THEN 1 ELSE 0 END) AS "emergency",
                SUM(CASE WHEN w."dueDate" < $1::date THEN 1 ELSE 0 END) AS "overdue",
                SUM(CASE WHEN COALESCE(w."assigneeId", '') = '' THEN 1 ELSE 0 END) AS "unassigned",
                SUM(CASE WHEN w."assigneeId" = $2 THEN 1 ELSE 0 END) AS "mine",
                SUM(CASE WHEN w."ownerApproval" = 'Pending' THEN 1 ELSE 0 END) AS "approvals",
                SUM(CASE WHEN w."status" = 'New' THEN 1 ELSE 0 END) AS "new"
              FROM "WorkOrders" w WHERE w."status" IN ${OPEN_WO}`,
            params: [today, actor.id],
          })
        : none,
      seesWork
        ? zite.sql({
            query: `
              SELECT w.id, w."number", w."title", w."priority", w."status", w."dueDate", w."propertyId", w."unitId", w."assigneeId", v."name" AS "vendorName"
              FROM "WorkOrders" w LEFT JOIN "Vendors" v ON v.id::text = w."vendorId"
              WHERE w."status" IN ${OPEN_WO} AND (w."priority" = 'Emergency' OR w."dueDate" < $1::date)
              ORDER BY CASE WHEN w."priority" = 'Emergency' THEN 0 ELSE 1 END, w."dueDate" ASC NULLS LAST, w."number" DESC LIMIT 100`,
            params: [today],
          })
        : none,
      seesWork
        ? zite.sql({
            query: `
              SELECT w.id, w."number", w."title", w."priority", w."estimateAmount", w."propertyId", w."unitId", w."assigneeId", w."lastActivityAt", o."name" AS "ownerName"
              FROM "WorkOrders" w LEFT JOIN "Properties" p ON p.id::text = w."propertyId" LEFT JOIN "Owners" o ON o.id::text = p."ownerId"
              WHERE w."status" IN ${OPEN_WO} AND w."ownerApproval" = 'Pending'
              ORDER BY w."lastActivityAt" ASC NULLS LAST LIMIT 100`,
            params: [],
          })
        : none,
      seesVendors
        ? zite.sql({
            query: `
              SELECT v.id, v."name", v."insuranceExpiresOn", COUNT(w.id) AS "openWork", MIN(w."number") AS "firstNumber"
              FROM "Vendors" v JOIN "WorkOrders" w ON w."vendorId" = v.id::text AND w."status" IN ${OPEN_WO}
              WHERE v."insuranceExpiresOn" IS NOT NULL AND v."insuranceExpiresOn" < $1::date
              GROUP BY v.id, v."name", v."insuranceExpiresOn"
              ORDER BY v."insuranceExpiresOn" ASC LIMIT 100`,
            params: [today],
          })
        : none,
      seesLeasing
        ? zite.sql({
            query: `
              SELECT a.id, a."number", a."applicantName", a."status", a."submittedAt", a."propertyId", a."unitId", a."assigneeId", a."monthlyIncome"
              FROM "Applications" a WHERE a."status" IN ('Submitted', 'Screening')
              ORDER BY a."submittedAt" ASC NULLS LAST LIMIT 100`,
            params: [],
          })
        : none,
      seesLeases
        ? zite.sql({
            query: `
              SELECT l.id, l."name", l."endDate", l."renewalStatus", l."renewalExpiresOn", l."propertyId", l."unitId"
              FROM "Leases" l
              WHERE l."status" = 'Active' AND l."leaseType" = 'Fixed term' AND l."endDate" >= $1::date AND l."endDate" <= $2::date
                AND COALESCE(NULLIF(l."renewalStatus", ''), 'None') IN ('None', 'Offered') AND l."noticeGivenOn" IS NULL AND l."moveOutDate" IS NULL
              ORDER BY l."endDate" ASC LIMIT 100`,
            params: [today, in60],
          })
        : none,
      seesLeases
        ? zite.sql({
            query: `
              SELECT 'in' AS "kind", l.id, l."name", l."status", COALESCE(l."moveInDate", l."startDate") AS "day", l."propertyId", l."unitId"
              FROM "Leases" l WHERE l."status" IN ('Active', 'Pending signature') AND COALESCE(l."moveInDate", l."startDate") >= $1::date AND COALESCE(l."moveInDate", l."startDate") <= $2::date
              UNION ALL
              SELECT 'out' AS "kind", l.id, l."name", l."status", l."moveOutDate" AS "day", l."propertyId", l."unitId"
              FROM "Leases" l WHERE l."status" = 'Active' AND l."moveOutDate" >= $1::date AND l."moveOutDate" <= $2::date
              ORDER BY "day" ASC LIMIT 100`,
            params: [today, in14],
          })
        : none,
      seesBills
        ? zite.sql({
            query: `
              SELECT x.* FROM (
                SELECT b.id, b."number", b."dueDate", b."description", b."reference", b."propertyId", v."name" AS "vendorName",
                  b."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = b.id::text AND COALESCE(a."void", false) = false), 0) AS open
                FROM "Transactions" b LEFT JOIN "Vendors" v ON v.id::text = b."vendorId"
                WHERE b."kind" = 'Bill' AND b."status" = 'Posted' AND b."dueDate" <= $1::date
              ) x WHERE x.open > 0.004 ORDER BY x."dueDate" ASC LIMIT 200`,
            params: [in7],
          })
        : none,
      seesMessages
        ? zite.sql({
            query: `
              SELECT DISTINCT ON (m."thread") m."thread", m."subject", m."body", COALESCE(m."sentAt", m.created_at) AS "sentAt", m."tenantId", m."ownerId",
                COALESCE(NULLIF(t."name", ''), NULLIF(o."name", ''), NULLIF(m."senderName", '')) AS "fromName", w."number" AS "workOrderNumber",
                (SELECT COUNT(*) FROM "Messages" m2 WHERE m2."thread" = m."thread" AND m2."direction" = 'Inbound' AND m2."readAt" IS NULL) AS "unread"
              FROM "Messages" m
              LEFT JOIN "Tenants" t ON t.id::text = m."tenantId"
              LEFT JOIN "Owners" o ON o.id::text = m."ownerId"
              LEFT JOIN "WorkOrders" w ON w.id::text = m."workOrderId"
              WHERE m."direction" = 'Inbound' AND m."readAt" IS NULL AND (COALESCE(m."tenantId", '') <> '' OR COALESCE(m."ownerId", '') <> '')
              ORDER BY m."thread", COALESCE(m."sentAt", m.created_at) DESC
              LIMIT 200`,
            params: [],
          })
        : none,
      zite.sql({
        query: `SELECT ${TASK_SELECT} FROM ${TASK_FROM} WHERE t."assigneeId" = $1 AND COALESCE(NULLIF(t."status", ''), 'To do') IN ('To do', 'In progress') AND t."dueDate" <= $2::date ORDER BY t."dueDate" ASC LIMIT 100`,
        params: [actor.id, today],
      }),
      seesLeases
        ? zite.sql({
            query: `
              SELECT to_char(l."endDate", 'YYYY-MM') AS "period", COUNT(*) AS "total",
                SUM(CASE WHEN l."noticeGivenOn" IS NOT NULL OR l."moveOutDate" IS NOT NULL OR l."renewalStatus" = 'Declined' THEN 1 ELSE 0 END) AS "movingOut",
                SUM(CASE WHEN l."renewalStatus" = 'Offered' THEN 1 ELSE 0 END) AS "offered",
                SUM(CASE WHEN l."renewalStatus" = 'Accepted' THEN 1 ELSE 0 END) AS "renewing"
              FROM "Leases" l
              WHERE l."status" = 'Active' AND l."leaseType" = 'Fixed term' AND l."endDate" >= $1::date AND l."endDate" <= $2::date
              GROUP BY to_char(l."endDate", 'YYYY-MM')`,
            params: [periodStart(period), periodEnd(addPeriods(period, 5))],
          })
        : none,
      seesWork
        ? zite.sql({
            query: `SELECT FLOOR(($1::date - COALESCE(w."reportedAt", w.created_at)::date) / 7) AS "weeksAgo", COUNT(*) AS "n" FROM "WorkOrders" w WHERE COALESCE(w."reportedAt", w.created_at)::date > ($1::date - 56) AND COALESCE(w."reportedAt", w.created_at)::date <= $1::date GROUP BY 1`,
            params: [today],
          })
        : none,
      seesWork
        ? zite.sql({
            query: `SELECT FLOOR(($1::date - w."completedAt"::date) / 7) AS "weeksAgo", COUNT(*) AS "n" FROM "WorkOrders" w WHERE w."status" = 'Completed' AND w."completedAt" IS NOT NULL AND w."completedAt"::date > ($1::date - 56) AND w."completedAt"::date <= $1::date GROUP BY 1`,
            params: [today],
          })
        : none,
      zite.sql({
        query: `
          SELECT a.id, a."summary", a."entityType", a."entityId", a."actorId", a."actorName", COALESCE(a."occurredAt", a.created_at) AS "occurredAt", a."leaseId", a."propertyId", a."unitId",
            w."number" AS "workOrderNumber", w."title" AS "workOrderTitle", ap."number" AS "applicationNumber", ap."applicantName",
            l."name" AS "leaseName", tn."name" AS "tenantName", o."name" AS "ownerName", v."name" AS "vendorName", tk."title" AS "taskTitle"
          FROM "Activity" a
          LEFT JOIN "WorkOrders" w ON a."entityType" = 'work_order' AND w.id::text = a."entityId"
          LEFT JOIN "Applications" ap ON a."entityType" = 'application' AND ap.id::text = a."entityId"
          LEFT JOIN "Leases" l ON a."entityType" = 'lease' AND l.id::text = a."entityId"
          LEFT JOIN "Tenants" tn ON a."entityType" = 'tenant' AND tn.id::text = a."entityId"
          LEFT JOIN "Owners" o ON a."entityType" = 'owner' AND o.id::text = a."entityId"
          LEFT JOIN "Vendors" v ON a."entityType" = 'vendor' AND v.id::text = a."entityId"
          LEFT JOIN "Tasks" tk ON a."entityType" = 'task' AND tk.id::text = a."entityId"
          WHERE a."entityType" IN (${activityTypes(actor.role).map(t => `'${t}'`).join(', ')})
            AND COALESCE(a."occurredAt", a.created_at) <= NOW()
            AND (a."entityType" <> 'task' OR $1 = 'all' OR tk."assigneeId" = $2 OR tk."createdById" = $2 OR a."actorId" = $2)
          ORDER BY COALESCE(a."occurredAt", a.created_at) DESC LIMIT 8`,
        params: [canManageAllTasks(actor) ? 'all' : 'own', actor.id],
      }),
    ]);

    // ── Figures ─────────────────────────────────────────────────────────
    const u = units.rows[0] ?? {};
    const unitFigures = { active: num(u.active), occupied: num(u.occupied), notice: num(u.notice), vacant: Math.max(0, num(u.active) - num(u.occupied)) };

    // Open past-due charges, never more than what the lease actually owes (an unapplied credit nets against them).
    const balances = pastDue.rows.length ? await leaseBalances(pastDue.rows.map(r => String(r.leaseId))) : new Map<string, { balance: number }>();
    const delinquent = pastDue.rows
      .map(r => {
        const open = num(r.open);
        const balance = balances.get(String(r.leaseId))?.balance ?? open;
        return { leaseId: String(r.leaseId), name: str(r.name) ?? 'Lease', status: str(r.status) ?? '', propertyId: ref(r.propertyId), unitId: ref(r.unitId), amount: fromCents(Math.min(toCents(open), toCents(balance))), oldestDue: day(r.oldestDue) };
      })
      .filter(d => toCents(d.amount) > 0)
      .sort((a, b) => b.amount - a.amount);

    const c = collections.rows[0] ?? {};
    const w = woCounts.rows[0] ?? {};
    const figures = {
      units: unitFigures,
      collections: seesMoney
        ? {
            period,
            billed: fromCents(toCents(num(c.billed))),
            collected: fromCents(toCents(num(c.collected))),
            received: fromCents(received.rows.reduce((s, r) => s + toCents(num(r.amount)), 0)),
          }
        : null,
      pastDue: seesMoney ? { amount: fromCents(delinquent.reduce((s, d) => s + toCents(d.amount), 0)), leases: delinquent.length } : null,
      workOrders: seesWorkCounts ? { open: num(w.open), emergency: num(w.emergency), overdue: num(w.overdue), unassigned: num(w.unassigned), mine: num(w.mine), approvals: num(w.approvals), new: num(w.new) } : null,
      leasing: seesLeasing || seesLeases ? { applications: applications.rows.length, expiring: renewals.rows.length, moveIns: moves.rows.filter(r => r.kind === 'in').length, moveOuts: moves.rows.filter(r => r.kind === 'out').length } : null,
      bills: seesBills ? { count: bills.rows.length, amount: fromCents(bills.rows.reduce((s, r) => s + toCents(num(r.open)), 0)), overdue: bills.rows.filter(r => day(r.dueDate)! < today).length } : null,
    };

    // ── Needs attention ─────────────────────────────────────────────────
    const sections: Section[] = [];
    const push = (s: Section) => s.total > 0 && sections.push({ ...s, items: s.items.slice(0, LIMIT) });

    push({
      key: 'urgentWork',
      title: 'Emergency and overdue work',
      total: urgentWork.rows.length,
      to: '/work-orders',
      items: urgentWork.rows.map(r => {
        const due = day(r.dueDate);
        const emergency = r.priority === 'Emergency';
        return item({
          id: String(r.id), to: `/work-orders/${num(r.number)}`, title: `${workOrderRef(num(r.number))} ${str(r.title) ?? ''}`, meta: [str(r.status), ref(r.vendorName)].filter(Boolean).join(' · '),
          propertyId: ref(r.propertyId), unitId: ref(r.unitId), priority: str(r.priority), memberId: ref(r.assigneeId), day: due, dayKind: 'due',
          badge: emergency ? { label: 'Emergency', tone: 'danger' } : null,
        });
      }),
    });

    const taskRows = myTasks.rows.map(toTask);
    push({
      key: 'myTasks',
      title: taskRows.some(t => t.dueDate! < today) ? 'Your overdue tasks' : 'Your tasks due today',
      total: taskRows.length,
      to: '/tasks',
      items: taskRows.map(t => item({
        id: t.id, to: `/tasks?task=${t.id}`, title: t.title, meta: [t.category, t.systemKey ? 'Automatic' : null].filter(Boolean).join(' · '),
        propertyId: t.propertyId, unitId: t.unitId, day: t.dueDate, dayKind: 'due', priority: t.priority === 'Urgent' ? 'Emergency' : t.priority,
      })),
    });

    push({
      key: 'messages',
      title: 'Unread messages from residents and owners',
      total: messages.rows.length,
      to: '/messages',
      items: [...messages.rows]
        .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))
        .map(r => {
          const thread = String(r.thread);
          const unread = num(r.unread);
          return item({
            id: thread, to: r.workOrderNumber != null && thread.startsWith('work_order:') ? `/work-orders/${num(r.workOrderNumber)}` : `/messages/${encodeURIComponent(thread)}`,
            // A hint of the message, not the message. 120 chars of body turned every
            // row into a paragraph; the thread itself is one click away.
            title: `${str(r.fromName) ?? 'Someone'}${ref(r.ownerId) ? ' (owner)' : ''}`, meta: [str(r.subject), (str(r.body) ?? '').replace(/\s+/g, ' ').slice(0, 60)].filter(Boolean).join(' — '),
            day: iso(r.sentAt), dayKind: 'waiting', badge: unread > 1 ? { label: `${unread} unread`, tone: 'info' } : null,
          });
        }),
    });

    push({
      key: 'applications',
      title: 'Applications waiting for a decision',
      total: applications.rows.length,
      to: '/leasing/applications',
      items: applications.rows.map(r => item({
        id: String(r.id), to: `/applications/${num(r.number)}`, title: `${str(r.applicantName) ?? 'Applicant'}`, meta: applicationRef(num(r.number)),
        propertyId: ref(r.propertyId), unitId: ref(r.unitId), day: iso(r.submittedAt), dayKind: 'waiting', memberId: ref(r.assigneeId),
        badge: { label: str(r.status) ?? 'Submitted', tone: r.status === 'Screening' ? 'warning' : 'info' },
      })),
    });

    push({
      key: 'renewals',
      title: 'Leases ending within 60 days',
      total: renewals.rows.length,
      to: '/leases',
      items: renewals.rows.map(r => {
        const end = day(r.endDate);
        const offered = r.renewalStatus === 'Offered';
        return item({
          // No meta when there's no decision: the missing "Offer out" pill already says
          // that, and printing it on every row was the most repeated string on Home.
          id: String(r.id), to: `/leases/${r.id}`, title: str(r.name) ?? 'Lease', meta: offered ? `Renewal offered${r.renewalExpiresOn ? ` · expires ${formatDay(day(r.renewalExpiresOn))}` : ''}` : null,
          day: end, dayKind: 'ends',
          badge: offered ? { label: 'Offer out', tone: 'info' } : end && daysBetween(today, end) <= 30 ? { label: `${daysBetween(today, end)} days`, tone: 'warning' } : null,
        });
      }),
    });

    push({
      key: 'moves',
      title: 'Move-ins and move-outs in the next 14 days',
      total: moves.rows.length,
      to: '/leases',
      items: moves.rows.map(r => item({
        id: `${r.kind}:${r.id}`, to: `/leases/${r.id}`, title: str(r.name) ?? 'Lease', meta: r.kind === 'in' ? (r.status === 'Pending signature' ? 'Moving in · lease not signed yet' : 'Moving in') : 'Moving out',
        day: day(r.day), dayKind: r.kind === 'in' ? 'moveIn' : 'moveOut',
        badge: r.kind === 'in' ? { label: 'Move-in', tone: 'success' } : { label: 'Move-out', tone: 'warning' },
      })),
    });

    push({
      key: 'delinquent',
      title: 'Top delinquent leases',
      total: delinquent.length,
      to: '/accounting/receivables',
      items: delinquent.map(d => {
        const late = d.oldestDue ? daysBetween(d.oldestDue, today) : 0;
        return item({
          id: d.leaseId, to: `/leases/${d.leaseId}/ledger`, title: d.name, meta: `${late} ${late === 1 ? 'day' : 'days'} late${d.status === 'Ended' ? ' · former resident' : ''}`,
          amount: d.amount, badge: late > 30 ? { label: '30+ days', tone: 'danger' } : null,
        });
      }),
    });

    push({
      key: 'approvals',
      title: 'Waiting on owner approval',
      total: approvals.rows.length,
      to: '/work-orders?tab=approvals',
      items: approvals.rows.map(r => item({
        id: String(r.id), to: `/work-orders/${num(r.number)}`, title: `${workOrderRef(num(r.number))} ${str(r.title) ?? ''}`, meta: ref(r.ownerName) ? `Asked ${r.ownerName}` : null,
        propertyId: ref(r.propertyId), unitId: ref(r.unitId), amount: numOrNull(r.estimateAmount), priority: str(r.priority), day: iso(r.lastActivityAt), dayKind: 'waiting', memberId: ref(r.assigneeId),
      })),
    });

    push({
      key: 'bills',
      title: 'Bills due this week',
      total: bills.rows.length,
      to: '/accounting/payables',
      items: bills.rows.map(r => {
        const due = day(r.dueDate);
        return item({
          id: String(r.id), to: `/accounting/payables/${r.id}`, title: ref(r.vendorName) ?? str(r.description) ?? 'Bill', meta: [ref(r.reference) ? `#${r.reference}` : null, str(r.description)].filter(Boolean).join(' · '),
          propertyId: ref(r.propertyId), amount: fromCents(toCents(num(r.open))), day: due, dayKind: 'due',
        });
      }),
    });

    push({
      key: 'insurance',
      title: 'Vendors with expired insurance on open work',
      total: insurance.rows.length,
      to: '/vendors',
      items: insurance.rows.map(r => item({
        id: String(r.id), to: `/vendors/${r.id}`, title: str(r.name) ?? 'Vendor', meta: `${num(r.openWork)} open ${num(r.openWork) === 1 ? 'work order' : 'work orders'}${r.firstNumber != null ? ` · ${workOrderRef(num(r.firstNumber))}${num(r.openWork) > 1 ? ' and more' : ''}` : ''}`,
        day: day(r.insuranceExpiresOn), dayKind: 'expired', badge: { label: 'COI expired', tone: 'danger' },
      })),
    });

    // ── Charts ──────────────────────────────────────────────────────────
    const expirationsByPeriod = new Map(expirations.rows.map(r => [String(r.period), r]));
    const charts = {
      received: seesMoney ? received.rows.map(r => ({ day: day(r.day)!, amount: fromCents(toCents(num(r.amount))), payments: num(r.payments) })) : null,
      expirations: seesLeases
        ? Array.from({ length: 6 }, (_, i) => {
            const p = addPeriods(period, i);
            const r = expirationsByPeriod.get(p);
            return { period: p, total: num(r?.total), movingOut: num(r?.movingOut), offered: num(r?.offered), renewing: num(r?.renewing) };
          })
        : null,
      workOrderWeeks: seesWork
        ? Array.from({ length: 8 }, (_, i) => {
            const weeksAgo = 7 - i;
            return {
              weekStart: addDays(today, -(weeksAgo * 7) - 6),
              opened: num(woOpened.rows.find(r => num(r.weeksAgo) === weeksAgo)?.n),
              completed: num(woCompleted.rows.find(r => num(r.weeksAgo) === weeksAgo)?.n),
            };
          })
        : null,
    };

    // ── Activity ────────────────────────────────────────────────────────
    const feed = activity.rows.map(r => {
      const type = String(r.entityType);
      const entityId = String(r.entityId ?? '');
      const leaseId = ref(r.leaseId);
      let to: string | null = null;
      let context_: string | null = null;
      switch (type) {
        case 'work_order':
          if (r.workOrderNumber != null) {
            to = `/work-orders/${num(r.workOrderNumber)}`;
            context_ = `${workOrderRef(num(r.workOrderNumber))} ${str(r.workOrderTitle) ?? ''}`.trim();
          }
          break;
        case 'application':
          if (r.applicationNumber != null) {
            to = `/applications/${num(r.applicationNumber)}`;
            context_ = `${applicationRef(num(r.applicationNumber))} ${str(r.applicantName) ?? ''}`.trim();
          }
          break;
        case 'lease': to = `/leases/${entityId}`; context_ = ref(r.leaseName); break;
        case 'tenant': to = `/residents/${entityId}`; context_ = ref(r.tenantName); break;
        case 'owner': to = `/owners/${entityId}`; context_ = ref(r.ownerName); break;
        case 'vendor': to = `/vendors/${entityId}`; context_ = ref(r.vendorName); break;
        case 'property': to = `/properties/${entityId}`; break;
        case 'unit': to = `/units/${entityId}`; break;
        case 'inspection': to = `/inspections/${entityId}`; break;
        case 'listing': to = `/listings/${entityId}`; break;
        case 'task': to = r.taskTitle != null ? `/tasks?task=${entityId}` : null; break;
        case 'transaction': to = leaseId ? `/leases/${leaseId}/ledger` : null; break;
        case 'announcement': to = '/announcements'; break;
        case 'inquiry': to = '/leasing/inquiries'; break;
      }
      return {
        id: String(r.id), summary: str(r.summary) ?? '', entityType: type, actorId: ref(r.actorId), actorName: ref(r.actorName), occurredAt: iso(r.occurredAt) ?? new Date().toISOString(),
        to, context: context_, propertyId: ref(r.propertyId), unitId: ref(r.unitId),
      };
    });

    return { today, period, role: actor.role, figures, sections, charts, activity: feed };
  },
});

function activityTypes(role: Parameters<typeof can>[0]) {
  const types = ['property', 'unit', 'task'];
  if (can(role, 'maintenance.create')) types.push('work_order');
  if (can(role, 'maintenance.manage')) types.push('inspection');
  if (can(role, 'residents.manage') || can(role, 'accounting.view')) types.push('lease');
  if (can(role, 'residents.manage')) types.push('tenant');
  if (can(role, 'leasing.manage')) types.push('application', 'listing', 'inquiry');
  if (can(role, 'owners.manage')) types.push('owner');
  if (can(role, 'vendors.manage')) types.push('vendor');
  if (can(role, 'accounting.view')) types.push('transaction');
  if (can(role, 'announcements.send')) types.push('announcement');
  if (can(role, 'settings.manage')) types.push('settings', 'member');
  return types;
}
