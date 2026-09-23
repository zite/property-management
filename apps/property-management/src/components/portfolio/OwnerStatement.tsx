import { CalendarRange, ChevronDown, Download, FileSpreadsheet, Printer, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { addPeriods, periodLabel, periodOf } from '@project/shared/dates';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { fullDate, longDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { FieldButton } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { EmptyState } from '../primitives/bits';
import { Money } from '../primitives/data';
import { useOwnerStatement, type OwnerStatementData } from './data';

/**
 * An owner's cash-basis statement for a month or the year to date, exactly as
 * `ownerStatement` computes it (see its header): the cash walk from beginning
 * to ending balance, what's available to distribute, a section per property,
 * and the register of transactions behind it. Prints on its own (the app
 * chrome is hidden) and exports to CSV.
 */

type Figures = OwnerStatementData['statement']['combined'];
type PropertySection = OwnerStatementData['statement']['properties'][number];

const KEY = 'property-management:owner-statement-period';

export function OwnerStatement({ ownerId }: { ownerId: string }) {
  const ws = useWorkspace();
  const lastMonth = addPeriods(periodOf(ws.today), -1);
  const [period, setPeriod] = useState(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      return saved && (saved === 'ytd' || saved <= periodOf(ws.today)) ? saved : lastMonth;
    } catch {
      return lastMonth;
    }
  });
  const choose = (p: string) => {
    setPeriod(p);
    try {
      sessionStorage.setItem(KEY, p);
    } catch {
      /* storage unavailable */
    }
  };
  const { data, isPending, isError, error, refetch, isFetching } = useOwnerStatement(ownerId, period);
  const [printing, setPrinting] = useState(false);

  const options = useMemo(() => {
    const out = [{ value: 'ytd', label: `Year to date ${ws.today.slice(0, 4)}`, group: 'Range' }];
    for (let i = 0; i < 24; i++) {
      const p = addPeriods(periodOf(ws.today), -i);
      out.push({ value: p, label: i === 0 ? `${periodLabel(p)} (so far)` : periodLabel(p), group: p.slice(0, 4) });
    }
    return out;
  }, [ws.today]);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  const exportStatement = () => {
    if (!data) return;
    const s = data.statement;
    const rows: Array<Array<string | number>> = [];
    const figureRows = (scope: string, f: Figures) => {
      rows.push([scope, 'Beginning cash', '', f.beginningCash]);
      for (const l of f.income.lines) rows.push([scope, 'Income', l.label, l.amount]);
      rows.push([scope, 'Total income', '', f.income.total]);
      for (const l of f.expenses.lines) rows.push([scope, 'Expenses', l.label, l.amount]);
      rows.push([scope, 'Total expenses', '', f.expenses.total]);
      rows.push([scope, 'Net operating cash flow', '', f.netOperatingCashFlow]);
      rows.push([scope, 'Security deposits received', '', f.deposits.received], [scope, 'Security deposits returned', '', -f.deposits.returned]);
      rows.push([scope, 'Owner contributions', '', f.ownerActivity.contributions], [scope, 'Owner distributions', '', -f.ownerActivity.distributions]);
      for (const l of f.other.lines) rows.push([scope, 'Other bank activity', l.label, l.amount]);
      rows.push([scope, 'Ending cash', '', f.endingCash], [scope, 'Security deposits held', '', f.depositsHeld], [scope, 'Reserve', '', f.reserve], [scope, 'Unpaid bills', '', f.unpaidBills], [scope, 'Available for distribution', '', f.availableForDistribution]);
    };
    for (const p of s.properties) figureRows(p.propertyName, p);
    if (s.properties.length > 1) figureRows('All properties', s.combined);
    downloadCsv(`owner-statement-${slug(data.owner.name)}-${data.period.choice}`, ['Property', 'Line', 'Detail', 'Amount'], rows);
  };

  const exportTransactions = () => {
    if (!data) return;
    downloadCsv(
      `owner-transactions-${slug(data.owner.name)}-${data.period.choice}`,
      ['Date', 'Number', 'Type', 'Property', 'Unit', 'Paid by / to', 'Memo', 'Method', 'Reference', 'Money in', 'Money out'],
      data.transactions.map(t => [t.date, t.number, t.typeLabel, t.propertyName, t.unitName, t.party, t.memo, t.paymentMethod, t.reference, t.amountIn || '', t.amountOut || '']),
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OptionPicker
          options={options}
          value={period}
          onChange={v => v && choose(v)}
          width={240}
          placeholder="Choose a month…"
          trigger={<FieldButton icon={<CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />} className="w-[220px]">{options.find(o => o.value === period)?.label}</FieldButton>}
        />
        {isFetching && !isPending && <span className="text-sm text-muted-foreground">Updating…</span>}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="ghost-chip h-9 gap-1.5" disabled={!data}><Download className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3 w-3" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportStatement}><FileSpreadsheet className="h-3.5 w-3.5" /> Statement (CSV)</DropdownMenuItem>
              <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportTransactions} disabled={!data?.transactions.length}><FileSpreadsheet className="h-3.5 w-3.5" /> Transactions (CSV)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className="ghost-chip h-9 gap-1.5" onClick={() => setPrinting(true)} disabled={!data}><Printer className="h-3.5 w-3.5" /> Print</button>
        </div>
      </div>

      {isPending ? (
        <div className="space-y-3">
          <div className="skeleton h-24 rounded-lg" />
          <div className="skeleton h-72 rounded-lg" />
        </div>
      ) : isError || !data ? (
        <EmptyState title="The statement didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      ) : (
        <div className={cn('transition-opacity', isFetching && 'opacity-60')}>
          <StatementDocument data={data} />
        </div>
      )}
      {printing && data && <PrintRoot><StatementDocument data={data} print /></PrintRoot>}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Renders children into <body> for printing only; while mounted, printing shows nothing else. */
function PrintRoot({ children }: { children: ReactNode }) {
  return createPortal(
    <div id="ks-print-root" className="hidden bg-white text-black print:block">
      <style>{`
        @media print {
          @page { margin: 14mm; }
          body > *:not(#ks-print-root) { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
          #ks-print-root { display: block !important; --foreground: 222 14% 10%; --muted-foreground: 220 6% 38%; --border: 220 10% 85%; --card: 0 0% 100%; --background: 0 0% 100%; --subtle: 220 14% 97%; --muted: 220 12% 95%; --tone-danger: 185 28 45; --tone-warning: 160 72 8; --tone-success: 21 128 61; color-scheme: light; }
        }
      `}</style>
      {children}
    </div>,
    document.body,
  );
}

function StatementDocument({ data, print }: { data: OwnerStatementData; print?: boolean }) {
  const s = data.statement;
  const c = s.combined;
  const multi = s.properties.length > 1;
  const noActivity = !s.properties.length;

  return (
    <article className={cn('text-[14px] text-foreground', !print && 'rounded-lg border bg-card shadow-2xs')} aria-label="Owner statement">
      <header className={cn('flex flex-wrap items-start justify-between gap-4 border-b', print ? 'pb-4' : 'px-5 py-4')}>
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Owner statement</p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight">{data.owner.name}</h2>
          {data.owner.contactName && data.owner.contactName !== data.owner.name && <p className="text-muted-foreground">Attn: {data.owner.contactName}</p>}
          {data.owner.mailingAddress && <p className="whitespace-pre-line text-muted-foreground">{data.owner.mailingAddress}</p>}
        </div>
        <div className="ml-auto text-right">
          <p className="text-[16px] font-semibold">{data.period.label}</p>
          <p className="text-muted-foreground">{fullDate(data.period.periodStart)} – {fullDate(data.period.periodEnd)}{data.period.isPartial ? ' (to date)' : ''}</p>
          <p className="mt-2 font-medium">{data.organization.name}</p>
          {data.organization.address && <p className="whitespace-pre-line text-sm text-muted-foreground">{data.organization.address}</p>}
          <p className="text-sm text-muted-foreground">Cash basis · prepared {longDate(data.today)}</p>
        </div>
      </header>

      {s.warnings.length > 0 && (
        <div className={cn('flex gap-2 border-b border-tone-warning/30 bg-tone-warning/[0.06] text-sm text-tone-warning', print ? 'py-2' : 'px-5 py-2.5')}>
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">{s.warnings.map(w => <p key={w}>{w}</p>)}</div>
        </div>
      )}

      {noActivity ? (
        <p className={cn('text-muted-foreground', print ? 'py-6' : 'px-5 py-10 text-center')}>{data.owner.name} doesn’t own any properties with activity in this period.</p>
      ) : (
        <>
          <section className={cn('grid gap-6 border-b md:grid-cols-2', print ? 'py-4' : 'px-5 py-4')}>
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">{multi ? `Cash summary · ${s.properties.length} properties` : 'Cash summary'}</h3>
              <CashWalk f={c} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Available for distribution</h3>
              <dl>
                <Line label="Ending cash" value={c.endingCash} />
                <Line label="Security deposits held" value={-c.depositsHeld} />
                <Line label="Reserve" value={-c.reserve} />
                <Line label="Unpaid bills" value={-c.unpaidBills} />
                <Line label="Available to distribute" value={c.availableForDistribution} total highlight />
              </dl>
              {multi && <p className="mt-2 text-sm text-muted-foreground">Adds each property’s available cash; a shortfall at one property doesn’t reduce another’s.</p>}
            </div>
          </section>

          {s.properties.map(p => <PropertyBlock key={p.propertyId} p={p} multi={multi} print={print} />)}

          <section className={cn(print ? 'pt-4' : 'px-5 py-4')}>
            <h3 className="mb-2 flex items-baseline justify-between text-sm font-medium text-muted-foreground">
              <span>Transactions</span>
              <span className="tabular-nums">{data.transactions.length}{data.truncated ? '+' : ''}</span>
            </h3>
            {data.transactions.length === 0 ? (
              <p className="text-muted-foreground">No money moved in or out of the bank in this period.</p>
            ) : (
              <div className={cn(!print && 'overflow-x-auto rounded-md border')}>
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="h-9 whitespace-nowrap px-2 font-medium">Date</th>
                      <th className="h-9 px-2 font-medium">Type</th>
                      {multi && <th className="h-9 px-2 font-medium">Property</th>}
                      <th className="h-9 px-2 font-medium">Paid by / to</th>
                      <th className="h-9 px-2 font-medium">Memo</th>
                      <th className="h-9 whitespace-nowrap px-2 text-right font-medium">In</th>
                      <th className="h-9 whitespace-nowrap px-2 text-right font-medium">Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map(t => (
                      <tr key={`${t.id}:${t.propertyId}`} className="border-b border-border/60 last:border-b-0 print:break-inside-avoid">
                        <td className="h-9 whitespace-nowrap px-2 tabular-nums text-muted-foreground">{fullDate(t.date)}</td>
                        <td className="whitespace-nowrap px-2">{t.typeLabel}</td>
                        {multi && <td className="max-w-[140px] truncate px-2 print:max-w-none print:whitespace-normal">{t.propertyName}</td>}
                        <td className="max-w-[180px] truncate px-2 print:max-w-none print:whitespace-normal">{[t.party, t.unitName && t.unitName !== 'Main' ? t.unitName : ''].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="max-w-[240px] truncate px-2 text-muted-foreground print:max-w-none print:whitespace-normal">{t.memo}</td>
                        <td className="whitespace-nowrap px-2 text-right">{t.amountIn ? <Money value={t.amountIn} /> : ''}</td>
                        <td className="whitespace-nowrap px-2 text-right">{t.amountOut ? <Money value={t.amountOut} /> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </article>
  );
}

function CashWalk({ f }: { f: Figures }) {
  const ws = useWorkspace();
  const fmt = (n: number) => ws.money(n);
  return (
    <dl>
      <Line label="Beginning cash" value={f.beginningCash} />
      <Line label="Income collected" value={f.income.total} />
      <Line label="Expenses paid" value={-f.expenses.total} />
      <Line label="Net operating cash flow" value={f.netOperatingCashFlow} subtotal />
      {(f.deposits.received || f.deposits.returned) ? <Line label="Security deposits, net" value={f.deposits.net} hint={`${f.deposits.received ? `received ${fmt(f.deposits.received)}` : ''}${f.deposits.received && f.deposits.returned ? ', ' : ''}${f.deposits.returned ? `returned ${fmt(f.deposits.returned)}` : ''}`} /> : null}
      {f.ownerActivity.contributions ? <Line label="Owner contributions" value={f.ownerActivity.contributions} /> : null}
      {f.ownerActivity.distributions ? <Line label="Owner distributions" value={-f.ownerActivity.distributions} /> : null}
      {f.other.total ? <Line label="Other bank activity" value={f.other.total} /> : null}
      <Line label="Ending cash" value={f.endingCash} total />
    </dl>
  );
}

function PropertyBlock({ p, multi, print }: { p: PropertySection; multi: boolean; print?: boolean }) {
  return (
    <section className={cn('border-b print:break-inside-avoid-page', print ? 'py-4' : 'px-5 py-4')}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{p.propertyName}</h3>
        {p.address && <span className="text-sm text-muted-foreground">{p.address}</span>}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-sm font-medium text-muted-foreground">Income</h4>
          <dl>
            {p.income.lines.length ? p.income.lines.map(l => <Line key={l.key} label={l.label} value={l.amount} />) : <p className="py-1 text-muted-foreground">No income collected</p>}
            <Line label="Total income" value={p.income.total} subtotal />
          </dl>
          <h4 className="mb-1 mt-4 text-sm font-medium text-muted-foreground">Expenses</h4>
          <dl>
            {p.expenses.lines.length ? p.expenses.lines.map(l => <Line key={l.key} label={l.label} value={l.amount} />) : <p className="py-1 text-muted-foreground">No expenses paid</p>}
            <Line label="Total expenses" value={p.expenses.total} subtotal />
          </dl>
          <dl className="mt-2"><Line label="Net operating cash flow" value={p.netOperatingCashFlow} total /></dl>
        </div>
        {multi && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">Cash</h4>
            <CashWalk f={p} />
            <dl className="mt-3">
              <Line label="Deposits held" value={-p.depositsHeld} />
              <Line label="Reserve" value={-p.reserve} />
              <Line label="Unpaid bills" value={-p.unpaidBills} />
              <Line label="Available to distribute" value={p.availableForDistribution} subtotal />
            </dl>
          </div>
        )}
        {!multi && p.other.lines.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">Other bank activity</h4>
            <dl>{p.other.lines.map(l => <Line key={l.key} label={l.label} value={l.amount} />)}</dl>
          </div>
        )}
      </div>
    </section>
  );
}

function Line({ label, value, subtotal, total, highlight, hint }: { label: string; value: number; subtotal?: boolean; total?: boolean; highlight?: boolean; hint?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', (subtotal || total) && 'border-t', total && 'border-foreground/25 font-semibold', subtotal && 'font-medium', highlight && 'text-[15px]')}>
      <dt className="min-w-0">
        {label}
        {hint && <span className="block text-sm font-normal text-muted-foreground">{hint}</span>}
      </dt>
      <dd><Money value={Math.abs(value) < 0.005 ? 0 : value} className={cn(value < -0.005 && highlight && 'text-tone-danger')} /></dd>
    </div>
  );
}
