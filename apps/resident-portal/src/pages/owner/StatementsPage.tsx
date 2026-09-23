import { useMutation } from '@tanstack/react-query';
import { Download, FileSearch, Info, ListOrdered, Receipt } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getOwnerStatementPdf } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { useOwnerOverview, useOwnerStatement, type OwnerStatementData } from '../../components/owner/data';
import { AreaSkeleton, LoadError, PageHeader, Panel, Segmented, ledgerMoney, money } from '../../components/owner/kit';
import { StatementTable } from '../../components/owner/StatementDocument';
import { Alert, Button, Card, Container, EmptyState, inputClass } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { longDate, shortDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Monthly owner statements: pick a month (or the year to date) and a property,
 * read the statement as a financial document with the transactions behind it,
 * and download it as a PDF.
 */

function defaultPeriod() {
  // Last month is the statement most owners come for; early in a month it's the only complete one.
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function StatementsPage() {
  useDocumentTitle('Statements');
  const [params, setParams] = useSearchParams();
  const period = params.get('period') || defaultPeriod();
  const propertyId = params.get('property') || null;
  const q = useOwnerStatement(period, propertyId);
  const overview = useOwnerOverview();

  const set = (key: 'period' | 'property', value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  if (q.isPending) return <AreaSkeleton variant="document" />;
  if (q.isError || !q.data) {
    return <LoadError error={q.error} onRetry={() => q.refetch()} what="that statement" home={{ to: '/owner/statements', label: 'Latest statement' }} />;
  }
  const d = q.data;
  const noProperties = d.options.properties.length === 0 && !overview.isPending;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Statements"
        subtitle={`Cash-basis statements for ${d.owner.name}`}
        actions={!noProperties && <PdfButton period={period} propertyId={propertyId} label={d.label} />}
      />
      <Container className="space-y-5 pb-4 pt-4">
        {noProperties ? (
          <Card>
            <EmptyState icon={Receipt} title="No statements yet">
              Statements appear once your property manager links a property to your account.
            </EmptyState>
          </Card>
        ) : (
          <>
            <Filters d={d} period={period} propertyId={propertyId} onChange={set} fetching={q.isFetching} />
            {d.statement.warnings.length > 0 && (
              <Alert tone="warning" title="This statement doesn’t reconcile yet">
                The transactions don’t add up to the bank balance, so the office is reviewing the books. The difference is shown on the statement.
              </Alert>
            )}
            <div className={cn('grid gap-5 transition-opacity lg:grid-cols-[minmax(0,1fr)_300px]', q.isFetching && q.isPlaceholderData && 'opacity-60')} aria-busy={q.isFetching}>
              <div className="min-w-0">
                <StatementCard d={d} />
              </div>
              <aside className="min-w-0 space-y-5">
                <Summary d={d} />
                <YearToDate d={d} />
                <HowItWorks />
              </aside>
            </div>
            <div className={cn('transition-opacity', q.isFetching && q.isPlaceholderData && 'opacity-60')}>
              <Transactions d={d} />
            </div>
          </>
        )}
      </Container>
    </div>
  );
}

function Filters({ d, period, propertyId, onChange, fetching }: { d: OwnerStatementData; period: string; propertyId: string | null; onChange: (k: 'period' | 'property', v: string | null) => void; fetching: boolean }) {
  const periodId = useId();
  const propertyIdField = useId();
  const periods = d.options.periods;
  return (
    <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-60">
        <label htmlFor={periodId} className="mb-1.5 block text-sm font-medium">
          Period
        </label>
        <select id={periodId} className={inputClass('pr-8')} value={period} onChange={e => onChange('period', e.target.value)}>
          <option value="ytd">Year to date</option>
          {!periods.some(p => p.value === period) && period !== 'ytd' && <option value={period}>{d.label}</option>}
          {periods.map((p, i) => (
            <option key={p.value} value={p.value}>
              {p.label}
              {i === 0 ? ' (month to date)' : ''}
            </option>
          ))}
        </select>
      </div>
      {d.options.properties.length > 1 && (
        <div className="sm:w-72">
          <label htmlFor={propertyIdField} className="mb-1.5 block text-sm font-medium">
            Property
          </label>
          <select id={propertyIdField} className={inputClass('pr-8')} value={propertyId ?? ''} onChange={e => onChange('property', e.target.value || null)}>
            <option value="">All properties</option>
            {d.options.properties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-sm text-muted-foreground sm:pb-2.5" aria-live="polite">
        {fetching ? 'Updating…' : `${longDate(d.periodStart)} – ${longDate(d.periodEnd)}${d.isPartial ? ' · so far' : ''}`}
      </p>
    </div>
  );
}

function PdfButton({ period, propertyId, label }: { period: string; propertyId: string | null; label: string }) {
  const pdf = useMutation({
    mutationFn: () => getOwnerStatementPdf({ period, propertyId }),
  });
  const download = () => {
    // Open the tab while we still have the click, then point it at the file — otherwise browsers block it.
    const tab = window.open('', '_blank');
    if (tab) tab.document.title = 'Preparing your statement…';
    pdf.mutate(undefined, {
      onSuccess: ({ url }) => {
        if (tab && !tab.closed) {
          tab.location.href = url;
          toast.success(`${label} statement is ready`);
        } else {
          toast.success(`${label} statement is ready`, { action: { label: 'Open PDF', onClick: () => window.open(url, '_blank') }, duration: 12000 });
        }
      },
      onError: e => {
        tab?.close();
        toast.error(errorMessage(e, 'The PDF couldn’t be created. Try again in a moment.'));
      },
    });
  };
  return (
    <Button onClick={download} loading={pdf.isPending}>
      {!pdf.isPending && <Download aria-hidden />} {pdf.isPending ? 'Preparing PDF…' : 'Download PDF'}
    </Button>
  );
}

function StatementCard({ d }: { d: OwnerStatementData }) {
  const st = d.statement;
  return (
    <Card as="article" className="overflow-hidden" aria-label={`Owner statement, ${d.label}`}>
      <header className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{d.organization.name}</p>
          <h2 className="mt-0.5 text-xl font-semibold tracking-tight">Owner statement · {d.label}</h2>
          <p className="text-sm text-muted-foreground">
            {longDate(d.periodStart)} – {longDate(d.periodEnd)}
            {d.isPartial ? ' (month to date)' : ''}
          </p>
        </div>
        <div className="min-w-0 text-sm sm:text-right">
          <p className="font-medium">{d.owner.name}</p>
          <p className="break-words text-muted-foreground">{st.properties.map(p => p.propertyName).join(', ')}</p>
        </div>
      </header>
      {st.properties.length === 0 ? (
        <EmptyState icon={FileSearch} title="Nothing to show">
          This property isn’t in your portfolio any more.
        </EmptyState>
      ) : (
        <div className="py-2">
          <StatementTable statement={st} currency={d.currency} />
        </div>
      )}
      <footer className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">Cash basis — income when it’s received, expenses when they’re paid. Negative figures are in parentheses.</footer>
    </Card>
  );
}

function Summary({ d }: { d: OwnerStatementData }) {
  const c = d.statement.combined;
  const cur = d.currency;
  return (
    <Panel title={d.label}>
      <dl className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-muted-foreground">Beginning cash</dt>
          <dd className="tabular-nums">{ledgerMoney(c.beginningCash, cur)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-muted-foreground">Net operating cash flow</dt>
          <dd className={cn('tabular-nums', c.netOperatingCashFlow < 0 && 'text-tone-danger')}>{ledgerMoney(c.netOperatingCashFlow, cur)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-muted-foreground">Distributions</dt>
          <dd className="tabular-nums">{money(c.ownerActivity.distributions, cur)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t pt-2.5">
          <dt className="text-sm font-medium">Ending cash</dt>
          <dd className="font-semibold tabular-nums">{ledgerMoney(c.endingCash, cur)}</dd>
        </div>
      </dl>
      <div className="mt-4 rounded-lg bg-primary/[0.06] px-3.5 py-3">
        <p className="text-sm text-muted-foreground">Available for distribution</p>
        <p className="text-2xl font-semibold tracking-tight">{money(Math.max(0, c.availableForDistribution), cur)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {c.availableForDistribution > 0 ? `As of ${shortDate(d.periodEnd)}, after deposits, reserves and unpaid bills.` : `As of ${shortDate(d.periodEnd)}. Residents’ deposits, the reserve and unpaid bills are covered first.`}
        </p>
      </div>
    </Panel>
  );
}

function YearToDate({ d }: { d: OwnerStatementData }) {
  const y = d.ytd;
  const cur = d.currency;
  return (
    <Panel title={y.label}>
      <p className="-mt-1 mb-2 text-sm text-muted-foreground">
        {shortDate(y.periodStart)} – {shortDate(y.periodEnd)}
      </p>
      <dl className="space-y-2">
        {[
          ['Income', y.income],
          ['Expenses', -y.expenses],
        ].map(([label, v]) => (
          <div key={label as string} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{ledgerMoney(v as number, cur)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t pt-2">
          <dt className="text-sm font-medium">Net operating cash flow</dt>
          <dd className="font-semibold tabular-nums">{ledgerMoney(y.netOperatingCashFlow, cur)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-muted-foreground">Distributed to you</dt>
          <dd className="tabular-nums">{money(y.distributions, cur)}</dd>
        </div>
        {y.contributions > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">Your contributions</dt>
            <dd className="tabular-nums">{money(y.contributions, cur)}</dd>
          </div>
        )}
      </dl>
    </Panel>
  );
}

function HowItWorks() {
  return (
    <Panel title="Reading your statement" icon={Info}>
      <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Income</span> is rent and fees residents actually paid in the period, grouped by what they paid for.
        </li>
        <li>
          <span className="font-medium text-foreground">Security deposits</span> belong to residents until they move out, so they’re held back rather than counted as income.
        </li>
        <li>
          <span className="font-medium text-foreground">Available for distribution</span> is cash left after deposits, your reserve and bills that are still unpaid.
        </li>
      </ul>
    </Panel>
  );
}

type Tx = OwnerStatementData['transactions'][number];

function Transactions({ d }: { d: OwnerStatementData }) {
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [showAll, setShowAll] = useState(false);
  const multi = d.statement.properties.length > 1;
  const cur = d.currency;
  const rows = useMemo(() => d.transactions.filter((t: Tx) => (filter === 'in' ? t.amountIn > 0 : filter === 'out' ? t.amountOut > 0 : true)), [d.transactions, filter]);
  const visible = showAll ? rows : rows.slice(0, 40);
  const totalIn = rows.reduce((a, t) => a + Math.round(t.amountIn * 100), 0) / 100;
  const totalOut = rows.reduce((a, t) => a + Math.round(t.amountOut * 100), 0) / 100;

  return (
    <Panel
      title="Transaction detail"
      icon={ListOrdered}
      description="Every deposit to and payment from the bank in this period"
      flush
      action={
        d.transactions.length > 0 && (
          <Segmented
            label="Filter transactions"
            value={filter}
            onChange={v => {
              setFilter(v as 'all' | 'in' | 'out');
              setShowAll(false);
            }}
            options={[
              { value: 'all', label: 'All', count: d.transactions.length },
              { value: 'in', label: 'In' },
              { value: 'out', label: 'Out' },
            ]}
          />
        )
      }
    >
      {d.transactions.length === 0 ? (
        <p className="px-5 py-10 text-center text-[15px] text-muted-foreground">No money moved in or out during this period.</p>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-[15px] text-muted-foreground">
          Nothing matches this filter.{' '}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setFilter('all')}>
            Show all transactions
          </button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className={cn('w-full text-[15px]', multi ? 'min-w-[900px]' : 'min-w-[760px]')}>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-sm text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Date</th>
                  {multi && <th scope="col" className="px-3 py-2.5 font-medium">Property</th>}
                  <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Paid by or to</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Memo</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">In</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map(t => (
                  <tr key={`${t.id}-${t.propertyId}`} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums sm:px-5">{shortDate(t.date)}</td>
                    {multi && <td className="px-3 py-2.5">{t.propertyName}</td>}
                    <td className="whitespace-nowrap px-3 py-2.5">{t.typeLabel}</td>
                    <td className="px-3 py-2.5">
                      <span className="break-words">{t.party || '—'}</span>
                      {t.unitName && (t.kind === 'Payment' || t.kind === 'Refund') && !/^main$/i.test(t.unitName) && <span className="text-muted-foreground"> · #{t.unitName}</span>}
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5 text-muted-foreground">
                      <span className="break-words">{t.memo}</span>
                      {t.reference && <span className="whitespace-nowrap">{t.paymentMethod === 'Check' ? ` #${t.reference}` : ` · ${t.reference}`}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{t.amountIn ? money(t.amountIn, cur) : ''}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums sm:px-5">{t.amountOut ? money(t.amountOut, cur) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="px-4 py-2.5 sm:px-5" colSpan={multi ? 5 : 4}>
                    Total{filter !== 'all' ? (filter === 'in' ? ' money in' : ' money out') : ''} · {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{filter !== 'out' ? money(totalIn, cur) : ''}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums sm:px-5">{filter !== 'in' ? money(totalOut, cur) : ''}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.length > visible.length && (
            <div className="border-t px-4 py-3 text-center sm:px-5">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                Show all {rows.length} transactions
              </Button>
            </div>
          )}
          {d.truncated && <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">Showing the first 1,000 transactions. Download the PDF or choose one property to see fewer at a time.</p>}
        </>
      )}
    </Panel>
  );
}
