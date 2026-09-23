import { zite } from 'zitejs/db';
import { addDays, isDay, periodLabel } from '../dates';
import { formatMoney, fromCents, toCents } from '../money';
import { getChart, type AccountRow, type Chart } from './accounts';
import { num, ref, str } from './sql';

/**
 * Owner statements: what happened to an owner's money, per property, the way
 * a property manager reports it — on a CASH basis.
 *
 * Every figure is read from the posted books (never stored), so a statement
 * can't disagree with the ledger it summarises:
 *
 *   Beginning cash        Σ bank lines (debit − credit) for the property before the period
 *   Income                payments received in the period, by what they paid: Allocations
 *                         dated by period end, from Payments dated in the period, grouped by
 *                         the charge's income account. Money that paid a SECURITY DEPOSIT
 *                         charge is not income (see Security deposits). Payment money not
 *                         yet matched to a charge by period end is "Prepaid rent & unapplied
 *                         payments". Refunds of a tenant's credit balance reduce income.
 *   Expenses              Bill payments, split across the paid bills' expense lines (by the
 *                         bill's property, which is how `payBills` books the cash), direct
 *                         Expenses by account, and Management fees
 *   Net operating cash    income − expenses
 *   Security deposits     received (payments applied to deposit charges) − returned (deposit refunds)
 *   Owner activity        contributions − distributions
 *   Other bank activity   transfers and journal entries that touched the property's bank lines
 *   Ending cash           Σ bank lines through period end — queried INDEPENDENTLY of the
 *                         sections above. When beginning + sections ≠ ending, the statement
 *                         carries `difference` and `reconciled: false` rather than hiding it.
 *
 *   Deposits held         Σ Deposits-held lines (credit − debit) through period end
 *   Reserve               Properties.reserveAmount
 *   Unpaid bills          bills dated by period end less payments dated by period end
 *   Available             ending cash − deposits held − reserve − unpaid bills (combined: the sum
 *                         of each property's positive amount)
 *
 * All reads are SQL aggregates (tables run to thousands of rows and `zite.sql`
 * returns at most 2000), so a statement costs a fixed ~8 queries however large
 * the portfolio or the period.
 *
 * API — used by the owner portal and the staff app's reports:
 *   ownerStatement({ propertyIds, periodStart, periodEnd })   → per-property sections + combined totals
 *   statementTransactions({ propertyIds, periodStart, periodEnd }) → the cash register behind it
 *   monthlyCashFlow({ propertyIds, fromPeriod, toPeriod })     → income / expenses / net per month (charts)
 *   statementPeriod('2026-08' | 'ytd', today)                  → { periodStart, periodEnd, label, isPartial }
 */

export type StatementLine = {
  /** Stable across properties, so combined totals merge lines: `acct:<accountId>`, `prepayments`, `credit_refunds`, `other:<kind>`. */
  key: string;
  label: string;
  accountId: string | null;
  accountNumber: string | null;
  amount: number;
};

export type StatementSection = { lines: StatementLine[]; total: number };

export type StatementFigures = {
  beginningCash: number;
  income: StatementSection;
  expenses: StatementSection;
  netOperatingCashFlow: number;
  deposits: { received: number; returned: number; net: number };
  ownerActivity: { contributions: number; distributions: number; net: number };
  other: StatementSection;
  /** Everything that moved the bank in the period, from the sections above. */
  netChange: number;
  /** Σ bank lines through period end, read separately from the sections. */
  endingCash: number;
  /** endingCash − (beginningCash + netChange). Zero when the books reconcile. */
  difference: number;
  reconciled: boolean;
  depositsHeld: number;
  reserve: number;
  unpaidBills: number;
  /**
   * Per property: ending cash − deposits held − reserve − unpaid bills (negative when there's a shortfall).
   * Combined: the sum of each property's positive amount — one building's shortfall doesn't hold back another's.
   */
  availableForDistribution: number;
};

export type PropertyStatement = StatementFigures & {
  propertyId: string;
  propertyName: string;
  ownerId: string | null;
  address: string;
};

export type OwnerStatement = {
  periodStart: string;
  periodEnd: string;
  properties: PropertyStatement[];
  combined: StatementFigures;
  /** Plain sentences for anything that didn't reconcile. Empty when the books tie out. */
  warnings: string[];
};

export type StatementTransaction = {
  id: string;
  number: number;
  date: string;
  kind: string;
  /** "Rent payment", "Bill payment", "Owner distribution"… */
  typeLabel: string;
  propertyId: string;
  propertyName: string;
  unitName: string;
  /** Who paid or was paid: a resident, a vendor, the owner. */
  party: string;
  memo: string;
  reference: string;
  paymentMethod: string;
  amountIn: number;
  amountOut: number;
};

export type MonthlyCashFlow = { period: string; label: string; income: number; expenses: number; net: number; distributions: number; contributions: number };

type Scope = { propertyIds: string[]; periodStart: string; periodEnd: string };

const OTHER_LABEL: Record<string, string> = {
  Transfer: 'Transfers between accounts',
  'Journal entry': 'Adjustments and opening balances',
};

const HANDLED_KINDS = ['Payment', 'Bill payment', 'Expense', 'Management fee', 'Refund', 'Owner contribution', 'Owner distribution'];

function assertScope(s: Scope) {
  if (!isDay(s.periodStart) || !isDay(s.periodEnd)) throw new Error('ownerStatement: periodStart and periodEnd must be YYYY-MM-DD');
  if (s.periodStart > s.periodEnd) throw new Error('ownerStatement: periodStart is after periodEnd');
}

const cents = (v: unknown) => toCents(num(v));

function bankIds(chart: Chart) {
  return chart.all.filter(a => a.subtype === 'Bank').map(a => a.id);
}

function lineFor(key: string, account: AccountRow | undefined, label: string, amountCents: number): StatementLine {
  return { key, label: account?.name ?? label, accountId: account?.id ?? null, accountNumber: account?.number || null, amount: fromCents(amountCents) };
}

/** Income lines first by account number, then the non-account lines in a fixed order. */
const LINE_ORDER = ['prepayments', 'credit_refunds'];
function sortLines(lines: StatementLine[]) {
  return lines
    .filter(l => toCents(l.amount) !== 0)
    .sort((a, b) => {
      if (a.accountNumber && b.accountNumber) return a.accountNumber.localeCompare(b.accountNumber);
      if (a.accountNumber) return -1;
      if (b.accountNumber) return 1;
      return LINE_ORDER.indexOf(a.key) - LINE_ORDER.indexOf(b.key) || a.label.localeCompare(b.label);
    });
}

type Bucket = { lines: Map<string, { account?: AccountRow; label: string; cents: number }> };
const bucket = (): Bucket => ({ lines: new Map() });
function add(b: Bucket, key: string, cents: number, account?: AccountRow, label = '') {
  const cur = b.lines.get(key);
  if (cur) cur.cents += cents;
  else b.lines.set(key, { account, label, cents });
}
function section(b: Bucket): StatementSection {
  const lines = sortLines([...b.lines.entries()].map(([key, v]) => lineFor(key, v.account, v.label, v.cents)));
  return { lines, total: fromCents([...b.lines.values()].reduce((a, v) => a + v.cents, 0)) };
}

/** Cash flows for a scope, grouped by property and (optionally) by calendar month of the cash event. */
type Flow = {
  income: Bucket;
  expenses: Bucket;
  depositsReceived: number;
  depositsReturned: number;
  contributions: number;
  distributions: number;
  other: Bucket;
};

const newFlow = (): Flow => ({ income: bucket(), expenses: bucket(), depositsReceived: 0, depositsReturned: 0, contributions: 0, distributions: 0, other: bucket() });

async function readFlows(scope: Scope, chart: Chart, byMonth: boolean): Promise<Map<string, Flow>> {
  const banks = bankIds(chart);
  const { propertyIds, periodStart, periodEnd } = scope;
  // A bucket key for SQL: the cash event's month, or one bucket for the whole period.
  const month = (col: string) => (byMonth ? `LEFT(CAST(${col} AS TEXT), 7)` : `'all'`);
  // An allocation counts toward what it paid only if it was made by the end of the bucket it lands in.
  const allocCutoff = byMonth ? `LEFT(CAST(a."date" AS TEXT), 7) <= LEFT(CAST(p."date" AS TEXT), 7)` : `a."date" <= $3`;

  const [headers, applied, billPaid, billPaidTotals, expenses, otherBank] = await Promise.all([
    // Payments, fees, refunds and owner money, by their header amounts.
    zite.sql({
      query: `
        SELECT t."propertyId" AS pid, ${month('t."date"')} AS bucket, t."kind", t."accountId", SUM(t."amount") AS amount
        FROM "Transactions" t
        WHERE t."status" = 'Posted' AND t."kind" IN ('Payment', 'Management fee', 'Refund', 'Owner contribution', 'Owner distribution')
          AND t."propertyId" = ANY($1) AND t."date" >= $2 AND t."date" <= $3
        GROUP BY 1, 2, 3, 4`,
      params: [propertyIds, periodStart, periodEnd],
    }),
    // What those payments paid for.
    zite.sql({
      query: `
        SELECT p."propertyId" AS pid, ${month('p."date"')} AS bucket, c."accountId", c."kind" AS "chargeKind", SUM(a."amount") AS amount
        FROM "Allocations" a
        JOIN "Transactions" p ON p.id::text = a."paymentId"
        JOIN "Transactions" c ON c.id::text = a."chargeId"
        WHERE COALESCE(a."void", false) = false AND p."kind" = 'Payment' AND p."status" = 'Posted' AND c."status" = 'Posted'
          AND p."propertyId" = ANY($1) AND p."date" >= $2 AND p."date" <= $3 AND ${allocCutoff}
        GROUP BY 1, 2, 3, 4`,
      params: [propertyIds, periodStart, periodEnd],
    }),
    // Bill payments spread over each paid bill's expense lines, by each line's property: a bill split across buildings is paid from each building's cash.
    zite.sql({
      query: `
        SELECT dl."propertyId" AS pid, ${month('bp."date"')} AS bucket, dl."accountId", SUM(a."amount" * dl."debit" / NULLIF(b."amount", 0)) AS amount
        FROM "Allocations" a
        JOIN "Transactions" bp ON bp.id::text = a."paymentId"
        JOIN "Transactions" b ON b.id::text = a."chargeId"
        JOIN "JournalLines" dl ON dl."transactionId" = b.id::text
        WHERE COALESCE(a."void", false) = false AND bp."kind" = 'Bill payment' AND bp."status" = 'Posted' AND b."kind" = 'Bill' AND b."status" = 'Posted'
          AND COALESCE(dl."void", false) = false AND COALESCE(dl."debit", 0) > 0
          AND dl."propertyId" = ANY($1) AND bp."date" >= $2 AND bp."date" <= $3
        GROUP BY 1, 2, 3`,
      params: [propertyIds, periodStart, periodEnd],
    }),
    // The exact amounts paid per property (the payment's bank lines), to settle sub-cent rounding from the spread above.
    zite.sql({
      query: `
        SELECT jl."propertyId" AS pid, ${month('bp."date"')} AS bucket, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS amount
        FROM "JournalLines" jl JOIN "Transactions" bp ON bp.id::text = jl."transactionId"
        WHERE bp."kind" = 'Bill payment' AND bp."status" = 'Posted' AND COALESCE(jl."void", false) = false
          AND jl."accountId" = ANY($4) AND jl."propertyId" = ANY($1) AND bp."date" >= $2 AND bp."date" <= $3
        GROUP BY 1, 2`,
      params: [propertyIds, periodStart, periodEnd, banks],
    }),
    // Money spent straight from the bank.
    zite.sql({
      query: `
        SELECT jl."propertyId" AS pid, ${month('jl."date"')} AS bucket, jl."accountId", SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS amount
        FROM "JournalLines" jl JOIN "Transactions" t ON t.id::text = jl."transactionId"
        WHERE t."kind" = 'Expense' AND t."status" = 'Posted' AND COALESCE(jl."void", false) = false
          AND NOT (jl."accountId" = ANY($4)) AND jl."propertyId" = ANY($1) AND jl."date" >= $2 AND jl."date" <= $3
        GROUP BY 1, 2, 3`,
      params: [propertyIds, periodStart, periodEnd, banks],
    }),
    // Anything else that touched the bank: transfers, journal entries, the unexpected.
    zite.sql({
      query: `
        SELECT jl."propertyId" AS pid, ${month('jl."date"')} AS bucket, t."kind", SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS amount
        FROM "JournalLines" jl JOIN "Transactions" t ON t.id::text = jl."transactionId"
        WHERE t."status" = 'Posted' AND COALESCE(jl."void", false) = false AND NOT (t."kind" = ANY($5))
          AND jl."accountId" = ANY($4) AND jl."propertyId" = ANY($1) AND jl."date" >= $2 AND jl."date" <= $3
        GROUP BY 1, 2, 3`,
      params: [propertyIds, periodStart, periodEnd, banks, HANDLED_KINDS],
    }),
  ]);

  const flows = new Map<string, Flow>();
  const flow = (pid: unknown, b: unknown) => {
    const key = `${String(pid ?? '')}|${String(b ?? 'all')}`;
    let f = flows.get(key);
    if (!f) {
      f = newFlow();
      flows.set(key, f);
    }
    return f;
  };
  const paymentCents = new Map<string, number>();
  const appliedCents = new Map<string, number>();
  const depositAccount = (id: string | null) => {
    const a = id ? chart.byId.get(id) : undefined;
    return a?.subtype === 'Deposits held';
  };

  for (const r of headers.rows) {
    const f = flow(r.pid, r.bucket);
    const amount = cents(r.amount);
    const accountId = ref(r.accountId);
    const key = `${r.pid}|${r.bucket}`;
    switch (String(r.kind)) {
      case 'Payment':
        paymentCents.set(key, (paymentCents.get(key) ?? 0) + amount);
        break;
      case 'Management fee': {
        const account = accountId ? chart.byId.get(accountId) : undefined;
        add(f.expenses, `acct:${account?.id ?? 'management_fees'}`, amount, account, 'Management fees');
        break;
      }
      case 'Refund':
        if (depositAccount(accountId)) f.depositsReturned += amount;
        else add(f.income, 'credit_refunds', -amount, undefined, 'Refunds of tenant credit');
        break;
      case 'Owner contribution':
        f.contributions += amount;
        break;
      case 'Owner distribution':
        f.distributions += amount;
        break;
    }
  }

  for (const r of applied.rows) {
    const f = flow(r.pid, r.bucket);
    const key = `${r.pid}|${r.bucket}`;
    const amount = cents(r.amount);
    const accountId = ref(r.accountId);
    const account = accountId ? chart.byId.get(accountId) : undefined;
    if (String(r.chargeKind) !== 'Charge' || !account) continue; // e.g. a payment consumed by a credit refund stays "unapplied"
    if (account.subtype === 'Deposits held') {
      f.depositsReceived += amount;
      appliedCents.set(key, (appliedCents.get(key) ?? 0) + amount);
    } else if (account.accountType === 'Income') {
      add(f.income, `acct:${account.id}`, amount, account);
      appliedCents.set(key, (appliedCents.get(key) ?? 0) + amount);
    }
  }
  for (const [key, paid] of paymentCents) {
    const [pid, b] = key.split('|');
    const rest = paid - (appliedCents.get(key) ?? 0);
    if (rest !== 0) add(flow(pid, b).income, 'prepayments', rest, undefined, 'Prepaid rent and unapplied payments');
  }

  const spread = new Map<string, Map<string, number>>();
  for (const r of billPaid.rows) {
    const key = `${r.pid}|${r.bucket}`;
    const m = spread.get(key) ?? new Map<string, number>();
    m.set(String(r.accountId), (m.get(String(r.accountId)) ?? 0) + Math.round(num(r.amount) * 100));
    spread.set(key, m);
  }
  for (const r of billPaidTotals.rows) {
    const key = `${r.pid}|${r.bucket}`;
    const f = flow(r.pid, r.bucket);
    const total = cents(r.amount);
    const m = spread.get(key) ?? new Map<string, number>();
    // Rounding each account's share can drift a cent or two from what was actually paid; the largest line absorbs it.
    const drift = total - [...m.values()].reduce((a, v) => a + v, 0);
    if (drift !== 0) {
      const largest = [...m.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      if (largest) m.set(largest[0], largest[1] + drift);
      else m.set('', drift);
    }
    for (const [accountId, amount] of m) {
      const account = chart.byId.get(accountId);
      add(f.expenses, account ? `acct:${account.id}` : 'bills_unclassified', amount, account, 'Bills paid');
    }
  }

  for (const r of expenses.rows) {
    const f = flow(r.pid, r.bucket);
    const accountId = ref(r.accountId);
    const account = accountId ? chart.byId.get(accountId) : undefined;
    add(f.expenses, account ? `acct:${account.id}` : 'expenses_unclassified', cents(r.amount), account, 'Other expenses');
  }

  for (const r of otherBank.rows) {
    const f = flow(r.pid, r.bucket);
    const kind = String(r.kind);
    add(f.other, `other:${kind}`, cents(r.amount), undefined, OTHER_LABEL[kind] ?? `Other bank activity (${kind.toLowerCase()})`);
  }

  return flows;
}

function figuresFrom(f: Flow, balances: { beginning: number; ending: number; depositsHeld: number; reserve: number; unpaidBills: number }): StatementFigures {
  const income = section(f.income);
  const expenses = section(f.expenses);
  const other = section(f.other);
  const noi = toCents(income.total) - toCents(expenses.total);
  const depositsNet = f.depositsReceived - f.depositsReturned;
  const ownerNet = f.contributions - f.distributions;
  const netChange = noi + depositsNet + ownerNet + toCents(other.total);
  const difference = balances.ending - (balances.beginning + netChange);
  return {
    beginningCash: fromCents(balances.beginning),
    income,
    expenses,
    netOperatingCashFlow: fromCents(noi),
    deposits: { received: fromCents(f.depositsReceived), returned: fromCents(f.depositsReturned), net: fromCents(depositsNet) },
    ownerActivity: { contributions: fromCents(f.contributions), distributions: fromCents(f.distributions), net: fromCents(ownerNet) },
    other,
    netChange: fromCents(netChange),
    endingCash: fromCents(balances.ending),
    difference: fromCents(difference),
    reconciled: difference === 0,
    depositsHeld: fromCents(balances.depositsHeld),
    reserve: fromCents(balances.reserve),
    unpaidBills: fromCents(balances.unpaidBills),
    availableForDistribution: fromCents(balances.ending - balances.depositsHeld - balances.reserve - balances.unpaidBills),
  };
}

function mergeFlows(list: Flow[]): Flow {
  const out = newFlow();
  for (const f of list) {
    for (const k of ['income', 'expenses', 'other'] as const) {
      for (const [key, v] of f[k].lines) add(out[k], key, v.cents, v.account, v.label);
    }
    out.depositsReceived += f.depositsReceived;
    out.depositsReturned += f.depositsReturned;
    out.contributions += f.contributions;
    out.distributions += f.distributions;
  }
  return out;
}

const addressOf = (r: Record<string, unknown>) => {
  const street = str(r.street) ?? '';
  const city = [str(r.city), [str(r.state), str(r.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, city].filter(Boolean).join(', ');
};

/**
 * The statement for one or more properties over a period (inclusive day strings).
 * Properties are returned in name order; ids that don't exist are ignored.
 */
export async function ownerStatement(scope: Scope): Promise<OwnerStatement> {
  assertScope(scope);
  const { periodStart, periodEnd } = scope;
  const propertyIds = [...new Set(scope.propertyIds.filter(Boolean))];
  const empty: OwnerStatement = {
    periodStart,
    periodEnd,
    properties: [],
    combined: figuresFrom(newFlow(), { beginning: 0, ending: 0, depositsHeld: 0, reserve: 0, unpaidBills: 0 }),
    warnings: [],
  };
  if (!propertyIds.length) return empty;

  const chart = await getChart();
  const banks = bankIds(chart);
  const depositAccounts = chart.all.filter(a => a.subtype === 'Deposits held').map(a => a.id);

  const [props, cash, held, unpaid, flows] = await Promise.all([
    zite.sql({
      query: `SELECT id, "name", "ownerId", "street", "city", "state", "postalCode", "reserveAmount" FROM "Properties" WHERE id::text = ANY($1) ORDER BY "name" ASC`,
      params: [propertyIds],
    }),
    zite.sql({
      query: `
        SELECT jl."propertyId" AS pid,
          SUM(CASE WHEN jl."date" < $2 THEN COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0) ELSE 0 END) AS beginning,
          SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS ending
        FROM "JournalLines" jl JOIN "Transactions" t ON t.id::text = jl."transactionId"
        WHERE COALESCE(jl."void", false) = false AND t."status" = 'Posted' AND jl."accountId" = ANY($4) AND jl."propertyId" = ANY($1) AND jl."date" <= $3
        GROUP BY jl."propertyId"`,
      params: [propertyIds, periodStart, periodEnd, banks],
    }),
    depositAccounts.length
      ? zite.sql({
          query: `
            SELECT jl."propertyId" AS pid, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS held
            FROM "JournalLines" jl JOIN "Transactions" t ON t.id::text = jl."transactionId"
            WHERE COALESCE(jl."void", false) = false AND t."status" = 'Posted' AND jl."accountId" = ANY($3) AND jl."propertyId" = ANY($1) AND jl."date" <= $2
            GROUP BY jl."propertyId"`,
          params: [propertyIds, periodEnd, depositAccounts],
        })
      : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    // Payables by property, from the AP lines: a split bill owes each building its own share.
    zite.sql({
      query: `
        SELECT jl."propertyId" AS pid, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS unpaid
        FROM "JournalLines" jl JOIN "Transactions" t ON t.id::text = jl."transactionId"
        WHERE jl."accountId" = $3 AND COALESCE(jl."void", false) = false AND t."status" = 'Posted'
          AND jl."propertyId" = ANY($1) AND jl."date" <= $2
        GROUP BY jl."propertyId"`,
      params: [propertyIds, periodEnd, chart.key('accounts_payable').id],
    }),
    readFlows({ propertyIds, periodStart, periodEnd }, chart, false),
  ]);

  const cashBy = new Map(cash.rows.map(r => [String(r.pid), { beginning: cents(r.beginning), ending: cents(r.ending) }]));
  const heldBy = new Map(held.rows.map(r => [String(r.pid), cents(r.held)]));
  const unpaidBy = new Map(unpaid.rows.map(r => [String(r.pid), Math.max(0, cents(r.unpaid))]));

  const warnings: string[] = [];
  const properties: PropertyStatement[] = props.rows.map(p => {
    const id = String(p.id);
    const f = flows.get(`${id}|all`) ?? newFlow();
    const c = cashBy.get(id) ?? { beginning: 0, ending: 0 };
    const figures = figuresFrom(f, { beginning: c.beginning, ending: c.ending, depositsHeld: heldBy.get(id) ?? 0, reserve: cents(p.reserveAmount), unpaidBills: unpaidBy.get(id) ?? 0 });
    const name = str(p.name) ?? 'Property';
    if (!figures.reconciled) {
      warnings.push(`${name}: the transactions on this statement add up to ${formatMoney(fromCents(c.beginning + toCents(figures.netChange)))}, but the bank lines say ${formatMoney(figures.endingCash)} (a difference of ${formatMoney(figures.difference)}). The ledger needs a review.`);
    }
    return { ...figures, propertyId: id, propertyName: name, ownerId: ref(p.ownerId), address: addressOf(p) };
  });

  const sum = (pick: (s: PropertyStatement) => number) => properties.reduce((a, s) => a + toCents(pick(s)), 0);
  const combined = figuresFrom(
    mergeFlows(properties.map(s => flows.get(`${s.propertyId}|all`) ?? newFlow())),
    { beginning: sum(s => s.beginningCash), ending: sum(s => s.endingCash), depositsHeld: sum(s => s.depositsHeld), reserve: sum(s => s.reserve), unpaidBills: sum(s => s.unpaidBills) },
  );

  combined.availableForDistribution = fromCents(properties.reduce((a, p) => a + Math.max(0, toCents(p.availableForDistribution)), 0));

  return { periodStart, periodEnd, properties, combined, warnings };
}

const TYPE_LABEL: Record<string, string> = {
  Payment: 'Payment received',
  'Bill payment': 'Bill payment',
  Expense: 'Expense',
  'Management fee': 'Management fee',
  'Owner contribution': 'Owner contribution',
  'Owner distribution': 'Owner distribution',
  Transfer: 'Transfer',
  'Journal entry': 'Adjustment',
};

/**
 * The cash register behind a statement: every transaction that moved a
 * property's bank balance in the period, oldest first, one row per property
 * (a bill payment covering two buildings appears under each with its share).
 * Transfers that net to zero within a property are left out.
 */
export async function statementTransactions(scope: Scope & { limit?: number; organizationName?: string }): Promise<{ rows: StatementTransaction[]; truncated: boolean }> {
  assertScope(scope);
  const propertyIds = [...new Set(scope.propertyIds.filter(Boolean))];
  if (!propertyIds.length) return { rows: [], truncated: false };
  const limit = Math.max(1, Math.min(1999, scope.limit ?? 1000));
  const chart = await getChart();
  const banks = bankIds(chart);
  const { rows } = await zite.sql({
    query: `
      SELECT t.id, t."number", t."kind", t."date", t."description", t."reference", t."paymentMethod", t."accountId", jl."propertyId" AS pid,
        p."name" AS "propertyName", u."name" AS "unitName", tn."name" AS "tenantName", v."name" AS "vendorName", o."name" AS "ownerName",
        SUM(COALESCE(jl."debit", 0)) AS "cashIn", SUM(COALESCE(jl."credit", 0)) AS "cashOut"
      FROM "JournalLines" jl
      JOIN "Transactions" t ON t.id::text = jl."transactionId"
      LEFT JOIN "Properties" p ON p.id::text = jl."propertyId"
      LEFT JOIN "Units" u ON u.id::text = t."unitId"
      LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
      LEFT JOIN "Vendors" v ON v.id::text = t."vendorId"
      LEFT JOIN "Owners" o ON o.id::text = t."ownerId"
      WHERE COALESCE(jl."void", false) = false AND t."status" = 'Posted' AND jl."accountId" = ANY($4)
        AND jl."propertyId" = ANY($1) AND jl."date" >= $2 AND jl."date" <= $3
      GROUP BY t.id, t."number", t."kind", t."date", t."description", t."reference", t."paymentMethod", t."accountId", jl."propertyId", p."name", u."name", tn."name", v."name", o."name"
      HAVING SUM(COALESCE(jl."debit", 0)) <> SUM(COALESCE(jl."credit", 0))
      ORDER BY t."date" ASC, t."number" ASC
      LIMIT ${limit + 1}`,
    params: [propertyIds, scope.periodStart, scope.periodEnd, banks],
  });
  const out = rows.slice(0, limit).map(r => {
    const kind = String(r.kind);
    const accountId = ref(r.accountId);
    const net = cents(r.cashIn) - cents(r.cashOut);
    const depositRefund = kind === 'Refund' && chart.byId.get(accountId ?? '')?.subtype === 'Deposits held';
    const party =
      kind === 'Payment' || kind === 'Refund'
        ? str(r.tenantName) ?? ''
        : kind === 'Bill payment' || kind === 'Expense'
          ? str(r.vendorName) ?? ''
          : kind === 'Owner contribution' || kind === 'Owner distribution'
            ? str(r.ownerName) ?? ''
            : kind === 'Management fee'
              ? scope.organizationName ?? ''
              : '';
    return {
      id: String(r.id),
      number: num(r.number),
      date: String(r.date ?? '').slice(0, 10),
      kind,
      typeLabel: kind === 'Refund' ? (depositRefund ? 'Deposit refund' : 'Credit refund') : TYPE_LABEL[kind] ?? kind,
      propertyId: String(r.pid ?? ''),
      propertyName: str(r.propertyName) ?? '',
      unitName: str(r.unitName) ?? '',
      party,
      memo: str(r.description) ?? '',
      reference: str(r.reference) ?? '',
      paymentMethod: str(r.paymentMethod) ?? '',
      amountIn: net > 0 ? fromCents(net) : 0,
      amountOut: net < 0 ? fromCents(-net) : 0,
    };
  });
  return { rows: out, truncated: rows.length > limit };
}

/**
 * Income, expenses and net operating cash flow per calendar month, combined
 * across the properties — the same definitions as `ownerStatement`, so a
 * month's bar matches that month's statement.
 */
export async function monthlyCashFlow(input: { propertyIds: string[]; fromPeriod: string; toPeriod: string; throughDay?: string }): Promise<MonthlyCashFlow[]> {
  const periods: string[] = [];
  for (let p = input.fromPeriod; p <= input.toPeriod && periods.length < 60; ) {
    periods.push(p);
    const [y, m] = p.split('-').map(Number);
    p = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const propertyIds = [...new Set(input.propertyIds.filter(Boolean))];
  if (!periods.length) return [];
  const blank = periods.map(period => ({ period, label: periodLabel(period, true), income: 0, expenses: 0, net: 0, distributions: 0, contributions: 0 }));
  if (!propertyIds.length) return blank;
  const chart = await getChart();
  const last = periods[periods.length - 1];
  const [ly, lm] = last.split('-').map(Number);
  const monthEnd = addDays(lm === 12 ? `${ly + 1}-01-01` : `${ly}-${String(lm + 1).padStart(2, '0')}-01`, -1);
  const end = input.throughDay && input.throughDay < monthEnd ? input.throughDay : monthEnd;
  const flows = await readFlows({ propertyIds, periodStart: `${periods[0]}-01`, periodEnd: end }, chart, true);
  return blank.map(row => {
    const merged = mergeFlows(propertyIds.map(id => flows.get(`${id}|${row.period}`)).filter((f): f is Flow => Boolean(f)));
    const income = section(merged.income).total;
    const expenses = section(merged.expenses).total;
    return { ...row, income, expenses, net: fromCents(toCents(income) - toCents(expenses)), distributions: fromCents(merged.distributions), contributions: fromCents(merged.contributions) };
  });
}

/**
 * Income and expense lines per calendar month, combined across the properties —
 * ownerStatement's definitions in one read (~6 queries) instead of one statement per month.
 */
export async function monthlyStatementLines(input: { propertyIds: string[]; periodStart: string; periodEnd: string }): Promise<Array<{ period: string; income: StatementSection; expenses: StatementSection }>> {
  assertScope(input as Scope);
  const propertyIds = [...new Set(input.propertyIds.filter(Boolean))];
  if (!propertyIds.length) return [];
  const chart = await getChart();
  const flows = await readFlows({ propertyIds, periodStart: input.periodStart, periodEnd: input.periodEnd } as Scope, chart, true);
  const periods = [...new Set([...flows.keys()].map(k => k.split('|')[1]))].sort();
  return periods.map(period => {
    const merged = mergeFlows(propertyIds.map(id => flows.get(`${id}|${period}`)).filter((f): f is Flow => Boolean(f)));
    return { period, income: section(merged.income), expenses: section(merged.expenses) };
  });
}

/**
 * Turn a statement choice into dates. `YYYY-MM` is that calendar month (ending
 * today if it's the current month); `ytd` runs from January 1 to today.
 */
export function statementPeriod(choice: string, today: string): { periodStart: string; periodEnd: string; label: string; isPartial: boolean } {
  if (choice === 'ytd') {
    return { periodStart: `${today.slice(0, 4)}-01-01`, periodEnd: today, label: `Year to date ${today.slice(0, 4)}`, isPartial: true };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(choice)) throw new Error('statementPeriod: choose YYYY-MM or ytd');
  const [y, m] = choice.split('-').map(Number);
  const start = `${choice}-01`;
  const end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  const partial = end > today && start <= today;
  return { periodStart: start, periodEnd: partial ? today : end, label: periodLabel(choice), isPartial: partial };
}
