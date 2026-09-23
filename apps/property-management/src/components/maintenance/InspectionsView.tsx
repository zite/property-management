import { useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Building2, CalendarRange, CircleDashed, ClipboardCheck, Download, Flag, Plus, Share2, SquareArrowOutUpRight, Tag, UserRound } from 'lucide-react';
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveInspection, type ListInspectionsOutputType } from 'zitejs/api';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { INSPECTION_STATUSES, INSPECTION_TYPES, type Role } from '@project/shared/constants';
import { can } from '@project/shared/roles';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDate, shortDateTime } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type ListOptions } from '../../lib/listState';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, RowShell, Slot, type ListGroup } from '../list/GroupedList';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { EmptyState, ProgressRing, SkeletonRows, Tip } from '../primitives/bits';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { MemberPicker } from '../pickers/pickers';
import { InspectionStatusGlyph } from './bits';
import { mk, useInspections, type InspectionRow } from './data';

type Grouping = 'status' | 'type' | 'property' | 'inspector' | 'none';
type Ordering = 'scheduled' | 'recent' | 'progress' | 'issues';

const GROUPINGS: ReadonlyArray<{ value: Grouping; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
  { value: 'property', label: 'Property' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'none', label: 'No grouping' },
];
const ORDERINGS: ReadonlyArray<{ value: Ordering; label: string }> = [
  { value: 'scheduled', label: 'Scheduled date' },
  { value: 'recent', label: 'Most recent first' },
  { value: 'progress', label: 'Progress' },
  { value: 'issues', label: 'Issues flagged' },
];
const PROPERTIES = [
  { key: 'type', label: 'Type' },
  { key: 'residents', label: 'Residents' },
  { key: 'progress', label: 'Progress' },
  { key: 'issues', label: 'Issues' },
  { key: 'scheduled', label: 'Date' },
  { key: 'inspector', label: 'Inspector' },
];
const DEFAULTS: ListOptions<Grouping, Ordering> = { layout: 'list', grouping: 'status', ordering: 'scheduled', properties: PROPERTIES.map(p => p.key), showEmptyGroups: false, showClosed: false };

const RANGES = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'past30', label: 'Last 30 days' },
  { value: 'past90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
];

const localDays = (iso: string | null) => (iso ? differenceInCalendarDays(parseISO(iso), new Date()) : null);
const isOpen = (i: InspectionRow) => i.status === 'Scheduled' || i.status === 'In progress';

function inRange(i: InspectionRow, range: string) {
  const when = i.status === 'Completed' ? i.completedAt ?? i.scheduledFor : i.scheduledFor;
  const d = localDays(when);
  if (d == null) return false;
  switch (range) {
    case 'overdue': return isOpen(i) && d < 0;
    case 'today': return d === 0;
    case 'next7': return d >= 0 && d <= 7;
    case 'next30': return d >= 0 && d <= 30;
    case 'past30': return d <= 0 && d >= -30;
    case 'past90': return d <= 0 && d >= -90;
    case 'year': return (when ?? '').slice(0, 4) === String(new Date().getFullYear());
    default: return true;
  }
}

/** "Today · 10:00 AM", "Overdue · Sep 3", "Sep 30". */
export function WhenLabel({ inspection: i, className }: { inspection: Pick<InspectionRow, 'status' | 'scheduledFor' | 'completedAt'>; className?: string }) {
  if (i.status === 'Completed') return <span className={cn('whitespace-nowrap text-sm text-muted-foreground', className)}>{i.completedAt ? `Done ${shortDate(i.completedAt)}` : 'Done'}</span>;
  if (!i.scheduledFor) return <span className={cn('text-sm text-muted-foreground', className)}>Not scheduled</span>;
  const d = localDays(i.scheduledFor)!;
  const time = new Date(i.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const label = i.status === 'Canceled' ? shortDate(i.scheduledFor) : d < 0 ? `Overdue · ${shortDate(i.scheduledFor)}` : d === 0 ? `Today · ${time}` : d === 1 ? `Tomorrow · ${time}` : shortDate(i.scheduledFor);
  return (
    <Tip label={shortDateTime(i.scheduledFor)}>
      <span className={cn('whitespace-nowrap text-sm tabular-nums', i.status !== 'Canceled' && d < 0 ? 'text-tone-danger' : d <= 1 && i.status !== 'Canceled' ? 'text-tone-warning' : 'text-muted-foreground', className)}>{label}</span>
    </Tip>
  );
}

export function InspectionProgress({ stats, status }: { stats: InspectionRow['stats']; status: string }) {
  const value = stats.total ? stats.rated / stats.total : 0;
  return (
    <Tip label={`${stats.rated} of ${stats.total} items checked${stats.photos ? ` · ${stats.photos} photos` : ''}`}>
      <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
        <ProgressRing value={value} size={14} className={status === 'Completed' ? 'text-tone-success' : value > 0 ? 'text-tone-warning' : 'text-muted-foreground'} />
        {stats.rated}/{stats.total}
      </span>
    </Tip>
  );
}

/**
 * The inspections list: grouped by status (or type, property, inspector),
 * filtered by status, type, property, inspector and date, with progress and
 * issue counts on every row. `A` assigns the focused inspection's inspector.
 */
export function InspectionsView({ scope }: { scope: 'all' | 'mine' }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useListState<Grouping, Ordering>(`inspections:${scope}`, DEFAULTS);
  const { options, setOptions, filters, setFilters } = list;
  const history = options.showClosed;
  const { data, isPending, isError, error, refetch, isFetching } = useInspections(history);
  const layout = options.layout === 'board' ? 'list' : options.layout;
  const props = useMemo(() => new Set(options.properties), [options.properties]);
  const [picker, setPicker] = useState<string | null>(null);
  const [bulkInspector, setBulkInspector] = useState(false);

  const rows = useMemo(() => {
    const arr = (k: string) => (Array.isArray(filters[k]) ? (filters[k] as string[]) : []);
    const statuses = arr('statuses');
    const types = arr('types');
    const propertyIds = arr('propertyIds');
    const inspectors = arr('inspectorIds').map(v => (v === '__me__' ? ws.me.id : v));
    const q = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
    return (data?.inspections ?? []).filter(i => {
      if (scope === 'mine' && i.inspectorId !== ws.me.id) return false;
      if (statuses.length && !statuses.includes(i.status)) return false;
      if (types.length && !types.includes(i.type)) return false;
      if (propertyIds.length && !propertyIds.includes(i.propertyId ?? '')) return false;
      if (inspectors.length && !inspectors.some(v => (v === '__none__' ? !i.inspectorId : v === i.inspectorId))) return false;
      if (typeof filters.range === 'string' && !inRange(i, filters.range)) return false;
      if (q && ![i.title, i.residentNames, i.leaseName ?? '', ws.unitLabel(i.unitId, i.propertyId), i.type].some(s => s.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, filters, scope, ws]);

  const sorted = useMemo(() => {
    const when = (i: InspectionRow) => i.scheduledFor ?? i.createdAt ?? '';
    const cmp: Record<Ordering, (a: InspectionRow, b: InspectionRow) => number> = {
      // Open work soonest first; finished work most recent first.
      scheduled: (a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || (isOpen(a) ? when(a).localeCompare(when(b)) : (b.completedAt ?? when(b)).localeCompare(a.completedAt ?? when(a))),
      recent: (a, b) => when(b).localeCompare(when(a)),
      progress: (a, b) => (b.stats.total ? b.stats.rated / b.stats.total : 0) - (a.stats.total ? a.stats.rated / a.stats.total : 0),
      issues: (a, b) => b.stats.issues - a.stats.issues || when(b).localeCompare(when(a)),
    };
    return [...rows].sort(cmp[options.ordering] ?? cmp.scheduled);
  }, [rows, options.ordering]);

  const groups: ListGroup<InspectionRow>[] = useMemo(() => {
    const make = (key: string, label: string, items: InspectionRow[], icon?: ReactNode) => ({ key, label, items, icon });
    switch (options.grouping) {
      case 'status':
        return INSPECTION_STATUSES.map(s => make(s, s, sorted.filter(i => i.status === s), <InspectionStatusGlyph status={s} />)).filter(g => g.items.length || (options.showEmptyGroups && g.key !== 'Canceled'));
      case 'type':
        return INSPECTION_TYPES.map(t => make(t, t, sorted.filter(i => i.type === t))).filter(g => g.items.length || options.showEmptyGroups);
      case 'property':
        return ws.orderedProperties.map(p => make(p.id, p.name, sorted.filter(i => i.propertyId === p.id), <PropertySwatch color={p.color} />)).filter(g => g.items.length || (options.showEmptyGroups && ws.propertyById.get(g.key)?.status !== 'Archived'));
      case 'inspector': {
        const ids = [...new Set(sorted.map(i => i.inspectorId ?? '__none__'))];
        return ids
          .map(id => make(id, id === '__none__' ? 'No inspector' : id === ws.me.id ? `${ws.memberName(id)} (you)` : ws.memberName(id), sorted.filter(i => (i.inspectorId ?? '__none__') === id), id === '__none__' ? <UnassignedAvatar size={16} /> : <MemberAvatar member={ws.memberById.get(id)} size={16} />))
          .sort((a, b) => Number(b.key === ws.me.id) - Number(a.key === ws.me.id) || Number(a.key === '__none__') - Number(b.key === '__none__') || a.label.localeCompare(b.label));
      }
      default:
        return [make('all', 'Inspections', sorted)];
    }
  }, [sorted, options.grouping, options.showEmptyGroups, ws]);

  const [collapsed, toggleCollapsed] = useCollapsedGroups(`inspections:${scope}`);
  const visible = useMemo(() => (layout === 'table' ? sorted : groups.flatMap(g => (options.grouping !== 'none' && collapsed.has(g.key) ? [] : g.items))), [layout, sorted, groups, collapsed, options.grouping]);
  const open = useCallback((i: InspectionRow) => navigate(`/inspections/${i.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: i => i.id, onOpen: open, enabled: !picker && !bulkInspector });
  const { selection, focusedId, focused, onRowClick, onHover, toggleSelect, setSelection, clearSelection, scrollRef, selecting, selected } = nav;

  const assign = async (i: InspectionRow, inspectorId: string | null) => {
    setPicker(null);
    if (inspectorId === i.inspectorId) return;
    const key = mk.inspectionList(history);
    const prev = qc.getQueryData<ListInspectionsOutputType>(key);
    qc.setQueryData<ListInspectionsOutputType>(key, old => (old ? { ...old, inspections: old.inspections.map(x => (x.id === i.id ? { ...x, inspectorId } : x)) } : old));
    try {
      await saveInspection({ action: 'update', id: i.id, patch: { inspectorId } });
      invalidate(qc, 'inspections');
    } catch (e) {
      if (prev) qc.setQueryData(key, prev);
      toast.error(errorMessage(e, 'Couldn’t change the inspector'));
    }
  };

  useHotkeys({ a: () => (selected.length ? setBulkInspector(true) : focused && setPicker(focused.id)) }, { enabled: !picker && !bulkInspector && layout === 'list' });

  const filterDefs = useMemo<FilterDef[]>(() => [
    listFilter('statuses', 'Status', <CircleDashed />, () => INSPECTION_STATUSES.map(s => ({ value: s, label: s, icon: <InspectionStatusGlyph status={s} /> }))),
    listFilter('types', 'Type', <Tag />, () => INSPECTION_TYPES.map(t => ({ value: t, label: t }))),
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
    ...(scope === 'all'
      ? [listFilter('inspectorIds', 'Inspector', <UserRound />, () => [
          { value: '__me__', label: 'Me', icon: <MemberAvatar member={ws.memberById.get(ws.me.id)} size={16} /> },
          { value: '__none__', label: 'No inspector', icon: <UnassignedAvatar size={16} /> },
          ...ws.activeMembers.filter(m => m.id !== ws.me.id && can(m.role as Role, 'maintenance.manage')).map(m => ({ value: m.id, label: m.name, icon: <MemberAvatar member={m} size={16} /> })),
        ])]
      : []),
    singleFilter('range', 'Date', <CalendarRange />, () => RANGES),
  ], [ws, scope]);
  const hasFilters = countFilters(filters) > 0 || Boolean(filters.search);

  const assignMany = async (targets: InspectionRow[], inspectorId: string | null) => {
    setBulkInspector(false);
    let done = 0;
    // One at a time: the platform refuses bursts of parallel writes.
    for (const t of targets) {
      if (t.inspectorId === inspectorId) continue;
      try {
        await saveInspection({ action: 'update', id: t.id, patch: { inspectorId } });
        done++;
      } catch (e) {
        toast.error(errorMessage(e, `Couldn’t change the inspector on ${ws.unitLabel(t.unitId, t.propertyId) || t.title}`));
        break;
      }
    }
    invalidate(qc, 'inspections');
    if (done) toast.success(inspectorId ? `${ws.memberName(inspectorId)} is inspecting ${done} ${done === 1 ? 'unit' : 'units'}` : `Inspector removed from ${done}`);
    clearSelection();
  };

  const exportRows = (list: InspectionRow[]) =>
    downloadCsv(
      'inspections',
      ['Title', 'Type', 'Status', 'Property', 'Unit', 'Lease', 'Residents', 'Scheduled', 'Completed', 'Inspector', 'Items checked', 'Items total', 'Flagged', 'Overall condition', 'Shared with residents', 'Acknowledged', 'Report'],
      list.map(i => [i.title, i.type, i.status, ws.propertyName(i.propertyId), i.unitId ? ws.unitById.get(i.unitId)?.name ?? '' : '', i.leaseName ?? '', i.residentNames, i.scheduledFor ?? '', i.completedAt ?? '', ws.memberName(i.inspectorId), i.stats.rated, i.stats.total, i.stats.issues, i.overallCondition ?? '', i.sharedWithTenant ? 'Yes' : 'No', i.tenantAcknowledgedAt?.slice(0, 10) ?? '', i.reportUrl ?? '']),
    );
  const exportCsv = () => exportRows(sorted);

  const menu = (i: InspectionRow) => (
    <div onClick={e => e.stopPropagation()}>
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => open(i)}><SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setPicker(i.id)}><UserRound className="h-3.5 w-3.5" /> Change inspector <ContextMenuShortcut>A</ContextMenuShortcut></ContextMenuItem>
      {i.reportUrl && <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => window.open(i.reportUrl!, '_blank', 'noopener')}><Download className="h-3.5 w-3.5" /> Open PDF report</ContextMenuItem>}
      {i.unitId && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('inspection', { unitId: i.unitId, leaseId: i.leaseId, type: i.type === 'Move-in' ? 'Move-out' : i.type })}><Plus className="h-3.5 w-3.5" /> Schedule another for this unit</ContextMenuItem>
        </>
      )}
    </div>
  );

  const renderRow = (i: InspectionRow) => {
    const inspector = i.inspectorId ? ws.memberById.get(i.inspectorId) : undefined;
    const property = i.propertyId ? ws.propertyById.get(i.propertyId) : undefined;
    return (
      <RowShell id={i.id} selected={selection.has(i.id)} focused={focusedId === i.id} selecting={selecting} onClick={(e: MouseEvent) => onRowClick(i, e)} onHover={() => onHover(i)} onToggleSelect={(e: MouseEvent) => toggleSelect(i, e)} menu={menu(i)} muted={i.status === 'Canceled'}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center"><InspectionStatusGlyph status={i.status} /></span>
        {props.has('type') && options.grouping !== 'type' && <span className="hidden w-[78px] shrink-0 truncate text-[13.5px] text-muted-foreground sm:inline">{i.type}</span>}
        <span className="flex min-w-0 items-center gap-1.5">
          {property && <PropertySwatch color={property.color} />}
          <span className={cn('truncate font-medium', i.status === 'Canceled' && 'line-through decoration-muted-foreground/50')}>{i.unitId ? ws.unitLabel(i.unitId, i.propertyId) : i.title}</span>
        </span>
        {props.has('residents') && i.residentNames && <span className="hidden min-w-0 truncate text-muted-foreground md:inline">{i.residentNames}</span>}
        <span className="min-w-4 flex-1" />
        <span className="flex shrink-0 items-center gap-3">
          {props.has('issues') && i.stats.issues > 0 && (
            <Tip label={`${i.stats.issues} ${i.stats.issues === 1 ? 'item' : 'items'} rated poor, damaged or missing${i.workOrderCount ? ` · ${i.workOrderCount} work ${i.workOrderCount === 1 ? 'order' : 'orders'}` : ''}`}>
              <span><Pill tone="danger"><Flag className="h-3 w-3" /> {i.stats.issues}</Pill></span>
            </Tip>
          )}
          {i.sharedWithTenant && i.status === 'Completed' && (
            <Tip label={i.tenantAcknowledgedAt ? `Resident acknowledged ${shortDate(i.tenantAcknowledgedAt)}` : 'Shared — waiting for the resident to acknowledge'}>
              <span className="hidden sm:inline-flex"><Share2 className={cn('h-3.5 w-3.5', i.tenantAcknowledgedAt ? 'text-tone-success' : 'text-muted-foreground')} /></span>
            </Tip>
          )}
          {props.has('progress') && i.status !== 'Canceled' && <span className="hidden sm:inline-flex"><InspectionProgress stats={i.stats} status={i.status} /></span>}
          {props.has('scheduled') && <WhenLabel inspection={i} className="hidden w-[118px] justify-end text-right md:inline-block" />}
        </span>
        {props.has('inspector') && (
          <Slot
            label={inspector ? `Inspector: ${inspector.name}` : 'No inspector'}
            active={picker === i.id}
            onActivate={() => setPicker(i.id)}
            picker={trigger => <MemberPicker value={i.inspectorId} onChange={id => void assign(i, id)} filter={m => can(m.role as Role, 'maintenance.manage')} noneLabel="No inspector" open onOpenChange={o => !o && setPicker(null)} align="end" trigger={trigger} />}
          >
            <span className="flex h-6 w-6 items-center justify-center">{inspector ? <MemberAvatar member={inspector} size={20} /> : <UnassignedAvatar size={20} />}</span>
          </Slot>
        )}
      </RowShell>
    );
  };

  const columns: Column<InspectionRow>[] = useMemo(() => [
    { key: 'unit', header: 'Unit', cell: i => <span className="flex min-w-0 items-center gap-2"><InspectionStatusGlyph status={i.status} /><PropertySwatch color={ws.propertyById.get(i.propertyId ?? '')?.color} /><span className="truncate font-medium">{ws.unitLabel(i.unitId, i.propertyId) || i.title}</span></span>, sort: i => ws.unitLabel(i.unitId, i.propertyId), className: 'max-w-[260px]' },
    { key: 'type', header: 'Type', cell: i => i.type, sort: i => i.type },
    { key: 'status', header: 'Status', cell: i => i.status, sort: i => INSPECTION_STATUSES.indexOf(i.status as never), hideBelow: 'md' },
    { key: 'scheduled', header: 'Date', cell: i => <WhenLabel inspection={i} />, sort: i => i.completedAt ?? i.scheduledFor },
    { key: 'inspector', header: 'Inspector', cell: i => (i.inspectorId ? <span className="inline-flex items-center gap-1.5"><MemberAvatar member={ws.memberById.get(i.inspectorId)} size={16} />{ws.memberName(i.inspectorId)}</span> : <span className="text-muted-foreground">—</span>), sort: i => ws.memberName(i.inspectorId), hideBelow: 'md' },
    { key: 'lease', header: 'Lease', cell: i => <span className="block max-w-[200px] truncate">{i.residentNames || <span className="text-muted-foreground">—</span>}</span>, sort: i => i.residentNames, hideBelow: 'lg' },
    { key: 'progress', header: 'Progress', cell: i => <InspectionProgress stats={i.stats} status={i.status} />, sort: i => (i.stats.total ? i.stats.rated / i.stats.total : 0), hideBelow: 'sm' },
    { key: 'issues', header: 'Flagged', align: 'right', cell: i => (i.stats.issues ? <span className="text-tone-danger">{i.stats.issues}</span> : <span className="text-muted-foreground/70">—</span>), sort: i => i.stats.issues },
    { key: 'condition', header: 'Overall', cell: i => i.overallCondition ?? <span className="text-muted-foreground/70">—</span>, sort: i => i.overallCondition, hideBelow: 'xl' },
  ], [ws]);

  const content = (() => {
    if (isPending) return <SkeletonRows rows={8} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Inspections didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length) {
      if (hasFilters) return <EmptyState className="py-20" icon={<ClipboardCheck />} title="No inspections match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />;
      return (
        <EmptyState
          className="py-20"
          icon={<ClipboardCheck />}
          title={scope === 'mine' ? 'No inspections assigned to you' : 'No inspections yet'}
          description={scope === 'mine' ? 'Inspections where you’re the inspector show up here.' : 'Schedule move-in, move-out and routine inspections, then walk through each unit from your phone.'}
          action={<button type="button" onClick={() => app.openCreate('inspection')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Schedule inspection</button>}
        />
      );
    }
    if (layout === 'table') {
      return <DataTable rows={sorted} columns={columns} getId={i => i.id} onRowClick={onRowClick} selection={selection} onToggleSelect={(i, e) => toggleSelect(i, e)} onSelectAll={all => setSelection(all ? new Set(sorted.map(i => i.id)) : new Set())} focusedId={focusedId} onHover={onHover} className="h-full pb-24" caption="Inspections" />;
    }
    return <GroupedList label="Inspections" groups={groups} single={options.grouping === 'none'} getId={i => i.id} collapsed={collapsed} onToggleCollapse={toggleCollapsed} renderRow={renderRow} />;
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={<><FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} /><FilterChips defs={filterDefs} filters={filters} onChange={setFilters} /></>}
        count={isPending ? null : rows.length}
        countLabel={['inspection', 'inspections']}
        search={typeof filters.search === 'string' ? filters.search : ''}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search unit, resident, title…"
        layout={layout}
        layouts={['list', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={isFetching && !isPending}
        display={<DisplayMenu options={{ ...options, layout }} onChange={setOptions} groupings={GROUPINGS} orderings={ORDERINGS} properties={PROPERTIES} closedLabel="Show canceled & older than a year" onReset={list.reset} isDirty={list.isDirty} />}
        more={<DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      <BulkBar count={selected.length} noun={['inspection', 'inspections']} onClear={clearSelection}>
        <MemberPicker
          value={null}
          open={bulkInspector}
          onOpenChange={setBulkInspector}
          onChange={id => void assignMany(selected, id)}
          filter={m => can(m.role as Role, 'maintenance.manage')}
          noneLabel="No inspector"
          align="center"
          trigger={<button type="button" className={bulkButton}><UserRound /> Inspector</button>}
        />
        <button type="button" className={bulkButton} onClick={() => exportRows(selected)}><Download /> Export</button>
      </BulkBar>
    </div>
  );
}
