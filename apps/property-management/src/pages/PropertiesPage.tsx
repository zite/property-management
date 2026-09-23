import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Building2, CircleDashed, Download, Home, Link2, Pencil, Plus, SquareArrowOutUpRight, UserRound, UserRoundCog, Wrench } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveProperty } from 'zitejs/api';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { PROPERTY_STATUSES, PROPERTY_TYPES } from '@project/shared/constants';
import { BulkBar, bulkButton } from '../components/list/BulkBar';
import { DataTable, type Column } from '../components/list/DataTable';
import { FilterChips, FilterMenu, listFilter, type FilterDef } from '../components/list/Filters';
import { GroupedList, RowShell, Slot, type ListGroup } from '../components/list/GroupedList';
import { DisplayMenu, ListToolbar } from '../components/list/Toolbar';
import { useListNav } from '../components/list/useListNav';
import { MemberPicker } from '../components/pickers/pickers';
import { Avatar, MemberAvatar, UnassignedAvatar } from '../components/primitives/Avatar';
import { EmptyState, SkeletonRows, Tip } from '../components/primitives/bits';
import { Money } from '../components/primitives/data';
import { Pill } from '../components/primitives/glyphs';
import { OccupancyBar, PropertyThumb } from '../components/portfolio/bits';
import { afterPortfolioWrite, occupancyOf, propertyAddress, usePropertyStats, type OccupancyCounts, type PropertyStats } from '../components/portfolio/data';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { downloadCsv } from '../lib/csv';
import { errorMessage } from '../lib/errors';
import { appUrl, percent, plural } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type ListOptions } from '../lib/listState';
import type { Property } from '../lib/types';
import { useWorkspace, type Workspace } from '../lib/workspace';

/**
 * Every property the company manages, as a list or a table: occupancy, rent,
 * what's past due and open work at a glance, grouped by owner, manager or type.
 * Rows open the property; A assigns a manager; E edits.
 */

type Grouping = 'owner' | 'manager' | 'type' | 'none';
type Ordering = 'name' | 'units' | 'occupancy' | 'vacant' | 'pastDue' | 'rent' | 'workOrders';
type Options = ListOptions<Grouping, Ordering>;

type Row = Property & { counts: OccupancyCounts; stats: PropertyStats | null; ownerName: string; managerName: string; address: string };

const DEFAULTS: Options = { layout: 'list', grouping: 'none', ordering: 'name', properties: ['address', 'type', 'units', 'occupancy', 'rent', 'pastDue', 'workOrders', 'owner', 'manager'], showEmptyGroups: false, showClosed: false };

const GROUPINGS: ReadonlyArray<{ value: Grouping; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'type', label: 'Type' },
];
const ORDERINGS: ReadonlyArray<{ value: Ordering; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'units', label: 'Most units' },
  { value: 'occupancy', label: 'Lowest occupancy' },
  { value: 'vacant', label: 'Most vacant units' },
  { value: 'pastDue', label: 'Most past due' },
  { value: 'rent', label: 'Highest rent' },
  { value: 'workOrders', label: 'Most open work orders' },
];
const PROPS = [
  { key: 'code', label: 'Code' },
  { key: 'address', label: 'Address' },
  { key: 'type', label: 'Type' },
  { key: 'units', label: 'Units' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'rent', label: 'Scheduled rent' },
  { key: 'pastDue', label: 'Past due' },
  { key: 'workOrders', label: 'Work orders' },
  { key: 'owner', label: 'Owner' },
  { key: 'manager', label: 'Manager' },
];

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compare(ordering: Ordering) {
  const byName = (a: Row, b: Row) => collator.compare(a.name, b.name);
  switch (ordering) {
    case 'units': return (a: Row, b: Row) => b.counts.total - a.counts.total || byName(a, b);
    case 'occupancy': return (a: Row, b: Row) => a.counts.rate - b.counts.rate || byName(a, b);
    case 'vacant': return (a: Row, b: Row) => b.counts.vacant - a.counts.vacant || byName(a, b);
    case 'pastDue': return (a: Row, b: Row) => (b.stats?.pastDue ?? 0) - (a.stats?.pastDue ?? 0) || byName(a, b);
    case 'rent': return (a: Row, b: Row) => (b.stats?.scheduledRent ?? 0) - (a.stats?.scheduledRent ?? 0) || byName(a, b);
    case 'workOrders': return (a: Row, b: Row) => (b.stats?.openWorkOrders ?? 0) - (a.stats?.openWorkOrders ?? 0) || byName(a, b);
    default: return byName;
  }
}

function groupRows(rows: Row[], grouping: Grouping, ws: Workspace): ListGroup<Row>[] {
  if (grouping === 'none') return [{ key: 'all', label: 'All properties', items: rows }];
  const buckets = new Map<string, Row[]>();
  const keyOf = (r: Row) => (grouping === 'owner' ? r.ownerId ?? '__none__' : grouping === 'manager' ? r.managerId ?? '__none__' : r.propertyType);
  for (const r of rows) buckets.set(keyOf(r), [...(buckets.get(keyOf(r)) ?? []), r]);
  const hint = (items: Row[]) => {
    const c = items.reduce((a, r) => ({ total: a.total + r.counts.total, filled: a.filled + r.counts.occupied + r.counts.notice }), { total: 0, filled: 0 });
    return `${plural(c.total, 'unit')} · ${percent(c.filled, c.total)}% occupied`;
  };
  const groups = [...buckets.entries()].map(([key, items]) => {
    if (grouping === 'owner') {
      const o = ws.ownerById.get(key);
      return { key, label: o?.name ?? 'No owner', items, hint: hint(items), icon: o ? <Avatar name={o.name} color={o.color} size={16} /> : <UnassignedAvatar size={16} /> };
    }
    if (grouping === 'manager') {
      const m = ws.memberById.get(key);
      return { key, label: m ? (m.id === ws.me.id ? `${m.name} (you)` : m.name) : 'No manager', items, hint: hint(items), icon: m ? <MemberAvatar member={m} size={16} /> : <UnassignedAvatar size={16} /> };
    }
    return { key, label: key, items, hint: hint(items), icon: <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> };
  });
  const order = (g: ListGroup<Row>) => (g.key === '__none__' ? 1 : 0);
  return groups.sort((a, b) => order(a) - order(b) || (grouping === 'type' ? PROPERTY_TYPES.indexOf(a.key as never) - PROPERTY_TYPES.indexOf(b.key as never) : collator.compare(a.label, b.label)));
}

export function PropertiesPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useDocumentTitle('Properties');
  const list = useListState<Grouping, Ordering>('properties', DEFAULTS, {});
  const { options, setOptions, filters, setFilters } = list;
  const stats = usePropertyStats();
  const statsBy = useMemo(() => new Map((stats.data?.stats ?? []).map(s => [s.propertyId, s])), [stats.data]);
  const money = ws.can('accounting.view');
  const manage = ws.can('portfolio.manage');
  const search = typeof filters.search === 'string' ? filters.search : '';

  const all: Row[] = useMemo(
    () =>
      ws.properties.map(p => ({
        ...p,
        counts: occupancyOf(ws.unitsByProperty.get(p.id) ?? []),
        stats: statsBy.get(p.id) ?? null,
        ownerName: p.ownerId ? ws.ownerById.get(p.ownerId)?.name ?? '' : '',
        managerName: p.managerId ? ws.memberName(p.managerId) : '',
        address: propertyAddress(p),
      })),
    [ws, statsBy],
  );

  const arr = (k: string) => (Array.isArray(filters[k]) ? (filters[k] as string[]) : []);
  const rows = useMemo(() => {
    const types = arr('types');
    const owners = arr('ownerIds');
    const managers = arr('managerIds').map(v => (v === '__me__' ? ws.me.id : v));
    const statuses = arr('statuses');
    const q = search.trim().toLowerCase();
    return all
      .filter(r => (statuses.length ? statuses.includes(r.status) : options.showClosed || r.status !== 'Archived'))
      .filter(r => !types.length || types.includes(r.propertyType))
      .filter(r => !owners.length || owners.includes(r.ownerId ?? '__none__'))
      .filter(r => !managers.length || managers.includes(r.managerId ?? '__none__'))
      .filter(r => !q || [r.name, r.code, r.address, r.ownerName, r.managerName].some(v => v.toLowerCase().includes(q)))
      .sort(compare(options.ordering));
  }, [all, filters, options.showClosed, options.ordering, search, ws.me.id]);

  const grouping = options.layout === 'table' ? 'none' : options.grouping;
  const groups = useMemo(() => groupRows(rows, grouping, ws), [rows, grouping, ws]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups('properties');
  const visible = useMemo(() => (options.layout === 'table' ? rows : groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items))), [groups, collapsed, rows, options.layout]);

  const [picker, setPicker] = useState<{ ids: string[]; anchor: 'row' | 'bulk' | 'float' } | null>(null);
  const open = useCallback((r: Row) => navigate(`/properties/${r.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: r => r.id, onOpen: open, enabled: !picker });
  const { selection, selected, focusedId, focused, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  const setManager = async (ids: string[], managerId: string | null) => {
    setPicker(null);
    const changing = ids.filter(id => (ws.propertyById.get(id)?.managerId ?? null) !== managerId);
    if (!changing.length) return;
    try {
      for (const id of changing) await saveProperty({ action: 'update', id, fields: { managerId } });
      afterPortfolioWrite(qc);
      const who = managerId ? ws.memberName(managerId) : 'no manager';
      toast.success(changing.length === 1 ? `${ws.propertyName(changing[0])} → ${who}` : `${plural(changing.length, 'property', 'properties')} → ${who}`);
    } catch (e) {
      afterPortfolioWrite(qc);
      toast.error(errorMessage(e, 'Couldn’t change the manager'));
    }
  };

  useHotkeys(
    {
      a: () => {
        if (!manage) return;
        const t = targets();
        if (t.length) setPicker({ ids: t.map(r => r.id), anchor: selection.size ? 'bulk' : options.layout === 'list' ? 'row' : 'float' });
      },
      e: () => manage && focused && app.openCreate('property', { propertyId: focused.id }),
    },
    { enabled: !picker },
  );

  useEffect(() => clearSelection(), [options.layout]);

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      listFilter('types', 'Type', <Home />, () => PROPERTY_TYPES.map(t => ({ value: t, label: t }))),
      listFilter('ownerIds', 'Owner', <UserRound />, () => [{ value: '__none__', label: 'No owner' }, ...ws.owners.map(o => ({ value: o.id, label: o.name, icon: <Avatar name={o.name} color={o.color} size={16} />, keywords: [o.contactName] }))]),
      listFilter('managerIds', 'Manager', <UserRoundCog />, () => [
        { value: '__me__', label: 'Me', icon: <MemberAvatar member={ws.memberById.get(ws.me.id)} size={16} /> },
        { value: '__none__', label: 'No manager', icon: <UnassignedAvatar size={16} /> },
        ...ws.activeMembers.filter(m => m.id !== ws.me.id && (m.role === 'Admin' || m.role === 'Property Manager')).map(m => ({ value: m.id, label: m.name, icon: <MemberAvatar member={m} size={16} /> })),
      ]),
      listFilter('statuses', 'Status', <CircleDashed />, () => PROPERTY_STATUSES.map(s => ({ value: s, label: s }))),
    ],
    [ws],
  );
  const hasFilters = countFilters(filters) > 0 || Boolean(search);

  const exportCsv = () =>
    downloadCsv(
      'properties',
      ['Name', 'Code', 'Type', 'Status', 'Street', 'City', 'State', 'ZIP', 'Owner', 'Manager', 'Units', 'Occupied', 'On notice', 'Vacant', 'Occupancy %', ...(money ? ['Scheduled rent', 'Past due', 'Cash'] : []), 'Open work orders'],
      rows.map(r => [r.name, r.code, r.propertyType, r.status, r.street, r.city, r.state, r.postalCode, r.ownerName, r.managerName, r.counts.total, r.counts.occupied, r.counts.notice, r.counts.vacant, percent(r.counts.occupied + r.counts.notice, r.counts.total), ...(money ? [r.stats?.scheduledRent ?? 0, r.stats?.pastDue ?? 0, r.stats?.cash ?? 0] : []), r.stats?.openWorkOrders ?? 0]),
    );

  const props = new Set(options.properties);
  const totals = useMemo(() => rows.reduce((a, r) => ({ units: a.units + r.counts.total, filled: a.filled + r.counts.occupied + r.counts.notice, rent: a.rent + (r.stats?.scheduledRent ?? 0), pastDue: a.pastDue + (r.stats?.pastDue ?? 0), work: a.work + (r.stats?.openWorkOrders ?? 0) }), { units: 0, filled: 0, rent: 0, pastDue: 0, work: 0 }), [rows]);

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Property', sort: r => r.name, className: 'min-w-[220px]', cell: r => <span className="flex min-w-0 items-center gap-2.5"><PropertyThumb photoUrl={r.photoUrl} color={r.color} code={r.code} size={24} /><span className={cn('truncate font-medium', r.status === 'Archived' && 'text-muted-foreground')}>{r.name}</span>{r.status !== 'Active' && <Pill>{r.status}</Pill>}</span> },
    { key: 'code', header: 'Code', sort: r => r.code, width: 72, cell: r => <span className="font-mono text-sm text-muted-foreground">{r.code}</span> },
    { key: 'type', header: 'Type', sort: r => r.propertyType, hideBelow: 'lg', cell: r => r.propertyType },
    { key: 'address', header: 'Address', sort: r => r.address, hideBelow: 'xl', className: 'max-w-[240px]', cell: r => <span className="block truncate text-muted-foreground">{r.address}</span> },
    { key: 'units', header: 'Units', align: 'right', sort: r => r.counts.total, cell: r => r.counts.total, footer: totals.units },
    { key: 'occupancy', header: 'Occupancy', sort: r => r.counts.rate, width: 150, hideBelow: 'sm', cell: r => <OccupancyBar counts={r.counts} className="w-[130px]" />, footer: <span className="text-sm text-muted-foreground">{percent(totals.filled, totals.units)}%</span> },
    ...(money ? [
      { key: 'rent', header: 'Scheduled rent', align: 'right' as const, sort: (r: Row) => r.stats?.scheduledRent ?? 0, hideBelow: 'md' as const, cell: (r: Row) => <Money value={r.stats?.scheduledRent} cents={false} muted0 />, footer: <Money value={totals.rent} cents={false} /> },
      { key: 'pastDue', header: 'Past due', align: 'right' as const, sort: (r: Row) => r.stats?.pastDue ?? 0, hideBelow: 'md' as const, cell: (r: Row) => <Money value={r.stats?.pastDue} tone="balance" muted0 />, footer: <Money value={totals.pastDue} tone="balance" /> },
    ] : []),
    { key: 'workOrders', header: 'Work orders', align: 'right', sort: r => r.stats?.openWorkOrders ?? 0, hideBelow: 'lg', cell: r => <WorkCount stats={r.stats} />, footer: totals.work },
    { key: 'owner', header: 'Owner', sort: r => r.ownerName, hideBelow: 'lg', className: 'max-w-[180px]', cell: r => <span className="block truncate">{r.ownerName || <span className="text-muted-foreground">—</span>}</span> },
    { key: 'manager', header: 'Manager', sort: r => r.managerName, hideBelow: 'xl', cell: r => (r.managerId ? <span className="inline-flex items-center gap-1.5"><MemberAvatar member={ws.memberById.get(r.managerId)} size={16} />{r.managerName}</span> : <span className="text-muted-foreground">—</span>) },
  ];

  const content = (() => {
    if (!ws.properties.length) {
      return (
        <EmptyState
          className="py-24"
          icon={<Building2 />}
          title="No properties yet"
          description="Add a building or home you manage. Units, leases, work orders and owner statements all hang off it."
          action={manage ? <button type="button" onClick={() => app.openCreate('property')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New property</button> : undefined}
        />
      );
    }
    if (!rows.length) {
      return hasFilters ? (
        <EmptyState className="py-20" icon={<Building2 />} title="No properties match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState className="py-20" icon={<Archive />} title="Every property is archived" description="Turn on “Show archived” in Display to see them." action={<button type="button" className="ghost-chip h-9" onClick={() => setOptions({ showClosed: true })}>Show archived</button>} />
      );
    }
    if (options.layout === 'table') {
      return (
        <DataTable
          rows={visible}
          columns={columns.filter(c => c.key === 'name' || props.has(c.key))}
          getId={r => r.id}
          onRowClick={onRowClick}
          selection={selection}
          onToggleSelect={(r, e) => toggleSelect(r, e)}
          onSelectAll={on => setSelection(on ? new Set(visible.map(r => r.id)) : new Set())}
          focusedId={focusedId}
          onHover={onHover}
          className="h-full pb-24"
          caption="Properties"
        />
      );
    }
    return (
      <GroupedList
        label="Properties"
        groups={groups}
        single={grouping === 'none'}
        getId={r => r.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(r => r.id)]))}
        renderRow={r => (
          <PropertyRow
            row={r}
            props={props}
            money={money}
            selected={selection.has(r.id)}
            focused={focusedId === r.id}
            selecting={selecting}
            pickerOpen={picker?.anchor === 'row' && picker.ids[0] === r.id}
            onPicker={o => setPicker(o && manage ? { ids: targetsFor(r).map(t => t.id), anchor: 'row' } : null)}
            onManager={id => void setManager(picker?.ids ?? [r.id], id)}
            onClick={onRowClick}
            onHover={onHover}
            onToggleSelect={toggleSelect}
            menu={<PropertyMenu rows={targetsFor(r)} onManager={() => setPicker({ ids: targetsFor(r).map(t => t.id), anchor: options.layout === 'list' ? 'row' : 'float' })} />}
            canManage={manage}
          />
        )}
      />
    );
  })();

  return (
    <>
      <PageHeader
        icon={<Building2 />}
        title="Properties"
        actions={
          manage && (
            <button type="button" onClick={() => app.openCreate('property')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New property</span>
            </button>
          )
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
          count={rows.length}
          countLabel={['property', 'properties']}
          search={search}
          onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
          searchPlaceholder="Search name, code, address, owner…"
          layout={options.layout}
          layouts={['list', 'table']}
          onLayout={l => setOptions({ layout: l })}
          fetching={stats.isFetching && !stats.isPending}
          display={<DisplayMenu options={options} onChange={setOptions} groupings={GROUPINGS} orderings={ORDERINGS} properties={PROPS.filter(p => money || !['rent', 'pastDue'].includes(p.key))} closedLabel="Show archived properties" onReset={list.reset} isDirty={list.isDirty} />}
          more={
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </DropdownMenuItem>
          }
        />
        {stats.isError && (
          <div className="flex items-center gap-2 border-b bg-tone-warning/[0.06] px-4 py-1.5 text-sm text-tone-warning">
            Rent, past due and work order figures didn’t load. <button type="button" className="underline" onClick={() => void stats.refetch()}>Try again</button>
          </div>
        )}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {stats.isPending ? <SkeletonRows rows={8} className="px-3 pt-2" /> : content}
        </div>
        {picker?.anchor === 'float' && (
          <div className="pointer-events-none absolute left-1/2 top-12 z-40">
            <MemberPicker value={ws.propertyById.get(picker.ids[0])?.managerId ?? null} onChange={id => void setManager(picker.ids, id)} noneLabel="No manager" filter={m => m.role === 'Admin' || m.role === 'Property Manager'} open onOpenChange={o => !o && setPicker(null)} align="center" trigger={<span className="block h-0 w-0" />} />
          </div>
        )}
        <BulkBar count={selected.length} noun={['property', 'properties']} onClear={clearSelection}>
          {manage && (
            <MemberPicker
              value={selected.every(r => r.managerId === selected[0]?.managerId) ? selected[0]?.managerId ?? null : undefined}
              onChange={id => void setManager(selected.map(r => r.id), id)}
              noneLabel="No manager"
              filter={m => m.role === 'Admin' || m.role === 'Property Manager'}
              open={picker?.anchor === 'bulk'}
              onOpenChange={o => setPicker(o ? { ids: selected.map(r => r.id), anchor: 'bulk' } : null)}
              align="center"
              trigger={<button type="button" className={bulkButton}><UserRoundCog /> Manager</button>}
            />
          )}
          <button
            type="button"
            className={bulkButton}
            onClick={() => downloadCsv('properties-selected', ['Name', 'Code', 'Type', 'Units', 'Occupancy %', 'Owner', 'Manager'], selected.map(r => [r.name, r.code, r.propertyType, r.counts.total, percent(r.counts.occupied + r.counts.notice, r.counts.total), r.ownerName, r.managerName]))}
          >
            <Download /> Export
          </button>
        </BulkBar>
      </div>
    </>
  );
}

function WorkCount({ stats }: { stats: PropertyStats | null }) {
  if (!stats?.openWorkOrders) return <span className="text-muted-foreground/70">—</span>;
  return (
    <Tip label={`${plural(stats.openWorkOrders, 'open work order')}${stats.emergencyWorkOrders ? ` · ${stats.emergencyWorkOrders} emergency` : ''}`}>
      <span className={cn('inline-flex items-center gap-1 tabular-nums', stats.emergencyWorkOrders ? 'text-tone-danger' : 'text-muted-foreground')}>
        <Wrench className="h-3 w-3" /> {stats.openWorkOrders}
      </span>
    </Tip>
  );
}

type RowProps = {
  row: Row;
  props: Set<string>;
  money: boolean;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  pickerOpen: boolean;
  canManage: boolean;
  onPicker: (open: boolean) => void;
  onManager: (id: string | null) => void;
  onClick: (r: Row, e: MouseEvent) => void;
  onHover: (r: Row) => void;
  onToggleSelect: (r: Row, e: MouseEvent) => void;
  menu: React.ReactNode;
};

const PropertyRow = memo(function PropertyRow({ row: r, props, money, selected, focused, selecting, pickerOpen, canManage, onPicker, onManager, onClick, onHover, onToggleSelect, menu }: RowProps) {
  const ws = useWorkspace();
  const owner = r.ownerId ? ws.ownerById.get(r.ownerId) : undefined;
  const manager = r.managerId ? ws.memberById.get(r.managerId) : undefined;
  const archived = r.status === 'Archived';
  return (
    <RowShell id={r.id} height={52} selected={selected} focused={focused} selecting={selecting} onClick={e => onClick(r, e)} onHover={() => onHover(r)} onToggleSelect={e => onToggleSelect(r, e)} menu={menu} muted={archived}>
      <PropertyThumb photoUrl={r.photoUrl} color={r.color} code={r.code} name={r.name} size={32} className={cn('ml-0.5', archived && 'opacity-60 grayscale')} />
      <span className="min-w-0 flex-1 sm:flex-none sm:basis-[260px] lg:basis-[320px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{r.name}</span>
          {props.has('code') && r.code && <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{r.code}</span>}
          {r.status !== 'Active' && <Pill className="shrink-0">{r.status}</Pill>}
        </span>
        {props.has('address') && <span className="block truncate text-sm text-muted-foreground">{r.address || 'No address'}</span>}
      </span>
      <span className="min-w-2 flex-1" />
      {props.has('type') && <span className="chip hidden shrink-0 lg:inline-flex">{r.propertyType}</span>}
      {props.has('units') && <span className="hidden w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:inline">{plural(r.counts.total, 'unit')}</span>}
      {props.has('occupancy') && <OccupancyBar counts={r.counts} className="hidden w-28 shrink-0 sm:inline-flex" />}
      <span className="shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:hidden">{r.counts.total ? `${percent(r.counts.occupied + r.counts.notice, r.counts.total)}%` : '—'}</span>
      {money && props.has('rent') && <span className="hidden w-[84px] shrink-0 text-right text-[13.5px] xl:inline"><Money value={r.stats?.scheduledRent} cents={false} muted0 /></span>}
      {money && props.has('pastDue') && (
        <span className="hidden w-[92px] shrink-0 text-right text-[13.5px] md:inline">
          {r.stats?.pastDue ? <Tip label="Past due"><span><Money value={r.stats.pastDue} tone="balance" /></span></Tip> : <span className="text-muted-foreground/60">—</span>}
        </span>
      )}
      {props.has('workOrders') && <span className="hidden w-10 shrink-0 text-right text-sm md:inline"><WorkCount stats={r.stats} /></span>}
      {props.has('owner') && (
        <span className="hidden w-[160px] shrink-0 lg:flex">
          {owner ? <span className="chip max-w-full"><Avatar name={owner.name} color={owner.color} size={14} /><span className="truncate">{owner.name}</span></span> : <span className="px-1 text-sm text-muted-foreground">No owner</span>}
        </span>
      )}
      {props.has('manager') &&
        (canManage ? (
          <Slot
            label={manager ? `Manager: ${manager.name}` : 'No manager'}
            active={pickerOpen}
            onActivate={() => onPicker(true)}
            picker={trigger => <MemberPicker value={r.managerId} onChange={onManager} noneLabel="No manager" filter={m => m.role === 'Admin' || m.role === 'Property Manager'} open onOpenChange={onPicker} align="end" trigger={trigger} />}
          >
            <span className="flex h-6 w-6 items-center justify-center">{manager ? <MemberAvatar member={manager} size={20} /> : <UnassignedAvatar size={20} />}</span>
          </Slot>
        ) : (
          <Tip label={manager ? `Managed by ${manager.name}` : 'No manager'}>
            <span className="flex h-6 w-6 items-center justify-center">{manager ? <MemberAvatar member={manager} size={20} /> : <UnassignedAvatar size={20} />}</span>
          </Tip>
        ))}
    </RowShell>
  );
});

const item = 'h-9 gap-2 text-[14px]';

function PropertyMenu({ rows, onManager }: { rows: Row[]; onManager: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const single = rows.length === 1 ? rows[0] : null;
  const manage = ws.can('portfolio.manage');

  const archive = async (r: Row) => {
    const restoring = r.status === 'Archived';
    if (!restoring && !(await app.confirm({ title: `Archive ${r.name}?`, description: 'It leaves lists, pickers and reports. Its units, leases and books are kept, and you can restore it any time.', confirmLabel: 'Archive property', destructive: true }))) return;
    try {
      await saveProperty({ action: restoring ? 'unarchive' : 'archive', id: r.id });
      afterPortfolioWrite(qc);
      toast.success(restoring ? `Restored ${r.name}` : `Archived ${r.name}`);
    } catch (e) {
      toast.error(errorMessage(e, restoring ? 'Couldn’t restore the property' : 'Couldn’t archive the property'));
    }
  };

  return (
    <div onClick={e => e.stopPropagation()}>
      {!single && <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{rows.length} properties selected</div>}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => navigate(`/properties/${single.id}`)}>
            <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut>
          </ContextMenuItem>
          {manage && (
            <ContextMenuItem className={item} onSelect={() => app.openCreate('property', { propertyId: single.id })}>
              <Pencil className="h-3.5 w-3.5" /> Edit <ContextMenuShortcut>E</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {ws.can('maintenance.create') && (
            <ContextMenuItem className={item} onSelect={() => app.openCreate('workOrder', { propertyId: single.id })}>
              <Wrench className="h-3.5 w-3.5" /> New work order
            </ContextMenuItem>
          )}
          {manage && single.status !== 'Archived' && (
            <ContextMenuItem className={item} onSelect={() => app.openCreate('unit', { propertyId: single.id })}>
              <Plus className="h-3.5 w-3.5" /> Add unit
            </ContextMenuItem>
          )}
        </>
      )}
      {manage && (
        <ContextMenuItem className={item} onSelect={onManager}>
          <UserRoundCog className="h-3.5 w-3.5" /> Set manager <ContextMenuShortcut>A</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem className={item} onSelect={() => void copyText(rows.map(r => appUrl(`/properties/${r.id}`)).join('\n'), single ? `Copied link to ${single.name}` : `Copied ${rows.length} links`)}>
        <Link2 className="h-3.5 w-3.5" /> Copy link
      </ContextMenuItem>
      {manage && single && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem className={cn(item, single.status !== 'Archived' && 'text-tone-danger focus:text-tone-danger')} onSelect={() => void archive(single)}>
            {single.status === 'Archived' ? <><ArchiveRestore className="h-3.5 w-3.5" /> Restore</> : <><Archive className="h-3.5 w-3.5" /> Archive…</>}
          </ContextMenuItem>
        </>
      )}
    </div>
  );
}
