import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addPeriods, formatDay, periodOf, todayIn } from '@project/shared/dates';
import { unitOccupancy } from '@project/shared/leases';
import { formatAddress } from '@project/shared/merge';
import { formatMoney } from '@project/shared/money';
import { membersWith } from '@project/shared/server/actor';
import type { OwnerStatement, PropertyStatement, StatementFigures, StatementTransaction } from '@project/shared/server/ownerStatement';
import { getSettings, type OrgSettings } from '@project/shared/server/settings';
import { day, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { ownerPropertyIds, requireOwner } from './identity';

/**
 * The owner area's scope and shared reads.
 *
 * Every owner endpoint starts from `ownerScope(context)`: the verified owner and
 * the ids of the properties they own. Anything addressed by id (a property, a
 * work order) is checked against that list, and a miss is NOT_FOUND — the same
 * answer whether it doesn't exist or belongs to another owner.
 *
 * Owners may see their residents' names, lease dates, rent and balances (the
 * rent roll is theirs), but never residents' contact details, staff-only notes
 * or anything on another owner's buildings.
 */

type UserLike = { email?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined;

export type OwnerScope = Awaited<ReturnType<typeof ownerScope>>;

export async function ownerScope(context: { user?: UserLike }) {
  const { identity, ownerId } = await requireOwner(context);
  const [propertyIds, settings, ownerRows] = await Promise.all([
    ownerPropertyIds(ownerId),
    getSettings(),
    zite.sql({ query: `SELECT "name", "contactName", "email", "mailingAddress", "distributionMethod" FROM "Owners" WHERE id::text = $1`, params: [ownerId] }),
  ]);
  const o = ownerRows.rows[0] ?? {};
  return {
    identity,
    ownerId,
    owner: {
      id: ownerId,
      name: str(o.name) ?? identity.owner?.name ?? '',
      contactName: str(o.contactName) || identity.name,
      email: str(o.email) ?? identity.email,
      mailingAddress: str(o.mailingAddress) ?? '',
      distributionMethod: str(o.distributionMethod) ?? '',
    },
    propertyIds,
    settings,
    today: todayIn(settings.timezone),
  };
}

export function requireOwnerProperty(scope: Pick<OwnerScope, 'propertyIds'>, propertyId: string) {
  if (!propertyId || !scope.propertyIds.includes(propertyId)) throw new ZiteError("We couldn't find that property in your portfolio.", 'NOT_FOUND');
  return propertyId;
}

/** "YYYY-MM" for this month and the eleven before it, newest first. */
export function recentPeriods(today: string, count = 12) {
  return Array.from({ length: count }, (_, i) => addPeriods(periodOf(today), -i));
}

export type UnitRow = {
  id: string;
  propertyId: string;
  name: string;
  beds: number;
  baths: number;
  squareFeet: number | null;
  marketRent: number;
  readiness: string;
  availableOn: string | null;
  occupancy: 'Occupied' | 'Notice' | 'Vacant';
  lease: { id: string; number: number | null; rent: number; startDate: string | null; endDate: string | null; leaseType: string; moveOutDate: string | null; residents: string[] } | null;
  upcomingLease: { id: string; startDate: string | null; rent: number } | null;
};

/** Units on these properties with today's occupancy and the lease that decides it. */
export async function unitsWithOccupancy(propertyIds: string[], today: string): Promise<UnitRow[]> {
  if (!propertyIds.length) return [];
  const [units, leases] = await Promise.all([
    zite.sql({
      query: `SELECT id, "propertyId", "name", "beds", "baths", "squareFeet", "marketRent", "readiness", "availableOn" FROM "Units" WHERE "propertyId" = ANY($1) AND COALESCE("archived", false) = false ORDER BY "name" ASC`,
      params: [propertyIds],
    }),
    zite.sql({
      query: `
        SELECT l.id, l."unitId", l."number", l."status", l."leaseType", l."startDate", l."endDate", l."noticeGivenOn", l."moveOutDate", l."rent",
          (SELECT string_agg(t."name", '|' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at)
             FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId"
             WHERE lt."leaseId" = l.id::text AND lt."role" IN ('Primary', 'Co-tenant')) AS residents
        FROM "Leases" l
        WHERE l."propertyId" = ANY($1) AND l."status" IN ('Active', 'Pending signature')
        ORDER BY l."startDate" ASC NULLS LAST`,
      params: [propertyIds],
    }),
  ]);
  const byUnit = new Map<string, Array<Record<string, unknown>>>();
  for (const l of leases.rows) {
    const k = String(l.unitId);
    byUnit.set(k, [...(byUnit.get(k) ?? []), l]);
  }
  return units.rows.map(u => {
    const list = byUnit.get(String(u.id)) ?? [];
    const dated = list.map(l => ({
      id: String(l.id),
      status: String(l.status),
      leaseType: str(l.leaseType),
      startDate: day(l.startDate),
      endDate: day(l.endDate),
      noticeGivenOn: day(l.noticeGivenOn),
      moveOutDate: day(l.moveOutDate),
    }));
    const occ = unitOccupancy(dated, today);
    const current = list.find(l => String(l.id) === occ.currentLeaseId);
    const upcoming = list.find(l => String(l.id) === occ.upcomingLeaseId);
    return {
      id: String(u.id),
      propertyId: String(u.propertyId),
      name: str(u.name) ?? '',
      beds: num(u.beds),
      baths: num(u.baths),
      squareFeet: numOrNull(u.squareFeet),
      marketRent: num(u.marketRent),
      readiness: str(u.readiness) || 'Ready',
      availableOn: day(u.availableOn),
      occupancy: occ.occupancy,
      lease: current
        ? {
            id: String(current.id),
            number: numOrNull(current.number),
            rent: num(current.rent),
            startDate: day(current.startDate),
            endDate: day(current.endDate),
            leaseType: str(current.leaseType) ?? '',
            moveOutDate: day(current.moveOutDate),
            residents: (str(current.residents) ?? '').split('|').filter(Boolean),
          }
        : null,
      upcomingLease: upcoming ? { id: String(upcoming.id), startDate: day(upcoming.startDate), rent: num(upcoming.rent) } : null,
    };
  });
}

/** Staff to tell when an owner writes or decides: each property's manager, else everyone who manages owners. */
export async function ownerContacts(propertyIds: string[]) {
  const managers = propertyIds.length
    ? (await zite.sql({ query: `SELECT DISTINCT "managerId" FROM "Properties" WHERE id::text = ANY($1) AND COALESCE("managerId", '') <> ''`, params: [propertyIds] })).rows.map(r => String(r.managerId))
    : [];
  if (managers.length) return managers;
  return (await membersWith('owners.manage')).map(m => m.id);
}

/** A property's address line for display. */
export const propertyAddress = (r: Record<string, unknown>) => formatAddress({ street: str(r.street), city: str(r.city), state: str(r.state), postalCode: str(r.postalCode) });

export const photoList = (raw: unknown): Array<{ url: string; name: string }> => {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(v) ? v.filter(p => p && typeof p.url === 'string' && /^https?:\/\//.test(p.url)).map(p => ({ url: String(p.url), name: String(p.name ?? 'Photo') })) : [];
  } catch {
    return [];
  }
};

// ── The printable statement ───────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function money(value: number, currency: string, opts: { parens?: boolean } = {}) {
  const n = Math.abs(value) < 0.005 ? 0 : value;
  if (opts.parens && n < 0) return `(${formatMoney(-n, currency)})`;
  return formatMoney(n, currency);
}

const CSS = `
  @page { size: letter; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #16181d; font-size: 9.5pt; line-height: 1.45; margin: 0; font-variant-numeric: tabular-nums; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #16181d; }
  .org { font-size: 13pt; font-weight: 700; letter-spacing: -0.01em; }
  .muted { color: #5c6270; }
  .small { font-size: 8.5pt; }
  .org-lines { margin-top: 2px; white-space: pre-line; }
  .title { text-align: right; }
  .title h1 { font-size: 17pt; margin: 0; letter-spacing: -0.02em; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 16px 0 6px; }
  .label { text-transform: uppercase; letter-spacing: 0.06em; font-size: 7.5pt; font-weight: 600; color: #5c6270; margin-bottom: 3px; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #d9dce3; border-radius: 6px; margin: 14px 0 6px; }
  .summary > div { padding: 9px 11px; }
  .summary > div + div { border-left: 1px solid #d9dce3; }
  .summary .v { font-size: 12pt; font-weight: 650; margin-top: 2px; }
  h2 { font-size: 11.5pt; margin: 22px 0 2px; letter-spacing: -0.01em; }
  h2 + .addr { margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3.5px 0; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; width: 110px; }
  .sec td { padding-top: 10px; font-weight: 650; border-bottom: 1px solid #d9dce3; }
  .ln td:first-child { padding-left: 12px; }
  .tot td { font-weight: 650; border-top: 1px solid #d9dce3; }
  .grand td { font-weight: 700; border-top: 1.5px solid #16181d; border-bottom: 1.5px solid #16181d; padding: 6px 0; }
  .avail td { font-weight: 700; background: #f2f4f7; padding: 6px 8px; }
  .gap td { height: 6px; padding: 0; }
  .warn { border: 1px solid #e3b341; background: #fff8e6; border-radius: 6px; padding: 8px 10px; margin-top: 12px; }
  .detail { page-break-before: always; }
  .detail th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: #5c6270; border-bottom: 1px solid #16181d; padding-bottom: 4px; }
  .detail td { border-bottom: 1px solid #eceef2; padding: 4px 6px 4px 0; font-size: 8.5pt; }
  .detail td.n { width: 80px; }
  .detail th.n { text-align: right; }
  .detail td.nowrap { white-space: nowrap; }
  tr { page-break-inside: avoid; }
  h2 { page-break-after: avoid; }
  .prop + .prop { margin-top: 8px; }
  .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #d9dce3; }
`;

function statementRows(f: StatementFigures, currency: string) {
  const row = (label: string, amount: number, cls = 'ln', parens = true) => `<tr class="${cls}"><td>${esc(label)}</td><td class="n">${money(amount, currency, { parens })}</td></tr>`;
  const sec = (label: string) => `<tr class="sec"><td colspan="2">${esc(label)}</td></tr>`;
  const out: string[] = [];
  out.push(`<tr class="grand"><td>Beginning cash</td><td class="n">${money(f.beginningCash, currency, { parens: true })}</td></tr>`);
  out.push(sec('Income'));
  if (!f.income.lines.length) out.push(`<tr class="ln"><td class="muted">No income received</td><td class="n">${money(0, currency)}</td></tr>`);
  for (const l of f.income.lines) out.push(row(l.label, l.amount));
  out.push(row('Total income', f.income.total, 'tot'));
  out.push(sec('Expenses'));
  if (!f.expenses.lines.length) out.push(`<tr class="ln"><td class="muted">No expenses paid</td><td class="n">${money(0, currency)}</td></tr>`);
  for (const l of f.expenses.lines) out.push(row(l.label, -l.amount));
  out.push(row('Total expenses', -f.expenses.total, 'tot'));
  out.push(row('Net operating cash flow', f.netOperatingCashFlow, 'tot'));
  if (f.deposits.received || f.deposits.returned) {
    out.push(sec('Security deposits'));
    if (f.deposits.received) out.push(row('Deposits received', f.deposits.received));
    if (f.deposits.returned) out.push(row('Deposits returned', -f.deposits.returned));
  }
  out.push(sec('Owner activity'));
  if (f.ownerActivity.contributions) out.push(row('Contributions', f.ownerActivity.contributions));
  out.push(row('Distributions', -f.ownerActivity.distributions));
  if (f.other.lines.length) {
    out.push(sec('Other bank activity'));
    for (const l of f.other.lines) out.push(row(l.label, l.amount));
  }
  if (!f.reconciled) out.push(row('Unreconciled difference', f.difference, 'tot'));
  out.push(`<tr class="gap"><td colspan="2"></td></tr>`);
  out.push(`<tr class="grand"><td>Ending cash</td><td class="n">${money(f.endingCash, currency, { parens: true })}</td></tr>`);
  out.push(row('Less security deposits held', -f.depositsHeld));
  out.push(row('Less property reserve', -f.reserve));
  out.push(row('Less unpaid bills', -f.unpaidBills));
  out.push(`<tr class="avail"><td>Available for distribution</td><td class="n">${money(Math.max(0, f.availableForDistribution), currency)}</td></tr>`);
  return `<table>${out.join('')}</table>`;
}

export function statementHtml(input: {
  settings: OrgSettings;
  owner: OwnerScope['owner'];
  label: string;
  statement: OwnerStatement;
  transactions: StatementTransaction[];
  truncated: boolean;
  generatedOn: string;
}) {
  const { settings, owner, statement: st, transactions } = input;
  const c = settings.currency;
  const multi = st.properties.length > 1;
  const summary = (f: StatementFigures) => `
    <div class="summary">
      <div><div class="label">Beginning cash</div><div class="v">${money(f.beginningCash, c, { parens: true })}</div></div>
      <div><div class="label">Net operating cash flow</div><div class="v">${money(f.netOperatingCashFlow, c, { parens: true })}</div></div>
      <div><div class="label">Distributions</div><div class="v">${money(f.ownerActivity.distributions, c)}</div></div>
      <div><div class="label">Ending cash</div><div class="v">${money(f.endingCash, c, { parens: true })}</div></div>
    </div>`;
  const property = (p: PropertyStatement) => `
    <section class="prop">
      <h2>${esc(p.propertyName)}</h2>
      <div class="addr muted small">${esc(p.address)}</div>
      ${statementRows(p, c)}
    </section>`;
  const detailRows = transactions
    .map(
      t => `<tr>
        <td class="nowrap">${esc(formatDay(t.date).replace(/, \d{4}$/, ''))}</td>
        ${multi ? `<td>${esc(t.propertyName)}</td>` : ''}
        <td class="nowrap">${esc(t.typeLabel)}</td>
        <td>${esc([t.party, t.unitName && t.kind === 'Payment' ? `#${t.unitName}` : ''].filter(Boolean).join(' '))}</td>
        <td>${esc(t.memo)}${t.reference ? ` <span class="muted">${t.paymentMethod === 'Check' ? '#' : '· '}${esc(t.reference)}</span>` : ''}</td>
        <td class="n">${t.amountIn ? money(t.amountIn, c) : ''}</td>
        <td class="n">${t.amountOut ? money(t.amountOut, c) : ''}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owner statement</title><style>${CSS}</style></head><body>
    <div class="head">
      <div>
        ${settings.logoUrl && /^https:\/\//.test(settings.logoUrl) ? `<img src="${esc(settings.logoUrl)}" alt="" style="height:30px;margin-bottom:6px">` : ''}
        <div class="org">${esc(settings.organizationName)}</div>
        <div class="org-lines muted small">${esc(settings.address)}${settings.phone ? `\n${esc(settings.phone)}` : ''}${settings.supportEmail ? ` · ${esc(settings.supportEmail)}` : ''}</div>
      </div>
      <div class="title">
        <h1>Owner statement</h1>
        <div class="muted">${esc(input.label)}</div>
        <div class="muted small">${esc(formatDay(st.periodStart, 'long'))} – ${esc(formatDay(st.periodEnd, 'long'))}</div>
      </div>
    </div>
    <div class="meta">
      <div><div class="label">Prepared for</div><div><strong>${esc(owner.name)}</strong></div>${owner.contactName && owner.contactName !== owner.name ? `<div>${esc(owner.contactName)}</div>` : ''}<div class="muted small" style="white-space:pre-line">${esc(owner.mailingAddress)}</div></div>
      <div><div class="label">Properties</div><div>${st.properties.map(p => esc(p.propertyName)).join('<br>') || '—'}</div></div>
    </div>
    ${summary(st.combined)}
    ${st.warnings.length ? `<div class="warn"><strong>Reconciliation needed.</strong> ${st.warnings.map(esc).join(' ')}</div>` : ''}
    ${st.properties.map(property).join('')}
    ${multi ? `<section class="prop"><h2>All properties</h2><div class="addr muted small">Combined totals</div>${statementRows(st.combined, c)}</section>` : ''}
    <section class="detail">
      <h2>Transaction detail</h2>
      <div class="addr muted small">Every deposit to and payment from the ${multi ? 'properties’' : 'property’s'} bank accounts in the period.${input.truncated ? ' Showing the first 1,000.' : ''}</div>
      ${
        transactions.length
          ? `<table><thead><tr><th>Date</th>${multi ? '<th>Property</th>' : ''}<th>Type</th><th>Paid by / to</th><th>Memo</th><th class="n">In</th><th class="n">Out</th></tr></thead><tbody>${detailRows}</tbody></table>`
          : '<p class="muted">No bank activity in this period.</p>'
      }
    </section>
    <div class="foot muted small">Cash basis. Prepared ${esc(formatDay(input.generatedOn, 'long'))} by ${esc(settings.organizationName)}. Questions about this statement? ${settings.phone ? `Call ${esc(settings.phone)}` : ''}${settings.supportEmail ? ` or email ${esc(settings.supportEmail)}` : ''}.</div>
  </body></html>`;
}

// ── Statement requests ────────────────────────────────────────────────────

/**
 * Resolve what an owner asked a statement for — a month in the last two years
 * or year to date, for all their properties or one — into a scope. A property
 * that isn't theirs is NOT_FOUND.
 */
export const StatementInput = z.object({
  period: z.string().regex(/^(ytd|\d{4}-(0[1-9]|1[0-2]))$/, 'Choose a month to see its statement.'),
  propertyId: z.string().max(64).nullish(),
});

export function statementRequest(scope: OwnerScope, input: { period: string; propertyId?: string | null }) {
  const periods = recentPeriods(scope.today, 24);
  if (input.period !== 'ytd' && !periods.includes(input.period)) {
    throw new ZiteError('Statements are available for the last 24 months. Choose another month.', 'BAD_REQUEST');
  }
  const propertyIds = input.propertyId ? [requireOwnerProperty(scope, input.propertyId)] : scope.propertyIds;
  return { propertyIds, periods };
}
