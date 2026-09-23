import { BookOpen, Building2, CircleDashed, Download, Layers, NotebookPen, Plus, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { TRANSACTION_KINDS } from '@project/shared/constants';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { fullDate, shortDate } from '../../lib/format';
import { useListState } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { useDocumentTitle } from '../shell/PageHeader';
import { RANGE_OPTIONS, rangeFor, TXN_LABEL, useTransactions, type RangePreset, type TxnListRow } from './accountingData';
import { JournalEntryDialog } from './JournalEntryDialog';
import { AccountingHeader, HeaderButton, menuItem } from './parts';
import { TransactionSheet } from './TransactionSheet';

const PAGE = 300;

/**
 * The general ledger: every transaction, filterable by kind, status, property,
 * account, vendor and date, with any one open in a side sheet at
 * `/accounting/transactions/:id`.
 */
export function TransactionsView({ openId }: { openId?: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  useDocumentTitle('Transactions');
  const list = useListState('accounting:transactions', { layout: 'table', grouping: 'none', ordering: 'date', properties: [], showEmptyGroups: false, showClosed: false }, { range: '90' });
  const { filters, setFilters } = list;
  const arr = (k: string) => (Array.isArray(filters[k]) && (filters[k] as string[]).length ? (filters[k] as string[]) : undefined);
  const range = (typeof filters.range === 'string' ? filters.range : '90') as RangePreset;
  const status = (filters.status === 'Void' || filters.status === 'all' ? filters.status : 'Posted') as 'Posted' | 'Void' | 'all';
  const search = typeof filters.search === 'string' ? filters.search : '';
  const [pages, setPages] = useState(1);
  const [journal, setJournal] = useState(false);
  const query = {
    ...rangeFor(range, ws.today),
    kinds: arr('kinds') as (typeof TRANSACTION_KINDS)[number][] | undefined,
    status,
    propertyIds: arr('propertyIds'),
    accountIds: arr('accountIds'),
    vendorIds: arr('vendorIds'),
    search: search || undefined,
    limit: PAGE * pages,
  };
  useEffect(() => setPages(1), [JSON.stringify({ ...query, limit: 0 })]);
  const { data, isPending, isError, error, refetch, isFetching } = useTransactions(query);
  const rows = data?.transactions ?? [];
  const open = (t: TxnListRow) => navigate(`/accounting/transactions/${t.id}`);
  const nav = useListNav({ items: rows, getId: t => t.id, onOpen: open, enabled: !openId && !journal });

  const filterDefs: FilterDef[] = useMemo(() => [
    listFilter('kinds', 'Type', <Layers />, () => TRANSACTION_KINDS.map(k => ({ value: k, label: k }))),
    singleFilter('status', 'Status', <CircleDashed />, () => [{ value: 'Void', label: 'Void only' }, { value: 'all', label: 'Posted and void' }]),
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> }))),
    listFilter('accountIds', 'Account', <BookOpen />, () => ws.accounts.map(a => ({ value: a.id, label: `${a.number} ${a.name}`, keywords: [a.accountType, a.subtype] }))),
    listFilter('vendorIds', 'Vendor', <Wrench />, () => ws.vendors.map(v => ({ value: v.id, label: v.name, keywords: [v.trade] }))),
  ], [ws]);

  const columns: Column<TxnListRow>[] = [
    { key: 'date', header: 'Date', width: 112, hideBelow: 'sm', cell: t => <span className="whitespace-nowrap tabular-nums">{fullDate(t.date)}</span> },
    { key: 'number', header: '#', width: 64, hideBelow: 'sm', cell: t => <span className="tabular-nums text-muted-foreground">{t.number}</span> },
    { key: 'kind', header: 'Type', width: 120, hideBelow: 'md', cell: t => <span className="text-muted-foreground">{TXN_LABEL[t.kind] ?? t.kind}</span> },
    {
      key: 'description',
      header: 'Description',
      cell: t => (
        <span className={cn('flex min-w-0 max-w-[62vw] flex-col py-1 leading-tight sm:max-w-[460px]', t.status === 'Void' && 'text-muted-foreground line-through decoration-muted-foreground/60')}>
          <span className="truncate font-medium">{t.description || TXN_LABEL[t.kind]}</span>
          <span className="truncate text-sm text-muted-foreground"><span className="sm:hidden">{shortDate(t.date)} · {TXN_LABEL[t.kind] ?? t.kind}</span>{[[t.vendorName, t.ownerName, t.tenantName ?? t.leaseName].filter(Boolean)[0], t.reference].filter(Boolean).map((part, i) => <span key={i} className={i === 0 ? '' : undefined}><span className={i === 0 ? 'sm:hidden' : undefined}> · </span>{part}</span>)}</span>
        </span>
      ),
    },
    { key: 'property', header: 'Property', width: 180, hideBelow: 'lg', cell: t => (t.propertyId ? <span className="inline-flex max-w-[170px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(t.propertyId)?.color} /><span className="truncate">{ws.propertyName(t.propertyId)}</span></span> : <span className="text-muted-foreground/70">—</span>) },
    { key: 'amount', header: 'Amount', align: 'right', width: 132, cell: t => <span className="inline-flex items-center justify-end gap-1.5">{t.status === 'Void' && <Pill tone="neutral">Void</Pill>}<Money value={t.amount} className={cn('font-medium', t.status === 'Void' && 'text-muted-foreground line-through')} /></span> },
  ];

  const hasFilter = Boolean(arr('kinds') || arr('propertyIds') || arr('accountIds') || arr('vendorIds') || search || status !== 'Posted');

  return (
    <>
      <AccountingHeader tab="transactions" actions={ws.can('banking.manage') && <HeaderButton primary icon={<NotebookPen />} label="Journal entry" onClick={() => setJournal(true)} />} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ListToolbar
          start={
            <>
              <Segmented size="sm" value={range} onChange={v => setFilters(f => ({ ...f, range: v }))} options={RANGE_OPTIONS} />
              <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
              <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
            </>
          }
          count={isPending ? null : data?.total ?? 0}
          countLabel={['transaction', 'transactions']}
          search={search}
          onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
          searchPlaceholder="Search description, reference, name, #…"
          fetching={isFetching && !isPending}
          more={<DropdownMenuItem className={menuItem} disabled={!rows.length} onSelect={() => downloadCsv('transactions', ['Date', 'Number', 'Type', 'Description', 'Vendor', 'Owner', 'Resident', 'Lease', 'Property', 'Reference', 'Method', 'Amount', 'Status'], rows.map(t => [t.date, t.number, t.kind, t.description, t.vendorName ?? '', t.ownerName ?? '', t.tenantName ?? '', t.leaseName ?? '', ws.propertyName(t.propertyId), t.reference ?? '', t.paymentMethod ?? '', t.amount, t.status]))}><Download /> Export CSV</DropdownMenuItem>}
        />
        <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <SkeletonRows rows={12} className="px-3 pt-2" />
          ) : isError ? (
            <EmptyState className="py-20" title="Transactions didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
          ) : !rows.length ? (
            hasFilter ? (
              <EmptyState className="py-20" icon={<BookOpen />} title="Nothing matches" description="No transactions match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({ range })}>Clear filters</button>} />
            ) : (
              <EmptyState className="py-20" icon={<BookOpen />} title={range === 'all' ? 'No transactions yet' : 'No transactions in this period'} description="Charges, payments, bills, transfers and journal entries all land here." action={range !== 'all' ? <button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, range: 'all' }))}>Show all</button> : ws.can('banking.manage') ? <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => setJournal(true)}><Plus className="h-3.5 w-3.5" /> Journal entry</button> : undefined} />
            )
          ) : (
            <>
              <DataTable rows={rows} columns={columns} getId={t => t.id} onRowClick={(t, e) => nav.onRowClick(t, e)} focusedId={nav.focusedId ?? openId ?? null} onHover={nav.onHover} caption="Transactions" />
              <div className="flex items-center justify-center gap-3 px-4 pb-24 pt-4 text-sm text-muted-foreground">
                {data?.hasMore && rows.length >= 1500 ? (
                  `Showing the newest ${rows.length.toLocaleString()} of ${data.total.toLocaleString()} — narrow the dates or filters to see older ones.`
                ) : data?.hasMore ? (
                  <>
                    Showing {rows.length.toLocaleString()} of {data.total.toLocaleString()}
                    <button type="button" className="ghost-chip h-8 text-sm" disabled={isFetching} onClick={() => setPages(p => p + 1)}>Load {Math.min(PAGE, data.total - rows.length).toLocaleString()} more</button>
                  </>
                ) : rows.length > 20 ? `All ${rows.length.toLocaleString()} shown` : null}
              </div>
            </>
          )}
        </div>
      </div>
      <TransactionSheet id={openId ?? null} onClose={() => navigate('/accounting/transactions', { replace: true })} />
      <JournalEntryDialog open={journal} onOpenChange={setJournal} onPosted={id => navigate(`/accounting/transactions/${id}`)} />
    </>
  );
}
