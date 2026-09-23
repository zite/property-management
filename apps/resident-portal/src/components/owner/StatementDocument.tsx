import { cn } from '@project/components/lib/utils';
import type { Statement, StatementFigures } from './data';
import { ledgerMoney } from './kit';

/**
 * A cash-basis owner statement set as a financial document: sections,
 * right-aligned figures in accounting style, totals ruled off, beginning and
 * ending cash, and what's available to distribute. With several properties
 * it's consolidated — a column per property and a total — and scrolls
 * sideways inside its card on a phone.
 */

type RowKind = 'grand' | 'section' | 'line' | 'total' | 'avail' | 'note' | 'spacer';
type Row = { key: string; kind: RowKind; label: string; values: number[]; total: number; hint?: string };

function build(st: Statement): Row[] {
  const props = st.properties;
  const c = st.combined;
  const per = (pick: (f: StatementFigures) => number) => props.map(p => pick(p));
  const rows: Row[] = [];
  const push = (key: string, kind: RowKind, label: string, pick: (f: StatementFigures) => number, hint?: string) => rows.push({ key, kind, label, values: per(pick), total: pick(c), hint });
  const section = (key: string, label: string) => rows.push({ key, kind: 'section', label, values: [], total: 0 });

  push('beginning', 'grand', 'Beginning cash', f => f.beginningCash);

  section('income', 'Income');
  if (!c.income.lines.length) rows.push({ key: 'income-none', kind: 'note', label: 'No income received', values: props.map(() => 0), total: 0 });
  for (const l of c.income.lines) {
    push(`in-${l.key}`, 'line', l.label, f => f.income.lines.find(x => x.key === l.key)?.amount ?? 0, l.key === 'prepayments' ? 'Rent paid ahead, or not yet matched to a charge' : undefined);
  }
  push('income-total', 'total', 'Total income', f => f.income.total);

  section('expenses', 'Expenses');
  if (!c.expenses.lines.length) rows.push({ key: 'expenses-none', kind: 'note', label: 'No expenses paid', values: props.map(() => 0), total: 0 });
  for (const l of c.expenses.lines) push(`ex-${l.key}`, 'line', l.label, f => -(f.expenses.lines.find(x => x.key === l.key)?.amount ?? 0));
  push('expenses-total', 'total', 'Total expenses', f => -f.expenses.total);
  push('noi', 'total', 'Net operating cash flow', f => f.netOperatingCashFlow);

  if (c.deposits.received || c.deposits.returned || props.some(p => p.deposits.received || p.deposits.returned)) {
    section('deposits', 'Security deposits');
    push('dep-in', 'line', 'Deposits received', f => f.deposits.received, 'Held for residents, not income');
    push('dep-out', 'line', 'Deposits returned', f => -f.deposits.returned);
  }

  section('owner', 'Owner activity');
  if (c.ownerActivity.contributions) push('contrib', 'line', 'Contributions', f => f.ownerActivity.contributions);
  push('dist', 'line', 'Distributions to you', f => -f.ownerActivity.distributions);

  if (c.other.lines.length) {
    section('other', 'Other bank activity');
    for (const l of c.other.lines) push(`ot-${l.key}`, 'line', l.label, f => f.other.lines.find(x => x.key === l.key)?.amount ?? 0);
  }
  if (!c.reconciled || props.some(p => !p.reconciled)) push('diff', 'total', 'Unreconciled difference', f => f.difference);

  rows.push({ key: 'gap', kind: 'spacer', label: '', values: [], total: 0 });
  push('ending', 'grand', 'Ending cash', f => f.endingCash);
  push('held', 'line', 'Less security deposits held', f => -f.depositsHeld);
  push('reserve', 'line', 'Less property reserve', f => -f.reserve);
  push('bills', 'line', 'Less unpaid bills', f => -f.unpaidBills);
  push('available', 'avail', 'Available for distribution', f => Math.max(0, f.availableForDistribution));
  return rows;
}

export function StatementTable({ statement, currency }: { statement: Statement; currency: string }) {
  const rows = build(statement);
  const multi = statement.properties.length > 1;
  const cols = multi ? statement.properties.length + 1 : 1;
  const figure = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';

  return (
    <div className="overflow-x-auto">
      {multi && <p className="px-4 pb-1 pt-2 text-sm text-muted-foreground sm:hidden">All properties combined. Choose a property above to see its own statement.</p>}
      <table className={cn('w-full text-[15px]', multi && (cols > 3 ? 'sm:min-w-[760px]' : 'sm:min-w-[600px]'))}>
        {multi && (
          <thead className="hidden sm:table-header-group">
            <tr className="border-b text-sm text-muted-foreground">
              <th scope="col" className="py-2 pl-4 pr-3 text-left font-medium sm:pl-6">
                <span className="sr-only">Line</span>
              </th>
              {statement.properties.map(p => (
                <th key={p.propertyId} scope="col" className="hidden max-w-[160px] px-3 py-2 text-right align-bottom font-medium sm:table-cell">
                  <span className="line-clamp-2 break-words">{p.propertyName}</span>
                </th>
              ))}
              <th scope="col" className="py-2 pl-3 pr-4 text-right align-bottom font-semibold text-foreground sm:pr-6">
                Total
              </th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => {
            if (r.kind === 'spacer') {
              return (
                <tr key={r.key} aria-hidden>
                  <td colSpan={cols + 1} className="h-4" />
                </tr>
              );
            }
            if (r.kind === 'section') {
              return (
                <tr key={r.key}>
                  <th colSpan={cols + 1} scope="colgroup" className={cn('pb-1 pl-4 pr-4 text-left text-sm font-semibold uppercase tracking-wide text-muted-foreground sm:pl-6', i > 0 ? 'pt-5' : 'pt-3')}>
                    {r.label}
                  </th>
                </tr>
              );
            }
            const values = multi ? [...r.values, r.total] : [r.total];
            return (
              <tr
                key={r.key}
                className={cn(
                  r.kind === 'grand' && 'border-y border-foreground/70 font-semibold',
                  r.kind === 'total' && 'border-t font-semibold',
                  r.kind === 'avail' && 'bg-primary/[0.06] font-semibold',
                  r.kind === 'note' && 'text-muted-foreground',
                )}
              >
                <th scope="row" className={cn('py-2 pr-3 text-left', r.kind === 'line' || r.kind === 'note' ? 'pl-7 font-normal sm:pl-9' : 'pl-4 font-semibold sm:pl-6')}>
                  <span className="break-words">{r.label}</span>
                  {r.hint && <span className="block text-xs font-normal text-muted-foreground">{r.hint}</span>}
                </th>
                {values.map((v, j) => (
                  <td key={j} className={cn(figure, j === values.length - 1 && 'pr-4 sm:pr-6', multi && j < values.length - 1 && 'hidden sm:table-cell', multi && j === values.length - 1 && r.kind === 'line' && 'font-medium', v < 0 && r.kind !== 'grand' && 'text-foreground/85')}>
                    {r.kind === 'note' ? '—' : ledgerMoney(v, currency)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
