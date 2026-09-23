import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { applicationRef } from '@project/shared/leases';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { daysLeft, leasePeople, loadStaffLease, phaseFor, renderTerms } from '../server/leaseStaff';
import { messagesWhere, timelineActivity } from '../server/timeline';

/**
 * One lease with everything its page shows: the people on it and their
 * signatures, what bills every month, balances, the agreement (frozen once
 * sent, otherwise a live preview of the template), move-out money and
 * inspections, and its history with the residents' conversation.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a lease with its residents, recurring charges, agreement, move-out and history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const { id } = parseInput(Input, input);
    const [lease, settings, chart] = await Promise.all([loadStaffLease(id), getSettings(), getChart()]);
    const today = todayIn(settings.timezone);
    const people = await leasePeople(lease.id);
    const tenantIds = people.map(p => p.id);

    const [recurring, posted, balances, moveOut, inspections, application, activity, messages, siblings, openWorkOrders] = await Promise.all([
      zite.sql({
        query: `SELECT id, "description", "accountId", "amount", "frequency", "dayOfMonth", "startDate", "endDate", "lastPostedPeriod", "active", created_at FROM "RecurringCharges" WHERE "leaseId" = $1 ORDER BY COALESCE("active", false) DESC, "startDate" ASC NULLS FIRST, created_at ASC`,
        params: [lease.id],
      }),
      zite.sql({
        query: `SELECT "recurringChargeId", MAX("period") AS "lastPeriod", COUNT(*) AS n FROM "Transactions" WHERE "leaseId" = $1 AND COALESCE("recurringChargeId", '') <> '' AND "status" = 'Posted' GROUP BY "recurringChargeId"`,
        params: [lease.id],
      }),
      leaseBalances([lease.id]),
      zite.sql({
        query: `SELECT id, "number", "kind", "date", "amount", "description", "accountId", "paymentMethod", "reference", "status" FROM "Transactions" WHERE "leaseId" = $1 AND "source" = 'Move-out' AND "status" = 'Posted' ORDER BY "date" ASC, "number" ASC`,
        params: [lease.id],
      }),
      zite.sql({
        query: `SELECT id, "title", "inspectionType", "status", "scheduledFor", "completedAt", "overallCondition" FROM "Inspections" WHERE "leaseId" = $1 OR ("unitId" = $2 AND "inspectionType" IN ('Move-in', 'Move-out') AND COALESCE("scheduledFor", created_at) >= $3::date) ORDER BY COALESCE("scheduledFor", created_at) DESC LIMIT 12`,
        params: [lease.id, lease.unitId, lease.noticeGivenOn ?? lease.startDate ?? today],
      }),
      lease.applicationId ? zite.sql({ query: `SELECT id, "number", "applicantName", "status" FROM "Applications" WHERE id::text = $1`, params: [lease.applicationId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      timelineActivity('leaseId', lease.id, 200),
      tenantIds.length
        ? messagesWhere(`(m."leaseId" = $1 OR (m."tenantId" = ANY($2) AND COALESCE(m."workOrderId", '') = '' AND COALESCE(m."direction", '') <> 'Internal'))`, [lease.id, tenantIds], 300)
        : messagesWhere(`m."leaseId" = $1`, [lease.id], 300),
      // Other leases on the unit, so a renewal chain or the next household is one click away.
      zite.sql({ query: `SELECT id, "name", "number", "status", "startDate", "endDate" FROM "Leases" WHERE "unitId" = $1 AND id::text <> $2 AND "status" <> 'Canceled' ORDER BY "startDate" DESC NULLS LAST LIMIT 6`, params: [lease.unitId, lease.id] }),
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "WorkOrders" WHERE "leaseId" = $1 AND "status" NOT IN ('Completed', 'Canceled')`, params: [lease.id] }),
    ]);

    const postedBy = new Map(posted.rows.map(r => [String(r.recurringChargeId), { lastPeriod: ref(r.lastPeriod), count: num(r.n) }]));
    const bal = balances.get(lease.id) ?? { balance: 0, depositHeld: 0 };
    const app = application.rows[0];
    const deposits = chart.key('deposits_held').id;
    const moveOutRows = moveOut.rows.map(r => ({
      id: String(r.id),
      number: num(r.number),
      kind: String(r.kind),
      date: day(r.date) ?? today,
      amount: num(r.amount),
      description: str(r.description) ?? '',
      accountId: ref(r.accountId),
      paymentMethod: ref(r.paymentMethod),
      reference: ref(r.reference),
    }));
    const unread = messages.filter(m => m.direction === 'Inbound' && !m.readAt).length;

    return {
      today,
      lease: {
        ...lease,
        signatures: lease.signatures.map(s => ({ tenantId: s.tenantId, name: s.name, signedAt: s.signedAt, by: s.by ?? 'resident' })),
        phase: phaseFor(lease, today, settings),
        daysToEnd: daysLeft(lease.endDate, today),
      },
      people,
      balance: bal.balance,
      depositHeld: bal.depositHeld,
      recurring: recurring.rows.map(r => {
        const p = postedBy.get(String(r.id));
        return {
          id: String(r.id),
          description: str(r.description) ?? '',
          accountId: ref(r.accountId),
          amount: num(r.amount),
          frequency: str(r.frequency) || 'Monthly',
          dayOfMonth: num(r.dayOfMonth, 1),
          startDate: day(r.startDate),
          endDate: day(r.endDate),
          active: bool(r.active),
          lastPostedPeriod: p?.lastPeriod ?? ref(r.lastPostedPeriod),
          postedCount: p?.count ?? 0,
        };
      }),
      document: lease.terms ? { markdown: lease.terms, frozen: true } : { markdown: renderTerms(lease, people, settings), frozen: false },
      moveOut: {
        deductions: moveOutRows.filter(t => t.kind === 'Charge'),
        applied: moveOutRows.filter(t => t.kind === 'Deposit application'),
        refunds: moveOutRows.filter(t => t.kind === 'Refund' && t.accountId === deposits),
      },
      inspections: inspections.rows.map(i => ({ id: String(i.id), title: str(i.title) ?? '', type: str(i.inspectionType) || 'Routine', status: str(i.status) || 'Scheduled', scheduledFor: iso(i.scheduledFor), completedAt: iso(i.completedAt), condition: ref(i.overallCondition) })),
      application: app ? { id: String(app.id), number: numOrNull(app.number), ref: applicationRef(numOrNull(app.number)), applicantName: str(app.applicantName) ?? '', status: str(app.status) ?? '' } : null,
      otherLeases: siblings.rows.map(s => ({ id: String(s.id), name: str(s.name) ?? '', number: numOrNull(s.number), status: str(s.status) ?? '', startDate: day(s.startDate), endDate: day(s.endDate) })),
      openWorkOrders: num(openWorkOrders.rows[0]?.n),
      activity,
      messages,
      unread,
      portalConfigured: Boolean(settings.portalUrl),
    };
  },
});
