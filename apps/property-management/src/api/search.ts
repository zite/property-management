import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { applicationRef, leasePhase, workOrderRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { getActor } from '@project/shared/server/actor';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { day, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Global search for ⌘K and record pickers: residents, leases, work orders,
 * owners, vendors and applications by name, email, phone, number or address.
 * Properties and units are searched client-side from bootstrap.
 */

const KINDS = ['tenants', 'leases', 'workOrders', 'owners', 'vendors', 'applications'] as const;
const Input = z.object({ query: z.string().max(120), limit: z.number().int().min(1).max(25).optional(), kinds: z.array(z.enum(KINDS)).optional() });
const Hit = z.object({ id: z.string(), name: z.string(), subtitle: z.string() });

export default createEndpoint({
  description: 'Search residents, leases, work orders, owners, vendors and applications',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    tenants: z.array(Hit),
    leases: z.array(z.object({ id: z.string(), name: z.string(), number: z.number().nullable(), phase: z.string(), balance: z.number(), balanceLabel: z.string(), unitId: z.string().nullable(), propertyId: z.string().nullable() })),
    workOrders: z.array(z.object({ id: z.string(), number: z.number(), title: z.string(), status: z.string(), priority: z.string(), subtitle: z.string() })),
    owners: z.array(Hit),
    vendors: z.array(Hit),
    applications: z.array(z.object({ id: z.string(), number: z.number().nullable(), name: z.string(), subtitle: z.string(), status: z.string() })),
  }),
  execute: async ({ input, context }) => {
    await getActor(context);
    const { query, limit = 8, kinds = [...KINDS] } = parseInput(Input, input);
    const q = query.trim();
    const want = new Set(kinds);
    const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
    const digits = q.replace(/\D/g, '');
    const num_ = /^(wo|l|app)?-?\s*\d+$/i.test(q) ? Number(digits) : -1;
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const L = Math.min(25, limit);
    // An empty query lists the most relevant few (active leases, open work orders) for pickers.
    const all = q.length === 0;

    const [tenants, leases, workOrders, owners, vendors, applications] = await Promise.all([
      want.has('tenants')
        ? zite.sql({
            query: `
              SELECT t.id, t."name", t."email", t."phone",
                (SELECT l."name" FROM "LeaseTenants" lt JOIN "Leases" l ON l.id::text = lt."leaseId" WHERE lt."tenantId" = t.id::text ORDER BY CASE l."status" WHEN 'Active' THEN 0 ELSE 1 END, l."startDate" DESC NULLS LAST LIMIT 1) AS "leaseName"
              FROM "Tenants" t
              WHERE COALESCE(t."archived", false) = false AND ($1 = '' OR t."name" ILIKE $2 OR t."email" ILIKE $2 OR t."company" ILIKE $2 OR ($3 <> '' AND regexp_replace(t."phone", '\\D', '', 'g') LIKE '%' || $3 || '%'))
              ORDER BY t."name" ASC LIMIT ${L}`,
            params: [q, like, digits.length >= 4 ? digits : ''],
          })
        : { rows: [] },
      want.has('leases')
        ? zite.sql({
            query: `
              SELECT l.id, l."name", l."number", l."status", l."leaseType", l."startDate", l."endDate", l."noticeGivenOn", l."moveOutDate", l."unitId", l."propertyId"
              FROM "Leases" l
              WHERE ($1 = '' AND l."status" IN ('Active', 'Pending signature')) OR ($1 <> '' AND (l."name" ILIKE $2 OR l."number" = $3
                OR EXISTS (SELECT 1 FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = l.id::text AND (t."name" ILIKE $2 OR t."email" ILIKE $2))))
              ORDER BY CASE l."status" WHEN 'Active' THEN 0 WHEN 'Pending signature' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END, l."name" ASC
              LIMIT ${all ? 40 : L}`,
            params: [q, like, num_],
          })
        : { rows: [] },
      want.has('workOrders')
        ? zite.sql({
            query: `
              SELECT w.id, w."number", w."title", w."status", w."priority", p."name" AS "propertyName", u."name" AS "unitName"
              FROM "WorkOrders" w LEFT JOIN "Properties" p ON p.id::text = w."propertyId" LEFT JOIN "Units" u ON u.id::text = w."unitId"
              WHERE ($1 = '' AND w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')) OR ($1 <> '' AND (w."title" ILIKE $2 OR w."number" = $3 OR w."description" ILIKE $2))
              ORDER BY CASE WHEN w."status" IN ('Completed', 'Canceled') THEN 1 ELSE 0 END, w."number" DESC LIMIT ${L}`,
            params: [q, like, num_],
          })
        : { rows: [] },
      want.has('owners') ? zite.sql({ query: `SELECT id, "name", "contactName", "email" FROM "Owners" WHERE $1 = '' OR "name" ILIKE $2 OR "contactName" ILIKE $2 OR "email" ILIKE $2 ORDER BY "name" LIMIT ${L}`, params: [q, like] }) : { rows: [] },
      want.has('vendors') ? zite.sql({ query: `SELECT id, "name", "trade", "contactName", "email" FROM "Vendors" WHERE $1 = '' OR "name" ILIKE $2 OR "contactName" ILIKE $2 OR "email" ILIKE $2 OR "trade" ILIKE $2 ORDER BY "name" LIMIT ${L}`, params: [q, like] }) : { rows: [] },
      want.has('applications')
        ? zite.sql({
            query: `SELECT id, "number", "applicantName", "email", "status", "submittedAt" FROM "Applications" WHERE ($1 = '' AND "status" IN ('Submitted', 'Screening', 'Approved')) OR ($1 <> '' AND ("applicantName" ILIKE $2 OR "email" ILIKE $2 OR "number" = $3)) ORDER BY "submittedAt" DESC NULLS LAST LIMIT ${L}`,
            params: [q, like, num_],
          })
        : { rows: [] },
    ]);

    const balances = leases.rows.length ? await leaseBalances(leases.rows.map(r => String(r.id))) : new Map();
    return {
      tenants: tenants.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', subtitle: [str(r.leaseName), str(r.email)].filter(Boolean).join(' · ') })),
      leases: leases.rows.map(r => {
        const balance = balances.get(String(r.id))?.balance ?? 0;
        return {
          id: String(r.id),
          name: str(r.name) ?? '',
          number: r.number == null ? null : num(r.number),
          phase: leasePhase({ status: String(r.status), leaseType: str(r.leaseType), startDate: day(r.startDate), endDate: day(r.endDate), noticeGivenOn: day(r.noticeGivenOn), moveOutDate: day(r.moveOutDate) }, today, settings.renewalNoticeDays),
          balance,
          balanceLabel: formatMoney(balance, settings.currency),
          unitId: ref(r.unitId),
          propertyId: ref(r.propertyId),
        };
      }),
      workOrders: workOrders.rows.map(r => ({ id: String(r.id), number: num(r.number), title: str(r.title) ?? '', status: String(r.status), priority: String(r.priority), subtitle: `${workOrderRef(num(r.number))} · ${[str(r.propertyName), str(r.unitName)].filter(Boolean).join(' ')}` })),
      owners: owners.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', subtitle: [str(r.contactName), str(r.email)].filter(Boolean).join(' · ') })),
      vendors: vendors.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? '', subtitle: [str(r.trade), str(r.contactName)].filter(Boolean).join(' · ') })),
      applications: applications.rows.map(r => ({ id: String(r.id), number: r.number == null ? null : num(r.number), name: str(r.applicantName) ?? '', subtitle: `${applicationRef(num(r.number))} · ${str(r.email) ?? ''}`, status: String(r.status) })),
    };
  },
});
