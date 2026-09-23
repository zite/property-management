import { Building2, Download, MessageSquare, Plus, SquareArrowOutUpRight, UserRound, Users, Wallet, Wifi } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import type { LeasePhase } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { format } from 'date-fns';
import { fullDate, parseDay, shortDate, telHref, timeAgo } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type Filters, type ListOptions } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, RowShell, type ListGroup } from '../list/GroupedList';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { Avatar } from '../primitives/Avatar';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { LeasePhasePill, PropertySwatch } from '../primitives/glyphs';
import { compareResidents, DISPLAY_PROPERTIES, GROUPINGS, groupResidents, NAV_ORDER_KEY, ORDERINGS, useResidents, type ResidentFilters, type ResidentGrouping, type ResidentOrdering, type ResidentRow, type ResidentStatus } from './data';

type Options = ListOptions<ResidentGrouping, ResidentOrdering>;

const DEFAULT_OPTIONS: Options = { layout: 'list', grouping: 'property', ordering: 'unit', properties: ['unit', 'phase', 'email', 'phone', 'portal', 'moveIn', 'balance'], showEmptyGroups: false, showClosed: false };
const SEARCH_KEY = 'search';

export function PortalStatus({ resident, className }: { resident: Pick<ResidentRow, 'portal' | 'portalSeenAt'>; className?: string }) {
  if (resident.portal === 'active') return <Tip label={resident.portalSeenAt ? `Last in the portal ${timeAgo(resident.portalSeenAt)}` : 'Uses the portal'}><span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}><span className="h-1.5 w-1.5 rounded-full bg-tone-success" /> Active</span></Tip>;
  if (resident.portal === 'invited') return <span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}><span className="h-1.5 w-1.5 rounded-full border border-muted-foreground" /> Invited</span>;
  return <span className={cn('text-sm text-faint', className)}>Not invited</span>;
}

/**
 * Residents as a list or table: who lives where, what they owe, how to reach
 * them and whether they use the portal. Scoped by the page's tab (current,
 * moving in, past, everyone).
 */
export function ResidentsView({ status, surfaceKey }: { status: ResidentStatus; surfaceKey: string }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const list = useListState<ResidentGrouping, ResidentOrdering>(surfaceKey, { ...DEFAULT_OPTIONS, ...(status === 'past' ? { grouping: 'none' as const, ordering: 'name' as const } : {}) }, {});
  const { options, setOptions, filters, setFilters } = list;
  const layout = options.layout === 'board' ? 'list' : options.layout;

  const query = useMemo<ResidentFilters>(() => {
    const arr = (k: string) => (Array.isArray(filters[k]) && (filters[k] as string[]).length ? (filters[k] as string[]) : undefined);
    const q: ResidentFilters = {
      status,
      propertyIds: arr('propertyIds'),
      portal: arr('portal') as ResidentFilters['portal'],
      hasBalance: filters.hasBalance === 'true' || undefined,
      search: typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : undefined,
    };
    return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as ResidentFilters;
  }, [filters, status]);
  const { data, isPending, isFetching, isError, error, refetch } = useResidents(query);
  const rows = data?.residents ?? [];
  const groups = useMemo(() => groupResidents(rows, options.grouping, options.ordering, ws), [rows, options.grouping, options.ordering, ws]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups(surfaceKey);
  const visible = useMemo(() => (layout === 'table' ? [...rows].sort(compareResidents(options.ordering, ws)) : groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items))), [layout, rows, groups, collapsed, options.ordering, ws]);

  useEffect(() => {
    try {
      sessionStorage.setItem(NAV_ORDER_KEY, JSON.stringify(visible.slice(0, 2000).map(r => r.id)));
    } catch {
      /* storage unavailable */
    }
  }, [visible]);

  const open = useCallback((r: ResidentRow) => navigate(`/residents/${r.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: r => r.id, onOpen: open });
  const { selection, selected, focusedId, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;
  useEffect(() => clearSelection(), [status]);

  const message = (rs: ResidentRow[]) => {
    if (!rs.length) return;
    app.openCompose({ recipients: rs.map(r => ({ kind: 'tenant' as const, id: r.id, name: r.name, email: r.email || null })), context: rs.length === 1 && rs[0].lease ? { leaseId: rs[0].lease.id } : undefined });
  };
  useHotkeys({ m: () => ws.can('communications.send') && message(targets()) });

  const exportCsv = (subset?: ResidentRow[]) =>
    downloadCsv(
      'residents',
      ['Name', 'Email', 'Phone', 'Company', 'Property', 'Unit', 'Lease', 'Phase', 'Role', 'Move-in', 'Move-out', 'Rent', 'Balance', 'Portal'],
      [...(subset ?? rows)].sort(compareResidents(options.ordering, ws)).map(r => [r.name, r.email, r.phone, r.company, ws.propertyName(r.lease?.propertyId), r.lease?.unitId ? ws.unitById.get(r.lease.unitId)?.name ?? '' : '', r.lease ? leaseRef(r.lease.number) : '', r.lease?.phase ?? '', r.lease?.role ?? '', r.lease?.moveInDate ?? '', r.lease?.moveOutDate ?? '', r.lease?.rent ?? '', r.balance, r.portal]),
    );

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
      singleFilter('hasBalance', 'Balance', <Wallet />, () => [{ value: 'true', label: 'Owes money' }]),
      listFilter('portal', 'Portal', <Wifi />, () => [
        { value: 'active', label: 'Uses the portal' },
        { value: 'invited', label: 'Invited, not signed in' },
        { value: 'none', label: 'Not invited' },
      ]),
    ],
    [ws],
  );

  const properties = useMemo(() => new Set(options.properties), [options.properties]);
  const hasAnyFilter = countFilters(filters) > 0 || Boolean(filters[SEARCH_KEY]);

  const listGroups: ListGroup<ResidentRow>[] = useMemo(
    () => groups.map(g => ({ key: g.key, label: g.label, items: g.items, icon: g.kind === 'property' ? <PropertySwatch color={g.color} /> : undefined, hint: g.items.some(r => r.balance > 0.004) ? `${ws.money(g.items.reduce((s, r) => s + Math.max(0, r.balance), 0))} owed` : undefined })),
    [groups, ws],
  );

  const columns: Column<ResidentRow>[] = useMemo(
    () => [
      { key: 'name', header: 'Name', cell: r => <span className="flex min-w-0 items-center gap-2"><Avatar name={r.name} color={r.color || undefined} size={20} /><span className="truncate font-medium">{r.name}</span></span>, sort: r => r.name, className: 'max-w-[240px]' },
      { key: 'unit', header: 'Unit', cell: r => (r.lease ? <span className="flex min-w-0 items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(r.lease.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(r.lease.unitId, r.lease.propertyId)}</span></span> : <span className="text-muted-foreground">—</span>), sort: r => (r.lease ? ws.unitLabel(r.lease.unitId, r.lease.propertyId) : null) },
      { key: 'phase', header: 'Lease', cell: r => (r.lease ? <LeasePhasePill phase={r.lease.phase as LeasePhase} /> : null), sort: r => r.lease?.phase, hideBelow: 'md' },
      { key: 'email', header: 'Email', cell: r => <span className="block max-w-[220px] truncate text-muted-foreground">{r.email}</span>, sort: r => r.email, hideBelow: 'lg' },
      { key: 'phone', header: 'Phone', cell: r => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{r.phone}</span>, sort: r => r.phone, hideBelow: 'xl' },
      { key: 'portal', header: 'Portal', cell: r => <PortalStatus resident={r} />, sort: r => r.portal, hideBelow: 'lg' },
      { key: 'moveIn', header: 'Move-in', cell: r => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{shortDate(r.lease?.moveInDate)}</span>, sort: r => r.lease?.moveInDate, hideBelow: 'md' },
      { key: 'balance', header: 'Balance', align: 'right', cell: r => <Money value={r.balance} tone="balance" muted0 />, sort: r => r.balance, footer: <Money value={rows.reduce((s, r) => s + r.balance, 0)} tone="balance" /> },
    ],
    [ws, rows],
  );

  const content = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Residents didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length) {
      return hasAnyFilter ? (
        <EmptyState className="py-20" icon={<Users />} title="No residents match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState
          className="py-20"
          icon={<Users />}
          title={status === 'future' ? 'Nobody is moving in' : status === 'past' ? 'No past residents yet' : status === 'current' ? 'No current residents' : 'No residents yet'}
          description={status === 'future' ? 'Residents on leases that start later — or are still waiting for signatures — show up here.' : status === 'past' ? 'When a lease ends, its residents move here with their history.' : 'Residents are added when you create a lease, or on their own.'}
          action={status !== 'past' ? <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate(status === 'future' || status === 'current' ? 'lease' : 'tenant')}><Plus className="h-3.5 w-3.5" /> {status === 'all' ? 'New resident' : 'New lease'}</button> : undefined}
        />
      );
    }
    if (layout === 'table') {
      return <DataTable rows={visible} columns={columns} getId={r => r.id} onRowClick={onRowClick} selection={selection} onToggleSelect={(r, e) => toggleSelect(r, e)} onSelectAll={all => setSelection(all ? new Set(visible.map(r => r.id)) : new Set())} focusedId={focusedId} onHover={onHover} className="h-full" caption="Residents" />;
    }
    return (
      <GroupedList
        label="Residents"
        groups={listGroups}
        single={options.grouping === 'none'}
        getId={r => r.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(r => r.id)]))}
        renderRow={r => <ResidentListRow resident={r} properties={properties} hideProperty={options.grouping === 'property'} hidePhase={options.grouping === 'phase'} selected={selection.has(r.id)} focused={focusedId === r.id} selecting={selecting} onClick={onRowClick} onHover={onHover} onToggleSelect={toggleSelect} targetsFor={targetsFor} onMessage={message} />}
      />
    );
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['resident', 'residents']}
        search={typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : ''}
        onSearch={q => setFilters((f: Filters) => ({ ...f, [SEARCH_KEY]: q || undefined }))}
        searchPlaceholder="Search name, email, phone, unit…"
        layout={layout}
        layouts={['list', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={isFetching && !isPending}
        display={<DisplayMenu options={{ ...options, layout }} onChange={setOptions} groupings={GROUPINGS} orderings={ORDERINGS} properties={layout === 'list' ? DISPLAY_PROPERTIES : undefined} onReset={list.reset} isDirty={list.isDirty} />}
        more={
          <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => exportCsv()} disabled={!rows.length}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </DropdownMenuItem>
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      <BulkBar count={selected.length} noun={['resident', 'residents']} onClear={clearSelection}>
        {ws.can('communications.send') && <button type="button" className={bulkButton} onClick={() => message(selected)}><MessageSquare /> Message</button>}
        <button type="button" className={bulkButton} onClick={() => { exportCsv(selected); toast.success(`Exported ${selected.length} ${selected.length === 1 ? 'resident' : 'residents'}`); }}><Download /> Export</button>
      </BulkBar>
    </div>
  );
}

type RowProps = {
  resident: ResidentRow;
  properties: Set<string>;
  hideProperty: boolean;
  hidePhase: boolean;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  onClick: (r: ResidentRow, e: MouseEvent) => void;
  onHover: (r: ResidentRow) => void;
  onToggleSelect: (r: ResidentRow, e: MouseEvent) => void;
  targetsFor: (r: ResidentRow) => ResidentRow[];
  onMessage: (rs: ResidentRow[]) => void;
};

const ResidentListRow = memo(function ResidentListRow({ resident: r, properties, hideProperty, hidePhase, selected, focused, selecting, onClick, onHover, onToggleSelect, targetsFor, onMessage }: RowProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const has = (k: string) => properties.has(k);
  const property = r.lease?.propertyId ? ws.propertyById.get(r.lease.propertyId) : undefined;
  const menuTargets = targetsFor(r);
  return (
    <RowShell
      id={r.id}
      selected={selected}
      focused={focused}
      selecting={selecting}
      onClick={e => onClick(r, e)}
      onHover={() => onHover(r)}
      onToggleSelect={e => onToggleSelect(r, e)}
      muted={r.status === 'past'}
      menu={
        <div onClick={e => e.stopPropagation()}>
          {menuTargets.length === 1 && <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => navigate(`/residents/${r.id}`)}><SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open</ContextMenuItem>}
          {ws.can('communications.send') && <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => onMessage(menuTargets)}><MessageSquare className="h-3.5 w-3.5" /> Message{menuTargets.length > 1 ? ` ${menuTargets.length} residents` : ''} <ContextMenuShortcut>M</ContextMenuShortcut></ContextMenuItem>}
          {menuTargets.length === 1 && r.lease && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => navigate(`/leases/${r.lease!.id}`)}><UserRound className="h-3.5 w-3.5" /> Open lease {leaseRef(r.lease.number)}</ContextMenuItem>
              {ws.can('receivables.manage') && r.lease.status !== 'Draft' && <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('payment', { leaseId: r.lease!.id, tenantId: r.id })}><Wallet className="h-3.5 w-3.5" /> Receive payment</ContextMenuItem>}
            </>
          )}
        </div>
      }
    >
      <Avatar name={r.name} color={r.color || undefined} size={20} />
      <span className={cn('min-w-0 shrink truncate font-medium', r.status === 'past' && 'font-normal')}>{r.name}</span>
      {has('email') && r.email && <span className="hidden min-w-0 truncate text-[13.5px] text-muted-foreground lg:inline">{r.email}</span>}
      {r.lease?.unitId && <span className="min-w-0 truncate text-[13.5px] text-muted-foreground sm:hidden">{ws.unitById.get(r.lease.unitId)?.name}</span>}
      <span className="min-w-4 flex-1" />
      {has('unit') && r.lease && !(hideProperty && (ws.unitsByProperty.get(r.lease.propertyId ?? '')?.length ?? 0) <= 1) && (
        <span className="chip hidden max-w-[210px] sm:inline-flex">
          {!hideProperty && <PropertySwatch color={property?.color} />}
          <span className="truncate">{hideProperty && r.lease.unitId ? ws.unitById.get(r.lease.unitId)?.name : ws.unitLabel(r.lease.unitId, r.lease.propertyId)}</span>
        </span>
      )}
      {has('phase') && !hidePhase && r.lease && <LeasePhasePill phase={r.lease.phase as LeasePhase} className="hidden md:inline-flex" />}
      {has('phone') && <span className="hidden w-[118px] shrink-0 truncate text-right text-sm tabular-nums text-muted-foreground xl:inline">{r.phone ? <a href={telHref(r.phone)} onClick={e => e.stopPropagation()} className="hover:text-foreground hover:underline">{r.phone}</a> : '—'}</span>}
      {has('portal') && <span className="hidden w-[84px] shrink-0 lg:inline-flex"><PortalStatus resident={r} /></span>}
      {has('moveIn') && (
        <Tip label={r.lease?.moveInDate ? `${r.status === 'future' ? 'Moves in' : 'Moved in'} ${fullDate(r.lease.moveInDate)}` : 'No move-in date'}>
          <span className="hidden w-[72px] shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground md:inline">{r.lease?.moveInDate ? format(parseDay(r.lease.moveInDate), 'MMM d ’yy') : ''}</span>
        </Tip>
      )}
      {has('balance') && <span className="w-[84px] shrink-0 text-right text-[13.5px]"><Money value={r.balance} tone="balance" muted0 /></span>}
    </RowShell>
  );
});
