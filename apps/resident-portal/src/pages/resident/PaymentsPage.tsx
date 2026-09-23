import { ArrowRight, Landmark, Receipt, ShieldCheck, Undo2, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { LoadError, ResidentSkeleton } from '../../components/resident/bits';
import { ReceiptDialog } from '../../components/resident/ReceiptDialog';
import { Segmented } from '../../components/resident/Segmented';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Button, Card, Container, EmptyState, LinkButton, StatusPill } from '../../components/ui';
import { formatMoney, shortDate } from '../../lib/format';
import { relativeDays } from '../../lib/residentFormat';
import { useResidentLease } from '../../lib/residentLease';
import { useResidentLedger, type LedgerRow } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The resident's ledger: every charge and payment with the balance after it,
 * newest first. Payments open a receipt. Reversed entries stay visible,
 * struck through, so nothing on a statement ever silently disappears.
 */

type Kind = 'all' | 'charges' | 'payments';

export default function PaymentsPage() {
  useDocumentTitle('Payments');
  const { leaseId } = useResidentLease();
  const q = useResidentLedger(leaseId);
  const [year, setYear] = useState<string>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [receipt, setReceipt] = useState<string | null>(null);

  const rows = useMemo(() => {
    const entries = q.data?.entries ?? [];
    return entries
      .filter(e => year === 'all' || e.date.startsWith(year))
      .filter(e => kind === 'all' || (kind === 'charges' ? e.type === 'charge' : e.type !== 'charge'))
      .slice()
      .reverse();
  }, [q.data, year, kind]);

  if (q.isPending) return <ResidentSkeleton variant="list" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your payments" />;

  const d = q.data;
  const m = (n: number) => formatMoney(n, d.currency);
  const filtered = year !== 'all' || kind !== 'all';
  const yearStart = year !== 'all' ? (d.entries.filter(e => e.date < `${year}-01-01` && !e.reversed).pop()?.balance ?? 0) : null;

  return (
    <div className="animate-fade-in">
      <ResidentHeader
        title="Payments"
        subtitle={<LeaseSwitcher />}
        actions={
          d.leaseStatus === 'Active' || d.balance > 0 ? (
            <LinkButton to="/resident/pay" size="lg" className="w-full sm:w-auto">
              {d.balance > 0 ? `Pay ${m(d.balance)}` : 'Make a payment'} <ArrowRight aria-hidden />
            </LinkButton>
          ) : null
        }
      />
      <Container className="space-y-5 pb-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary
            icon={Wallet}
            label={d.balance < 0 ? 'Credit on your account' : 'Current balance'}
            value={m(Math.abs(d.balance))}
            hint={d.pastDue > 0 ? <span className="text-tone-danger">{m(d.pastDue)} past due</span> : d.balance <= 0 ? 'You’re all paid up' : 'Nothing past due'}
            emphasis={d.pastDue > 0}
          />
          <Summary
            icon={Receipt}
            label="Next charges"
            value={d.nextCharges ? m(d.nextCharges.total) : '—'}
            hint={d.nextCharges ? `Due ${shortDate(d.nextCharges.dueDate)} (${relativeDays(d.nextCharges.dueDate)})` : 'Nothing scheduled'}
          />
          <Summary
            icon={ShieldCheck}
            label="Security deposit held"
            value={m(d.depositHeld)}
            hint={d.depositHeld > 0 ? 'Returned after move-out, less any charges' : d.deposit > 0 ? `${m(d.deposit)} once your lease starts` : 'No deposit on this lease'}
          />
        </div>

        {d.nextCharges && d.nextCharges.items.length > 1 && (
          <p className="text-sm text-muted-foreground">
            Next charges: {d.nextCharges.items.map(i => `${i.description} ${m(i.amount)}`).join(' · ')}
          </p>
        )}

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <h2 className="text-[15px] font-semibold">Activity</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={kind} onChange={v => setKind(v as Kind)} options={[{ value: 'all', label: 'All' }, { value: 'charges', label: 'Charges' }, { value: 'payments', label: 'Payments' }]} label="Show" />
              {d.years.length > 1 && (
                <select value={year} onChange={e => setYear(e.target.value)} aria-label="Year" className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                  <option value="all">All years</option>
                  {d.years.map(y => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {d.entries.length === 0 ? (
            <EmptyState icon={Landmark} title="No activity yet">
              Charges and payments will appear here once your lease starts.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nothing matches"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setYear('all');
                    setKind('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              No {kind === 'all' ? 'activity' : kind} {year !== 'all' ? `in ${year}` : ''}.
            </EmptyState>
          ) : (
            <>
              <div className="hidden grid-cols-[110px_minmax(0,1fr)_130px_130px] gap-4 border-b bg-subtle px-5 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
                <span>Date</span>
                <span>Description</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Balance</span>
              </div>
              <ul className="divide-y">
                {rows.map(e => (
                  <Row key={e.id} e={e} m={m} showBalance={kind === 'all'} onReceipt={() => setReceipt(e.id)} />
                ))}
              </ul>
              {yearStart != null && kind === 'all' && (
                <div className="flex justify-between gap-3 border-t bg-subtle px-4 py-2.5 text-sm text-muted-foreground sm:px-5">
                  <span>Balance on January 1, {year}</span>
                  <span className="tabular-nums">{m(yearStart)}</span>
                </div>
              )}
            </>
          )}
        </Card>
        {filtered && rows.length > 0 && kind !== 'all' && <p className="text-sm text-muted-foreground">Running balances show when all activity is listed.</p>}
      </Container>

      <ReceiptDialog leaseId={leaseId} transactionId={receipt} onOpenChange={o => !o && setReceipt(null)} />
    </div>
  );
}

function Summary({ icon: Icon, label, value, hint, emphasis }: { icon: typeof Wallet; label: string; value: string; hint: ReactNode; emphasis?: boolean }) {
  return (
    <Card className={cn('p-4', emphasis && 'border-tone-danger/30')}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden /> {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
    </Card>
  );
}

function Row({ e, m, showBalance, onReceipt }: { e: LedgerRow; m: (n: number) => string; showBalance: boolean; onReceipt: () => void }) {
  const credit = e.effect < 0;
  const neutral = e.effect === 0 && !e.reversed;
  const amount = e.reversed ? m(e.amount) : credit ? `−${m(-e.effect)}` : neutral ? m(e.amount) : m(e.effect);
  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-4 py-3 sm:px-5 md:grid-cols-[110px_minmax(0,1fr)_130px_130px] md:items-center', e.reversed && 'bg-muted/30')}>
      <span className="order-2 col-span-1 text-sm text-muted-foreground md:order-none md:text-[15px] md:text-foreground">{shortDate(e.date)}</span>
      <div className="order-1 min-w-0 md:order-none">
        <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium', e.reversed && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
          <span className="break-words">{e.label}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {e.reversed && (
            <StatusPill tone="neutral" dot={false} className="h-6 no-underline">
              <Undo2 className="h-3 w-3" aria-hidden /> Reversed{e.reversedOn ? ` ${shortDate(e.reversedOn)}` : ''}
            </StatusPill>
          )}
          {e.type === 'charge' && !e.reversed && e.open != null && e.open > 0 && (
            <span className={cn('text-sm', e.overdue ? 'text-tone-danger' : 'text-muted-foreground')}>
              {e.open < e.amount ? `${m(e.open)} still open` : 'Unpaid'}
              {e.dueDate ? ` · due ${shortDate(e.dueDate)}` : ''}
            </span>
          )}
          {e.hasReceipt && (
            <button type="button" onClick={onReceipt} className="inline-flex h-7 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
              <Receipt className="h-3.5 w-3.5" aria-hidden /> Receipt
            </button>
          )}
        </div>
      </div>
      <span className={cn('order-1 text-right text-[15px] font-medium tabular-nums md:order-none', e.reversed ? 'text-muted-foreground line-through' : credit ? 'text-tone-success' : neutral ? 'text-muted-foreground' : '')}>{amount}</span>
      <span className="order-2 text-right text-sm tabular-nums text-muted-foreground md:order-none md:text-[15px]">{showBalance ? (e.reversed ? '—' : m(e.balance)) : ''}</span>
    </li>
  );
}
