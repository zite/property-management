import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { findTemplate } from '@project/shared/server/email';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, ref, str } from '@project/shared/server/sql';
import { depositIdsOf } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Receivables by lease: the aging of what residents owe (by how late each open
 * charge is), unapplied credit, deposit held, and the last payment and late
 * notice. Every current lease is included so charges can be posted to many at
 * once; ended leases appear only while they still carry money.
 *
 * Aging buckets come from open charges' due dates (Allocations), the balance
 * from the journal — the two agree whenever charges and payments were posted
 * through the ledger; `adjustments` carries any journal-entry difference.
 */

const Input = z.object({});

const cents = (v: unknown) => toCents(num(v));

export default createEndpoint({
  description: 'Aging, balances and deposits held for every lease with money on it',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    parseInput(Input, input);
    const [settings, chart] = await Promise.all([getSettings(), getChart()]);
    const today = todayIn(settings.timezone);
    const ar = chart.key('accounts_receivable').id;
    const deposits = depositIdsOf(chart);

    const [{ rows }, template, notices] = await Promise.all([
      zite.sql({
        query: `
          SELECT l.id, l."name", l."number", l."status", l."propertyId", l."unitId", l."rent", l."deposit", l."startDate", l."endDate", l."moveOutDate",
            COALESCE(j.balance, 0) AS balance, COALESCE(j.held, 0) AS held,
            COALESCE(o.b0, 0) AS b0, COALESCE(o.b30, 0) AS b30, COALESCE(o.b60, 0) AS b60, COALESCE(o.b90, 0) AS b90, COALESCE(o.b91, 0) AS b91,
            o."oldestDue", COALESCE(u.unapplied, 0) AS unapplied,
            lp."date" AS "lastPaymentDate", lp."amount" AS "lastPaymentAmount"
          FROM "Leases" l
          LEFT JOIN (
            SELECT jl."leaseId" AS lid,
              SUM(CASE WHEN jl."accountId" = $1 THEN COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0) ELSE 0 END) AS balance,
              SUM(CASE WHEN jl."accountId" = ANY($2) THEN COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0) ELSE 0 END) AS held
            FROM "JournalLines" jl
            WHERE COALESCE(jl."void", false) = false AND COALESCE(jl."leaseId", '') <> ''
            GROUP BY jl."leaseId"
          ) j ON j.lid = l.id::text
          LEFT JOIN (
            SELECT open_items.lid,
              SUM(CASE WHEN open_items.late <= 0 THEN open_items.open ELSE 0 END) AS b0,
              SUM(CASE WHEN open_items.late BETWEEN 1 AND 30 THEN open_items.open ELSE 0 END) AS b30,
              SUM(CASE WHEN open_items.late BETWEEN 31 AND 60 THEN open_items.open ELSE 0 END) AS b60,
              SUM(CASE WHEN open_items.late BETWEEN 61 AND 90 THEN open_items.open ELSE 0 END) AS b90,
              SUM(CASE WHEN open_items.late > 90 THEN open_items.open ELSE 0 END) AS b91,
              MIN(CASE WHEN open_items.late > 0 THEN open_items.due END) AS "oldestDue"
            FROM (
              SELECT t."leaseId" AS lid, COALESCE(t."dueDate", t."date") AS due,
                ($3::date - COALESCE(t."dueDate", t."date")::date) AS late,
                t."amount" - COALESCE(paid.s, 0) AS open
              FROM "Transactions" t
              LEFT JOIN (SELECT al."chargeId", SUM(al."amount") AS s FROM "Allocations" al WHERE COALESCE(al."void", false) = false GROUP BY al."chargeId") paid ON paid."chargeId" = t.id::text
              WHERE t."status" = 'Posted' AND COALESCE(t."leaseId", '') <> '' AND (t."kind" = 'Charge' OR (t."kind" = 'Refund' AND t."accountId" = $1))
            ) open_items
            WHERE open_items.open > 0.004
            GROUP BY open_items.lid
          ) o ON o.lid = l.id::text
          LEFT JOIN (
            SELECT t."leaseId" AS lid, SUM(t."amount" - COALESCE(used.s, 0)) AS unapplied
            FROM "Transactions" t
            LEFT JOIN (SELECT al."paymentId", SUM(al."amount") AS s FROM "Allocations" al WHERE COALESCE(al."void", false) = false GROUP BY al."paymentId") used ON used."paymentId" = t.id::text
            WHERE t."status" = 'Posted' AND t."kind" IN ('Payment', 'Credit', 'Deposit application') AND COALESCE(t."leaseId", '') <> ''
            GROUP BY t."leaseId"
          ) u ON u.lid = l.id::text
          LEFT JOIN (
            SELECT DISTINCT ON (t."leaseId") t."leaseId" AS lid, t."date", t."amount"
            FROM "Transactions" t WHERE t."kind" = 'Payment' AND t."status" = 'Posted' AND COALESCE(t."leaseId", '') <> ''
            ORDER BY t."leaseId", t."date" DESC, t."number" DESC
          ) lp ON lp.lid = l.id::text
          WHERE l."status" NOT IN ('Draft', 'Canceled')
            AND (l."status" IN ('Active', 'Pending signature') OR ABS(COALESCE(j.balance, 0)) > 0.004 OR ABS(COALESCE(j.held, 0)) > 0.004 OR COALESCE(u.unapplied, 0) > 0.004
              OR (COALESCE(o.b0, 0) + COALESCE(o.b30, 0) + COALESCE(o.b60, 0) + COALESCE(o.b90, 0) + COALESCE(o.b91, 0)) > 0.004)
          ORDER BY l."name" ASC
          LIMIT 2000`,
        params: [ar, deposits, today],
      }),
      findTemplate('Late notice'),
      zite.sql({
        query: `
          SELECT m."leaseId", MAX(m."sentAt") AS "sentAt"
          FROM "Messages" m JOIN "EmailTemplates" e ON e.id::text = m."templateId"
          WHERE e."trigger" = 'Late notice' AND COALESCE(m."leaseId", '') <> ''
          GROUP BY m."leaseId"`,
        params: [],
      }),
    ]);

    const leaseIds = rows.map(r => String(r.id));
    const { rows: people } = leaseIds.length
      ? await zite.sql({
          query: `
            SELECT lt."leaseId", t.id, t."name", t."email", t."phone", lt."role"
            FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId"
            WHERE lt."leaseId" = ANY($1) AND lt."role" IN ('Primary', 'Co-tenant')
            ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at ASC`,
          params: [leaseIds],
        })
      : { rows: [] as Array<Record<string, unknown>> };
    const tenantsBy = new Map<string, Array<{ id: string; name: string; email: string; phone: string }>>();
    for (const p of people) {
      const list = tenantsBy.get(String(p.leaseId)) ?? [];
      list.push({ id: String(p.id), name: str(p.name) ?? '', email: str(p.email) ?? '', phone: str(p.phone) ?? '' });
      tenantsBy.set(String(p.leaseId), list);
    }
    const noticeBy = new Map(notices.rows.map(n => [String(n.leaseId), iso(n.sentAt)]));

    const leases = rows.map(r => {
      const id = String(r.id);
      const buckets = { current: cents(r.b0), d30: cents(r.b30), d60: cents(r.b60), d90: cents(r.b90), d90plus: cents(r.b91) };
      const open = buckets.current + buckets.d30 + buckets.d60 + buckets.d90 + buckets.d90plus;
      const unapplied = cents(r.unapplied);
      const balance = cents(r.balance);
      const tenants = tenantsBy.get(id) ?? [];
      return {
        id,
        name: str(r.name) ?? '',
        number: num(r.number),
        status: str(r.status) ?? 'Active',
        propertyId: ref(r.propertyId),
        unitId: ref(r.unitId),
        rent: num(r.rent),
        depositRequired: num(r.deposit),
        startDate: day(r.startDate),
        endDate: day(r.endDate),
        moveOutDate: day(r.moveOutDate),
        tenants,
        tenantNames: tenants.map(t => t.name).join(', '),
        balance: fromCents(balance),
        current: fromCents(buckets.current),
        days30: fromCents(buckets.d30),
        days60: fromCents(buckets.d60),
        days90: fromCents(buckets.d90),
        days90plus: fromCents(buckets.d90plus),
        pastDue: fromCents(open - buckets.current),
        openCharges: fromCents(open),
        unapplied: fromCents(unapplied),
        /** Journal entries on AR that no charge or payment explains (normally zero). */
        adjustments: fromCents(balance - (open - unapplied)),
        depositHeld: fromCents(cents(r.held)),
        oldestDueDate: day(r.oldestDue),
        lastPaymentDate: day(r.lastPaymentDate),
        lastPaymentAmount: r.lastPaymentAmount == null ? null : num(r.lastPaymentAmount),
        lastLateNoticeAt: noticeBy.get(id) ?? null,
      };
    });

    return { today, lateNoticeEnabled: Boolean(template), leases };
  },
});
