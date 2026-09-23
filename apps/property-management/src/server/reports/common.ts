import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { daysBetween, formatDay, isDay, todayIn } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { getChart, type Chart } from '@project/shared/server/accounts';
import { assertCan, getActor, type Actor } from '@project/shared/server/actor';
import { getSettings, type OrgSettings } from '@project/shared/server/settings';
import { ref, str } from '@project/shared/server/sql';
import { periodUrlParams, reportHref, REPORT_BY_KEY, resolvePeriod, type ReportDef, type ReportInputValues } from '../../components/reports/catalog';
import type { ReportDoc } from '../../components/reports/doc';
import { parseInput } from '../input';

/**
 * Shared plumbing for the report endpoints: input parsing, permissions, the
 * property scope, SQL fragments every report agrees on (what "posted" and
 * "occupying" mean), drill-down links, and the document envelope.
 *
 * Reports are read-only and every figure is an SQL aggregate over posted,
 * non-void journal lines and transactions — nothing is stored or summed
 * from thousands of rows in JS.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.');
const id = z.string().min(1).max(80);

export const ReportInput = z.object({
  propertyIds: z.array(id).max(500).optional(),
  from: day.optional(),
  to: day.optional(),
  asOf: day.optional(),
  basis: z.enum(['cash', 'accrual']).optional(),
  groupBy: z.string().max(40).optional(),
  ownerId: id.optional(),
  accountIds: z.array(id).max(100).optional(),
  months: z.number().int().min(1).max(24).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  showZero: z.boolean().optional(),
});

export type PropertyInfo = { id: string; name: string; code: string; ownerId: string | null; status: string };

export type ReportScope = {
  def: ReportDef;
  actor: Actor;
  settings: OrgSettings;
  today: string;
  chart: Chart;
  input: ReportInputValues;
  properties: PropertyInfo[];
  propertyById: Map<string, PropertyInfo>;
  /** Selected property ids, or null for the whole portfolio. */
  propertyIds: string[] | null;
  /** Every property in scope (all of them when none are selected). */
  scopedProperties: PropertyInfo[];
  propertyLabel: string;
  money: (n: number) => string;
};

export async function openReport(key: string, context: Parameters<typeof getActor>[0], raw: unknown): Promise<ReportScope> {
  const def = REPORT_BY_KEY.get(key);
  if (!def) throw new ZiteError('That report doesn’t exist.', 'NOT_FOUND');
  const actor = await getActor(context);
  assertCan(actor, 'reports.view');
  if (def.financial) assertCan(actor, 'accounting.view');
  const input = parseInput(ReportInput, raw) as ReportInputValues;
  if (input.from && input.to && input.from > input.to) throw new ZiteError('The start date is after the end date.', 'BAD_REQUEST');
  if (input.from && input.to && daysBetween(input.from, input.to) > 366 * 10) throw new ZiteError('Choose a period of ten years or less.', 'BAD_REQUEST');

  const [settings, chart, props] = await Promise.all([
    getSettings(),
    getChart(),
    zite.sql({ query: `SELECT id, "name", "code", "ownerId", "status" FROM "Properties" ORDER BY "name" ASC LIMIT 2000`, params: [] }),
  ]);
  const today = todayIn(settings.timezone);
  const properties: PropertyInfo[] = props.rows.map(r => ({ id: String(r.id), name: str(r.name) ?? 'Property', code: str(r.code) ?? '', ownerId: ref(r.ownerId), status: str(r.status) || 'Active' }));
  const propertyById = new Map(properties.map(p => [p.id, p]));
  const selected = (input.propertyIds ?? []).filter(pid => propertyById.has(pid));
  if (input.propertyIds?.length && !selected.length) throw new ZiteError('Those properties no longer exist. Clear the property filter.', 'BAD_REQUEST');
  const propertyIds = selected.length ? [...new Set(selected)] : null;
  const scopedProperties = propertyIds ? properties.filter(p => propertyIds.includes(p.id)) : properties;
  const propertyLabel = !propertyIds
    ? 'All properties'
    : scopedProperties.length <= 2
      ? scopedProperties.map(p => p.name).join(' & ')
      : `${scopedProperties.length} properties`;
  const currency = settings.currency || 'USD';
  return { def, actor, settings, today, chart, input, properties, propertyById, propertyIds, scopedProperties, propertyLabel, money: n => formatMoney(n, currency) };
}

export function envelope(scope: ReportScope, parts: Partial<ReportDoc> & { subtitle: string }): ReportDoc {
  return {
    key: scope.def.key,
    title: scope.def.title,
    organizationName: scope.settings.organizationName,
    generatedAt: new Date().toISOString(),
    figures: [],
    checks: [],
    warnings: [],
    sections: [],
    notes: [],
    chart: null,
    page: null,
    ...parts,
  };
}

// ── Parameters ───────────────────────────────────────────────────────────────

/** The period asked for, or the report's default preset (the same one the page starts on). */
export function periodOf(scope: ReportScope) {
  const fallback = resolvePeriod(scope.def.params.period ?? 'this_month', scope.today);
  const from = scope.input.from && isDay(scope.input.from) ? scope.input.from : fallback.from;
  const to = scope.input.to && isDay(scope.input.to) ? scope.input.to : fallback.to;
  return { from, to, label: rangeLabel(from, to) };
}

export function asOfOf(scope: ReportScope) {
  const asOf = scope.input.asOf && isDay(scope.input.asOf) ? scope.input.asOf : scope.today;
  return { asOf, label: asOf === scope.today ? `As of today, ${formatDay(asOf)}` : `As of ${formatDay(asOf)}` };
}

export function rangeLabel(from: string, to: string) {
  if (from.slice(0, 4) === to.slice(0, 4)) {
    const a = formatDay(from).replace(/, \d{4}$/, '');
    return `${a} – ${formatDay(to)}`;
  }
  return `${formatDay(from)} – ${formatDay(to)}`;
}

export const joinLabel = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ');

// ── SQL fragments ────────────────────────────────────────────────────────────

/** `AND <col> = ANY($n)` when a property filter is set. */
export function inProperties(p: { add: (v: unknown) => string }, col: string, scope: ReportScope) {
  return scope.propertyIds ? `AND ${col} = ANY(${p.add(scope.propertyIds)})` : '';
}

/** Journal lines that count: not void, and their transaction still posted. */
export const POSTED_LINES = `"JournalLines" jl JOIN "Transactions" t ON t.id::text = jl."transactionId"`;
export const LINE_IS_POSTED = `COALESCE(jl."void", false) = false AND t."status" = 'Posted'`;

/**
 * Is lease `l` putting someone in its unit on day `d` (an SQL date expression)?
 * Today and later this is exactly `isOccupying` (Active, started, not moved
 * out); for past days an Ended lease counts until its move-out or end date.
 */
export function occupyingSql(l: string, d: string, today: string) {
  return `(${l}."startDate" IS NOT NULL AND ${l}."startDate" <= ${d}
    AND (${l}."status" = 'Active' OR (${l}."status" = 'Ended' AND ${d} < ${today}))
    AND COALESCE(${l}."moveOutDate", CASE WHEN ${l}."status" = 'Ended' THEN ${l}."endDate" END, DATE '9999-12-31') >= ${d})`;
}

/** Residents' names on a lease, primary first. */
export const residentsSql = (l: string) =>
  `(SELECT STRING_AGG(tn."name", ', ' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, tn."name") FROM "LeaseTenants" lt JOIN "Tenants" tn ON tn.id::text = lt."tenantId" WHERE lt."leaseId" = ${l}.id::text AND lt."role" IN ('Primary', 'Co-tenant'))`;

/** A recurring charge's monthly equivalent. */
export const monthlySql = (rc: string) => `(CASE ${rc}."frequency" WHEN 'Quarterly' THEN ${rc}."amount" / 3.0 WHEN 'Annually' THEN ${rc}."amount" / 12.0 ELSE ${rc}."amount" END)`;

// ── Links ────────────────────────────────────────────────────────────────────

export const links = {
  property: (pid: string | null | undefined) => (pid ? `/properties/${pid}` : undefined),
  unit: (uid: string | null | undefined) => (uid ? `/units/${uid}` : undefined),
  lease: (lid: string | null | undefined) => (lid ? `/leases/${lid}` : undefined),
  ledger: (lid: string | null | undefined) => (lid ? `/leases/${lid}/ledger` : undefined),
  vendor: (vid: string | null | undefined) => (vid ? `/vendors/${vid}` : undefined),
  owner: (oid: string | null | undefined) => (oid ? `/owners/${oid}` : undefined),
  workOrder: (n: number | null | undefined) => (n ? `/work-orders/${n}` : undefined),
  application: (n: number | null | undefined) => (n ? `/applications/${n}` : undefined),
  /** Where a transaction can be seen and acted on. */
  transaction: (t: { id: string; kind: string; leaseId?: string | null; vendorId?: string | null; ownerId?: string | null; propertyId?: string | null }) => {
    if (t.leaseId) return `/leases/${t.leaseId}/ledger`;
    if (t.kind === 'Bill') return `/accounting/payables/${t.id}`;
    if (t.vendorId) return `/vendors/${t.vendorId}`;
    if (t.ownerId && (t.kind === 'Owner contribution' || t.kind === 'Owner distribution')) return `/owners/${t.ownerId}`;
    return t.propertyId ? `/properties/${t.propertyId}` : undefined;
  },
  generalLedger: (scope: ReportScope, accountId: string, from: string, to: string) =>
    reportHref('general-ledger', { accounts: [accountId], properties: scope.propertyIds ?? undefined, ...periodUrlParams(from, to, scope.today) }),
};

/** Drop undefined entries so a row's links object stays small. */
export function compact<T>(o: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, T>;
}

export const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export const accountLabel = (a: { number: string; name: string }) => (a.number ? `${a.number} · ${a.name}` : a.name);

/** An empty `zite.sql` result, for queries skipped because there is nothing to look up. */
export const noRows = () => ({ rows: [] as Array<Record<string, unknown>> });
