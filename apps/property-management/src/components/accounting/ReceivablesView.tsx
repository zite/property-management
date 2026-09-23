import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, BookOpen, Building2, Download, HandCoins, Mail, MessageSquare, Plus, Receipt, Wallet } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { sendLateNotices } from 'zitejs/api';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { fullDate, plural, shortDate, timeAgo } from '../../lib/format';
import { useListState } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, type FilterDef } from '../list/Filters';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { useDocumentTitle } from '../shell/PageHeader';
import { RANGE_OPTIONS, rangeFor, usePayments, useReceivables, type PaymentRow, type RangePreset, type ReceivableLease } from './accountingData';
import { BulkChargeDialog } from './BulkChargeDialog';
import { afterPosting } from './ledgerData';
import { VoidDialog, type VoidTarget } from './LedgerDialogs';
import { AccountingHeader, bankLabel, HeaderButton, menuItem, menuItemDanger, RowMenu, SortHeader, SummaryStrip, useSorted } from './parts';
import { TransactionSheet } from './TransactionSheet';

type View = 'aging' | 'payments' | 'deposits';
type Show = 'owing' | 'pastDue' | 'credit' | 'all';

const VIEWS = [
  { value: 'aging', label: 'Aging' },
  { value: 'payments', label: 'Payments' },
  { value: 'deposits', label: 'Deposits held' },
] as const;

const sumOf = <T,>(rows: T[], pick: (r: T) => number) => Math.round(rows.reduce((s, r) => s + Math.round(pick(r) * 100), 0)) / 100;

/**
 * Receivables: who owes what and for how long (aging), the payments register,
 * and deposits held — with posting, late notices and messages on every row and
 * in bulk.
 */
export function ReceivablesView() {
  const ws = useWorkspace();
  const app = useAppActions();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'payments' ? 'payments' : params.get('view') === 'deposits' ? 'deposits' : 'aging';
  useDocumentTitle(view === 'payments' ? 'Payments received' : view === 'deposits' ? 'Deposits held' : 'Receivables');
  const [bulk, setBulk] = useState<string[] | null>(null);
  const canPost = ws.can('receivables.manage');

  const switcher = (
    <Segmented size="sm" value={view} onChange={v => setParams(v === 'aging' ? {} : { view: v }, { replace: true })} options={VIEWS} className="mr-1" />
  );

  return (
    <>
      <AccountingHeader
        tab="receivables"
        actions={
          canPost && (
            <>
              <HeaderButton icon={<Plus />} label="Post charges" onClick={() => setBulk([])} />
              <HeaderButton primary icon={<HandCoins />} label="Receive payment" keys={['⇧', 'P']} onClick={() => app.openCreate('payment')} />
            </>
          )
        }
      />
      {view === 'aging' && <AgingTable switcher={switcher} onBulkCharge={ids => setBulk(ids)} dialogOpen={bulk !== null} />}
      {view === 'payments' && <PaymentsRegister switcher={switcher} />}
      {view === 'deposits' && <DepositsHeld switcher={switcher} />}
      <BulkChargeDialog leaseIds={bulk} onOpenChange={o => !o && setBulk(null)} />
    </>
  );
}

// ── Aging ────────────────────────────────────────────────────────────────────

function useLateNotices() {
  const app = useAppActions();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const send = async (leases: ReceivableLease[], enabled: boolean) => {
    if (sending) return;
    if (!enabled) {
      toast.error('Your Late notice template is turned off', { description: 'Turn it on in Settings → Email templates to send late notices.' });
      return;
    }
    const owing = leases.filter(l => l.balance > 0.004);
    if (!owing.length) {
      toast.error(leases.length === 1 ? 'This lease doesn’t owe anything' : 'None of these leases owe anything');
      return;
    }
    const ok = await app.confirm({
      title: owing.length === 1 ? `Send a late notice to ${owing[0].tenantNames || owing[0].name}?` : `Send late notices to ${owing.length} leases?`,
      description: `Emails your Late notice template with each balance${owing.length < leases.length ? ` — ${plural(leases.length - owing.length, 'lease')} with nothing owed will be skipped` : ''}. It also appears in their portal conversation.`,
      confirmLabel: owing.length === 1 ? 'Send notice' : 'Send notices',
    });
    if (!ok) return;
    setSending(true);
    const id = toast.loading(owing.length === 1 ? 'Sending late notice…' : `Sending ${owing.length} late notices…`);
    try {
      const res = await sendLateNotices({ leaseIds: owing.map(l => l.id) });
      void qc.invalidateQueries({ queryKey: ['accounting', 'receivables'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      const skipped = res.skipped.length ? `${res.skipped.slice(0, 2).map(s => `${s.name} ${s.reason}`).join('; ')}${res.skipped.length > 2 ? `; ${res.skipped.length - 2} more skipped` : ''}` : undefined;
      if (res.sent) toast.success(res.sent === 1 ? 'Late notice sent' : `Late notices sent to ${res.sent} leases`, { id, description: skipped });
      else toast.error('No late notices were sent', { id, description: skipped });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the late notices'), { id });
    } finally {
      setSending(false);
    }
  };
  return { send, sending };
}

function AgingTable({ switcher, onBulkCharge, dialogOpen }: { switcher: ReactNode; onBulkCharge: (leaseIds: string[]) => void; dialogOpen: boolean }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch, isFetching } = useReceivables();
  const list = useListState('accounting:receivables', { layout: 'table', grouping: 'none', ordering: 'balance', properties: [], showEmptyGroups: false, showClosed: false }, { show: 'owing' });
  const { filters, setFilters } = list;
  const show = (typeof filters.show === 'string' ? filters.show : 'owing') as Show;
  const search = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
  const propertyIds = Array.isArray(filters.propertyIds) ? (filters.propertyIds as string[]) : [];
  const canPost = ws.can('receivables.manage');
  const { send, sending } = useLateNotices();

  const inScope = useMemo(() => (data?.leases ?? []).filter(l => (!propertyIds.length || propertyIds.includes(l.propertyId ?? '')) && (!search || `${l.name} ${l.tenantNames} ${ws.unitLabel(l.unitId, l.propertyId)}`.toLowerCase().includes(search))), [data, propertyIds.join(','), search, ws]);
  const rows = useMemo(
    () => inScope.filter(l => (show === 'owing' ? l.balance > 0.004 : show === 'pastDue' ? l.pastDue > 0.004 : show === 'credit' ? l.balance < -0.004 : true)),
    [inScope, show],
  );
  const sorters = useMemo(() => ({
    lease: (l: ReceivableLease) => l.name,
    property: (l: ReceivableLease) => ws.unitLabel(l.unitId, l.propertyId),
    current: (l: ReceivableLease) => l.current,
    d30: (l: ReceivableLease) => l.days30,
    d60: (l: ReceivableLease) => l.days60,
    d90: (l: ReceivableLease) => l.days90,
    d90plus: (l: ReceivableLease) => l.days90plus,
    balance: (l: ReceivableLease) => l.balance,
    lastPayment: (l: ReceivableLease) => l.lastPaymentDate,
    notice: (l: ReceivableLease) => l.lastLateNoticeAt,
  }), [ws]);
  const { sorted, sort, toggle } = useSorted(rows, sorters, { key: 'balance', dir: 'desc' });

  const open = useCallback((l: ReceivableLease) => navigate(`/leases/${l.id}/ledger`), [navigate]);
  const nav = useListNav({ items: sorted, getId: l => l.id, onOpen: open, enabled: !dialogOpen });
  const { selection, selected, focusedId, onHover, toggleSelect, setSelection, clearSelection, scrollRef, onRowClick } = nav;

  const message = (leases: ReceivableLease[]) => {
    const recipients = leases.flatMap(l => l.tenants.filter(t => t.email).map(t => ({ kind: 'tenant' as const, id: t.id, name: t.name, email: t.email })));
    if (!recipients.length) return toast.error('No one on these leases has an email address');
    app.openCompose({ recipients, context: leases.length === 1 ? { leaseId: leases[0].id, propertyId: leases[0].propertyId ?? undefined } : undefined });
  };

  const filterDefs: FilterDef[] = useMemo(() => [listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> })))], [ws]);
  const totals = {
    owed: sumOf(inScope.filter(l => l.balance > 0), l => l.balance),
    pastDue: sumOf(inScope, l => l.pastDue),
    current: sumOf(inScope, l => l.current),
    d30: sumOf(inScope, l => l.days30),
    d60: sumOf(inScope, l => l.days60),
    d90: sumOf(inScope, l => l.days90),
    d90plus: sumOf(inScope, l => l.days90plus),
    credit: sumOf(inScope.filter(l => l.balance < 0), l => -l.balance),
  };
  const head = (label: string, key: string, numeric?: boolean) => <SortHeader label={label} sortKey={key} sort={sort} onToggle={toggle} align={numeric ? 'right' : undefined} numeric={numeric} />;
  const bucket = (v: number, danger?: boolean) => <Money value={v} muted0 className={cn(danger && v > 0.004 && 'text-tone-danger')} />;

  const columns: Column<ReceivableLease>[] = [
    {
      key: 'lease',
      header: head('Lease', 'lease'),
      cell: l => (
        <span className="flex min-w-0 max-w-[340px] flex-col py-1 leading-tight">
          <span className="truncate font-medium">{l.tenantNames || l.name}</span>
          <span className="truncate text-sm text-muted-foreground">{l.name}{l.status !== 'Active' ? ` · ${l.status.toLowerCase()}` : ''}</span>
        </span>
      ),
      footer: <span className="text-sm text-muted-foreground">{plural(rows.length, 'lease')}</span>,
    },
    { key: 'property', header: head('Unit', 'property'), hideBelow: 'lg', cell: l => <span className="inline-flex max-w-[200px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(l.unitId, l.propertyId)}</span></span> },
    { key: 'current', header: head('Current', 'current', true), align: 'right', width: 104, hideBelow: 'md', cell: l => bucket(l.current), footer: <Money value={sumOf(rows, l => l.current)} muted0 /> },
    { key: 'd30', header: head('1–30', 'd30', true), align: 'right', width: 104, hideBelow: 'md', cell: l => bucket(l.days30, true), footer: <Money value={sumOf(rows, l => l.days30)} muted0 /> },
    { key: 'd60', header: head('31–60', 'd60', true), align: 'right', width: 104, hideBelow: 'md', cell: l => bucket(l.days60, true), footer: <Money value={sumOf(rows, l => l.days60)} muted0 /> },
    { key: 'd90', header: head('61–90', 'd90', true), align: 'right', width: 104, hideBelow: 'lg', cell: l => bucket(l.days90, true), footer: <Money value={sumOf(rows, l => l.days90)} muted0 /> },
    { key: 'd90plus', header: head('90+', 'd90plus', true), align: 'right', width: 104, hideBelow: 'lg', cell: l => bucket(l.days90plus, true), footer: <Money value={sumOf(rows, l => l.days90plus)} muted0 /> },
    {
      key: 'balance',
      header: head('Balance', 'balance', true),
      align: 'right',
      width: 120,
      cell: l => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {Math.abs(l.adjustments) > 0.004 && <Tip label={`Includes ${ws.money(l.adjustments)} from journal entries`}><AlertTriangle className="h-3 w-3 text-tone-warning" /></Tip>}
          <Money value={l.balance} tone="balance" className="font-medium" />
        </span>
      ),
      footer: <Money value={sumOf(rows, l => l.balance)} tone="balance" />,
    },
    { key: 'lastPayment', header: head('Last payment', 'lastPayment'), hideBelow: 'xl', width: 172, cell: l => (l.lastPaymentDate ? <span className="whitespace-nowrap text-muted-foreground"><Money value={l.lastPaymentAmount} className="text-foreground" /> · {shortDate(l.lastPaymentDate)}</span> : <span className="text-muted-foreground">None yet</span>) },
    { key: 'notice', header: head('Late notice', 'notice'), hideBelow: 'xl', width: 110, cell: l => (l.lastLateNoticeAt ? <Tip label={`Sent ${fullDate(l.lastLateNoticeAt.slice(0, 10))}`}><span className="text-muted-foreground">{timeAgo(l.lastLateNoticeAt)}</span></Tip> : <span className="text-muted-foreground/70">—</span>) },
    {
      key: 'menu',
      header: <span className="sr-only">Actions</span>,
      width: 44,
      cell: l => (
        <RowMenu label={`Actions for ${l.name}`}>
          <DropdownMenuItem className={menuItem} onSelect={() => open(l)}><BookOpen /> Open ledger</DropdownMenuItem>
          {canPost && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuItem} onSelect={() => app.openCreate('payment', { leaseId: l.id })}><HandCoins /> Receive payment</DropdownMenuItem>
              <DropdownMenuItem className={menuItem} onSelect={() => app.openCreate('charge', { leaseId: l.id })}><Plus /> Post charge</DropdownMenuItem>
              <DropdownMenuItem className={menuItem} onSelect={() => app.openCreate('credit', { leaseId: l.id })}><Receipt /> Post credit</DropdownMenuItem>
              <DropdownMenuItem className={menuItem} disabled={l.balance <= 0 || sending} onSelect={() => void send([l], Boolean(data?.lateNoticeEnabled))}><Mail /> Send late notice</DropdownMenuItem>
            </>
          )}
          {ws.can('communications.send') && <DropdownMenuItem className={menuItem} onSelect={() => message([l])}><MessageSquare /> Message residents</DropdownMenuItem>}
        </RowMenu>
      ),
    },
  ];

  const exportCsv = () =>
    downloadCsv('receivables-aging', ['Lease', 'Residents', 'Property', 'Unit', 'Status', 'Current', '1-30', '31-60', '61-90', '90+', 'Unapplied credit', 'Balance', 'Deposit held', 'Last payment', 'Last late notice'],
      sorted.map(l => [l.name, l.tenantNames, ws.propertyName(l.propertyId), l.unitId ? ws.unitById.get(l.unitId)?.name ?? '' : '', l.status, l.current, l.days30, l.days60, l.days90, l.days90plus, l.unapplied, l.balance, l.depositHeld, l.lastPaymentDate ?? '', l.lastLateNoticeAt?.slice(0, 10) ?? '']));

  const hasFilter = propertyIds.length > 0 || Boolean(search);
  const content = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Receivables didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length) {
      if (hasFilter) return <EmptyState className="py-20" icon={<Wallet />} title="Nothing matches" description="No leases match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({ show })}>Clear filters</button>} />;
      if (show === 'owing' || show === 'pastDue') return <EmptyState className="py-20" icon={<Wallet />} title={show === 'owing' ? 'Everyone’s paid up' : 'Nothing is past due'} description="Residents with a balance show up here, aged by how late each charge is." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, show: 'all' }))}>Show all leases</button>} />;
      return <EmptyState className="py-20" icon={<Wallet />} title={show === 'credit' ? 'No one is in credit' : 'No leases yet'} description={show === 'credit' ? 'Leases where a resident has paid ahead show up here.' : 'Active leases appear here once they’re created.'} />;
    }
    return (
      <DataTable
        rows={sorted}
        columns={columns}
        getId={l => l.id}
        onRowClick={onRowClick}
        selection={canPost || ws.can('communications.send') ? selection : undefined}
        onToggleSelect={(l, e) => toggleSelect(l, e)}
        onSelectAll={all => setSelection(all ? new Set(sorted.map(l => l.id)) : new Set())}
        focusedId={focusedId}
        onHover={onHover}
        className="h-full pb-24"
        caption="Receivables aging"
      />
    );
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {data && (
        <SummaryStrip
          items={[
            { label: 'Owed to you', value: <Money value={totals.owed} />, onClick: () => setFilters(f => ({ ...f, show: 'owing' })), active: show === 'owing' },
            { label: 'Past due', value: <Money value={totals.pastDue} />, tone: totals.pastDue > 0 ? 'danger' : 'muted', onClick: () => setFilters(f => ({ ...f, show: 'pastDue' })), active: show === 'pastDue' },
            { label: '1–30 days', value: <Money value={totals.d30} />, tone: totals.d30 > 0 ? undefined : 'muted', secondary: true },
            { label: '31–60 days', value: <Money value={totals.d60} />, tone: totals.d60 > 0 ? 'warning' : 'muted', secondary: true },
            { label: '61–90 days', value: <Money value={totals.d90} />, tone: totals.d90 > 0 ? 'danger' : 'muted', secondary: true },
            { label: '90+ days', value: <Money value={totals.d90plus} />, tone: totals.d90plus > 0 ? 'danger' : 'muted', secondary: true },
            { label: 'Prepaid & credit', value: <Money value={totals.credit} />, tone: totals.credit > 0 ? 'success' : 'muted', onClick: () => setFilters(f => ({ ...f, show: 'credit' })), active: show === 'credit', secondary: true },
          ]}
        />
      )}
      <ListToolbar
        start={
          <>
            {switcher}
            <Segmented
              size="sm"
              value={show}
              onChange={v => setFilters(f => ({ ...f, show: v }))}
              options={[{ value: 'owing', label: 'Owes' }, { value: 'pastDue', label: 'Past due' }, { value: 'credit', label: 'In credit' }, { value: 'all', label: 'All' }]}
              className="hidden md:inline-flex"
            />
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['lease', 'leases']}
        search={search}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search resident, lease, unit…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} onSelect={exportCsv} disabled={!rows.length}><Download /> Export CSV</DropdownMenuItem>}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      <BulkBar count={selected.length} noun={['lease', 'leases']} onClear={clearSelection}>
        {canPost && <button type="button" className={bulkButton} onClick={() => onBulkCharge(selected.map(l => l.id))}><Plus /> Post charge</button>}
        {canPost && <button type="button" className={bulkButton} disabled={sending} onClick={() => void send(selected, Boolean(data?.lateNoticeEnabled))}><Mail /> Late notice</button>}
        {ws.can('communications.send') && <button type="button" className={bulkButton} onClick={() => message(selected)}><MessageSquare /> Message</button>}
      </BulkBar>
    </div>
  );
}

// ── Payments register ────────────────────────────────────────────────────────

function PaymentsRegister({ switcher }: { switcher: ReactNode }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useListState('accounting:payments', { layout: 'table', grouping: 'none', ordering: 'date', properties: [], showEmptyGroups: false, showClosed: false }, { range: '30' });
  const { filters, setFilters } = list;
  const range = (typeof filters.range === 'string' ? filters.range : '30') as RangePreset;
  const propertyIds = Array.isArray(filters.propertyIds) ? (filters.propertyIds as string[]) : [];
  const search = typeof filters.search === 'string' ? filters.search : '';
  const includeVoid = filters.includeVoid === true;
  const query = { ...rangeFor(range, ws.today), propertyIds: propertyIds.length ? propertyIds : undefined, search: search || undefined, includeVoid: includeVoid || undefined };
  const { data, isPending, isError, error, refetch, isFetching } = usePayments(query);
  const rows = data?.payments ?? [];
  const [sheet, setSheet] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const canVoid = ws.can('receivables.manage');

  const sorters = useMemo(() => ({
    date: (p: PaymentRow) => `${p.date}-${String(p.number).padStart(8, '0')}`,
    number: (p: PaymentRow) => p.number,
    resident: (p: PaymentRow) => p.tenantName ?? p.leaseName,
    method: (p: PaymentRow) => p.paymentMethod,
    bank: (p: PaymentRow) => ws.accountById.get(p.bankAccountId ?? '')?.name,
    amount: (p: PaymentRow) => p.amount,
    unapplied: (p: PaymentRow) => p.unapplied,
  }), [ws]);
  const { sorted, sort, toggle } = useSorted(rows, sorters, { key: 'date', dir: 'desc' });
  const nav = useListNav({ items: sorted, getId: p => p.id, onOpen: p => setSheet(p.id), enabled: !sheet && !voidTarget });
  const head = (label: string, key: string, numeric?: boolean) => <SortHeader label={label} sortKey={key} sort={sort} onToggle={toggle} align={numeric ? 'right' : undefined} numeric={numeric} />;
  const posted = rows.filter(p => p.status === 'Posted');

  const columns: Column<PaymentRow>[] = [
    { key: 'date', header: head('Date', 'date'), width: 112, hideBelow: 'sm', cell: p => <span className="whitespace-nowrap tabular-nums">{fullDate(p.date)}</span> },
    { key: 'number', header: head('Receipt', 'number'), width: 84, hideBelow: 'sm', cell: p => <span className="tabular-nums text-muted-foreground">#{p.number}</span> },
    {
      key: 'resident',
      header: head('Resident', 'resident'),
      cell: p => (
        <span className={cn('flex min-w-0 max-w-[320px] flex-col py-1 leading-tight', p.status === 'Void' && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
          <span className="truncate font-medium">{p.tenantName ?? p.leaseName ?? 'Resident'}</span>
          <span className="truncate text-sm text-muted-foreground"><span className="sm:hidden">{shortDate(p.date)} · </span>{p.leaseName}</span>
        </span>
      ),
      footer: <span className="text-sm text-muted-foreground">{plural(posted.length, 'payment')}</span>,
    },
    { key: 'method', header: head('Method', 'method'), width: 150, hideBelow: 'md', cell: p => <span className="text-muted-foreground">{p.paymentMethod ?? '—'}{p.reference ? <span className="text-foreground/80"> · {p.reference}</span> : ''}{p.source === 'Online payment' || p.source === 'Portal' ? <Pill tone="info" className="ml-1.5">Portal</Pill> : null}</span> },
    { key: 'bank', header: head('Deposited to', 'bank'), hideBelow: 'lg', cell: p => <span className="block max-w-[220px] truncate text-muted-foreground">{bankLabel(ws.accountById.get(p.bankAccountId ?? ''))}</span> },
    { key: 'unapplied', header: head('Unapplied', 'unapplied', true), align: 'right', width: 100, hideBelow: 'md', cell: p => (p.status === 'Void' ? <Pill tone="neutral">Void</Pill> : <Money value={p.unapplied} muted0 className={p.unapplied > 0 ? 'text-tone-success' : undefined} />), footer: <Money value={sumOf(posted, p => p.unapplied)} muted0 /> },
    { key: 'amount', header: head('Amount', 'amount', true), align: 'right', width: 116, cell: p => <Money value={p.amount} className={cn('font-medium', p.status === 'Void' && 'text-muted-foreground line-through')} />, footer: <Money value={sumOf(posted, p => p.amount)} /> },
    {
      key: 'menu',
      header: <span className="sr-only">Actions</span>,
      width: 44,
      cell: p => (
        <RowMenu label={`Actions for payment #${p.number}`}>
          <DropdownMenuItem className={menuItem} onSelect={() => setSheet(p.id)}><Receipt /> View payment</DropdownMenuItem>
          {p.leaseId && <DropdownMenuItem className={menuItem} onSelect={() => navigate(`/leases/${p.leaseId}/ledger`)}><BookOpen /> Open ledger</DropdownMenuItem>}
          {canVoid && p.status === 'Posted' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuItemDanger} onSelect={() => setVoidTarget({ id: p.id, number: p.number, kind: 'Payment', amount: p.amount, description: `${p.tenantName ?? p.leaseName ?? 'Payment'}${p.reference ? ` · ${p.reference}` : ''}` })}><Ban /> Void…</DropdownMenuItem>
            </>
          )}
        </RowMenu>
      ),
    },
  ];

  const exportCsv = () => downloadCsv('payments-received', ['Date', 'Receipt', 'Resident', 'Lease', 'Method', 'Reference', 'Deposited to', 'Amount', 'Unapplied', 'Status'], sorted.map(p => [p.date, p.number, p.tenantName ?? '', p.leaseName ?? '', p.paymentMethod ?? '', p.reference ?? '', ws.accountById.get(p.bankAccountId ?? '')?.name ?? '', p.amount, p.unapplied, p.status]));
  const filterDefs: FilterDef[] = useMemo(() => [listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> })))], [ws]);
  const hasFilter = propertyIds.length > 0 || Boolean(search);

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
        searchPlaceholder="Search resident, reference, receipt #…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} onSelect={exportCsv} disabled={!rows.length}><Download /> Export CSV</DropdownMenuItem>}
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={10} className="px-3 pt-2" />
        ) : isError ? (
          <EmptyState className="py-20" title="Payments didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          hasFilter ? (
            <EmptyState className="py-20" icon={<HandCoins />} title="Nothing matches" description="No payments match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({ range })}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<HandCoins />} title="No payments in this period" description={range === 'all' ? 'Payments you record, and ones residents make in the portal, show up here.' : 'Try a longer date range.'} action={range !== 'all' ? <button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, range: 'all' }))}>Show all payments</button> : undefined} />
          )
        ) : (
          <>
            <DataTable rows={sorted} columns={columns} getId={p => p.id} onRowClick={p => setSheet(p.id)} focusedId={nav.focusedId} onHover={nav.onHover} className="pb-24" caption="Payments received" />
            {data?.truncated && <p className="px-4 pb-24 text-center text-sm text-muted-foreground">Showing the newest 1,000 payments. Narrow the dates to see older ones.</p>}
          </>
        )}
      </div>
      <TransactionSheet id={sheet} onClose={() => setSheet(null)} />
      <VoidDialog target={voidTarget} onOpenChange={o => !o && setVoidTarget(null)} onVoided={() => afterPosting(qc)} />
    </div>
  );
}

// ── Deposits held ────────────────────────────────────────────────────────────

function DepositsHeld({ switcher }: { switcher: ReactNode }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch, isFetching } = useReceivables();
  const list = useListState('accounting:deposits', { layout: 'table', grouping: 'none', ordering: 'held', properties: [], showEmptyGroups: false, showClosed: false }, {});
  const { filters, setFilters } = list;
  const propertyIds = Array.isArray(filters.propertyIds) ? (filters.propertyIds as string[]) : [];
  const search = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
  const rows = useMemo(
    () => (data?.leases ?? []).filter(l => (Math.abs(l.depositHeld) > 0.004 || (l.status === 'Active' && l.depositRequired > 0)) && (!propertyIds.length || propertyIds.includes(l.propertyId ?? '')) && (!search || `${l.name} ${l.tenantNames}`.toLowerCase().includes(search))),
    [data, propertyIds.join(','), search],
  );
  const sorters = useMemo(() => ({
    lease: (l: ReceivableLease) => l.tenantNames || l.name,
    property: (l: ReceivableLease) => ws.unitLabel(l.unitId, l.propertyId),
    status: (l: ReceivableLease) => l.status,
    required: (l: ReceivableLease) => l.depositRequired,
    held: (l: ReceivableLease) => l.depositHeld,
    difference: (l: ReceivableLease) => l.depositHeld - l.depositRequired,
  }), [ws]);
  const { sorted, sort, toggle } = useSorted(rows, sorters, { key: 'held', dir: 'desc' });
  const nav = useListNav({ items: sorted, getId: l => l.id, onOpen: l => navigate(`/leases/${l.id}/ledger`) });
  const head = (label: string, key: string, numeric?: boolean) => <SortHeader label={label} sortKey={key} sort={sort} onToggle={toggle} align={numeric ? 'right' : undefined} numeric={numeric} />;
  const ended = rows.filter(l => l.status === 'Ended' && l.depositHeld > 0.004);
  const short = rows.filter(l => l.status === 'Active' && l.depositHeld + 0.004 < l.depositRequired);

  const columns: Column<ReceivableLease>[] = [
    { key: 'lease', header: head('Lease', 'lease'), cell: l => <span className="flex min-w-0 max-w-[320px] flex-col py-1 leading-tight"><span className="truncate font-medium">{l.tenantNames || l.name}</span><span className="truncate text-sm text-muted-foreground">{l.name}</span></span>, footer: <span className="text-sm text-muted-foreground">{plural(rows.length, 'lease')}</span> },
    { key: 'property', header: head('Unit', 'property'), hideBelow: 'md', cell: l => <span className="inline-flex max-w-[220px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(l.unitId, l.propertyId)}</span></span> },
    { key: 'status', header: head('Lease status', 'status'), width: 130, hideBelow: 'sm', cell: l => (l.status === 'Ended' ? <Pill tone={l.depositHeld > 0.004 ? 'warning' : 'neutral'}>{l.depositHeld > 0.004 ? 'Ended · return due' : 'Ended'}</Pill> : <span className="text-muted-foreground">{l.status}</span>) },
    { key: 'required', header: head('Required', 'required', true), align: 'right', width: 116, hideBelow: 'md', cell: l => <Money value={l.depositRequired} muted0 />, footer: <Money value={sumOf(rows, l => l.depositRequired)} /> },
    { key: 'held', header: head('Held', 'held', true), align: 'right', width: 116, cell: l => <Money value={l.depositHeld} className="font-medium" />, footer: <Money value={sumOf(rows, l => l.depositHeld)} /> },
    { key: 'difference', header: head('Difference', 'difference', true), align: 'right', width: 116, hideBelow: 'sm', cell: l => { const d = Math.round((l.depositHeld - l.depositRequired) * 100) / 100; return l.status !== 'Active' ? <span className="text-muted-foreground/70">—</span> : <Money value={d} muted0 signed className={d < 0 ? 'text-tone-danger' : undefined} />; } },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {data && (
        <SummaryStrip
          items={[
            { label: 'Deposits held', value: <Money value={sumOf(rows, l => l.depositHeld)} /> },
            { label: 'Short of required', value: plural(short.length, 'lease'), tone: short.length ? 'warning' : 'muted', hint: short.length ? <Money value={sumOf(short, l => l.depositRequired - l.depositHeld)} /> : undefined },
            { label: 'Ended, still held', value: plural(ended.length, 'lease'), tone: ended.length ? 'warning' : 'muted', hint: ended.length ? <Money value={sumOf(ended, l => l.depositHeld)} /> : undefined },
          ]}
        />
      )}
      <ListToolbar
        start={
          <>
            {switcher}
            <FilterMenu defs={[listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> })))]} filters={filters} onChange={setFilters} />
            <FilterChips defs={[listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> })))]} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['lease', 'leases']}
        search={search}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search resident or lease…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} disabled={!rows.length} onSelect={() => downloadCsv('deposits-held', ['Lease', 'Residents', 'Property', 'Status', 'Required', 'Held'], sorted.map(l => [l.name, l.tenantNames, ws.propertyName(l.propertyId), l.status, l.depositRequired, l.depositHeld]))}><Download /> Export CSV</DropdownMenuItem>}
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={10} className="px-3 pt-2" />
        ) : isError ? (
          <EmptyState className="py-20" title="Deposits didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          propertyIds.length || search ? (
            <EmptyState className="py-20" icon={<Wallet />} title="Nothing matches" description="No deposits match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<Wallet />} title="No deposits held" description="Security deposits collected from residents show up here until they’re applied or returned." />
          )
        ) : (
          <DataTable rows={sorted} columns={columns} getId={l => l.id} onRowClick={l => navigate(`/leases/${l.id}/ledger`)} focusedId={nav.focusedId} onHover={nav.onHover} className="pb-24" caption="Deposits held" />
        )}
      </div>
    </div>
  );
}
