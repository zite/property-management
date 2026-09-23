import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { DEFAULT_CHART, invalidateChart } from '@project/shared/server/accounts';
import { DEFAULT_SETTINGS, getSettings } from '@project/shared/server/settings';
import { iso, num, pool, str, withRetry } from '@project/shared/server/sql';
import { SAVED_VIEWS } from '../seed/comms';
import { ORG } from '../seed/model';
import { parseInput } from '../server/input';

/**
 * Remove the demo company so the workspace can run a real one.
 *
 * What counts as demo: rows the seed inserted, found by their system
 * `created_at` — its business dates are backdated and can't be trusted.
 * `Settings.seededAt` marks the start of the seed's last phase and the saved
 * views are the last thing that phase writes, so the window closes a minute
 * after those views (or 15 minutes after `seededAt` if they're gone). Earlier
 * phases ran before `seededAt`, when the workspace had no data of its own. Teammates additionally need a
 * reserved example-domain email, and the admin running this is never removed.
 * Rows added later *under* a demo record (a payment on a demo lease, a note on
 * a demo work order) go with it, or they'd be orphans; real records that merely
 * point at a demo owner, vendor or teammate are kept and that link is cleared.
 * Settings, the chart of accounts and email templates are kept; organization
 * details that still hold the demo's values are cleared.
 *
 * The seed writes thousands of rows and Zite deletes one at a time (bursts of
 * parallel writes are rate-limited live), so this works in chunks: children
 * before parents, until ~85s have passed, then returns progress. Calling it
 * again resumes — every step re-finds what is left. `dryRun` only counts.
 */

const WINDOW_MS = 15 * 60_000;
const AFTER_LAST_WRITE_MS = 60_000;
/** Reserved example domains (and their subdomains) — plain LIKEs rather than a regex, for the widest SQL support. */
const EXAMPLE_EMAIL = ['com', 'org', 'net'].map(tld => `LOWER("email") LIKE '%@example.${tld}' OR LOWER("email") LIKE '%.example.${tld}'`).join(' OR ');
const BATCH = 250;
const SOFT_BUDGET_MS = 85_000;
const HARD_BUDGET_MS = 120_000;

// $1 = end of the seed window, $2 = the acting admin.
const W = `created_at <= $1::timestamptz`;
const any = (col: string, sets: string[]) => sets.map(s => `"${col}" IN (SELECT id FROM ${s})`).join(' OR ');

const CTES = `
  dm_members AS (SELECT id::text AS id FROM "Members" WHERE ${W} AND (${EXAMPLE_EMAIL}) AND id::text <> $2),
  dm_owners AS (SELECT id::text AS id FROM "Owners" WHERE ${W}),
  dm_props AS (SELECT id::text AS id FROM "Properties" WHERE ${W}),
  dm_units AS (SELECT id::text AS id FROM "Units" WHERE ${W} OR ${any('propertyId', ['dm_props'])}),
  dm_tenants AS (SELECT id::text AS id FROM "Tenants" WHERE ${W}),
  dm_vendors AS (SELECT id::text AS id FROM "Vendors" WHERE ${W}),
  dm_leases AS (SELECT id::text AS id FROM "Leases" WHERE ${W} OR ${any('propertyId', ['dm_props'])} OR ${any('unitId', ['dm_units'])}),
  dm_listings AS (SELECT id::text AS id FROM "Listings" WHERE ${W} OR ${any('propertyId', ['dm_props'])} OR ${any('unitId', ['dm_units'])}),
  dm_apps AS (SELECT id::text AS id FROM "Applications" WHERE ${W} OR ${any('listingId', ['dm_listings'])} OR ${any('propertyId', ['dm_props'])} OR ${any('unitId', ['dm_units'])}),
  dm_inquiries AS (SELECT id::text AS id FROM "Inquiries" WHERE ${W} OR ${any('listingId', ['dm_listings'])} OR ${any('propertyId', ['dm_props'])}),
  dm_schedules AS (SELECT id::text AS id FROM "MaintenanceSchedules" WHERE ${W} OR ${any('propertyId', ['dm_props'])}),
  dm_inspections AS (SELECT id::text AS id FROM "Inspections" WHERE ${W} OR ${any('propertyId', ['dm_props'])} OR ${any('unitId', ['dm_units'])} OR ${any('leaseId', ['dm_leases'])}),
  dm_wos AS (SELECT id::text AS id FROM "WorkOrders" WHERE ${W} OR ${any('propertyId', ['dm_props'])} OR ${any('unitId', ['dm_units'])} OR ${any('leaseId', ['dm_leases'])} OR ${any('scheduleId', ['dm_schedules'])} OR ${any('inspectionId', ['dm_inspections'])}),
  dm_announcements AS (SELECT id::text AS id FROM "Announcements" WHERE ${W}),
  dm_txns AS (SELECT id::text AS id FROM "Transactions" WHERE ${W} OR ${any('leaseId', ['dm_leases'])} OR ${any('propertyId', ['dm_props'])} OR ${any('unitId', ['dm_units'])} OR ${any('tenantId', ['dm_tenants'])} OR ${any('ownerId', ['dm_owners'])} OR ${any('vendorId', ['dm_vendors'])} OR ${any('workOrderId', ['dm_wos'])}),
  dm_any AS (
    SELECT id FROM dm_members UNION ALL SELECT id FROM dm_owners UNION ALL SELECT id FROM dm_props UNION ALL SELECT id FROM dm_units UNION ALL SELECT id FROM dm_tenants
    UNION ALL SELECT id FROM dm_vendors UNION ALL SELECT id FROM dm_leases UNION ALL SELECT id FROM dm_listings UNION ALL SELECT id FROM dm_apps UNION ALL SELECT id FROM dm_inquiries
    UNION ALL SELECT id FROM dm_schedules UNION ALL SELECT id FROM dm_inspections UNION ALL SELECT id FROM dm_wos UNION ALL SELECT id FROM dm_announcements UNION ALL SELECT id FROM dm_txns
  )`;

const links = (cols: Array<[string, string]>) => cols.map(([col, set]) => `"${col}" IN (SELECT id FROM ${set})`).join(' OR ');
const RECORD_LINKS: Array<[string, string]> = [
  ['propertyId', 'dm_props'], ['unitId', 'dm_units'], ['leaseId', 'dm_leases'], ['tenantId', 'dm_tenants'], ['ownerId', 'dm_owners'], ['vendorId', 'dm_vendors'], ['workOrderId', 'dm_wos'], ['applicationId', 'dm_apps'],
];

type Delete = { kind: 'delete'; table: string; where: string };
type Unlink = { kind: 'unlink'; table: string; column: string; set: string; own?: string };

/** Children first, parents last; unlinks run while the parent they test against still exists. */
const STEPS: Array<Delete | Unlink> = [
  { kind: 'delete', table: 'Allocations', where: `${W} OR ${links([['paymentId', 'dm_txns'], ['chargeId', 'dm_txns']])}` },
  { kind: 'delete', table: 'JournalLines', where: `${W} OR ${links([['transactionId', 'dm_txns']])}` },
  { kind: 'delete', table: 'OnlinePayments', where: `${W} OR ${links([['leaseId', 'dm_leases'], ['tenantId', 'dm_tenants'], ['applicationId', 'dm_apps'], ['transactionId', 'dm_txns']])}` },
  { kind: 'unlink', table: 'WorkOrders', column: 'billId', set: 'dm_txns', own: 'dm_wos' },
  { kind: 'unlink', table: 'WorkOrders', column: 'tenantChargeId', set: 'dm_txns', own: 'dm_wos' },
  { kind: 'delete', table: 'Transactions', where: `id::text IN (SELECT id FROM dm_txns)` },
  { kind: 'delete', table: 'Reconciliations', where: W },
  { kind: 'delete', table: 'Notifications', where: `${W} OR ${links([['memberId', 'dm_members'], ['entityId', 'dm_any']])}` },
  { kind: 'delete', table: 'Activity', where: `${W} OR ${links([['entityId', 'dm_any'], ...RECORD_LINKS])}` },
  { kind: 'delete', table: 'Messages', where: `${W} OR ${links([...RECORD_LINKS.filter(([c]) => c !== 'unitId'), ['announcementId', 'dm_announcements']])}` },
  { kind: 'delete', table: 'Documents', where: `${W} OR ${links(RECORD_LINKS)}` },
  { kind: 'delete', table: 'Tasks', where: `${W} OR ${links(RECORD_LINKS)}` },
  { kind: 'delete', table: 'Applications', where: `id::text IN (SELECT id FROM dm_apps)` },
  { kind: 'delete', table: 'Inquiries', where: `id::text IN (SELECT id FROM dm_inquiries)` },
  { kind: 'delete', table: 'Listings', where: `id::text IN (SELECT id FROM dm_listings)` },
  { kind: 'delete', table: 'WorkOrders', where: `id::text IN (SELECT id FROM dm_wos)` },
  { kind: 'delete', table: 'Inspections', where: `id::text IN (SELECT id FROM dm_inspections)` },
  { kind: 'delete', table: 'MaintenanceSchedules', where: `id::text IN (SELECT id FROM dm_schedules)` },
  { kind: 'delete', table: 'RecurringCharges', where: `${W} OR ${links([['leaseId', 'dm_leases']])}` },
  { kind: 'delete', table: 'LeaseTenants', where: `${W} OR ${links([['leaseId', 'dm_leases'], ['tenantId', 'dm_tenants']])}` },
  { kind: 'delete', table: 'Leases', where: `id::text IN (SELECT id FROM dm_leases)` },
  { kind: 'delete', table: 'Announcements', where: `id::text IN (SELECT id FROM dm_announcements)` },
  { kind: 'delete', table: 'Tenants', where: `id::text IN (SELECT id FROM dm_tenants)` },
  { kind: 'delete', table: 'Units', where: `id::text IN (SELECT id FROM dm_units)` },
  { kind: 'unlink', table: 'Properties', column: 'ownerId', set: 'dm_owners', own: 'dm_props' },
  { kind: 'unlink', table: 'Properties', column: 'managerId', set: 'dm_members', own: 'dm_props' },
  { kind: 'delete', table: 'Properties', where: `id::text IN (SELECT id FROM dm_props)` },
  { kind: 'unlink', table: 'WorkOrders', column: 'vendorId', set: 'dm_vendors' },
  { kind: 'unlink', table: 'MaintenanceSchedules', column: 'vendorId', set: 'dm_vendors' },
  { kind: 'delete', table: 'Vendors', where: `id::text IN (SELECT id FROM dm_vendors)` },
  { kind: 'delete', table: 'Owners', where: `id::text IN (SELECT id FROM dm_owners)` },
  { kind: 'unlink', table: 'WorkOrders', column: 'assigneeId', set: 'dm_members' },
  { kind: 'unlink', table: 'Tasks', column: 'assigneeId', set: 'dm_members' },
  { kind: 'unlink', table: 'MaintenanceSchedules', column: 'assigneeId', set: 'dm_members' },
  { kind: 'unlink', table: 'Listings', column: 'contactMemberId', set: 'dm_members' },
  { kind: 'unlink', table: 'Inquiries', column: 'assigneeId', set: 'dm_members' },
  { kind: 'unlink', table: 'Applications', column: 'assigneeId', set: 'dm_members' },
  { kind: 'delete', table: 'Members', where: `id::text IN (SELECT id FROM dm_members)` },
  // Last: the seed's saved views date the end of the seed window, so they must outlive every other step.
  { kind: 'delete', table: 'Views', where: W },
];

const DELETE_TABLES = STEPS.filter((s): s is Delete => s.kind === 'delete');

/** The organization details the seed filled in; reset only while they still hold the demo's value. */
const ORG_IDENTITY = ['organizationName', 'legalName', 'address', 'phone', 'emergencyPhone', 'officeHours', 'supportEmail', 'websiteUrl', 'emailSignature', 'paymentInstructions', 'portalIntro'] as const;
const SEED_BANKS: Record<string, { name: string; bankName: string; last4: string }> = {
  operating_bank: { name: 'Operating — Front Range Community Bank', bankName: 'Front Range Community Bank', last4: '4821' },
  deposit_bank: { name: 'Deposit Trust — Front Range Community Bank', bankName: 'Front Range Community Bank', last4: '7730' },
};
const SEED_ADMIN_PROFILE = { title: 'Director of Property Management', phone: '(303) 555-0140' };

const accessor = (table: string) => (zite as unknown as Record<string, { delete: (p: { id: string }) => Promise<unknown>; update: (p: { id: string; record: Record<string, unknown> }) => Promise<unknown> }>)[table.charAt(0).toLowerCase() + table.slice(1)];

const Input = z.object({ dryRun: z.boolean().optional() });

export default createEndpoint({
  description: 'Remove the demo company’s records, resumably (admins)',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    done: z.boolean(),
    hasDemo: z.boolean(),
    seededAt: z.string().nullable(),
    deleted: z.number(),
    remaining: z.number(),
    counts: z.array(z.object({ table: z.string(), count: z.number() })),
  }),
  execute: async ({ input, context }) => {
    const started = Date.now();
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    if (actor.role !== 'Admin') throw new ZiteError('Only an admin can remove the demo data.', 'FORBIDDEN');
    const { dryRun } = parseInput(Input, input);

    const settings = await getSettings();
    const seededAt = settings.seededAt;
    if (!seededAt) return { done: true, hasDemo: false, seededAt: null, deleted: 0, remaining: 0, counts: [] };
    const latest = Date.parse(seededAt) + WINDOW_MS;
    const { rows: marker } = await zite.sql({
      query: `SELECT MAX(created_at) AS at FROM "Views" WHERE "name" IN (${SAVED_VIEWS.map((_, i) => `$${i + 3}`).join(', ')}) AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
      params: [seededAt, new Date(latest).toISOString(), ...SAVED_VIEWS.map(v => v.name)],
    });
    const seedEnd = marker[0]?.at ? Date.parse(String(marker[0].at)) : NaN;
    const cutoff = new Date(Number.isFinite(seedEnd) ? Math.min(latest, seedEnd + AFTER_LAST_WRITE_MS) : latest).toISOString();
    const params = [cutoff, actor.id];

    const { rows } = await zite.sql({
      query: `WITH ${CTES} SELECT ${DELETE_TABLES.map(s => `(SELECT COUNT(*) FROM "${s.table}" WHERE ${s.where}) AS "${s.table}"`).join(', ')}`,
      params,
    });
    const counts = DELETE_TABLES.map(s => ({ table: s.table, count: num(rows[0]?.[s.table]) }));
    const total = counts.reduce((a, c) => a + c.count, 0);
    if (dryRun) return { done: total === 0, hasDemo: true, seededAt, deleted: 0, remaining: total, counts };

    let deleted = 0;
    const soft = started + SOFT_BUDGET_MS;
    const hard = started + HARD_BUDGET_MS;

    for (const step of STEPS) {
      if (step.kind === 'unlink') {
        const { rows: linked } = await zite.sql({
          query: `WITH ${CTES} SELECT id FROM "${step.table}" WHERE "${step.column}" IN (SELECT id FROM ${step.set})${step.own ? ` AND id::text NOT IN (SELECT id FROM ${step.own})` : ''} LIMIT 2000`,
          params,
        });
        const client = accessor(step.table);
        await pool(linked, 2, async r => {
          if (Date.now() > hard) return;
          await withRetry(() => client.update({ id: String(r.id), record: { [step.column]: null } })).catch(e => {
            if (!/not found/i.test(String((e as Error)?.message))) throw e;
          });
        });
        continue;
      }
      const client = accessor(step.table);
      let stuck = 0;
      for (;;) {
        // Always make some progress per call, even if counting took most of the budget.
        if (Date.now() > soft && deleted > 0) return { done: false, hasDemo: true, seededAt, deleted, remaining: Math.max(0, total - deleted), counts };
        const { rows: batch } = await zite.sql({ query: `WITH ${CTES} SELECT id FROM "${step.table}" WHERE ${step.where} LIMIT ${BATCH}`, params });
        if (!batch.length) break;
        let removed = 0;
        await pool(batch, 2, async r => {
          if (Date.now() > hard) return;
          try {
            await withRetry(() => client.delete({ id: String(r.id) }));
            removed++;
          } catch (e) {
            // Another tab running the same removal got there first.
            if (!/not found/i.test(String((e as Error)?.message))) throw e;
          }
        });
        deleted += removed;
        if (Date.now() > hard) return { done: false, hasDemo: true, seededAt, deleted, remaining: Math.max(0, total - deleted), counts };
        if (removed === 0 && ++stuck > 1) throw new ZiteError('Some demo records couldn’t be removed. Try again in a minute.', 'CONFLICT');
        if (removed > 0) stuck = 0;
      }
    }

    // Everything demo is gone: tidy what the seed changed on records that stay.
    const { rows: raw } = await zite.sql({ query: `SELECT * FROM "Settings" WHERE id::text = $1`, params: [settings.id] });
    const reset: Record<string, unknown> = { seededAt: null, seedStatus: 'done', automationRanAt: null, automationSummary: null };
    for (const key of ORG_IDENTITY) {
      if (str(raw[0]?.[key]) === ORG[key]) reset[key] = key === 'organizationName' ? DEFAULT_SETTINGS.organizationName : null;
    }
    await withRetry(() => zite.settings.update({ id: settings.id, record: reset as never }));

    const { rows: banks } = await zite.sql({ query: `SELECT id, "systemKey", "name", "bankName", "accountLast4" FROM "Accounts" WHERE "systemKey" IN ('operating_bank', 'deposit_bank')`, params: [] });
    for (const b of banks) {
      const seed = SEED_BANKS[String(b.systemKey)];
      const def = DEFAULT_CHART.find(d => d.systemKey === b.systemKey);
      if (seed && def && str(b.name) === seed.name) {
        await withRetry(() => zite.accounts.update({ id: String(b.id), record: { name: def.name, bankName: str(b.bankName) === seed.bankName ? null : str(b.bankName), accountLast4: str(b.accountLast4) === seed.last4 ? null : str(b.accountLast4) } }));
      }
    }
    invalidateChart();

    const { rows: profiles } = await zite.sql({ query: `SELECT id FROM "Members" WHERE "title" = $1 AND "phone" = $2`, params: [SEED_ADMIN_PROFILE.title, SEED_ADMIN_PROFILE.phone] });
    for (const p of profiles) await withRetry(() => zite.members.update({ id: String(p.id), record: { title: null, phone: null } }));

    await logActivity({ entityType: 'settings', entityId: settings.id, action: 'demo_cleared', summary: 'removed the demo data', actorId: actor.id, actorName: actor.name, data: { seededAt: iso(seededAt), deletedInFinalPass: deleted } });
    return { done: true, hasDemo: false, seededAt: null, deleted, remaining: 0, counts: counts.map(c => ({ ...c, count: 0 })) };
  },
});
