import { ArrowLeftRight, CheckCircle2, ChevronRight, Landmark, Receipt, Scale } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../lib/errors';
import { fullDate, plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { useDocumentTitle } from '../shell/PageHeader';
import { useBanking, type BankAccountSummary } from './accountingData';
import { ExpenseDialog, TransferDialog } from './BankActivityDialogs';
import { AccountingHeader, HeaderButton } from './parts';

/**
 * Bank accounts: each account's balance and how that cash splits across the
 * properties it holds money for, what hasn't cleared, and where reconciliation
 * stands. Open an account for its register.
 */
export function BankingView() {
  const ws = useWorkspace();
  useDocumentTitle('Banking');
  const { data, isPending, isError, error, refetch } = useBanking();
  const [transfer, setTransfer] = useState(false);
  const [expense, setExpense] = useState(false);
  const total = data ? Math.round(data.accounts.reduce((s, a) => s + Math.round(a.balance * 100), 0)) / 100 : 0;

  return (
    <>
      <AccountingHeader
        tab="banking"
        actions={
          <>
            {ws.can('banking.manage') && ws.bankAccounts.length > 1 && <HeaderButton icon={<ArrowLeftRight />} label="Transfer" onClick={() => setTransfer(true)} />}
            {ws.can('payables.manage') && <HeaderButton primary icon={<Receipt />} label="Record expense" onClick={() => setExpense(true)} />}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-8">
          {isPending ? (
            <SkeletonRows rows={8} />
          ) : isError || !data ? (
            <EmptyState title="Bank accounts didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
          ) : !data.accounts.length ? (
            <EmptyState icon={<Landmark />} title="No bank accounts yet" description="Add a bank account in the chart of accounts to see balances and reconcile statements." />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">Cash across {plural(data.accounts.length, 'account')}</div>
                  <Money value={total} className="text-[26px] font-semibold tracking-tight" />
                </div>
              </div>
              <div className="space-y-4">
                {data.accounts.map(a => <AccountPanel key={a.id} account={a} />)}
              </div>
            </>
          )}
        </div>
      </div>
      <TransferDialog open={transfer} onOpenChange={setTransfer} />
      <ExpenseDialog open={expense} onOpenChange={setExpense} />
    </>
  );
}

function AccountPanel({ account: a }: { account: BankAccountSummary }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const positive = a.byProperty.filter(p => p.balance > 0);
  const whole = positive.reduce((s, p) => s + p.balance, 0) || 1;
  const open = () => navigate(`/accounting/banking/${a.id}`);
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-2xs">
      <button type="button" onClick={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left hover:bg-accent/40">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground"><Landmark className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium">{a.name}</span>
            {!a.active && <Pill tone="neutral">Inactive</Pill>}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            <span className="num">{a.number}</span>
            {a.bankName ? ` · ${a.bankName}` : ''}
            {a.accountLast4 ? ` ··${a.accountLast4}` : ''}
          </span>
        </span>
        <span className="hidden text-right text-sm text-muted-foreground sm:block">
          {a.inProgress ? (
            <Pill tone="warning"><Scale className="h-3 w-3" /> Reconciling {fullDate(a.inProgress.statementDate)}</Pill>
          ) : a.lastReconciliation ? (
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-tone-success" /> Reconciled through {fullDate(a.lastReconciliation.statementDate)}</span>
          ) : (
            'Never reconciled'
          )}
          <span className="block">{a.uncleared.count ? `${plural(a.uncleared.count, 'uncleared transaction')}` : 'Everything has cleared'}</span>
        </span>
        <Money value={a.balance} className="text-[18px] font-semibold tracking-tight" />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
      {positive.length > 0 && (
        <div className="border-t px-4 pb-3 pt-2.5">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {positive.map(p => <span key={p.propertyId ?? 'none'} style={{ width: `${(p.balance / whole) * 100}%`, background: ws.propertyById.get(p.propertyId ?? '')?.color ?? 'hsl(var(--muted-foreground))' }} className="h-full border-r border-card last:border-r-0" />)}
          </div>
          <ul className="mt-2.5 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {a.byProperty.map(p => (
              <li key={p.propertyId ?? 'none'} className="flex min-w-0 items-center gap-2 text-[14px]">
                <PropertySwatch color={ws.propertyById.get(p.propertyId ?? '')?.color} />
                <span className="min-w-0 flex-1 truncate">{p.propertyId ? ws.propertyName(p.propertyId) || 'Removed property' : 'No property'}</span>
                <Money value={p.balance} className={p.balance < 0 ? 'text-tone-danger' : 'text-muted-foreground'} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
