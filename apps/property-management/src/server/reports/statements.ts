import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { bankBalances, propertyCash } from '@project/shared/server/ledger';
import { ownerStatement, statementTransactions, type StatementFigures, type StatementLine } from '@project/shared/server/ownerStatement';
import { str } from '@project/shared/server/sql';
import type { ReportColumn, ReportRow, ReportSection } from '../../components/reports/doc';
import { collator, compact, envelope, joinLabel, links, periodOf, type ReportScope } from './common';

/**
 * Cash flow and owner statements. Both render `ownerStatement` — the one
 * cash-basis definition in the app — so a cash flow report, an owner
 * statement and the owner portal can never disagree.
 */

type Col = { key: string; figures: StatementFigures };

/** Merge statement lines across columns by their stable key, keeping first-seen order sorted by account number. */
function mergedLines(cols: Col[], pick: (f: StatementFigures) => StatementLine[]) {
  const seen = new Map<string, StatementLine>();
  for (const c of cols) for (const l of pick(c.figures)) if (!seen.has(l.key)) seen.set(l.key, l);
  return [...seen.values()].sort((a, b) => {
    if (a.accountNumber && b.accountNumber) return collator.compare(a.accountNumber, b.accountNumber);
    if (a.accountNumber) return -1;
    if (b.accountNumber) return 1;
    return a.label.localeCompare(b.label);
  });
}

const lineAmount = (f: StatementFigures, pick: (f: StatementFigures) => StatementLine[], key: string) => pick(f).find(l => l.key === key)?.amount ?? 0;

function cashFlowRows(cols: Col[]): ReportRow[] {
  const cells = (get: (f: StatementFigures) => number) => Object.fromEntries(cols.map(c => [c.key, fromCents(toCents(get(c.figures)))]));
  const income = mergedLines(cols, f => f.income.lines);
  const expenses = mergedLines(cols, f => f.expenses.lines);
  const other = mergedLines(cols, f => f.other.lines);
  const receipts = (f: StatementFigures) => fromCents(toCents(f.income.total) + toCents(f.deposits.received) + toCents(f.ownerActivity.contributions));
  const disbursements = (f: StatementFigures) => fromCents(toCents(f.expenses.total) + toCents(f.deposits.returned) + toCents(f.ownerActivity.distributions));
  const rows: ReportRow[] = [
    { id: 'beginning', kind: 'subtotal', cells: { label: 'Beginning cash', ...cells(f => f.beginningCash) } },
    { id: 'g:receipts', kind: 'group', cells: { label: 'Receipts' } },
    ...income.map(l => ({ id: `in:${l.key}`, depth: 1, cells: { label: l.label, ...cells(f => lineAmount(f, x => x.income.lines, l.key)) } })),
    { id: 'dep-in', depth: 1, cells: { label: 'Security deposits received', ...cells(f => f.deposits.received) } },
    { id: 'contrib', depth: 1, cells: { label: 'Owner contributions', ...cells(f => f.ownerActivity.contributions) } },
    { id: 's:receipts', kind: 'subtotal', cells: { label: 'Total receipts', ...cells(receipts) } },
    { id: 'g:disbursements', kind: 'group', cells: { label: 'Disbursements' } },
    ...expenses.map(l => ({ id: `out:${l.key}`, depth: 1, cells: { label: l.label, ...cells(f => lineAmount(f, x => x.expenses.lines, l.key)) } })),
    { id: 'dep-out', depth: 1, cells: { label: 'Security deposits returned', ...cells(f => f.deposits.returned) } },
    { id: 'distrib', depth: 1, cells: { label: 'Owner distributions', ...cells(f => f.ownerActivity.distributions) } },
    { id: 's:disbursements', kind: 'subtotal', cells: { label: 'Total disbursements', ...cells(disbursements) } },
  ];
  if (other.length) {
    rows.push({ id: 'g:other', kind: 'group', cells: { label: 'Other bank activity' } });
    rows.push(...other.map(l => ({ id: `other:${l.key}`, depth: 1, cells: { label: l.label, ...cells(f => lineAmount(f, x => x.other.lines, l.key)) } })));
  }
  rows.push({ id: 'net', kind: 'subtotal', cells: { label: 'Net change in cash', ...cells(f => f.netChange) } });
  return rows;
}

export async function buildCashFlow(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const byProperty = scope.input.groupBy !== 'none';
  const propertyIds = scope.scopedProperties.map(p => p.id);
  const [st, cashByProperty, banks] = await Promise.all([
    ownerStatement({ propertyIds, periodStart: from, periodEnd: to }),
    propertyCash(to),
    scope.propertyIds ? Promise.resolve(null) : bankBalances({ asOf: to }),
  ]);

  const cols: Col[] = [...(byProperty && st.properties.length > 1 ? st.properties.map(p => ({ key: p.propertyId, figures: p as StatementFigures })) : []), { key: 'total', figures: st.combined }];
  const columns: ReportColumn[] = [
    { key: 'label', label: '', kind: 'text', width: 250 },
    ...cols.map(c => ({ key: c.key, label: c.key === 'total' ? 'Total' : scope.propertyById.get(c.key)?.name ?? 'Property', kind: 'money' as const, width: 126 })),
  ];
  const endingCells = Object.fromEntries(cols.map(c => [c.key, c.figures.endingCash]));

  const scopedLedgerCash = propertyIds.reduce((a, pid) => a + toCents(cashByProperty.get(pid) ?? 0), 0);
  const unassigned = toCents(cashByProperty.get('') ?? 0);
  const bankTotal = banks ? [...banks.values()].reduce((a, v) => a + toCents(v), 0) : null;
  const ending = toCents(st.combined.endingCash);
  const tiesToProperties = ending === scopedLedgerCash;
  const tiesToBanks = bankTotal == null || bankTotal === ending + unassigned;
  const unreconciled = st.properties.filter(p => !p.reconciled);

  const sections: ReportSection[] = [
    {
      id: 'cash-flow',
      columns,
      rows: cashFlowRows(cols),
      totals: { id: 'ending', kind: 'total', cells: { label: 'Ending cash', ...endingCells } },
      empty: 'No properties to report on.',
    },
  ];
  if (banks) {
    const rows: ReportRow[] = scope.chart.all
      .filter(a => a.subtype === 'Bank')
      .map(a => ({ id: a.id, cells: { account: a.name + (a.accountLast4 ? ` ••${a.accountLast4}` : ''), balance: banks.get(a.id) ?? 0 }, links: { account: links.generalLedger(scope, a.id, from, to) } }));
    if (unassigned) rows.push({ id: 'unassigned', cells: { account: 'Less cash not assigned to a property', balance: -fromCents(unassigned) }, tones: { balance: 'warning' } });
    sections.push({
      id: 'banks',
      title: 'Bank accounts',
      description: `Balances on ${formatDay(to)}, read from the bank accounts themselves.`,
      columns: [
        { key: 'account', label: 'Account', kind: 'text' },
        { key: 'balance', label: 'Balance', kind: 'money', width: 150 },
      ],
      rows,
      totals: { id: 'bank-total', kind: 'total', cells: { account: 'Total', balance: fromCents((bankTotal ?? 0) - unassigned) } },
    });
  }

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Beginning cash', value: st.combined.beginningCash, kind: 'money', hint: formatDay(from) },
      { label: 'Receipts', value: fromCents(toCents(st.combined.income.total) + toCents(st.combined.deposits.received) + toCents(st.combined.ownerActivity.contributions)), kind: 'money' },
      { label: 'Disbursements', value: fromCents(toCents(st.combined.expenses.total) + toCents(st.combined.deposits.returned) + toCents(st.combined.ownerActivity.distributions)), kind: 'money' },
      { label: 'Ending cash', value: st.combined.endingCash, kind: 'money', hint: formatDay(to) },
    ],
    checks: [
      {
        label: tiesToProperties && tiesToBanks ? 'Ending cash ties to the bank' : 'Ending cash doesn’t tie to the bank',
        ok: tiesToProperties && tiesToBanks,
        detail: tiesToProperties && tiesToBanks
          ? `${scope.money(fromCents(ending))} matches the cash recorded in the bank accounts${banks ? '' : ' for these properties'} on ${formatDay(to)}.`
          : `The statement shows ${scope.money(fromCents(ending))} but the bank accounts hold ${scope.money(fromCents(bankTotal != null ? bankTotal - unassigned : scopedLedgerCash))}. Review the general ledger for the bank accounts.`,
      },
      {
        label: unreconciled.length ? 'Some properties don’t reconcile' : 'Every property reconciles',
        ok: !unreconciled.length,
        detail: unreconciled.length ? unreconciled.map(p => `${p.propertyName} is off by ${scope.money(p.difference)}`).join('; ') : 'Beginning cash plus the activity shown equals ending cash for each property.',
      },
    ],
    warnings: st.warnings,
    sections,
    notes: ['Receipts and disbursements use the owner statement definitions: payments by what they paid, bills when paid. Transfers and adjustments that moved a property’s cash appear under other bank activity.'],
  });
}

export async function buildOwnerStatement(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const { rows: owners } = await zite.sql({ query: `SELECT id, "name", "email", "mailingAddress" FROM "Owners" ORDER BY "name" ASC LIMIT 2000`, params: [] });
  const withProperties = owners.filter(o => scope.properties.some(p => p.ownerId === String(o.id)));
  const owner = scope.input.ownerId ? owners.find(o => String(o.id) === scope.input.ownerId) : withProperties[0] ?? owners[0];
  if (scope.input.ownerId && !owner) throw new ZiteError('That owner no longer exists. Choose another owner.', 'NOT_FOUND');
  if (!owner) {
    return envelope(scope, { subtitle: label, sections: [], notes: ['Add an owner and assign properties to them to produce a statement.'], resolved: { ownerId: null } });
  }
  const ownerId = String(owner.id);
  const ownerName = str(owner.name) ?? 'Owner';
  const propertyIds = scope.properties.filter(p => p.ownerId === ownerId).map(p => p.id);
  const [st, register] = await Promise.all([
    ownerStatement({ propertyIds, periodStart: from, periodEnd: to }),
    statementTransactions({ propertyIds, periodStart: from, periodEnd: to, limit: 1000, organizationName: scope.settings.organizationName }),
  ]);

  const statementRows = (f: StatementFigures, prefix: string): ReportRow[] => {
    const row = (id: string, labelText: string, amount: number, kind?: ReportRow['kind'], depth = 1): ReportRow => ({ id: `${prefix}:${id}`, kind, depth: kind ? 0 : depth, cells: { label: labelText, amount: fromCents(toCents(amount)) } });
    const rows: ReportRow[] = [
      row('begin', 'Beginning cash', f.beginningCash, 'subtotal'),
      { id: `${prefix}:g:income`, kind: 'group', cells: { label: 'Income' } },
      ...f.income.lines.map(l => row(`in:${l.key}`, l.label, l.amount)),
      row('income', 'Total income', f.income.total, 'subtotal'),
      { id: `${prefix}:g:expenses`, kind: 'group', cells: { label: 'Expenses' } },
      ...f.expenses.lines.map(l => row(`out:${l.key}`, l.label, l.amount)),
      row('expenses', 'Total expenses', f.expenses.total, 'subtotal'),
      row('noi', 'Net operating cash flow', f.netOperatingCashFlow, 'subtotal'),
      { id: `${prefix}:g:other`, kind: 'group', cells: { label: 'Deposits and owner activity' } },
    ];
    if (f.deposits.received) rows.push(row('dep-in', 'Security deposits received', f.deposits.received));
    if (f.deposits.returned) rows.push(row('dep-out', 'Security deposits returned', -f.deposits.returned));
    if (f.ownerActivity.contributions) rows.push(row('contrib', 'Owner contributions', f.ownerActivity.contributions));
    rows.push(row('distrib', 'Owner distributions', -f.ownerActivity.distributions));
    for (const l of f.other.lines) rows.push(row(`other:${l.key}`, l.label, l.amount));
    rows.push(row('ending', 'Ending cash', f.endingCash, 'total'));
    rows.push({ id: `${prefix}:g:available`, kind: 'group', cells: { label: 'Available for distribution' } });
    rows.push(row('held', 'Less security deposits held', -f.depositsHeld));
    if (f.reserve) rows.push(row('reserve', 'Less reserve', -f.reserve));
    if (f.unpaidBills) rows.push(row('unpaid', 'Less unpaid bills', -f.unpaidBills));
    rows.push({ ...row('available', 'Available for distribution', f.availableForDistribution, 'total'), tones: f.availableForDistribution < 0 ? { amount: 'danger' } : undefined });
    return rows;
  };
  const statementColumns: ReportColumn[] = [
    { key: 'label', label: '', kind: 'text' },
    { key: 'amount', label: 'Amount', kind: 'money', width: 150 },
  ];

  const sections: ReportSection[] = st.properties.map(p => ({
    id: `property:${p.propertyId}`,
    title: p.propertyName,
    description: [p.address, p.reconciled ? null : `Doesn’t reconcile by ${scope.money(p.difference)}`].filter(Boolean).join(' · '),
    columns: statementColumns,
    rows: statementRows(p, p.propertyId),
  }));
  if (st.properties.length > 1) {
    sections.push({ id: 'combined', title: 'All properties', description: `${st.properties.length} properties combined`, columns: statementColumns, rows: statementRows(st.combined, 'all') });
  }
  sections.push({
    id: 'register',
    title: 'Transactions',
    description: register.truncated ? 'The first 1,000 transactions that moved cash. Export the general ledger for the rest.' : 'Every transaction that moved the properties’ cash in the period.',
    columns: [
      { key: 'date', label: 'Date', kind: 'date', width: 108 },
      { key: 'type', label: 'Type', kind: 'text', width: 140 },
      { key: 'property', label: 'Property', kind: 'text', width: 170, hideBelow: 'lg' },
      { key: 'party', label: 'Paid by / to', kind: 'text', width: 170, hideBelow: 'md' },
      { key: 'memo', label: 'Memo', kind: 'text' },
      { key: 'in', label: 'Money in', kind: 'money', width: 116 },
      { key: 'out', label: 'Money out', kind: 'money', width: 116 },
    ],
    rows: register.rows.map(r => ({
      id: `${r.id}:${r.propertyId}`,
      cells: { date: r.date, type: r.typeLabel, property: [r.propertyName, r.unitName].filter(Boolean).join(' · '), party: r.party || null, memo: r.memo, in: r.amountIn || null, out: r.amountOut || null },
      links: compact({ property: links.property(r.propertyId) }),
    })),
    totals: {
      id: 'register-total',
      kind: 'total',
      cells: { date: null, type: `${register.rows.length} ${register.rows.length === 1 ? 'transaction' : 'transactions'}`, in: fromCents(register.rows.reduce((a, r) => a + toCents(r.amountIn), 0)), out: fromCents(register.rows.reduce((a, r) => a + toCents(r.amountOut), 0)) },
    },
    sortable: true,
    tall: register.rows.length > 40,
    empty: 'No money moved in this period.',
  });

  const c = st.combined;
  return envelope(scope, {
    title: `Owner statement · ${ownerName}`,
    subtitle: joinLabel(label, propertyIds.length === 1 ? scope.propertyById.get(propertyIds[0])?.name : `${propertyIds.length} properties`, 'Cash basis'),
    figures: [
      { label: 'Beginning cash', value: c.beginningCash, kind: 'money' },
      { label: 'Income', value: c.income.total, kind: 'money' },
      { label: 'Expenses', value: c.expenses.total, kind: 'money' },
      { label: 'Distributions', value: c.ownerActivity.distributions, kind: 'money' },
      { label: 'Ending cash', value: c.endingCash, kind: 'money' },
      { label: 'Available', value: c.availableForDistribution, kind: 'money', hint: 'After deposits, reserve and unpaid bills', tone: c.availableForDistribution < 0 ? 'danger' : undefined },
    ],
    checks: propertyIds.length
      ? [{ label: st.warnings.length ? 'The statement doesn’t reconcile' : 'The statement reconciles', ok: !st.warnings.length, detail: st.warnings.length ? 'See the warnings below.' : 'For every property, beginning cash plus the activity shown equals the bank balance at the end of the period.' }]
      : [],
    warnings: st.warnings,
    sections: propertyIds.length ? sections : [],
    notes: propertyIds.length ? [] : [`${ownerName} has no properties assigned, so there is nothing to report.`],
    resolved: { ownerId },
  });
}
