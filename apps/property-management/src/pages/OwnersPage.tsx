import { Banknote, Download, Globe, Link2, Mail, Pencil, Plus, SquareArrowOutUpRight, UserRound, Users } from 'lucide-react';
import { memo, useCallback, useMemo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { DISTRIBUTION_METHODS, OWNER_TYPES } from '@project/shared/constants';
import { BulkBar, bulkButton } from '../components/list/BulkBar';
import { DataTable, type Column } from '../components/list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../components/list/Filters';
import { GroupedList, RowShell, type ListGroup } from '../components/list/GroupedList';
import { DisplayMenu, ListToolbar } from '../components/list/Toolbar';
import { useListNav } from '../components/list/useListNav';
import { Avatar } from '../components/primitives/Avatar';
import { EmptyState, SkeletonRows, Tip } from '../components/primitives/bits';
import { Money } from '../components/primitives/data';
import { Pill } from '../components/primitives/glyphs';
import { useOwners, type OwnerRow } from '../components/portfolio/data';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { downloadCsv } from '../lib/csv';
import { errorMessage } from '../lib/errors';
import { appUrl, plural, timeAgo } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type ListOptions } from '../lib/listState';
import { useWorkspace } from '../lib/workspace';

/**
 * The people and companies who own the properties: what they own, how they're
 * paid, whether they use the portal, and (for money roles) what's been
 * distributed this year. Rows open the owner; E edits.
 */

type Grouping = 'type' | 'distribution' | 'portal' | 'none';
type Ordering = 'name' | 'units' | 'distributions' | 'recent';
type Options = ListOptions<Grouping, Ordering>;

const DEFAULTS: Options = { layout: 'list', grouping: 'none', ordering: 'name', properties: ['contact', 'type', 'portfolio', 'portal', 'distributions', 'fee'], showEmptyGroups: false, showClosed: false };
const GROUPINGS: ReadonlyArray<{ value: Grouping; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'type', label: 'Owner type' },
  { value: 'distribution', label: 'Distribution method' },
  { value: 'portal', label: 'Portal access' },
];
const ORDERINGS: ReadonlyArray<{ value: Ordering; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'units', label: 'Most units' },
  { value: 'distributions', label: 'Most distributed' },
  { value: 'recent', label: 'Last message' },
];
const PROPS = [
  { key: 'contact', label: 'Contact' },
  { key: 'type', label: 'Type' },
  { key: 'portfolio', label: 'Properties' },
  { key: 'portal', label: 'Portal' },
  { key: 'distributions', label: 'Distributions YTD' },
  { key: 'fee', label: 'Fee' },
  { key: 'method', label: 'Pay by' },
];
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function OwnersPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  useDocumentTitle('Owners');
  const list = useListState<Grouping, Ordering>('owners', DEFAULTS, {});
  const { options, setOptions, filters, setFilters } = list;
  const { data, isPending, isError, error, refetch, isFetching } = useOwners();
  const money = Boolean(data?.money);
  const defaultFee = data?.defaultFeePercent ?? ws.settings.managementFeePercent;
  const search = typeof filters.search === 'string' ? filters.search : '';

  const rows = useMemo(() => {
    const all = data?.owners ?? [];
    const arr = (k: string) => (Array.isArray(filters[k]) ? (filters[k] as string[]) : []);
    const types = arr('types');
    const methods = arr('methods');
    const portal = typeof filters.portal === 'string' ? filters.portal : '';
    const q = search.trim().toLowerCase();
    const sorted = all
      .filter(o => options.showClosed || o.status !== 'Archived')
      .filter(o => !types.length || types.includes(o.ownerType))
      .filter(o => !methods.length || methods.includes(o.distributionMethod))
      .filter(o => !portal || (portal === 'on' ? o.portalEnabled : !o.portalEnabled))
      .filter(o => !q || [o.name, o.contactName, o.email, o.phone].some(v => v.toLowerCase().includes(q)) || o.propertyIds.some(id => ws.propertyName(id).toLowerCase().includes(q)));
    const byName = (a: OwnerRow, b: OwnerRow) => collator.compare(a.name, b.name);
    return sorted.sort(
      options.ordering === 'units' ? (a, b) => b.unitCount - a.unitCount || byName(a, b)
        : options.ordering === 'distributions' ? (a, b) => (b.distributionsYtd ?? 0) - (a.distributionsYtd ?? 0) || byName(a, b)
          : options.ordering === 'recent' ? (a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || byName(a, b)
            : byName,
    );
  }, [data, filters, options.showClosed, options.ordering, search, ws]);

  const grouping = options.layout === 'table' ? 'none' : options.grouping;
  const groups: ListGroup<OwnerRow>[] = useMemo(() => {
    if (grouping === 'none') return [{ key: 'all', label: 'All owners', items: rows }];
    const keyOf = (o: OwnerRow) => (grouping === 'type' ? o.ownerType : grouping === 'distribution' ? o.distributionMethod : o.portalEnabled ? 'on' : 'off');
    const order = grouping === 'type' ? [...OWNER_TYPES] : grouping === 'distribution' ? [...DISTRIBUTION_METHODS] : ['on', 'off'];
    const label = (k: string) => (grouping === 'portal' ? (k === 'on' ? 'Portal access on' : 'No portal access') : grouping === 'distribution' ? (k === 'Hold' ? 'Holding funds' : `Paid by ${k}`) : k);
    return order.map(k => ({ key: k, label: label(k), items: rows.filter(o => keyOf(o) === k) })).filter(g => g.items.length);
  }, [rows, grouping]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups('owners');
  const visible = useMemo(() => (options.layout === 'table' ? rows : groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items))), [groups, collapsed, rows, options.layout]);

  const open = useCallback((o: OwnerRow) => navigate(`/owners/${o.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: o => o.id, onOpen: open });
  useHotkeys({ e: () => nav.focused && app.openCreate('owner', { ownerId: nav.focused.id }) });

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      listFilter('types', 'Type', <Users />, () => OWNER_TYPES.map(t => ({ value: t, label: t }))),
      listFilter('methods', 'Distribution method', <Banknote />, () => DISTRIBUTION_METHODS.map(m => ({ value: m, label: m === 'Hold' ? 'Hold funds' : m }))),
      singleFilter('portal', 'Portal access', <Globe />, () => [{ value: 'on', label: 'Has portal access' }, { value: 'off', label: 'No portal access' }]),
    ],
    [],
  );
  const hasFilters = countFilters(filters) > 0 || Boolean(search);
  const props = new Set(options.properties);
  const feeOf = (o: OwnerRow) => o.managementFeePercent ?? defaultFee;

  const exportCsv = () =>
    downloadCsv(
      'owners',
      ['Name', 'Type', 'Contact', 'Email', 'Phone', 'Mailing address', 'Properties', 'Units', 'Portal access', 'Distribution method', 'Management fee %', ...(money ? ['Distributions YTD', 'Contributions YTD', 'Fees YTD', 'Cash held'] : []), 'Status'],
      rows.map(o => [o.name, o.ownerType, o.contactName, o.email, o.phone, o.mailingAddress.replace(/\n/g, ', '), o.propertyIds.map(id => ws.propertyName(id)).join('; '), o.unitCount, o.portalEnabled ? 'Yes' : 'No', o.distributionMethod, feeOf(o), ...(money ? [o.distributionsYtd ?? 0, o.contributionsYtd ?? 0, o.feesYtd ?? 0, o.cash ?? 0] : []), o.status]),
    );

  const columns: Column<OwnerRow>[] = [
    { key: 'name', header: 'Owner', sort: o => o.name, className: 'min-w-[200px]', cell: o => <span className="flex min-w-0 items-center gap-2"><Avatar name={o.name} color={o.color} size={20} /><span className="truncate font-medium">{o.name}</span>{o.status === 'Archived' && <Pill>Archived</Pill>}</span> },
    { key: 'type', header: 'Type', sort: o => o.ownerType, hideBelow: 'md', cell: o => o.ownerType },
    { key: 'contact', header: 'Contact', sort: o => o.contactName || o.email, hideBelow: 'lg', className: 'max-w-[240px]', cell: o => <span className="block truncate">{o.contactName || o.email || <span className="text-muted-foreground">—</span>}{o.contactName && o.email && <span className="text-muted-foreground"> · {o.email}</span>}</span> },
    { key: 'properties', header: 'Properties', align: 'right', sort: o => o.propertyCount, cell: o => o.propertyCount },
    { key: 'units', header: 'Units', align: 'right', sort: o => o.unitCount, hideBelow: 'sm', cell: o => o.unitCount },
    { key: 'portal', header: 'Portal', sort: o => Number(o.portalEnabled), hideBelow: 'sm', cell: o => (o.portalEnabled ? <Pill tone="success">On</Pill> : <span className="text-muted-foreground">Off</span>) },
    { key: 'method', header: 'Pay by', sort: o => o.distributionMethod, hideBelow: 'lg', cell: o => o.distributionMethod },
    ...(money ? [
      { key: 'distributions', header: 'Distributed YTD', align: 'right' as const, sort: (o: OwnerRow) => o.distributionsYtd ?? 0, hideBelow: 'md' as const, cell: (o: OwnerRow) => <Money value={o.distributionsYtd} cents={false} muted0 />, footer: <Money value={rows.reduce((a, o) => a + (o.distributionsYtd ?? 0), 0)} cents={false} /> },
      { key: 'cash', header: 'Cash held', align: 'right' as const, sort: (o: OwnerRow) => o.cash ?? 0, hideBelow: 'xl' as const, cell: (o: OwnerRow) => <Money value={o.cash} muted0 /> },
    ] : []),
    { key: 'fee', header: 'Fee', align: 'right', sort: feeOf, cell: o => <span className={cn('tabular-nums', o.managementFeePercent == null && 'text-muted-foreground')}>{feeOf(o)}%</span> },
  ];

  const content = (() => {
    if (isPending) return <SkeletonRows rows={8} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Owners didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!data?.owners.length) {
      return <EmptyState className="py-24" icon={<UserRound />} title="No owners yet" description="Add the people and companies whose properties you manage. Statements and distributions follow from their properties." action={<button type="button" onClick={() => app.openCreate('owner')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New owner</button>} />;
    }
    if (!rows.length) {
      return hasFilters ? (
        <EmptyState className="py-20" icon={<UserRound />} title="No owners match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState className="py-20" icon={<UserRound />} title="Every owner is archived" action={<button type="button" className="ghost-chip h-9" onClick={() => setOptions({ showClosed: true })}>Show archived</button>} />
      );
    }
    if (options.layout === 'table') {
      return <DataTable rows={visible} columns={columns.filter(c => ['name', 'properties'].includes(c.key) || props.has(c.key === 'units' ? 'portfolio' : c.key === 'cash' ? 'distributions' : c.key))} getId={o => o.id} onRowClick={nav.onRowClick} selection={nav.selection} onToggleSelect={(o, e) => nav.toggleSelect(o, e)} onSelectAll={on => nav.setSelection(on ? new Set(visible.map(o => o.id)) : new Set())} focusedId={nav.focusedId} onHover={nav.onHover} className="h-full pb-24" caption="Owners" />;
    }
    return (
      <GroupedList
        label="Owners"
        groups={groups}
        single={grouping === 'none'}
        getId={o => o.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        renderRow={o => <OwnerListRow owner={o} props={props} money={money} fee={feeOf(o)} focused={nav.focusedId === o.id} selected={nav.selection.has(o.id)} selecting={nav.selecting} onClick={nav.onRowClick} onHover={nav.onHover} onToggleSelect={nav.toggleSelect} />}
      />
    );
  })();

  return (
    <>
      <PageHeader
        icon={<UserRound />}
        title="Owners"
        actions={
          <button type="button" onClick={() => app.openCreate('owner')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New owner</span>
          </button>
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ListToolbar
          start={
            <>
              <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
              <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
            </>
          }
          count={isPending ? null : rows.length}
          countLabel={['owner', 'owners']}
          search={search}
          onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
          searchPlaceholder="Search name, email, property…"
          layout={options.layout}
          layouts={['list', 'table']}
          onLayout={l => setOptions({ layout: l })}
          fetching={isFetching && !isPending}
          display={<DisplayMenu options={options} onChange={setOptions} groupings={GROUPINGS} orderings={money ? ORDERINGS : ORDERINGS.filter(o => o.value !== 'distributions')} properties={PROPS.filter(p => money || p.key !== 'distributions')} closedLabel="Show archived owners" onReset={list.reset} isDirty={list.isDirty} />}
          more={<DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>}
        />
        <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">{content}</div>
        <BulkBar count={nav.selected.length} noun={['owner', 'owners']} onClear={nav.clearSelection}>
          <button type="button" className={bulkButton} disabled={!nav.selected.some(o => o.email)} onClick={() => void copyText(nav.selected.filter(o => o.email).map(o => `${o.name} <${o.email}>`).join(', '), `Copied ${plural(nav.selected.filter(o => o.email).length, 'email address', 'email addresses')}`)}>
            <Mail /> Copy emails
          </button>
          <button type="button" className={bulkButton} onClick={() => downloadCsv('owners-selected', ['Name', 'Type', 'Contact', 'Email', 'Phone', 'Properties', 'Units'], nav.selected.map(o => [o.name, o.ownerType, o.contactName, o.email, o.phone, o.propertyCount, o.unitCount]))}>
            <Download /> Export
          </button>
        </BulkBar>
      </div>
    </>
  );
}

const OwnerListRow = memo(function OwnerListRow({ owner: o, props, money, fee, focused, selected, selecting, onClick, onHover, onToggleSelect }: { owner: OwnerRow; props: Set<string>; money: boolean; fee: number; focused: boolean; selected: boolean; selecting: boolean; onClick: (o: OwnerRow, e: MouseEvent) => void; onHover: (o: OwnerRow) => void; onToggleSelect: (o: OwnerRow, e: MouseEvent) => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const menu = (
    <div onClick={e => e.stopPropagation()}>
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => navigate(`/owners/${o.id}`)}><SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('owner', { ownerId: o.id })}><Pencil className="h-3.5 w-3.5" /> Edit <ContextMenuShortcut>E</ContextMenuShortcut></ContextMenuItem>
      {ws.can('portfolio.manage') && <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('property', { ownerId: o.id })}><Plus className="h-3.5 w-3.5" /> New property for {o.name.length > 24 ? 'this owner' : o.name}</ContextMenuItem>}
      <ContextMenuSeparator />
      {o.email && <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(o.email, 'Email copied')}><Mail className="h-3.5 w-3.5" /> Copy email</ContextMenuItem>}
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/owners/${o.id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</ContextMenuItem>
    </div>
  );
  return (
    <RowShell id={o.id} height={52} selected={selected} focused={focused} selecting={selecting} onClick={e => onClick(o, e)} onHover={() => onHover(o)} onToggleSelect={e => onToggleSelect(o, e)} menu={menu} muted={o.status === 'Archived'}>
      <Avatar name={o.name} color={o.color} size={28} className="ml-1" />
      <span className="min-w-0 flex-1 sm:flex-none sm:basis-[300px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{o.name}</span>
          {o.status === 'Archived' && <Pill>Archived</Pill>}
        </span>
        {props.has('contact') && <span className="block truncate text-sm text-muted-foreground">{[o.contactName && o.contactName !== o.name ? o.contactName : '', o.email || 'No email'].filter(Boolean).join(' · ')}</span>}
      </span>
      <span className="min-w-2 flex-1" />
      {props.has('type') && <span className="chip hidden shrink-0 lg:inline-flex">{o.ownerType}</span>}
      {props.has('portfolio') && (
        <Tip label={o.propertyIds.map(id => ws.propertyName(id)).join(', ') || 'No properties'}>
          <span className="hidden w-[150px] shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:inline">{plural(o.propertyCount, 'property', 'properties')} · {plural(o.unitCount, 'unit')}</span>
        </Tip>
      )}
      {props.has('method') && <span className="hidden w-12 shrink-0 text-sm text-muted-foreground xl:inline">{o.distributionMethod}</span>}
      {props.has('portal') && (
        <span className="hidden w-[72px] shrink-0 justify-end md:flex">
          {o.portalEnabled ? <Tip label={o.lastMessageAt ? `Last message ${timeAgo(o.lastMessageAt)}` : 'Can sign in to the owner portal'}><span><Pill tone="success"><Globe className="h-3 w-3" /> Portal</Pill></span></Tip> : <span className="text-sm text-muted-foreground">No portal</span>}
        </span>
      )}
      {money && props.has('distributions') && (
        <Tip label="Distributed this year">
          <span className="hidden w-[92px] shrink-0 text-right text-[13.5px] md:inline"><Money value={o.distributionsYtd} cents={false} muted0 /></span>
        </Tip>
      )}
      {props.has('fee') && (
        <Tip label={o.managementFeePercent == null ? 'Default management fee' : 'Management fee'}>
          <span className={cn('w-10 shrink-0 text-right text-sm tabular-nums', o.managementFeePercent == null ? 'text-muted-foreground' : '')}>{fee}%</span>
        </Tip>
      )}
    </RowShell>
  );
});
