import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { maxDay, minDay, periodEnd, periodLabel, periodsBetween, periodStart } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import type { AccountRow } from '@project/shared/server/accounts';
import { monthlyStatementLines, ownerStatement, type StatementLine } from '@project/shared/server/ownerStatement';
import { num, Params } from '@project/shared/server/sql';
import { pct, type ReportColumn, type ReportRow } from '../../components/reports/doc';
import { accountLabel, collator, compact, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, periodOf, POSTED_LINES, type ReportScope } from './common';

/**
 * Income statement (P&L) for a period, by month, by property or as one total.
 *
 *   Accrual: journal lines on income and expense accounts dated in the period —
 *            income when charged, expenses when billed.
 *   Cash:    the owner-statement definitions (`ownerStatement`): payments
 *            received by what they paid, bills paid, direct expenses and fees.
 *            Security deposits and owner money are not income or expenses.
 */

type Bucket = { key: string; label: string; link?: string };
type Line = { key: string; label: string; account?: AccountRow; section: 'income' | 'expense'; by: Map<string, number> };

const SPECIAL_ORDER = ['prepayments', 'credit_refunds', 'bills_unclassified', 'expenses_unclassified'];

export async function buildIncomeStatement(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const basis = scope.input.basis === 'accrual' ? 'accrual' : 'cash';
  const groupBy = scope.input.groupBy === 'property' || scope.input.groupBy === 'none' ? scope.input.groupBy : 'month';
  const chart = scope.chart;

  let buckets: Bucket[] = [];
  if (groupBy === 'month') {
    const periods = periodsBetween(from.slice(0, 7), to.slice(0, 7));
    if (periods.length > 24) throw new ZiteError('Choose 24 months or fewer to show a column per month, or switch to Total.', 'BAD_REQUEST');
    buckets = periods.map(p => ({ key: p, label: periodLabel(p, true) }));
  } else if (groupBy === 'property') {
    buckets = scope.scopedProperties.map(p => ({ key: p.id, label: p.name, link: links.property(p.id) }));
  }

  const lines = new Map<string, Line>();
  const add = (key: string, label: string, section: 'income' | 'expense', bucket: string, amountCents: number, account?: AccountRow) => {
    if (!amountCents) return;
    let l = lines.get(key);
    if (!l) {
      l = { key, label, account, section, by: new Map() };
      lines.set(key, l);
    }
    l.by.set(bucket, (l.by.get(bucket) ?? 0) + amountCents);
  };

  if (basis === 'accrual') {
    const ids = chart.all.filter(a => a.accountType === 'Income' || a.accountType === 'Expense').map(a => a.id);
    const p = new Params();
    const bucketSql = groupBy === 'month' ? `LEFT(CAST(jl."date" AS TEXT), 7)` : groupBy === 'property' ? `jl."propertyId"` : `'all'`;
    const { rows } = await zite.sql({
      query: `
        SELECT jl."accountId", ${bucketSql} AS bucket, SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS net
        FROM ${POSTED_LINES}
        WHERE ${LINE_IS_POSTED} AND jl."accountId" = ANY(${p.add(ids)}) AND jl."date" >= ${p.add(from)}::date AND jl."date" <= ${p.add(to)}::date
          ${inProperties(p, 'jl."propertyId"', scope)}
        GROUP BY 1, 2`,
      params: p.values,
    });
    for (const r of rows) {
      const account = chart.byId.get(String(r.accountId));
      if (!account) continue;
      const net = toCents(num(r.net));
      const bucket = String(r.bucket ?? '');
      if (account.accountType === 'Income') add(`acct:${account.id}`, account.name, 'income', bucket, net, account);
      else add(`acct:${account.id}`, account.name, 'expense', bucket, -net, account);
    }
    if (groupBy === 'property' && [...lines.values()].some(l => [...l.by.keys()].some(k => !scope.propertyById.has(k)))) {
      buckets.push({ key: '', label: 'No property' });
    }
  } else {
    const propertyIds = scope.scopedProperties.map(p => p.id);
    const take = (bucket: string, statementLines: { income: StatementLine[]; expense: StatementLine[] }) => {
      for (const l of statementLines.income) add(l.key, l.label, 'income', bucket, toCents(l.amount), l.accountId ? chart.byId.get(l.accountId) : undefined);
      for (const l of statementLines.expense) add(l.key, l.label, 'expense', bucket, toCents(l.amount), l.accountId ? chart.byId.get(l.accountId) : undefined);
    };
    if (propertyIds.length) {
      if (groupBy === 'month') {
        // Every month in one read, with the owner statement's definitions.
        for (const m of await monthlyStatementLines({ propertyIds, periodStart: from, periodEnd: to })) take(m.period, { income: m.income.lines, expense: m.expenses.lines });
      } else {
        const st = await ownerStatement({ propertyIds, periodStart: from, periodEnd: to });
        if (groupBy === 'property') for (const ps of st.properties) take(ps.propertyId, { income: ps.income.lines, expense: ps.expenses.lines });
        else take('all', { income: st.combined.income.lines, expense: st.combined.expenses.lines });
      }
    }
  }

  const bucketKeys = groupBy === 'none' ? ['all'] : buckets.map(b => b.key);
  const order = (a: Line, b: Line) => {
    if (a.account && b.account) return collator.compare(a.account.number, b.account.number) || collator.compare(a.label, b.label);
    if (a.account) return -1;
    if (b.account) return 1;
    return SPECIAL_ORDER.indexOf(a.key) - SPECIAL_ORDER.indexOf(b.key);
  };
  const income = [...lines.values()].filter(l => l.section === 'income').sort(order);
  const expenses = [...lines.values()].filter(l => l.section === 'expense').sort(order);
  const totalOf = (ls: Line[], bucket?: string) => ls.reduce((a, l) => a + (bucket === undefined ? [...l.by.values()].reduce((x, y) => x + y, 0) : l.by.get(bucket) ?? 0), 0);
  const totalIncome = totalOf(income);
  const totalExpenses = totalOf(expenses);
  const noi = totalIncome - totalExpenses;

  const cellsFor = (get: (bucket?: string) => number) => {
    const cells: Record<string, number | string | null> = {};
    if (groupBy !== 'none') for (const k of bucketKeys) cells[`b:${k}`] = fromCents(get(k));
    const total = get();
    cells.total = fromCents(total);
    if (groupBy === 'none') cells.share = pct(total, totalIncome);
    return cells;
  };

  const lineRow = (l: Line): ReportRow => ({
    id: l.key,
    depth: 1,
    cells: { account: l.account ? accountLabel(l.account) : l.label, ...cellsFor(b => (b === undefined ? [...l.by.values()].reduce((x, y) => x + y, 0) : l.by.get(b) ?? 0)) },
    links: basis === 'accrual' && l.account ? { account: links.generalLedger(scope, l.account.id, from, to) } : undefined,
  });

  const rows: ReportRow[] = [
    { id: 'g:income', kind: 'group', cells: { account: 'Income' } },
    ...income.map(lineRow),
    { id: 's:income', kind: 'subtotal', cells: { account: 'Total income', ...cellsFor(b => totalOf(income, b)) } },
    { id: 'g:expenses', kind: 'group', cells: { account: 'Expenses' } },
    ...expenses.map(lineRow),
    { id: 's:expenses', kind: 'subtotal', cells: { account: 'Total expenses', ...cellsFor(b => totalOf(expenses, b)) } },
  ];

  const columns: ReportColumn[] = [
    { key: 'account', label: 'Account', kind: 'text', width: 260 },
    ...(groupBy === 'none' ? [] : buckets.map(b => ({ key: `b:${b.key}`, label: b.label, kind: 'money' as const, width: 118 }))),
    { key: 'total', label: 'Total', kind: 'money', width: 128 },
    ...(groupBy === 'none' ? [{ key: 'share', label: '% of income', kind: 'percent' as const, width: 100 }] : []),
  ];

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel, basis === 'cash' ? 'Cash basis' : 'Accrual basis'),
    figures: [
      { label: 'Total income', value: fromCents(totalIncome), kind: 'money' },
      { label: 'Total expenses', value: fromCents(totalExpenses), kind: 'money' },
      { label: 'Net operating income', value: fromCents(noi), kind: 'money', tone: noi < 0 ? 'danger' : undefined },
      { label: 'Operating margin', value: pct(noi, totalIncome), kind: 'percent', hint: 'NOI as a share of income' },
    ],
    sections: [
      {
        id: 'statement',
        columns,
        rows,
        totals: { id: 'noi', kind: 'total', cells: { account: 'Net operating income', ...cellsFor(b => totalOf(income, b) - totalOf(expenses, b)) }, tones: compact({ total: noi < 0 ? ('danger' as const) : undefined }) },
        empty: 'No income or expenses in this period.',
      },
    ],
    notes: [
      basis === 'cash'
        ? 'Cash basis: income is money received in the period, by the charge it paid (payments not yet matched to a charge are shown as prepaid); expenses are bills paid, direct expenses and management fees. These are the same figures as owner statements. Security deposits and owner contributions and distributions are not income or expenses.'
        : 'Accrual basis: income when it was charged and expenses when they were billed, from journal lines on income and expense accounts.',
    ],
  });
}
