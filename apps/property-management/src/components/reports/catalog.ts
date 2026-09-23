import { addPeriods, isDay, periodEnd, periodOf, periodStart } from '@project/shared/dates';

/**
 * Every report the app offers: its URL key, what it's called, what it
 * answers, which parameters it takes and whether it shows the books (and so
 * needs `accounting.view` on top of `reports.view`). Pure data — the catalog
 * page, the report frame and the endpoints all read it.
 */

export type ReportGroup = 'financial' | 'receivables' | 'leasing' | 'maintenance' | 'portfolio';

export const REPORT_GROUPS: Array<{ key: ReportGroup; label: string }> = [
  { key: 'financial', label: 'Financial' },
  { key: 'receivables', label: 'Rent & receivables' },
  { key: 'leasing', label: 'Leasing' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'portfolio', label: 'Portfolio' },
];

export type PeriodPreset = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'ytd' | 'last_year' | 'last_12_months' | 'custom';

export const PERIOD_PRESETS: Array<{ value: Exclude<PeriodPreset, 'custom'>; label: string }> = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_12_months', label: 'Last 12 months' },
  { value: 'last_year', label: 'Last year' },
];

export type AsOfPreset = 'today' | 'last_month_end' | 'last_quarter_end' | 'last_year_end' | 'custom';

export const AS_OF_PRESETS: Array<{ value: Exclude<AsOfPreset, 'custom'>; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last_month_end', label: 'End of last month' },
  { value: 'last_quarter_end', label: 'End of last quarter' },
  { value: 'last_year_end', label: 'End of last year' },
];

export type Option = { value: string; label: string };

export type ReportParamSpec = {
  properties?: boolean;
  /** A date range; the value is the default preset. */
  period?: Exclude<PeriodPreset, 'custom'>;
  asOf?: boolean;
  basis?: 'cash' | 'accrual';
  groupBy?: { options: Option[]; default: string };
  owner?: boolean;
  accounts?: boolean;
  months?: { options: number[]; default: number };
  year?: boolean;
  /** Offer "Show zero balances". */
  zero?: boolean;
};

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  group: ReportGroup;
  /** Shows the books: needs accounting.view as well as reports.view. */
  financial: boolean;
  params: ReportParamSpec;
  keywords: string[];
};

export const REPORTS: ReportDef[] = [
  {
    key: 'income-statement',
    title: 'Income statement',
    description: 'Income, expenses and net operating income by month or property, cash or accrual.',
    group: 'financial',
    financial: true,
    params: {
      properties: true,
      period: 'ytd',
      basis: 'cash',
      groupBy: { options: [{ value: 'month', label: 'By month' }, { value: 'property', label: 'By property' }, { value: 'none', label: 'Total' }], default: 'month' },
    },
    keywords: ['p&l', 'profit and loss', 'pnl', 'noi', 'operating statement'],
  },
  {
    key: 'balance-sheet',
    title: 'Balance sheet',
    description: 'Assets, liabilities and equity on a date, with a check that they balance.',
    group: 'financial',
    financial: true,
    params: { properties: true, asOf: true, zero: true },
    keywords: ['assets', 'liabilities', 'equity', 'position'],
  },
  {
    key: 'cash-flow',
    title: 'Cash flow',
    description: 'Beginning cash, receipts, disbursements and owner money for a period, tied to the bank.',
    group: 'financial',
    financial: true,
    params: { properties: true, period: 'this_month', groupBy: { options: [{ value: 'property', label: 'By property' }, { value: 'none', label: 'Total' }], default: 'property' } },
    keywords: ['cash', 'receipts', 'disbursements', 'bank'],
  },
  {
    key: 'trial-balance',
    title: 'Trial balance',
    description: 'Every account’s debit or credit balance on a date. Debits must equal credits.',
    group: 'financial',
    financial: true,
    params: { properties: true, asOf: true, zero: true },
    keywords: ['tb', 'debits', 'credits', 'accounts'],
  },
  {
    key: 'general-ledger',
    title: 'General ledger',
    description: 'Opening balance, every posted line with a running balance, and closing balance per account.',
    group: 'financial',
    financial: true,
    params: { properties: true, period: 'this_month', accounts: true },
    keywords: ['gl', 'journal', 'lines', 'register', 'transactions'],
  },
  {
    key: 'owner-statement',
    title: 'Owner statement',
    description: 'What happened to an owner’s money, property by property, on a cash basis.',
    group: 'financial',
    financial: true,
    params: { owner: true, period: 'last_month' },
    keywords: ['owner', 'distribution', 'statement', 'remittance'],
  },
  {
    key: 'rent-roll',
    title: 'Rent roll',
    description: 'Every unit with its residents, lease dates, market and lease rent, deposit and balance.',
    group: 'receivables',
    financial: true,
    params: { properties: true, asOf: true },
    keywords: ['units', 'rent', 'occupancy', 'leases', 'residents'],
  },
  {
    key: 'aging',
    title: 'Delinquency & aging',
    description: 'Who owes what, bucketed 0–30, 31–60, 61–90 and 90+ days past due.',
    group: 'receivables',
    financial: true,
    params: { properties: true, asOf: true },
    keywords: ['delinquency', 'aging', 'past due', 'collections', 'ar', 'receivables', 'balances'],
  },
  {
    key: 'payments',
    title: 'Payments received',
    description: 'Rent and other payments for a period, by method and property, with every payment listed.',
    group: 'receivables',
    financial: true,
    params: { properties: true, period: 'this_month' },
    keywords: ['receipts', 'collections', 'deposits', 'ach', 'checks'],
  },
  {
    key: 'deposits',
    title: 'Security deposits held',
    description: 'Deposit held for each lease against what the lease requires, on a date.',
    group: 'receivables',
    financial: true,
    params: { properties: true, asOf: true },
    keywords: ['security deposit', 'trust', 'liability'],
  },
  {
    key: 'vacancy',
    title: 'Vacancy',
    description: 'Vacant and on-notice units with days vacant, estimated loss, readiness and listing status.',
    group: 'leasing',
    financial: false,
    params: { properties: true },
    keywords: ['vacant', 'notice', 'make ready', 'listings', 'loss'],
  },
  {
    key: 'lease-expirations',
    title: 'Lease expirations',
    description: 'Leases ending in the coming months, with renewal status and rent against market.',
    group: 'leasing',
    financial: false,
    params: { properties: true, months: { options: [3, 6, 12], default: 6 } },
    keywords: ['renewals', 'expiring', 'month-to-month', 'retention'],
  },
  {
    key: 'leasing-funnel',
    title: 'Leasing funnel',
    description: 'Inquiries to applications to approvals to leases, with conversion rates and days to lease.',
    group: 'leasing',
    financial: false,
    params: { properties: true, period: 'ytd', groupBy: { options: [{ value: 'property', label: 'By property' }, { value: 'source', label: 'By source' }], default: 'property' } },
    keywords: ['conversion', 'inquiries', 'applications', 'prospects', 'marketing'],
  },
  {
    key: 'work-orders',
    title: 'Work orders',
    description: 'Opened and completed work, days to complete, open aging and vendor costs.',
    group: 'maintenance',
    financial: false,
    params: {
      properties: true,
      period: 'ytd',
      groupBy: { options: [{ value: 'category', label: 'By category' }, { value: 'property', label: 'By property' }, { value: 'vendor', label: 'By vendor' }, { value: 'priority', label: 'By priority' }], default: 'category' },
    },
    keywords: ['maintenance', 'repairs', 'service', 'response time'],
  },
  {
    key: 'vendor-spend',
    title: 'Vendor spend & 1099',
    description: 'What each vendor was paid in a calendar year, with 1099 status and a filing export.',
    group: 'maintenance',
    financial: true,
    params: { properties: true, year: true },
    keywords: ['1099', '1099-nec', 'vendors', 'tax', 'w-9', 'spend'],
  },
  {
    key: 'occupancy',
    title: 'Occupancy summary',
    description: 'Physical and economic occupancy by property, and the trend over the last 12 months.',
    group: 'portfolio',
    financial: false,
    params: { properties: true, asOf: true },
    keywords: ['occupancy', 'vacancy rate', 'trend', 'portfolio'],
  },
];

export const REPORT_BY_KEY = new Map(REPORTS.map(r => [r.key, r]));

// ── Parameters ───────────────────────────────────────────────────────────────

/** What an endpoint receives: every value resolved (no presets). */
export type ReportInputValues = {
  propertyIds?: string[];
  from?: string;
  to?: string;
  asOf?: string;
  basis?: 'cash' | 'accrual';
  groupBy?: string;
  ownerId?: string;
  accountIds?: string[];
  months?: number;
  year?: number;
  page?: number;
  showZero?: boolean;
};

const quarterStart = (day: string) => {
  const [y, m] = day.split('-').map(Number);
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
};

export function resolvePeriod(preset: Exclude<PeriodPreset, 'custom'>, today: string): { from: string; to: string } {
  const month = periodOf(today);
  const year = today.slice(0, 4);
  switch (preset) {
    case 'this_month':
      return { from: periodStart(month), to: today };
    case 'last_month': {
      const p = addPeriods(month, -1);
      return { from: periodStart(p), to: periodEnd(p) };
    }
    case 'this_quarter':
      return { from: quarterStart(today), to: today };
    case 'last_quarter': {
      const start = periodOf(quarterStart(today));
      const p = addPeriods(start, -3);
      return { from: periodStart(p), to: periodEnd(addPeriods(p, 2)) };
    }
    case 'ytd':
      return { from: `${year}-01-01`, to: today };
    case 'last_12_months':
      return { from: periodStart(addPeriods(month, -11)), to: today };
    case 'last_year':
      return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` };
  }
}

export function resolveAsOf(preset: Exclude<AsOfPreset, 'custom'>, today: string): string {
  const month = periodOf(today);
  switch (preset) {
    case 'today':
      return today;
    case 'last_month_end':
      return periodEnd(addPeriods(month, -1));
    case 'last_quarter_end':
      return periodEnd(addPeriods(periodOf(quarterStart(today)), -1));
    case 'last_year_end':
      return `${Number(today.slice(0, 4)) - 1}-12-31`;
  }
}

/** The parameters as they live in the URL, parsed and defaulted. */
export type ReportUrlState = {
  propertyIds: string[];
  period: PeriodPreset;
  from: string;
  to: string;
  asOfPreset: AsOfPreset;
  asOf: string;
  basis: 'cash' | 'accrual';
  groupBy: string;
  ownerId: string;
  accountIds: string[];
  months: number;
  year: number;
  page: number;
  showZero: boolean;
};

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

export function readUrlState(def: ReportDef, search: URLSearchParams, today: string): ReportUrlState {
  const p = def.params;
  let period: PeriodPreset = (search.get('period') as PeriodPreset) || p.period || 'this_month';
  let from = '';
  let to = '';
  if (period === 'custom') {
    from = search.get('from') ?? '';
    to = search.get('to') ?? '';
    if (!isDay(from) || !isDay(to) || from > to) period = p.period ?? 'this_month';
  }
  if (period !== 'custom') {
    if (!PERIOD_PRESETS.some(x => x.value === period)) period = p.period ?? 'this_month';
    ({ from, to } = resolvePeriod(period as Exclude<PeriodPreset, 'custom'>, today));
  }
  const asOfRaw = search.get('asOf');
  let asOfPreset: AsOfPreset = 'today';
  let asOf = today;
  if (asOfRaw && isDay(asOfRaw)) {
    asOfPreset = 'custom';
    asOf = asOfRaw;
  } else if (asOfRaw && AS_OF_PRESETS.some(x => x.value === asOfRaw)) {
    asOfPreset = asOfRaw as AsOfPreset;
    asOf = resolveAsOf(asOfPreset as Exclude<AsOfPreset, 'custom'>, today);
  }
  const groupBy = search.get('group') ?? '';
  const months = Number(search.get('months'));
  const year = Number(search.get('year'));
  const page = Number(search.get('page'));
  return {
    propertyIds: list(search.get('properties')),
    period,
    from,
    to,
    asOfPreset,
    asOf,
    basis: search.get('basis') === 'accrual' ? 'accrual' : search.get('basis') === 'cash' ? 'cash' : p.basis ?? 'cash',
    groupBy: p.groupBy?.options.some(o => o.value === groupBy) ? groupBy : p.groupBy?.default ?? '',
    ownerId: search.get('owner') ?? '',
    accountIds: list(search.get('accounts')),
    months: p.months?.options.includes(months) ? months : p.months?.default ?? 6,
    year: year >= 2000 && year <= 2100 ? year : Number(today.slice(0, 4)),
    page: page >= 1 ? Math.floor(page) : 1,
    showZero: search.get('zero') === 'show',
  };
}

/** Only what this report uses, for the endpoint (and the query key). */
export function toInput(def: ReportDef, s: ReportUrlState): ReportInputValues {
  const p = def.params;
  const out: ReportInputValues = {};
  if (p.properties && s.propertyIds.length) out.propertyIds = s.propertyIds;
  if (p.period) {
    out.from = s.from;
    out.to = s.to;
  }
  if (p.asOf) out.asOf = s.asOf;
  if (p.basis) out.basis = s.basis;
  if (p.groupBy) out.groupBy = s.groupBy;
  if (p.owner && s.ownerId) out.ownerId = s.ownerId;
  if (p.accounts && s.accountIds.length) out.accountIds = s.accountIds;
  if (p.months) out.months = s.months;
  if (p.year) out.year = s.year;
  if (p.accounts && s.page > 1) out.page = s.page;
  if (p.zero && s.showZero) out.showZero = true;
  return out;
}

/** A link to a report with parameters, for drill-downs between reports. */
export function reportHref(key: string, params: Record<string, string | number | string[] | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return `/reports/${key}${s ? `?${s}` : ''}`;
}

/** URL params for a resolved date range: a preset when it matches one, else custom dates. */
export function periodUrlParams(from: string, to: string, today: string): Record<string, string> {
  for (const p of PERIOD_PRESETS) {
    const r = resolvePeriod(p.value, today);
    if (r.from === from && r.to === to) return { period: p.value };
  }
  return { period: 'custom', from, to };
}
