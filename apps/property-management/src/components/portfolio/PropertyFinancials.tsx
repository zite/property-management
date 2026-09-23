import { ArrowUpRight, BarChart3, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { sumMoney } from '@project/shared/money';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { EmptyState } from '../primitives/bits';
import { Card, Money, StatTile } from '../primitives/data';
import { usePropertyFinancials, type PropertyFinancials as Financials } from './data';

/**
 * Twelve months of income, expenses and NOI for one property, on an accrual
 * basis (the journal: income when charged, expenses when billed) or a cash
 * basis (the owner statement: income when collected, expenses when paid).
 */

type Basis = 'accrual' | 'cash';
type Month = { period: string; label: string; income: number; expenses: number; noi: number; distributions?: number };

// Categorical slots 1–2, validated for CVD separation and contrast on both surfaces.
const INCOME = 'fill-[#2a78d6] dark:fill-[#3987e5]';
const EXPENSE = 'fill-[#eb6834] dark:fill-[#d95926]';
const INCOME_BG = 'bg-[#2a78d6] dark:bg-[#3987e5]';
const EXPENSE_BG = 'bg-[#eb6834] dark:bg-[#d95926]';

export function PropertyFinancials({ propertyId }: { propertyId: string }) {
  const ws = useWorkspace();
  const { data, isPending, isError, error, refetch } = usePropertyFinancials(propertyId);
  const [basis, setBasis] = useState<Basis>(() => {
    try {
      return localStorage.getItem('property-management:property-financials-basis') === 'cash' ? 'cash' : 'accrual';
    } catch {
      return 'accrual';
    }
  });
  const choose = (b: Basis) => {
    setBasis(b);
    try {
      localStorage.setItem('property-management:property-financials-basis', b);
    } catch {
      /* storage unavailable */
    }
  };

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[86px] rounded-lg" />)}</div>
        <div className="skeleton h-[300px] rounded-lg" />
      </div>
    );
  }
  if (isError || !data) {
    return <EmptyState title="Financials didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
  }
  return <FinancialsBody data={data} basis={basis} onBasis={choose} propertyName={ws.propertyName(propertyId)} />;
}

function FinancialsBody({ data, basis, onBasis, propertyName }: { data: Financials; basis: Basis; onBasis: (b: Basis) => void; propertyName: string }) {
  const ws = useWorkspace();
  const months: Month[] = basis === 'cash' ? data.cash : data.accrual;
  const income = sumMoney(months.map(m => m.income));
  const expenses = sumMoney(months.map(m => m.expenses));
  const noi = sumMoney(months.map(m => m.noi));
  const distributions = basis === 'cash' ? sumMoney(data.cash.map(m => m.distributions)) : 0;
  const empty = months.every(m => !m.income && !m.expenses);
  const incomeAccounts = data.accounts.filter(a => a.type === 'Income');
  const expenseAccounts = data.accounts.filter(a => a.type === 'Expense');

  const exportCsv = () =>
    downloadCsv(
      `${propertyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-noi-${basis}`,
      ['Month', 'Income', 'Expenses', 'NOI', ...(basis === 'cash' ? ['Owner distributions'] : [])],
      [...months.map(m => [m.period, m.income, m.expenses, m.noi, ...(basis === 'cash' ? [m.distributions ?? 0] : [])]), ['Total', income, expenses, noi, ...(basis === 'cash' ? [distributions] : [])]],
    );

  const columns: Column<Month>[] = [
    { key: 'month', header: 'Month', cell: m => <span className="whitespace-nowrap">{m.label}</span>, footer: 'Total' },
    { key: 'income', header: 'Income', align: 'right', cell: m => <Money value={m.income} muted0 />, footer: <Money value={income} /> },
    { key: 'expenses', header: 'Expenses', align: 'right', cell: m => <Money value={m.expenses} muted0 />, footer: <Money value={expenses} /> },
    { key: 'noi', header: 'NOI', align: 'right', cell: m => <Money value={m.noi} muted0 className="font-medium" />, footer: <Money value={noi} /> },
    ...(basis === 'cash' ? [{ key: 'dist', header: 'Distributed', align: 'right' as const, hideBelow: 'sm' as const, cell: (m: Month) => <Money value={m.distributions} muted0 />, footer: <Money value={distributions} /> }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Segmented value={basis} onChange={v => onBasis(v as Basis)} options={[{ value: 'accrual', label: 'Accrual' }, { value: 'cash', label: 'Cash' }]} size="sm" />
          <span className="hidden text-sm text-muted-foreground md:inline">
            {basis === 'accrual' ? 'Income when charged, expenses when billed. From the journal; void entries excluded.' : 'Income when collected, expenses when paid — the same figures as owner statements.'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={exportCsv} className="ghost-chip h-8 gap-1.5 text-sm"><Download className="h-3.5 w-3.5" /> Export CSV</button>
          {ws.can('reports.view') && <Link to="/reports" className="ghost-chip h-8 gap-1.5 text-sm">Full reports <ArrowUpRight className="h-3.5 w-3.5" /></Link>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Income · 12 months" value={<Money value={income} cents={false} />} hint={`${ws.money(income / 12, { cents: false })} a month on average`} />
        <StatTile label="Expenses · 12 months" value={<Money value={expenses} cents={false} />} hint={income > 0 ? `${Math.round((expenses / income) * 100)}% of income` : undefined} />
        <StatTile label="Net operating income" value={<Money value={noi} cents={false} />} tone={noi < 0 ? 'danger' : undefined} hint={income > 0 ? `${Math.round((noi / income) * 100)}% margin` : undefined} />
        {basis === 'cash' ? (
          <StatTile label="Distributed to owner" value={<Money value={distributions} cents={false} />} hint={noi > 0 ? `${Math.round((distributions / noi) * 100)}% of NOI` : undefined} />
        ) : (
          <StatTile label="Best month" value={(() => { const best = [...months].sort((a, b) => b.noi - a.noi)[0]; return best && best.noi ? best.label : '—'; })()} hint={(() => { const best = [...months].sort((a, b) => b.noi - a.noi)[0]; return best && best.noi ? `${ws.money(best.noi, { cents: false })} NOI` : undefined; })()} />
        )}
      </div>

      <Card title="By month">
        <div className="-mt-1 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-[3px]', INCOME_BG)} /> Income</span>
          <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-[3px]', EXPENSE_BG)} /> Expenses</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-foreground" /> Net operating income</span>
        </div>
        {empty ? (
          <EmptyState className="py-10" icon={<BarChart3 />} title="No income or expenses in the last 12 months" description="Charges, payments and bills posted to this property will chart here." />
        ) : (
          <NoiChart months={months} />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-lg border bg-card">
          <DataTable rows={months} columns={columns} getId={m => m.period} stickyHeader={false} dense caption="Monthly income, expenses and NOI" />
        </div>
        {basis === 'accrual' && data.accounts.length > 0 && (
          <div className="overflow-hidden rounded-lg border bg-card">
            <AccountTable title="Income" rows={incomeAccounts} />
            <AccountTable title="Expenses" rows={expenseAccounts} />
            <div className="flex h-9 items-center justify-between border-t bg-subtle/60 px-3 text-[14px] font-medium">
              <span>Net operating income</span>
              <Money value={noi} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountTable({ title, rows }: { title: string; rows: Financials['accounts'] }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="flex h-9 items-center justify-between border-b bg-subtle/60 px-3 text-sm font-medium text-muted-foreground">
        <span>{title} by account</span>
        <span>12 months</span>
      </div>
      <ul>
        {rows.map(a => (
          <li key={a.accountId} className="flex h-9 items-center gap-3 border-b border-border/60 px-3 text-[14px] last:border-b-0">
            <span className="w-10 shrink-0 text-sm tabular-nums text-muted-foreground">{a.number}</span>
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <Money value={a.amount} />
          </li>
        ))}
        <li className="flex h-9 items-center justify-between border-t px-3 text-[14px] font-medium">
          <span>Total {title.toLowerCase()}</span>
          <Money value={sumMoney(rows.map(r => r.amount))} />
        </li>
      </ul>
    </div>
  );
}

function niceStep(range: number, ticks = 4) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Grouped columns for income and expenses with NOI as a line, one axis in dollars, hover per month. */
function NoiChart({ months }: { months: Month[] }) {
  const ws = useWorkspace();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 240;
  const pad = { top: 12, right: 8, bottom: 26, left: 52 };
  const geo = useMemo(() => {
    const max = Math.max(0, ...months.flatMap(m => [m.income, m.expenses, m.noi]));
    const min = Math.min(0, ...months.map(m => m.noi));
    const step = niceStep(max - min || 1);
    const top = Math.ceil(max / step) * step || step;
    const bottom = Math.floor(min / step) * step;
    const ticks: number[] = [];
    for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v));
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const y = (v: number) => pad.top + plotH - ((v - bottom) / (top - bottom)) * plotH;
    const band = plotW / months.length;
    const bar = Math.max(3, Math.min(24, (band - 10) / 2 - 1));
    return { ticks, y, band, bar, plotW, plotH, zero: y(0) };
  }, [months, width]);

  const compact = (v: number) => ws.money(v, { compact: true, cents: false });
  const colX = (i: number) => pad.left + geo.band * i + geo.band / 2;
  // The NOI line starts at the first month with any activity, so a new property isn't drawn along zero.
  const first = Math.max(0, months.findIndex(m => m.income || m.expenses));
  const line = months.slice(first).map((m, j) => `${j ? 'L' : 'M'}${colX(first + j).toFixed(1)} ${geo.y(m.noi).toFixed(1)}`).join(' ');
  const barPath = (x: number, v: number) => {
    const h = Math.abs(geo.y(v) - geo.zero);
    if (h < 0.5) return '';
    const r = Math.min(4, h, geo.bar / 2);
    const top = geo.zero - h;
    return `M${x} ${geo.zero} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + geo.bar - r} Q${x + geo.bar} ${top} ${x + geo.bar} ${top + r} V${geo.zero} Z`;
  };
  const showEvery = geo.band < 34 ? 3 : geo.band < 52 ? 2 : 1;
  const h = hover != null ? months[hover] : null;

  return (
    <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label="Monthly income, expenses and NOI" className="block overflow-visible">
        {geo.ticks.map(t => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={geo.y(t)} y2={geo.y(t)} className={t === 0 ? 'stroke-border' : 'stroke-border/60'} strokeWidth={1} />
            <text x={pad.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[12px] tabular-nums">{compact(t)}</text>
          </g>
        ))}
        {months.map((m, i) => (
          <g key={m.period}>
            {hover === i && <rect x={pad.left + geo.band * i + 2} y={pad.top} width={geo.band - 4} height={geo.plotH} rx={4} className="fill-accent/70" />}
            <path d={barPath(colX(i) - geo.bar - 1, m.income)} className={INCOME} />
            <path d={barPath(colX(i) + 1, m.expenses)} className={EXPENSE} />
            {(i % showEvery === 0 || (i === months.length - 1 && i % showEvery >= showEvery / 2 + 0.5)) && (
              <text x={colX(i)} y={height - 8} textAnchor="middle" className={cn('text-[12px]', hover === i ? 'fill-foreground' : 'fill-muted-foreground')}>
                {m.label.split(' ')[0]}{showEvery === 1 && (m.period.endsWith('-01') || i === 0) ? ` ’${m.period.slice(2, 4)}` : ''}
              </text>
            )}
          </g>
        ))}
        <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-foreground" />
        {months.map((m, i) => (i < first ? null : <circle key={m.period} cx={colX(i)} cy={geo.y(m.noi)} r={hover === i ? 5 : 4} strokeWidth={2} className="fill-foreground stroke-card" />))}
        {months.map((m, i) => (
          <rect key={`hit-${m.period}`} x={pad.left + geo.band * i} y={0} width={geo.band} height={height} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
        ))}
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-44 rounded-md border bg-popover px-3 py-2 text-sm shadow-md"
          style={{ left: Math.min(Math.max(0, colX(hover) + (colX(hover) > width / 2 ? -188 : 12)), width - 176) }}
        >
          <div className="mb-1 font-medium">{h.label}</div>
          <Row swatch={INCOME_BG} label="Income" value={h.income} />
          <Row swatch={EXPENSE_BG} label="Expenses" value={h.expenses} />
          <div className="mt-1 border-t pt-1"><Row swatch="bg-foreground" label="NOI" value={h.noi} strong /></div>
        </div>
      )}
    </div>
  );
}

function Row({ swatch, label, value, strong }: { swatch: string; label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', swatch)} />
      <span className="flex-1 text-muted-foreground">{label}</span>
      <Money value={value} cents={false} className={strong ? 'font-medium' : undefined} />
    </div>
  );
}
