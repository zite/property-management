import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { isDebitNormal, type AccountRow } from '@project/shared/server/accounts';
import { num, Params } from '@project/shared/server/sql';
import { reportHref, periodUrlParams } from '../../components/reports/catalog';
import type { ReportRow } from '../../components/reports/doc';
import { accountLabel, asOfOf, collator, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, POSTED_LINES, type ReportScope } from './common';

/**
 * Balance sheet and trial balance: every account's balance through a date,
 * straight from posted journal lines. There are no closing entries, so the
 * balance sheet carries income and expense into equity itself — prior years
 * as retained earnings, this year as net income — and checks A = L + E.
 */

type Balance = { account: AccountRow; dr: number; cr: number; priorNet: number };

async function accountBalances(scope: ReportScope, asOf: string) {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const p = new Params();
  const { rows } = await zite.sql({
    query: `
      SELECT jl."accountId", (jl."date" < ${p.add(yearStart)}::date) AS prior, SUM(COALESCE(jl."debit", 0)) AS dr, SUM(COALESCE(jl."credit", 0)) AS cr
      FROM ${POSTED_LINES}
      WHERE ${LINE_IS_POSTED} AND jl."date" <= ${p.add(asOf)}::date ${inProperties(p, 'jl."propertyId"', scope)}
      GROUP BY 1, 2`,
    params: p.values,
  });
  const by = new Map<string, Balance>();
  let unknown = 0;
  for (const r of rows) {
    const account = scope.chart.byId.get(String(r.accountId));
    const dr = toCents(num(r.dr));
    const cr = toCents(num(r.cr));
    if (!account) {
      unknown += dr - cr;
      continue;
    }
    const b = by.get(account.id) ?? { account, dr: 0, cr: 0, priorNet: 0 };
    b.dr += dr;
    b.cr += cr;
    if (r.prior === true || r.prior === 'true') b.priorNet += dr - cr;
    by.set(account.id, b);
  }
  return { by, unknown, yearStart };
}

const ordered = (scope: ReportScope) => [...scope.chart.all].sort((a, b) => collator.compare(a.number, b.number) || collator.compare(a.name, b.name));

export async function buildBalanceSheet(scope: ReportScope) {
  const { asOf, label } = asOfOf(scope);
  const { by, unknown, yearStart } = await accountBalances(scope, asOf);
  const showZero = Boolean(scope.input.showZero);
  const glLink = (a: AccountRow) => links.generalLedger(scope, a.id, yearStart, asOf);

  const section = (type: 'Asset' | 'Liability' | 'Equity') => {
    const rows: ReportRow[] = [];
    let total = 0;
    for (const a of ordered(scope).filter(x => x.accountType === type)) {
      const b = by.get(a.id);
      const net = b ? b.dr - b.cr : 0;
      const amount = isDebitNormal(a.accountType) ? net : -net;
      total += amount;
      if (!amount && !showZero) continue;
      rows.push({ id: a.id, depth: 1, cells: { account: accountLabel(a), amount: fromCents(amount) }, links: { account: glLink(a) } });
    }
    return { rows, total };
  };

  const assets = section('Asset');
  const liabilities = section('Liability');
  const equity = section('Equity');
  let retained = 0;
  let current = 0;
  for (const b of by.values()) {
    if (b.account.accountType !== 'Income' && b.account.accountType !== 'Expense') continue;
    const total = b.cr - b.dr; // income positive, expense negative
    const prior = -b.priorNet;
    retained += prior;
    current += total - prior;
  }
  const year = asOf.slice(0, 4);
  const incomeLink = reportHref('income-statement', { basis: 'accrual', group: 'none', properties: scope.propertyIds ?? undefined, ...periodUrlParams(yearStart, asOf, scope.today) });
  if (retained || showZero) equity.rows.push({ id: 'retained', depth: 1, cells: { account: 'Retained earnings (before this year)', amount: fromCents(retained) } });
  equity.rows.push({ id: 'net-income', depth: 1, cells: { account: `Net income, ${year} to date`, amount: fromCents(current) }, links: { account: incomeLink } });
  if (unknown) assets.rows.push({ id: 'unknown', depth: 1, cells: { account: 'Lines on deleted accounts', amount: fromCents(unknown) }, tones: { amount: 'warning' } });
  const totalAssets = assets.total + unknown;
  const totalEquity = equity.total + retained + current;
  const totalLE = liabilities.total + totalEquity;
  const difference = totalAssets - totalLE;
  const cash = ordered(scope).filter(a => a.subtype === 'Bank').reduce((a, acc) => a + ((by.get(acc.id)?.dr ?? 0) - (by.get(acc.id)?.cr ?? 0)), 0);

  const rows: ReportRow[] = [
    { id: 'g:assets', kind: 'group', cells: { account: 'Assets' } },
    ...assets.rows,
    { id: 's:assets', kind: 'subtotal', cells: { account: 'Total assets', amount: fromCents(totalAssets) } },
    { id: 'g:liabilities', kind: 'group', cells: { account: 'Liabilities' } },
    ...liabilities.rows,
    { id: 's:liabilities', kind: 'subtotal', cells: { account: 'Total liabilities', amount: fromCents(liabilities.total) } },
    { id: 'g:equity', kind: 'group', cells: { account: 'Equity' } },
    ...equity.rows,
    { id: 's:equity', kind: 'subtotal', cells: { account: 'Total equity', amount: fromCents(totalEquity) } },
  ];

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Total assets', value: fromCents(totalAssets), kind: 'money' },
      { label: 'Total liabilities', value: fromCents(liabilities.total), kind: 'money' },
      { label: 'Total equity', value: fromCents(totalEquity), kind: 'money' },
      { label: 'Cash in bank', value: fromCents(cash), kind: 'money' },
    ],
    checks: [
      {
        label: difference === 0 ? 'Assets equal liabilities plus equity' : 'Assets don’t equal liabilities plus equity',
        ok: difference === 0,
        detail: difference === 0 ? `Both total ${scope.money(fromCents(totalAssets))} on ${formatDay(asOf)}.` : `They differ by ${scope.money(fromCents(difference))}. A journal entry may be unbalanced for the properties shown — run the trial balance to find the account.`,
      },
    ],
    sections: [
      {
        id: 'balance-sheet',
        columns: [
          { key: 'account', label: 'Account', kind: 'text' },
          { key: 'amount', label: 'Balance', kind: 'money', width: 150 },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { account: 'Total liabilities and equity', amount: fromCents(totalLE) } },
      },
    ],
    notes: [`There are no closing entries: income and expenses before ${year} appear as retained earnings, and this year’s as net income.`],
  });
}

export async function buildTrialBalance(scope: ReportScope) {
  const { asOf, label } = asOfOf(scope);
  const { by, unknown, yearStart } = await accountBalances(scope, asOf);
  const showZero = Boolean(scope.input.showZero);
  const rows: ReportRow[] = [];
  let debits = 0;
  let credits = 0;
  for (const type of ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const) {
    const accounts = ordered(scope).filter(a => a.accountType === type);
    const typeRows: ReportRow[] = [];
    for (const a of accounts) {
      const b = by.get(a.id);
      const net = b ? b.dr - b.cr : 0;
      if (!net && !showZero) continue;
      if (net > 0) debits += net;
      else credits -= net;
      typeRows.push({
        id: a.id,
        depth: 1,
        cells: { account: accountLabel(a), subtype: a.subtype || type, debit: net > 0 ? fromCents(net) : null, credit: net < 0 ? fromCents(-net) : null },
        links: { account: links.generalLedger(scope, a.id, yearStart, asOf) },
      });
    }
    if (!typeRows.length) continue;
    rows.push({ id: `g:${type}`, kind: 'group', cells: { account: type === 'Liability' ? 'Liabilities' : type === 'Equity' ? 'Equity' : type === 'Income' ? 'Income' : `${type}s` } });
    rows.push(...typeRows);
  }
  if (unknown) {
    if (unknown > 0) debits += unknown;
    else credits -= unknown;
    rows.push({ id: 'unknown', cells: { account: 'Lines on deleted accounts', debit: unknown > 0 ? fromCents(unknown) : null, credit: unknown < 0 ? fromCents(-unknown) : null }, tones: { account: 'warning' } });
  }
  const difference = debits - credits;
  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Total debits', value: fromCents(debits), kind: 'money' },
      { label: 'Total credits', value: fromCents(credits), kind: 'money' },
      { label: 'Difference', value: fromCents(difference), kind: 'money', tone: difference ? 'danger' : 'success' },
    ],
    checks: [
      {
        label: difference === 0 ? 'Debits equal credits' : 'Debits don’t equal credits',
        ok: difference === 0,
        detail: difference === 0 ? `Both total ${scope.money(fromCents(debits))}.` : `Debits exceed credits by ${scope.money(fromCents(difference))}. With a property filter this can mean a journal entry that moves money between properties; clear the filter to check the whole books.`,
      },
    ],
    sections: [
      {
        id: 'trial-balance',
        columns: [
          { key: 'account', label: 'Account', kind: 'text' },
          { key: 'subtype', label: 'Type', kind: 'text', width: 150, hideBelow: 'md' },
          { key: 'debit', label: 'Debit', kind: 'money', width: 140 },
          { key: 'credit', label: 'Credit', kind: 'money', width: 140 },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { account: 'Total', debit: fromCents(debits), credit: fromCents(credits) } },
        empty: 'Nothing has been posted on or before this date.',
      },
    ],
    notes: ['Balances are cumulative through the date and include every posted, non-void journal line. Select an account to open its general ledger.'],
  });
}
