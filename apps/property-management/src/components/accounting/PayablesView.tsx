import { useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, Building2, Download, FileText, Lock, Plus, Receipt, Wrench } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { dueLabel, fullDate, plural, shortDate } from '../../lib/format';
import { useCollapsedGroups, useListState } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, type FilterDef } from '../list/Filters';
import { GroupedList, RowShell, type ListGroup } from '../list/GroupedList';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { useDocumentTitle } from '../shell/PageHeader';
import { RANGE_OPTIONS, rangeFor, useBillPayments, useBills, type BillPaymentRow, type BillRow, type BillStatus, type RangePreset } from './accountingData';
import { afterPosting } from './ledgerData';
import { VoidDialog, type VoidTarget } from './LedgerDialogs';
import { PayBillsDialog } from './PayBillsDialog';
import { AccountingHeader, bankLabel, HeaderButton, menuItem, menuItemDanger, RowMenu, SortHeader, useSorted } from './parts';
import { TransactionSheet } from './TransactionSheet';

type View = 'bills' | 'payments';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'all', label: 'All' },
] as const;

const sumOf = <T,>(rows: T[], pick: (r: T) => number) => Math.round(rows.reduce((s, r) => s + Math.round(pick(r) * 100), 0)) / 100;

/** Payables: vendor bills (open, overdue, paid) grouped by when they're due, and the payments made. */
export function PayablesView() {
  const ws = useWorkspace();
  const app = useAppActions();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'payments' ? 'payments' : 'bills';
  useDocumentTitle(view === 'payments' ? 'Bill payments' : 'Payables');
  const [payOpen, setPayOpen] = useState<string[] | null>(null);
  const canPay = ws.can('payables.manage');
  const switcher = <Segmented size="sm" value={view} onChange={v => setParams(v === 'bills' ? {} : { view: v }, { replace: true })} options={[{ value: 'bills', label: 'Bills' }, { value: 'payments', label: 'Payments' }]} className="mr-1" />;

  return (
    <>
      <AccountingHeader
        tab="payables"
        actions={
          canPay && (
            <>
              <HeaderButton icon={<Banknote />} label="Pay bills" onClick={() => setPayOpen([])} />
              <HeaderButton primary icon={<Plus />} label="New bill" onClick={() => app.openCreate('bill')} />
            </>
          )
        }
      />
      {view === 'bills' ? <BillsList switcher={switcher} onPay={ids => setPayOpen(ids)} payOpen={payOpen !== null} /> : <BillPaymentsList switcher={switcher} />}
      <PayBillsDialog billIds={payOpen} onOpenChange={o => !o && setPayOpen(null)} />
    </>
  );
}

// ── Bills ────────────────────────────────────────────────────────────────────

function billState(b: BillRow, today: string): { label: string; tone: 'neutral' | 'danger' | 'warning' | 'success' | 'info' } {
  if (b.status === 'Void') return { label: 'Void', tone: 'neutral' };
  if (b.open <= 0.004) return { label: 'Paid', tone: 'success' };
  if (b.dueDate && b.dueDate < today) return { label: b.paid > 0 ? 'Part paid · overdue' : 'Overdue', tone: 'danger' };
  if (b.paid > 0) return { label: 'Part paid', tone: 'info' };
  return { label: 'Open', tone: 'neutral' };
}

function groupBills(rows: BillRow[], status: BillStatus, today: string): ListGroup<BillRow>[] {
  if (status === 'open' || status === 'overdue') {
    const week = new Date(`${today}T00:00:00Z`);
    week.setUTCDate(week.getUTCDate() + 7);
    const weekEnd = week.toISOString().slice(0, 10);
    const buckets: Array<{ key: string; label: string; test: (b: BillRow) => boolean }> = [
      { key: 'overdue', label: 'Overdue', test: b => Boolean(b.dueDate && b.dueDate < today) },
      { key: 'week', label: 'Due in the next 7 days', test: b => Boolean(b.dueDate && b.dueDate >= today && b.dueDate <= weekEnd) },
      { key: 'later', label: 'Due later', test: b => Boolean(b.dueDate && b.dueDate > weekEnd) },
      { key: 'none', label: 'No due date', test: b => !b.dueDate },
    ];
    return buckets
      .map(g => {
        const items = rows.filter(g.test).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.number - b.number);
        return { key: g.key, label: g.label, items, hint: <Money value={sumOf(items, b => b.open)} /> };
      })
      .filter(g => g.items.length);
  }
  const byMonth = new Map<string, BillRow[]>();
  for (const b of [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number)) {
    const k = b.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), b]);
  }
  return [...byMonth.entries()].map(([k, items]) => ({ key: k, label: new Date(`${k}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), items, hint: <Money value={sumOf(items, b => b.amount)} /> }));
}

function BillsList({ switcher, onPay, payOpen }: { switcher: ReactNode; onPay: (ids: string[]) => void; payOpen: boolean }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const list = useListState('accounting:bills', { layout: 'list', grouping: 'due', ordering: 'due', properties: [], showEmptyGroups: false, showClosed: false }, { status: 'open' });
  const { filters, setFilters } = list;
  const status = (typeof filters.status === 'string' ? filters.status : 'open') as BillStatus;
  const propertyIds = Array.isArray(filters.propertyIds) ? (filters.propertyIds as string[]) : [];
  const vendorIds = Array.isArray(filters.vendorIds) ? (filters.vendorIds as string[]) : [];
  const search = typeof filters.search === 'string' ? filters.search : '';
  const { data, isPending, isError, error, refetch, isFetching } = useBills({ status, propertyIds: propertyIds.length ? propertyIds : undefined, vendorIds: vendorIds.length ? vendorIds : undefined, search: search || undefined });
  const rows = data?.bills ?? [];
  const today = data?.today ?? ws.today;
  const groups = useMemo(() => groupBills(rows, status, today), [rows, status, today]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups(`accounting:bills:${status}`);
  const visible = useMemo(() => groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items)), [groups, collapsed]);
  const open = useCallback((b: BillRow) => navigate(`/accounting/payables/${b.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: b => b.id, onOpen: open, enabled: !payOpen });
  const { selection, selected, focusedId, selecting, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;
  const canPay = ws.can('payables.manage');
  const payable = selected.filter(b => b.status === 'Posted' && b.open > 0.004);

  const filterDefs: FilterDef[] = useMemo(() => [
    listFilter('vendorIds', 'Vendor', <Wrench />, () => ws.vendors.map(v => ({ value: v.id, label: v.name, keywords: [v.trade] }))),
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> }))),
  ], [ws]);
  const hasFilter = propertyIds.length > 0 || vendorIds.length > 0 || Boolean(search);
  const exportCsv = () => downloadCsv(`bills-${status}`, ['Bill', 'Vendor', 'Property', 'Reference', 'Description', 'Date', 'Due', 'Amount', 'Paid', 'Open', 'Status', 'Work order'], rows.map(b => [b.number, b.vendorName ?? '', b.propertyCount > 1 ? `${b.propertyCount} properties` : ws.propertyName(b.propertyId), b.reference ?? '', b.description, b.date, b.dueDate ?? '', b.amount, b.paid, b.open, billState(b, today).label, b.workOrderNumber ? workOrderRef(b.workOrderNumber) : '']));

  const content = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Bills didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length) {
      if (hasFilter) return <EmptyState className="py-20" icon={<Receipt />} title="Nothing matches" description="No bills match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({ status })}>Clear filters</button>} />;
      return (
        <EmptyState
          className="py-20"
          icon={<Receipt />}
          title={status === 'open' ? 'No unpaid bills' : status === 'overdue' ? 'Nothing is overdue' : status === 'paid' ? 'No paid bills yet' : 'No bills yet'}
          description={status === 'open' || status === 'overdue' ? 'Vendor bills you enter — or that come from work orders — wait here until they’re paid.' : 'Bills show up here once they’re entered.'}
          action={canPay ? <NewBillButton /> : undefined}
        />
      );
    }
    return (
      <GroupedList
        label="Bills"
        groups={groups}
        getId={b => b.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={canPay ? g => setSelection(prev => new Set([...prev, ...g.items.map(b => b.id)])) : undefined}
        renderRow={b => {
          const state = billState(b, today);
          const due = dueLabel(b.dueDate);
          return (
            <RowShell id={b.id} selected={selection.has(b.id)} focused={focusedId === b.id} selecting={selecting} onClick={e => onRowClick(b, e)} onHover={() => onHover(b)} onToggleSelect={e => toggleSelect(b, e)} muted={b.status === 'Void'}>
              <span className="hidden w-[52px] shrink-0 text-[13.5px] tabular-nums text-muted-foreground sm:inline">#{b.number}</span>
              <span className={cn('min-w-0 shrink truncate font-medium', b.status === 'Void' && 'line-through decoration-muted-foreground/50')}>{b.vendorName ?? 'No vendor'}</span>
              <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">{b.description}</span>
              {b.attachmentUrl && <Tip label="Invoice attached"><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" /></Tip>}
              <span className="min-w-4 flex-1" />
              <span className="hidden min-w-0 items-center gap-2 md:flex">
                {b.reference && <span className="hidden max-w-[110px] truncate text-sm text-muted-foreground xl:inline">{b.reference}</span>}
                {b.workOrderNumber != null && (
                  <button type="button" onClick={e => { e.stopPropagation(); navigate(`/work-orders/${b.workOrderNumber}`); }} className="chip max-w-[110px] hover:bg-accent">
                    <Wrench className="h-3 w-3 text-muted-foreground" /> <span className="truncate">{workOrderRef(b.workOrderNumber)}</span>
                  </button>
                )}
                <span className="chip max-w-[170px]">
                  {b.propertyCount > 1 ? <><Building2 className="h-3 w-3 text-muted-foreground" /><span className="truncate">{b.propertyCount} properties</span></> : <><PropertySwatch color={ws.propertyById.get(b.propertyId ?? '')?.color} /><span className="truncate">{ws.propertyName(b.propertyId)}</span></>}
                </span>
                {state.label !== 'Open' && state.label !== 'Overdue' && <Pill tone={state.tone}>{state.label}</Pill>}
              </span>
              {b.status === 'Posted' && b.open > 0.004 && b.dueDate ? (
                <Tip label={`Due ${fullDate(b.dueDate)}`}>
                  <span className={cn('w-[72px] shrink-0 whitespace-nowrap text-right text-sm tabular-nums sm:w-[88px]', due?.tone === 'overdue' ? 'text-tone-danger' : due?.tone === 'soon' ? 'text-tone-warning' : 'text-muted-foreground')}>{due?.tone === 'overdue' ? <><span className="hidden sm:inline">Overdue </span>{shortDate(b.dueDate)}</> : due?.label}</span>
                </Tip>
              ) : (
                <span className="hidden w-[88px] shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:inline">{shortDate(b.date)}</span>
              )}
              <span className="w-[88px] shrink-0 text-right sm:w-[104px]">
                {b.status === 'Posted' && b.open > 0.004 && b.open < b.amount - 0.004 ? (
                  <Tip label={`${ws.money(b.open)} left of ${ws.money(b.amount)}`}><span><Money value={b.open} className="font-medium" /></span></Tip>
                ) : (
                  <Money value={b.status === 'Posted' && b.open > 0.004 ? b.open : b.amount} className={cn('font-medium', (b.status === 'Void' || b.open <= 0.004) && 'text-muted-foreground', b.status === 'Void' && 'line-through')} />
                )}
              </span>
            </RowShell>
          );
        }}
      />
    );
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            {switcher}
            <Segmented size="sm" value={status} onChange={v => { clearSelection(); setFilters(f => ({ ...f, status: v })); }} options={STATUS_OPTIONS} />
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['bill', 'bills']}
        search={search}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search vendor, invoice #, bill #…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} onSelect={exportCsv} disabled={!rows.length}><Download /> Export CSV</DropdownMenuItem>}
      />
      {rows.length > 0 && (status === 'open' || status === 'overdue') && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b px-4 py-2 text-sm text-muted-foreground">
          <span>Unpaid <Money value={sumOf(rows, b => b.open)} className="font-medium text-foreground" /></span>
          <span>Overdue <Money value={sumOf(rows.filter(b => b.dueDate && b.dueDate < today), b => b.open)} className={cn('font-medium', rows.some(b => b.dueDate && b.dueDate < today) ? 'text-tone-danger' : 'text-foreground')} /></span>
          <span>{plural(new Set(rows.map(b => b.vendorId)).size, 'vendor')}</span>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      {data?.truncated && <p className="border-t px-4 py-2 text-center text-sm text-muted-foreground">Showing the newest 1,000 bills. Filter by vendor or property to see older ones.</p>}
      <BulkBar count={selected.length} noun={['bill', 'bills']} onClear={clearSelection}>
        {canPay && (
          <button type="button" className={bulkButton} disabled={!payable.length} onClick={() => onPay(payable.map(b => b.id))}>
            <Banknote /> Pay {payable.length ? <Money value={sumOf(payable, b => b.open)} /> : ''}
          </button>
        )}
      </BulkBar>
    </div>
  );
}

function NewBillButton() {
  const app = useAppActions();
  return (
    <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('bill')}>
      <Plus className="h-3.5 w-3.5" /> New bill
    </button>
  );
}

// ── Payments made ────────────────────────────────────────────────────────────

function BillPaymentsList({ switcher }: { switcher: ReactNode }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const list = useListState('accounting:billPayments', { layout: 'table', grouping: 'none', ordering: 'date', properties: [], showEmptyGroups: false, showClosed: false }, { range: '90' });
  const { filters, setFilters } = list;
  const range = (typeof filters.range === 'string' ? filters.range : '90') as RangePreset;
  const vendorIds = Array.isArray(filters.vendorIds) ? (filters.vendorIds as string[]) : [];
  const search = typeof filters.search === 'string' ? filters.search : '';
  const includeVoid = filters.includeVoid === true;
  const { data, isPending, isError, error, refetch, isFetching } = useBillPayments({ ...rangeFor(range, ws.today), vendorIds: vendorIds.length ? vendorIds : undefined, search: search || undefined, includeVoid: includeVoid || undefined });
  const rows = data?.payments ?? [];
  const [sheet, setSheet] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const canVoid = ws.can('payables.manage');
  const sorters = useMemo(() => ({
    date: (p: BillPaymentRow) => `${p.date}-${String(p.number).padStart(8, '0')}`,
    vendor: (p: BillPaymentRow) => p.vendorName,
    method: (p: BillPaymentRow) => p.paymentMethod,
    amount: (p: BillPaymentRow) => p.amount,
  }), []);
  const { sorted, sort, toggle } = useSorted(rows, sorters, { key: 'date', dir: 'desc' });
  const nav = useListNav({ items: sorted, getId: p => p.id, onOpen: p => setSheet(p.id), enabled: !sheet && !voidTarget });
  const head = (label: string, key: string, numeric?: boolean) => <SortHeader label={label} sortKey={key} sort={sort} onToggle={toggle} align={numeric ? 'right' : undefined} numeric={numeric} />;
  const posted = rows.filter(p => p.status === 'Posted');
  const filterDefs: FilterDef[] = useMemo(() => [listFilter('vendorIds', 'Vendor', <Wrench />, () => ws.vendors.map(v => ({ value: v.id, label: v.name, keywords: [v.trade] })))], [ws]);

  const columns: Column<BillPaymentRow>[] = [
    { key: 'date', header: head('Date', 'date'), width: 112, hideBelow: 'sm', cell: p => <span className="whitespace-nowrap tabular-nums">{fullDate(p.date)}</span> },
    { key: 'number', header: 'Payment', width: 84, hideBelow: 'sm', cell: p => <span className="tabular-nums text-muted-foreground">#{p.number}</span> },
    {
      key: 'vendor',
      header: head('Vendor', 'vendor'),
      cell: p => (
        <span className={cn('flex min-w-0 max-w-[320px] flex-col py-1 leading-tight', p.status === 'Void' && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
          <span className="truncate font-medium">{p.vendorName ?? 'No vendor'}</span>
          <span className="truncate text-sm text-muted-foreground"><span className="sm:hidden">{shortDate(p.date)} · </span>{p.billNumbers ? `Bill${p.billNumbers.includes(',') ? 's' : ''} #${p.billNumbers.replace(/, /g, ', #')}` : p.description}</span>
        </span>
      ),
      footer: <span className="text-sm text-muted-foreground">{plural(posted.length, 'payment')}</span>,
    },
    { key: 'method', header: head('Method', 'method'), width: 160, hideBelow: 'md', cell: p => <span className="text-muted-foreground">{p.paymentMethod ?? '—'}{p.reference ? <span className="text-foreground/80"> · {p.paymentMethod === 'Check' ? `#${p.reference}` : p.reference}</span> : ''}</span> },
    { key: 'bank', header: 'Paid from', hideBelow: 'lg', cell: p => <span className="block max-w-[220px] truncate text-muted-foreground">{bankLabel(ws.accountById.get(p.bankAccountId ?? ''))}</span> },
    { key: 'amount', header: head('Amount', 'amount', true), align: 'right', width: 124, cell: p => <span className="inline-flex items-center justify-end gap-1.5">{p.reconciled && <Tip label="Cleared the bank"><Lock className="h-3 w-3 text-tone-success" /></Tip>}{p.status === 'Void' && <Pill tone="neutral">Void</Pill>}<Money value={p.amount} className={cn('font-medium', p.status === 'Void' && 'text-muted-foreground line-through')} /></span>, footer: <Money value={sumOf(posted, p => p.amount)} /> },
    {
      key: 'menu',
      header: <span className="sr-only">Actions</span>,
      width: 44,
      cell: p => (
        <RowMenu label={`Actions for payment #${p.number}`}>
          <DropdownMenuItem className={menuItem} onSelect={() => setSheet(p.id)}><Receipt /> View payment</DropdownMenuItem>
          {canVoid && p.status === 'Posted' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuItemDanger} onSelect={() => setVoidTarget({ id: p.id, number: p.number, kind: 'Bill payment', amount: p.amount, description: `${p.vendorName ?? 'Vendor'}${p.reference ? ` · ${p.reference}` : ''}` })}><Ban /> Void…</DropdownMenuItem>
            </>
          )}
        </RowMenu>
      ),
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            {switcher}
            <Segmented size="sm" value={range} onChange={v => setFilters(f => ({ ...f, range: v }))} options={RANGE_OPTIONS} />
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
            <button type="button" onClick={() => setFilters(f => ({ ...f, includeVoid: !includeVoid || undefined }))} className={cn('ghost-chip h-8 text-sm', includeVoid && 'bg-accent text-foreground')}>{includeVoid ? 'Hide voided' : 'Show voided'}</button>
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['payment', 'payments']}
        search={search}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search vendor, check #…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} disabled={!rows.length} onSelect={() => downloadCsv('bill-payments', ['Date', 'Payment', 'Vendor', 'Bills', 'Method', 'Reference', 'Paid from', 'Amount', 'Status'], sorted.map(p => [p.date, p.number, p.vendorName ?? '', p.billNumbers, p.paymentMethod ?? '', p.reference ?? '', ws.accountById.get(p.bankAccountId ?? '')?.name ?? '', p.amount, p.status]))}><Download /> Export CSV</DropdownMenuItem>}
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={10} className="px-3 pt-2" />
        ) : isError ? (
          <EmptyState className="py-20" title="Payments didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          vendorIds.length || search ? (
            <EmptyState className="py-20" icon={<Banknote />} title="Nothing matches" description="No payments match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({ range })}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<Banknote />} title="No bill payments in this period" description="Checks and ACH payments to vendors show up here." action={range !== 'all' ? <button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, range: 'all' }))}>Show all payments</button> : undefined} />
          )
        ) : (
          <DataTable rows={sorted} columns={columns} getId={p => p.id} onRowClick={p => setSheet(p.id)} focusedId={nav.focusedId} onHover={nav.onHover} className="pb-24" caption="Bill payments" />
        )}
      </div>
      <TransactionSheet id={sheet} onClose={() => setSheet(null)} />
      <VoidDialog target={voidTarget} onOpenChange={o => !o && setVoidTarget(null)} onVoided={() => afterPosting(qc)} />
    </div>
  );
}
