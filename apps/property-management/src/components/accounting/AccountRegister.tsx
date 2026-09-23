import { ArrowLeftRight, BookOpen, Building2, CheckCircle2, Download, Landmark, Link2, Receipt, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { copyText } from '../../lib/clipboard';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { appUrl, fullDate, plural, shortDate } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { useListState } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, singleFilter, type FilterDef } from '../list/Filters';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { PageHeader, useDocumentTitle } from '../shell/PageHeader';
import { RANGE_OPTIONS, rangeFor, TXN_LABEL, useBanking, useRegister, type RangePreset, type RegisterEntry } from './accountingData';
import { ExpenseDialog, TransferDialog } from './BankActivityDialogs';
import { HeaderButton, menuItem, Notice, SummaryStrip } from './parts';
import { ReconcileView } from './ReconcileView';
import { TransactionSheet } from './TransactionSheet';

/**
 * Any account's register — `/accounting/banking/:id` for bank accounts (with
 * reconciliation at `?mode=reconcile`) and `/accounting/chart/:id` for the rest.
 */
export function AccountRegisterPage({ accountId, from }: { accountId: string; from: 'banking' | 'chart' }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const account = ws.accountById.get(accountId);
  const isBank = account?.subtype === 'Bank';
  const reconciling = isBank && params.get('mode') === 'reconcile';
  const { data: banking } = useBanking();
  const summary = banking?.accounts.find(a => a.id === accountId);
  const [transfer, setTransfer] = useState(false);
  const [expense, setExpense] = useState(false);
  useDocumentTitle(account ? `${reconciling ? 'Reconcile ' : ''}${account.name}` : 'Account');
  const back = from === 'banking' ? '/accounting/banking' : '/accounting/chart';
  const canReconcile = isBank && ws.can('banking.manage');

  const header = (
    <PageHeader
      breadcrumb={{ to: back, label: from === 'banking' ? 'Banking' : 'Chart of accounts' }}
      icon={isBank ? <Landmark /> : <BookOpen />}
      title={account ? <span className="inline-flex items-center gap-2"><span className="num text-muted-foreground">{account.number}</span>{account.name}{reconciling && <span className="text-muted-foreground">· Reconcile</span>}</span> : 'Account'}
      actions={
        <>
          <Tip label="Copy link">
            <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/accounting/${from}/${accountId}`), 'Link copied')}><Link2 /></IconButton>
          </Tip>
          {!reconciling && isBank && ws.can('banking.manage') && ws.bankAccounts.length > 1 && <HeaderButton icon={<ArrowLeftRight />} label="Transfer" onClick={() => setTransfer(true)} />}
          {!reconciling && isBank && ws.can('payables.manage') && <HeaderButton icon={<Receipt />} label="Record expense" onClick={() => setExpense(true)} />}
          {!reconciling && canReconcile && <HeaderButton primary icon={<Scale />} label={summary?.inProgress ? 'Resume reconciliation' : 'Reconcile'} onClick={() => setParams({ mode: 'reconcile' })} />}
        </>
      }
    />
  );

  if (!account) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <EmptyState className="flex-1" icon={<BookOpen />} title="Account not found" description="It may have been removed, or the link is wrong." action={<button type="button" className="ghost-chip h-9" onClick={() => navigate(back)}>Back</button>} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {reconciling ? <ReconcileView accountId={accountId} onDone={() => setParams({})} /> : <Register accountId={accountId} isBank={isBank} inProgress={summary?.inProgress ?? null} lastReconciled={summary?.lastReconciliation?.statementDate ?? null} unclearedCount={summary?.uncleared.count ?? null} onResume={() => setParams({ mode: 'reconcile' })} />}
      <TransferDialog open={transfer} onOpenChange={setTransfer} defaults={{ fromBankId: accountId }} />
      <ExpenseDialog open={expense} onOpenChange={setExpense} defaults={{ bankAccountId: accountId }} />
    </div>
  );
}

function Register({ accountId, isBank, inProgress, lastReconciled, unclearedCount, onResume }: { accountId: string; isBank: boolean; inProgress: { statementDate: string } | null; lastReconciled: string | null; unclearedCount: number | null; onResume: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const list = useListState(`accounting:register:${isBank ? 'bank' : 'account'}`, { layout: 'table', grouping: 'none', ordering: 'date', properties: [], showEmptyGroups: false, showClosed: false }, { range: isBank ? '90' : 'year' });
  const { filters, setFilters } = list;
  const range = (typeof filters.range === 'string' ? filters.range : '90') as RangePreset;
  const propertyId = typeof filters.propertyId === 'string' ? filters.propertyId : undefined;
  const cleared = (filters.cleared === 'cleared' || filters.cleared === 'uncleared' ? filters.cleared : 'all') as 'all' | 'cleared' | 'uncleared';
  const search = typeof filters.search === 'string' ? filters.search : '';
  const [limit, setLimit] = useState(500);
  const query = { accountId, ...rangeFor(range, ws.today), propertyId, cleared: isBank ? cleared : 'all', search: search || undefined, limit } as const;
  const { data, isPending, isError, error, refetch, isFetching } = useRegister(query);
  const [sheet, setSheet] = useState<string | null>(null);
  const rows = data?.entries ?? [];
  const nav = useListNav({ items: rows, getId: r => r.id, onOpen: r => setSheet(r.id), enabled: !sheet });
  useHotkeys({ esc: () => navigate(isBank ? '/accounting/banking' : '/accounting/chart') }, { enabled: !sheet && nav.selection.size === 0 && !nav.focusedId });
  const debitLabel = isBank ? 'Deposit' : 'Debit';
  const creditLabel = isBank ? 'Payment' : 'Credit';

  const columns: Column<RegisterEntry>[] = useMemo(() => [
    { key: 'date', header: 'Date', width: 112, hideBelow: 'sm', cell: r => <span className="whitespace-nowrap tabular-nums">{fullDate(r.date)}</span> },
    { key: 'number', header: '#', width: 64, hideBelow: 'md', cell: r => <span className="tabular-nums text-muted-foreground">{r.number}</span> },
    {
      key: 'description',
      header: isBank ? 'Payee / description' : 'Description',
      cell: r => {
        const label = TXN_LABEL[r.kind] ?? r.kind;
        const detail = r.party && !r.description.startsWith(label) ? `${label} · ${r.description}` : r.party ? r.description : label;
        return (
          <span className="flex min-w-0 max-w-[62vw] flex-col py-1 leading-tight sm:max-w-[420px]">
            <span className="truncate font-medium">{r.party || r.description}</span>
            <span className="truncate text-sm text-muted-foreground"><span className="sm:hidden">{shortDate(r.date)} · </span>{detail}{r.reference ? ` · ${r.paymentMethod === 'Check' ? '#' : ''}${r.reference}` : ''}</span>
          </span>
        );
      },
    },
    { key: 'property', header: 'Property', hideBelow: 'lg', width: 180, cell: r => (r.propertyCount > 1 ? <span className="text-muted-foreground">{r.propertyCount} properties</span> : r.propertyId ? <span className="inline-flex max-w-[170px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(r.propertyId)?.color} /><span className="truncate">{ws.propertyName(r.propertyId)}</span></span> : <span className="text-muted-foreground/70">—</span>) },
    { key: 'debit', header: debitLabel, align: 'right', width: 116, hideBelow: 'md', cell: r => (r.debit ? <Money value={r.debit} className={isBank ? 'text-tone-success' : undefined} /> : null), footer: data ? <Money value={data.debits} /> : undefined },
    { key: 'credit', header: creditLabel, align: 'right', width: 116, hideBelow: 'md', cell: r => (r.credit ? <Money value={r.credit} /> : null), footer: data ? <Money value={data.credits} /> : undefined },
    { key: 'amount', header: 'Amount', align: 'right', width: 104, className: 'md:hidden', cell: r => <Money value={r.amount} signed className={r.amount > 0 && isBank ? 'text-tone-success' : undefined} /> },
    { key: 'running', header: 'Balance', align: 'right', width: 128, hideBelow: 'sm', cell: r => <Money value={r.running} className="font-medium" />, footer: data ? <Money value={data.closingBalance} /> : undefined },
    ...(isBank ? [{ key: 'cleared', header: <span className="sr-only">Cleared</span>, width: 36, cell: (r: RegisterEntry) => (r.reconciled ? <Tip label={`Reconciled${r.clearedAt ? ` · statement ${fullDate(r.clearedAt)}` : ''}`}><CheckCircle2 className="h-3.5 w-3.5 text-tone-success" /></Tip> : null) } as Column<RegisterEntry>] : []),
  ], [ws, isBank, data]);

  const propertyFilter: FilterDef[] = useMemo(() => [singleFilter('propertyId', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> })))], [ws]);
  const hasFilter = Boolean(propertyId || search || cleared !== 'all');

  return (
    <>
      {inProgress && (
        <div className="border-b px-4 py-2">
          <Notice tone="warning" action={<button type="button" className="ghost-chip h-8 text-sm" onClick={onResume}>Resume</button>}>
            A reconciliation for the statement ending {fullDate(inProgress.statementDate)} is in progress.
          </Notice>
        </div>
      )}
      {data && (
        <SummaryStrip
          items={[
            ...(data.openingBalance !== 0 || range !== 'all' ? [{ label: range === 'all' ? 'Opening' : 'Starting balance', value: <Money value={data.openingBalance} /> }] : []),
            { label: isBank ? 'Deposits' : data.normal === 'debit' ? 'Debits' : 'Credits', value: <Money value={data.normal === 'debit' ? data.debits : data.credits} />, secondary: true },
            { label: isBank ? 'Payments' : data.normal === 'debit' ? 'Credits' : 'Debits', value: <Money value={data.normal === 'debit' ? data.credits : data.debits} />, secondary: true },
            { label: range === 'all' ? 'Balance' : 'Ending balance', value: <Money value={data.closingBalance} /> },
            ...(isBank ? [
              { label: 'Uncleared', value: unclearedCount == null ? '—' : plural(unclearedCount, 'transaction'), tone: unclearedCount ? undefined : ('muted' as const), secondary: true },
              { label: 'Reconciled through', value: lastReconciled ? fullDate(lastReconciled) : 'Never', tone: lastReconciled ? undefined : ('muted' as const) },
            ] : []),
          ]}
        />
      )}
      <ListToolbar
        start={
          <>
            <Segmented size="sm" value={range} onChange={v => { setLimit(500); setFilters(f => ({ ...f, range: v })); }} options={RANGE_OPTIONS} />
            {isBank && <Segmented size="sm" value={cleared} onChange={v => setFilters(f => ({ ...f, cleared: v === 'all' ? undefined : v }))} options={[{ value: 'all', label: 'All' }, { value: 'uncleared', label: 'Uncleared' }, { value: 'cleared', label: 'Cleared' }]} className="hidden sm:inline-flex" />}
            <FilterMenu defs={propertyFilter} filters={filters} onChange={setFilters} />
            <FilterChips defs={propertyFilter} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : data?.matching ?? 0}
        countLabel={['transaction', 'transactions']}
        search={search}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search payee, memo, check #…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} disabled={!rows.length} onSelect={() => downloadCsv(`register-${data?.account.number ?? 'account'}`, ['Date', 'Number', 'Type', 'Payee', 'Description', 'Reference', 'Property', debitLabel, creditLabel, 'Balance', 'Reconciled'], rows.map(r => [r.date, r.number, r.kind, r.party, r.description, r.reference ?? '', r.propertyCount > 1 ? `${r.propertyCount} properties` : ws.propertyName(r.propertyId), r.debit || '', r.credit || '', r.running, r.reconciled ? 'Yes' : '']))}><Download /> Export CSV</DropdownMenuItem>}
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={12} className="px-3 pt-2" />
        ) : isError || !data ? (
          <EmptyState className="py-20" title="The register didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          hasFilter ? (
            <EmptyState className="py-20" icon={<BookOpen />} title="Nothing matches" description="No transactions match these filters." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({ range })}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<BookOpen />} title={range === 'all' ? 'No activity yet' : 'No activity in this period'} description={range === 'all' ? 'Transactions posted to this account show up here with a running balance.' : 'Try a longer date range.'} action={range !== 'all' ? <button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, range: 'all' }))}>Show all activity</button> : undefined} />
          )
        ) : (
          <>
            <DataTable rows={rows} columns={columns} getId={r => r.id} onRowClick={r => setSheet(r.id)} focusedId={nav.focusedId} onHover={nav.onHover} rowClassName={r => cn(!r.reconciled && isBank && cleared === 'all' && 'text-foreground')} caption="Account register" />
            {data.truncated && (
              <div className="flex items-center justify-center gap-3 px-4 py-4 pb-24 text-sm text-muted-foreground">
                Showing the newest {rows.length.toLocaleString()} of {data.matching.toLocaleString()}.
                {limit < 1500 ? <button type="button" className="ghost-chip h-8 text-sm" onClick={() => setLimit(l => Math.min(1500, l + 500))}>Show more</button> : 'Narrow the dates to see older ones.'}
              </div>
            )}
            {!data.truncated && <div className="h-24" />}
          </>
        )}
      </div>
      <TransactionSheet id={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
