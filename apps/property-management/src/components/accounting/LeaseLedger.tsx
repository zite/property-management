import { Ban, Download, HandCoins, MoreHorizontal, Plus, Receipt, Undo2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { ordinal } from '@project/shared/merge';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { fullDate, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill } from '../primitives/glyphs';
import { DepositDialog, VoidDialog, type DepositAction, type VoidTarget } from './LedgerDialogs';
import { KIND_LABEL, useLeaseLedger, type LedgerEntry } from './ledgerData';

type Filter = 'all' | 'open' | 'charges' | 'payments';

/**
 * A lease's ledger as a resident statement: balance, past due and deposit up
 * top; every entry newest first with its running balance; voids struck
 * through. Money actions sit on the header so the page that shows the
 * balance is where you fix it.
 */
export function LeaseLedger({ leaseId, className, hideActions }: { leaseId: string; className?: string; hideActions?: boolean }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { data, isPending, isError, error } = useLeaseLedger(leaseId);
  const [filter, setFilter] = useState<Filter>('all');
  const [showVoid, setShowVoid] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [deposit, setDeposit] = useState<DepositAction | null>(null);
  const canPost = ws.can('receivables.manage') && !hideActions;

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.entries]
      .filter(e => showVoid || e.status !== 'Void')
      .filter(e => {
        if (filter === 'open') return (e.open ?? 0) > 0.004 || (e.unapplied ?? 0) > 0.004;
        if (filter === 'charges') return e.effect > 0 || e.kind === 'Charge';
        if (filter === 'payments') return e.effect < 0 || ['Payment', 'Credit', 'Deposit application'].includes(e.kind);
        return true;
      })
      .reverse();
  }, [data, filter, showVoid]);

  if (isPending) return <SkeletonRows rows={8} className={className} />;
  if (isError || !data) return <EmptyState className={className} title="The ledger didn’t load" description={errorMessage(error, 'Try again in a moment.')} />;
  const voidCount = data.entries.filter(e => e.status === 'Void').length;

  const exportCsv = () =>
    downloadCsv(
      `ledger-${(data.lease?.name ?? 'lease').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      ['Date', 'Number', 'Type', 'Description', 'Charges', 'Payments & credits', 'Balance', 'Status', 'Reference'],
      data.entries.map(e => [e.date, e.number, KIND_LABEL[e.kind] ?? e.kind, e.description, e.effect > 0 ? e.effect : '', e.effect < 0 ? -e.effect : '', e.runningBalance, e.status, e.reference ?? '']),
    );

  const columns: Column<LedgerEntry>[] = [
    { key: 'date', header: 'Date', width: 116, cell: e => <span className="whitespace-nowrap tabular-nums">{fullDate(e.date)}</span> },
    {
      key: 'description',
      header: 'Description',
      cell: e => (
        <span className={cn('flex min-w-0 items-center gap-2', e.status === 'Void' && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
          <span className="w-[74px] shrink-0 text-sm text-muted-foreground">{KIND_LABEL[e.kind] ?? e.kind}</span>
          <span className="min-w-0 truncate">{e.description}</span>
          {e.reference && <span className="hidden shrink-0 text-sm text-muted-foreground lg:inline">#{e.reference}</span>}
          {e.paymentMethod && e.kind === 'Payment' && !e.description.includes(e.paymentMethod) && <span className="hidden shrink-0 text-sm text-muted-foreground xl:inline">{e.paymentMethod}</span>}
          {e.workOrderId && (
            <Tip label="From a work order">
              <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
            </Tip>
          )}
          {e.status === 'Void' && (
            <Tip label={e.voidReason ?? 'Voided'}>
              <span className="no-underline"><Pill tone="neutral">Void</Pill></span>
            </Tip>
          )}
          {e.status === 'Posted' && (e.open ?? 0) > 0.004 && e.dueDate && e.dueDate < ws.today && <Pill tone="danger">Past due</Pill>}
          {e.status === 'Posted' && (e.open ?? 0) > 0.004 && (e.open ?? 0) < e.amount - 0.004 && <span className="shrink-0 text-sm text-muted-foreground"><Money value={e.open} /> open</span>}
          {e.status === 'Posted' && (e.unapplied ?? 0) > 0.004 && <span className="shrink-0 text-sm text-tone-success"><Money value={e.unapplied} /> unapplied</span>}
        </span>
      ),
    },
    { key: 'charges', header: 'Charges', align: 'right', width: 110, cell: e => (e.effect > 0 || (e.status === 'Void' && e.kind === 'Charge') ? <Money value={e.status === 'Void' ? e.amount : e.effect} className={cn(e.status === 'Void' && 'text-muted-foreground line-through')} /> : null) },
    { key: 'credits', header: 'Payments', align: 'right', width: 110, cell: e => (e.effect < 0 || (e.status === 'Void' && e.kind !== 'Charge') ? <Money value={e.status === 'Void' ? e.amount : -e.effect} className={cn(e.status === 'Void' ? 'text-muted-foreground line-through' : 'text-tone-success')} /> : null) },
    { key: 'balance', header: 'Balance', align: 'right', width: 116, cell: e => (e.status === 'Void' ? null : <Money value={e.runningBalance} className="font-medium" />), hideBelow: 'sm' },
    {
      key: 'menu',
      header: <span className="sr-only">Actions</span>,
      width: 40,
      cell: e =>
        canPost && e.status === 'Posted' && e.kind !== 'Journal entry' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" aria-label={`Actions for #${e.number}`} className="opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100" onClick={ev => ev.stopPropagation()}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {e.kind === 'Charge' && (e.open ?? 0) > 0.004 && (
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('credit', { leaseId, chargeId: e.id, amount: e.open, description: `Waived: ${e.description}` })}>
                  <Undo2 className="h-3.5 w-3.5" /> Waive remaining
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => setVoidTarget({ id: e.id, number: e.number, kind: KIND_LABEL[e.kind] ?? e.kind, amount: e.amount, description: e.description })}>
                <Ban className="h-3.5 w-3.5" /> Void…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Summary label="Balance" hint={data.balance < -0.004 ? 'In credit' : data.balance > 0.004 ? 'Owed' : 'Paid up'}>
          <Money value={data.balance} tone="balance" />
        </Summary>
        <Summary label="Past due">{data.pastDue > 0 ? <Money value={data.pastDue} className="text-tone-danger" /> : <span className="text-muted-foreground">—</span>}</Summary>
        <Summary label="Deposit held" hint={data.lease?.deposit ? `of ${ws.money(data.lease.deposit, { cents: false })} required` : undefined}>
          <Money value={data.depositHeld} />
        </Summary>
        <Summary label="Unapplied credit">{data.unappliedCredit > 0 ? <Money value={data.unappliedCredit} className="text-tone-success" /> : <span className="text-muted-foreground">—</span>}</Summary>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={filter}
          onChange={v => setFilter(v as Filter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'charges', label: 'Charges' },
            { value: 'payments', label: 'Payments' },
          ]}
        />
        {voidCount > 0 && (
          <button type="button" onClick={() => setShowVoid(v => !v)} className={cn('ghost-chip h-8 text-sm', showVoid && 'bg-accent text-foreground')}>
            {showVoid ? 'Hide' : 'Show'} {voidCount} voided
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {canPost && (
            <>
              <button type="button" onClick={() => app.openCreate('payment', { leaseId })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <HandCoins className="h-3.5 w-3.5" /> Receive payment
              </button>
              <button type="button" onClick={() => app.openCreate('charge', { leaseId })} className="ghost-chip h-8 text-[13.5px]"><Plus className="h-3.5 w-3.5" /> Charge</button>
              <button type="button" onClick={() => app.openCreate('credit', { leaseId })} className="ghost-chip h-8 text-[13.5px]"><Receipt className="h-3.5 w-3.5" /> Credit</button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More ledger actions"><MoreHorizontal /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canPost && (
                <>
                  <DropdownMenuItem className="h-9 gap-2 text-[14px]" disabled={data.depositHeld <= 0} onSelect={() => setDeposit('applyDeposit')}>Apply deposit to balance</DropdownMenuItem>
                  <DropdownMenuItem className="h-9 gap-2 text-[14px]" disabled={data.depositHeld <= 0} onSelect={() => setDeposit('refundDeposit')}>Return deposit</DropdownMenuItem>
                  <DropdownMenuItem className="h-9 gap-2 text-[14px]" disabled={data.unappliedCredit <= 0} onSelect={() => setDeposit('refundCredit')}>Refund credit balance</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border">
        <DataTable
          rows={rows}
          columns={columns}
          getId={e => e.id}
          stickyHeader={false}
          dense
          caption="Lease ledger"
          empty={<p className="px-4 py-10 text-center text-[14px] text-muted-foreground">{filter === 'all' ? 'Nothing posted yet.' : 'Nothing matches.'}</p>}
        />
      </div>
      {data.recurring.some(r => r.active) && (
        <p className="mt-2 text-sm text-muted-foreground">
          Bills automatically:{' '}
          {data.recurring.filter(r => r.active).map((r, i) => (
            <span key={r.id}>
              {i > 0 && ' · '}
              {r.description} <Money value={r.amount} /> {r.frequency.toLowerCase()} on the {ordinal(r.dayOfMonth)}
              {r.endDate ? ` until ${shortDate(r.endDate)}` : ''}
            </span>
          ))}
        </p>
      )}

      <VoidDialog target={voidTarget} onOpenChange={o => !o && setVoidTarget(null)} />
      <DepositDialog action={deposit} leaseId={leaseId} onOpenChange={o => !o && setDeposit(null)} />
    </div>
  );
}

function Summary({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold leading-7 tracking-tight">{children}</div>
      {hint && <div className="text-sm text-muted-foreground">{hint}</div>}
    </div>
  );
}
