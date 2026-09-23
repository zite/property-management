import { useQueryClient } from '@tanstack/react-query';
import {
  Building2, CalendarClock, CircleDashed, Download, Flag, Pencil, Plus, RotateCcw, Save, ShieldQuestion, Signal, Tag, Trash2, UserRound, Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveView } from 'zitejs/api';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { OWNER_APPROVALS, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_SOURCES, WORK_ORDER_STATUSES } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { useAppActions, type CreateDefaults } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDate, shortDateTime } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { cleanFilters, countFilters, useCollapsedGroups, useListState, type Filters, type ListOptions } from '../../lib/listState';
import { invalidate } from '../../lib/queries';
import type { SavedView } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { Board, type BoardColumn } from '../list/Board';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, type ListGroup } from '../list/GroupedList';
import { parseViewConfig, SaveViewDialog } from '../list/SaveViewDialog';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import {
  DISPLAY_PROPERTIES, GROUPINGS, NAV_ORDER_KEY, groupWorkOrders, ORDERINGS, patchForGroup, useWorkOrderActions, useWorkOrders, compareWorkOrders,
  type WorkOrder, type WorkOrderFilters, type WorkOrderGrouping, type WorkOrderOrdering,
} from './data';
import { WorkOrderMenu } from './WorkOrderMenu';
import { WorkOrderPicker, type WorkOrderPickerKind } from './WorkOrderPicker';
import { DueChip, WorkOrderCard, WorkOrderRow, type RowPicker } from './WorkOrderRow';

type Options = ListOptions<WorkOrderGrouping, WorkOrderOrdering>;

export const DEFAULT_OPTIONS: Options = {
  layout: 'list',
  grouping: 'status',
  ordering: 'priority',
  properties: ['priority', 'number', 'location', 'vendor', 'scheduled', 'due', 'approval', 'messages', 'assignee'],
  showEmptyGroups: false,
  showClosed: false,
};

export type WorkOrdersViewProps = {
  /** Where display options and filters are remembered, e.g. `work-orders`, `property:<id>:work-orders`. */
  surfaceKey: string;
  /** The surface's fixed scope, merged under the person's own filters (a property, a vendor, a lease). */
  baseFilters?: WorkOrderFilters;
  defaults?: Partial<Options>;
  defaultFilters?: Filters;
  savedView?: SavedView | null;
  /** Filters that make no sense to change on this surface (e.g. property on a property page). */
  lockedFilters?: string[];
  toolbarStart?: ReactNode;
  /** Pre-fill for "New work order" from this surface. */
  createDefaults?: CreateDefaults;
  hideLocation?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Embedded on a record page: shorter empty states. */
  compact?: boolean;
  /** Set false when embedded on a page that owns J/K and the property shortcuts itself. */
  keyboard?: boolean;
};

const SEARCH_KEY = 'search';

function toQuery(base: WorkOrderFilters, f: Filters, showClosed: boolean): WorkOrderFilters {
  const arr = (k: string) => (Array.isArray(f[k]) && (f[k] as string[]).length ? (f[k] as string[]) : undefined);
  const q: WorkOrderFilters = {
    ...base,
    statuses: (arr('statuses') as WorkOrderFilters['statuses']) ?? base.statuses,
    priorities: (arr('priorities') as WorkOrderFilters['priorities']) ?? base.priorities,
    categories: (arr('categories') as WorkOrderFilters['categories']) ?? base.categories,
    sources: (arr('sources') as WorkOrderFilters['sources']) ?? base.sources,
    approvals: (arr('approvals') as WorkOrderFilters['approvals']) ?? base.approvals,
    propertyIds: arr('propertyIds') ?? base.propertyIds,
    assigneeIds: arr('assigneeIds') ?? base.assigneeIds,
    vendorIds: arr('vendorIds') ?? base.vendorIds,
    due: (typeof f.due === 'string' ? (f.due as WorkOrderFilters['due']) : undefined) ?? base.due,
    unscheduled: f.unscheduled === 'true' || f.unscheduled === true || base.unscheduled || undefined,
    search: typeof f[SEARCH_KEY] === 'string' ? (f[SEARCH_KEY] as string) : undefined,
    showClosed: showClosed || base.showClosed || undefined,
  };
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as WorkOrderFilters;
}

/**
 * Every work order list, board and table in the app is this component —
 * the maintenance queue, a property's or vendor's work, a saved view. It owns
 * fetching, filters, grouping, keyboard navigation, bulk edits, export and
 * saving views; a surface only says what it's scoped to.
 */
export function WorkOrdersView({ surfaceKey, baseFilters = {}, defaults, defaultFilters = {}, savedView, lockedFilters = [], toolbarStart, createDefaults, hideLocation, emptyTitle, emptyDescription, compact, keyboard = true }: WorkOrdersViewProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { update } = useWorkOrderActions();
  const viewConfig = useMemo(() => (savedView ? parseViewConfig(savedView.config) : null), [savedView]);
  const list = useListState<WorkOrderGrouping, WorkOrderOrdering>(surfaceKey, { ...DEFAULT_OPTIONS, ...defaults, ...(viewConfig?.options as Partial<Options>) }, viewConfig?.filters ?? defaultFilters);
  const { options, setOptions, filters, setFilters } = list;
  const layout = options.layout;

  const query = useMemo(() => toQuery(baseFilters, filters, options.showClosed), [baseFilters, filters, options.showClosed]);
  const { data, isPending, isFetching, isError, error, refetch } = useWorkOrders(query);
  const rows = data?.workOrders ?? [];

  const grouping: WorkOrderGrouping = layout === 'board' && options.grouping === 'none' ? 'status' : options.grouping;
  const groups = useMemo(
    () => groupWorkOrders(rows, grouping, options.ordering, ws, { showEmpty: options.showEmptyGroups, showClosed: options.showClosed || Boolean(query.statuses?.some(s => s === 'Completed' || s === 'Canceled')), board: layout === 'board' }),
    [rows, grouping, options.ordering, options.showEmptyGroups, options.showClosed, query.statuses, ws, layout],
  );
  const [collapsed, toggleCollapsed] = useCollapsedGroups(surfaceKey);
  const visible = useMemo(() => {
    if (layout === 'table') return [...rows].sort(compareWorkOrders(options.ordering));
    return groups.flatMap(g => (layout === 'list' && collapsed.has(g.key) ? [] : g.items));
  }, [groups, collapsed, layout, rows, options.ordering]);

  useEffect(() => {
    try {
      sessionStorage.setItem(NAV_ORDER_KEY, JSON.stringify(visible.slice(0, 2000).map(w => w.number)));
    } catch {
      /* storage unavailable */
    }
  }, [visible]);

  const [rowPicker, setRowPicker] = useState<RowPicker>(null);
  const [bulkPicker, setBulkPicker] = useState<WorkOrderPickerKind | null>(null);
  const [floatingPicker, setFloatingPicker] = useState<{ kind: WorkOrderPickerKind; targets: WorkOrder[] } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const pickerOpen = Boolean(rowPicker || bulkPicker || floatingPicker);

  const open = useCallback((w: WorkOrder) => navigate(`/work-orders/${w.number}`), [navigate]);
  const nav = useListNav({ items: visible, getId: w => w.id, onOpen: open, onPeek: w => app.peekWorkOrder(w.number), enabled: keyboard && !pickerOpen });
  const { selection, selected, focusedId, focused, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  useEffect(() => {
    clearSelection();
    setRowPicker(null);
  }, [surfaceKey]);

  const openPicker = (kind: WorkOrderPickerKind) => {
    if (selection.size > 0) return setBulkPicker(kind);
    if (!focused) return;
    if (layout === 'list') setRowPicker({ id: focused.id, kind });
    else setFloatingPicker({ kind, targets: [focused] });
  };
  useHotkeys(
    {
      s: () => openPicker('status'),
      p: () => openPicker('priority'),
      a: () => openPicker('assignee'),
      v: () => ws.can('maintenance.manage') && openPicker('vendor'),
      d: () => openPicker('due'),
      'shift+d': () => openPicker('schedule'),
      i: () => {
        const t = targets();
        if (t.length) void update(t, { assigneeId: ws.me.id }, { toast: t.length === 1 ? `${workOrderRef(t[0].number)} assigned to you` : undefined }).catch(() => undefined);
      },
      'mod+shift+enter': () => {
        const t = targets().filter(w => w.status !== 'Completed');
        if (t.length) void update(t, { status: 'Completed' }, { toast: t.length === 1 ? `${workOrderRef(t[0].number)} completed` : undefined }).catch(() => undefined);
      },
    },
    { enabled: keyboard && !pickerOpen },
  );

  const onPicker = useCallback((id: string, kind: WorkOrderPickerKind | null) => setRowPicker(kind ? { id, kind } : null), []);
  const properties = useMemo(() => new Set(options.properties.filter(p => !(p === 'assignee' && grouping === 'assignee' && layout === 'list'))), [options.properties, grouping, layout]);

  // ── Filters ──
  const filterDefs = useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      listFilter('statuses', 'Status', <CircleDashed />, () => WORK_ORDER_STATUSES.map(s => ({ value: s, label: s, icon: <WorkOrderStatusGlyph status={s} /> }))),
      listFilter('priorities', 'Priority', <Signal />, () => WORK_ORDER_PRIORITIES.map(p => ({ value: p, label: p, icon: <PriorityGlyph priority={p} /> }))),
      listFilter('assigneeIds', 'Assignee', <UserRound />, () => [
        { value: '__me__', label: 'Me', icon: <MemberAvatar member={ws.memberById.get(ws.me.id)} size={16} /> },
        { value: '__none__', label: 'Unassigned', icon: <UnassignedAvatar size={16} /> },
        ...ws.activeMembers.filter(m => m.id !== ws.me.id).map(m => ({ value: m.id, label: m.name, icon: <MemberAvatar member={m} size={16} />, keywords: [m.role] })),
      ]),
      listFilter('vendorIds', 'Vendor', <Wrench />, () => [{ value: '__none__', label: 'In-house (no vendor)' }, ...ws.vendors.map(v => ({ value: v.id, label: v.name, keywords: [v.trade] }))]),
      listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
      listFilter('categories', 'Category', <Tag />, () => WORK_ORDER_CATEGORIES.map(c => ({ value: c, label: c }))),
      singleFilter('due', 'Due', <Flag />, () => [
        { value: 'overdue', label: 'Overdue' },
        { value: 'today', label: 'Due today' },
        { value: 'week', label: 'Due within a week' },
      ]),
      singleFilter('unscheduled', 'Schedule', <CalendarClock />, () => [{ value: 'true', label: 'Not scheduled yet' }]),
      listFilter('approvals', 'Owner approval', <ShieldQuestion />, () => OWNER_APPROVALS.map(a => ({ value: a, label: a }))),
      listFilter('sources', 'Source', <Plus />, () => WORK_ORDER_SOURCES.map(s => ({ value: s, label: s }))),
    ];
    return defs.filter(d => !lockedFilters.includes(d.key));
  }, [ws, lockedFilters]);

  // ── Saved view dirty state ──
  const viewDirty = Boolean(savedView) && list.isDirty;
  const saveCurrentView = async () => {
    if (!savedView) return;
    try {
      await saveView({ action: 'update', id: savedView.id, config: { filters: cleanFilters(filters), options: options as unknown as Record<string, unknown> } });
      // The saved config becomes the new baseline when bootstrap refetches, so the view reads as clean.
      invalidate(qc, 'bootstrap');
      toast.success('View updated');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t update the view'));
    }
  };
  const canEditView = savedView && (savedView.ownerId === ws.me.id || ws.can('settings.manage'));

  const exportCsv = () => {
    const sorted = [...rows].sort(compareWorkOrders(options.ordering));
    downloadCsv(
      'work-orders',
      ['ID', 'Title', 'Status', 'Priority', 'Category', 'Property', 'Unit', 'Resident', 'Assignee', 'Vendor', 'Scheduled', 'Due', 'Estimate', 'Cost', 'Owner approval', 'Source', 'Reported', 'Completed'],
      sorted.map(w => [workOrderRef(w.number), w.title, w.status, w.priority, w.category, ws.propertyName(w.propertyId), w.unitId ? ws.unitById.get(w.unitId)?.name ?? '' : '', w.tenantName ?? '', ws.memberName(w.assigneeId), w.vendorId ? ws.vendorById.get(w.vendorId)?.name ?? '' : '', w.scheduledFor ?? '', w.dueDate ?? '', w.estimateAmount, w.actualCost, w.ownerApproval, w.source, w.reportedAt.slice(0, 10), w.completedAt?.slice(0, 10) ?? '']),
    );
  };

  // ── Rendering ──
  const listGroups: ListGroup<WorkOrder>[] = useMemo(
    () =>
      groups.map(g => ({
        key: g.key,
        label: g.label,
        items: g.items,
        icon:
          g.kind === 'status' ? <WorkOrderStatusGlyph status={g.key} /> :
          g.kind === 'priority' ? <PriorityGlyph priority={g.key} /> :
          g.kind === 'assignee' ? (g.key === '__none__' ? <UnassignedAvatar size={16} /> : <MemberAvatar member={ws.memberById.get(g.key)} size={16} />) :
          g.kind === 'property' ? <PropertySwatch color={g.color} /> :
          g.kind === 'vendor' && g.key !== '__none__' ? <Wrench className="h-3.5 w-3.5 text-muted-foreground" /> : undefined,
      })),
    [groups, ws],
  );

  const columns: BoardColumn<WorkOrder>[] = useMemo(
    () => listGroups.map((g, i) => ({ ...g, droppable: groups[i]?.droppable !== false, emptyText: grouping === 'status' ? 'Drop work orders here' : 'Nothing here' })),
    [listGroups, groups, grouping],
  );

  const tableColumns: Column<WorkOrder>[] = useMemo(
    () => [
      { key: 'number', header: 'ID', width: 80, cell: w => <span className="tabular-nums text-muted-foreground">{workOrderRef(w.number)}</span>, sort: w => w.number },
      { key: 'title', header: 'Title', cell: w => <span className="flex min-w-0 items-center gap-2"><WorkOrderStatusGlyph status={w.status} /><span className="truncate font-medium">{w.title}</span></span>, sort: w => w.title, className: 'max-w-[360px]' },
      { key: 'status', header: 'Status', cell: w => w.status, sort: w => WORK_ORDER_STATUSES.indexOf(w.status as never), hideBelow: 'md' },
      { key: 'priority', header: 'Priority', cell: w => <span className="inline-flex items-center gap-1.5"><PriorityGlyph priority={w.priority} /> {w.priority}</span>, sort: w => WORK_ORDER_PRIORITIES.indexOf(w.priority as never) },
      { key: 'location', header: 'Unit', cell: w => <span className="inline-flex max-w-[220px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(w.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(w.unitId, w.propertyId)}</span></span>, sort: w => ws.unitLabel(w.unitId, w.propertyId), hideBelow: 'md' },
      { key: 'resident', header: 'Resident', cell: w => w.tenantName ?? '', sort: w => w.tenantName, hideBelow: 'xl' },
      { key: 'category', header: 'Category', cell: w => w.category, sort: w => w.category, hideBelow: 'lg' },
      { key: 'vendor', header: 'Vendor', cell: w => (w.vendorId ? ws.vendorById.get(w.vendorId)?.name : <span className="text-muted-foreground">In-house</span>), sort: w => (w.vendorId ? ws.vendorById.get(w.vendorId)?.name : ''), hideBelow: 'lg' },
      { key: 'assignee', header: 'Assignee', cell: w => (w.assigneeId ? <span className="inline-flex items-center gap-1.5"><MemberAvatar member={ws.memberById.get(w.assigneeId)} size={16} />{ws.memberName(w.assigneeId)}</span> : <span className="text-muted-foreground">—</span>), sort: w => ws.memberName(w.assigneeId), hideBelow: 'md' },
      { key: 'scheduled', header: 'Scheduled', cell: w => (w.scheduledFor ? shortDateTime(w.scheduledFor) : ''), sort: w => w.scheduledFor, hideBelow: 'xl' },
      { key: 'due', header: 'Due', cell: w => <DueChip day={w.dueDate} closed={w.status === 'Completed' || w.status === 'Canceled'} />, sort: w => w.dueDate },
      { key: 'estimate', header: 'Estimate', align: 'right', cell: w => <Money value={w.estimateAmount} muted0 />, sort: w => w.estimateAmount ?? 0, hideBelow: 'lg' },
      { key: 'cost', header: 'Cost', align: 'right', cell: w => <Money value={w.actualCost} muted0 />, sort: w => w.actualCost ?? 0, hideBelow: 'lg', footer: <Money value={rows.reduce((s, w) => s + (w.actualCost ?? 0), 0)} /> },
      { key: 'created', header: 'Reported', cell: w => shortDate(w.reportedAt.slice(0, 10)), sort: w => w.reportedAt, hideBelow: 'xl' },
    ],
    [ws, rows],
  );

  const filterCount = countFilters(filters);
  const hasAnyFilter = filterCount > 0 || Boolean(filters[SEARCH_KEY]);

  const content = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) {
      return <EmptyState className={compact ? 'py-8' : 'py-20'} title="Work orders didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    }
    if (!rows.length && layout !== 'board') {
      return hasAnyFilter ? (
        <EmptyState className={compact ? 'py-8' : 'py-20'} icon={<Wrench />} title="No work orders match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState
          className={compact ? 'py-8' : 'py-20'}
          icon={<Wrench />}
          title={emptyTitle ?? (options.showClosed ? 'No work orders yet' : 'No open work orders')}
          description={emptyDescription ?? 'Requests from residents arrive here automatically. Staff can log one with C.'}
          action={ws.can('maintenance.create') ? <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('workOrder', createDefaults)}><Plus className="h-3.5 w-3.5" /> New work order</button> : undefined}
        />
      );
    }
    if (layout === 'board') {
      return (
        <Board
          columns={columns}
          getId={w => w.id}
          selection={selection}
          focusedId={focusedId}
          onCardClick={onRowClick}
          menuFor={w => <WorkOrderMenu targets={targetsFor(w)} />}
          renderCard={(w, s) => <WorkOrderCard workOrder={w} {...s} hideStatus={grouping === 'status'} hideAssignee={grouping === 'assignee'} />}
          onMove={(w, _from, to) => {
            const patch = patchForGroup(grouping, to);
            if (!patch) return;
            const moving = selection.has(w.id) && selection.size > 1 ? selected : [w];
            void update(moving, patch, { toast: moving.length === 1 ? `${workOrderRef(w.number)} → ${groups.find(g => g.key === to)?.label}` : undefined }).catch(() => undefined);
          }}
        />
      );
    }
    if (layout === 'table') {
      return (
        <DataTable
          rows={visible}
          columns={tableColumns.filter(c => c.key === 'title' || c.key === 'status' || options.properties.includes(c.key) || c.key === 'estimate' || c.key === 'cost')}
          getId={w => w.id}
          onRowClick={onRowClick}
          selection={selection}
          onToggleSelect={(w, e) => toggleSelect(w, e)}
          onSelectAll={all => setSelection(all ? new Set(visible.map(w => w.id)) : new Set())}
          focusedId={focusedId}
          onHover={onHover}
          className="h-full pb-24"
          caption="Work orders"
        />
      );
    }
    return (
      <GroupedList
        label="Work orders"
        groups={listGroups}
        single={grouping === 'none'}
        getId={w => w.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(w => w.id)]))}
        renderRow={w => (
          <WorkOrderRow
            workOrder={w}
            properties={properties}
            selected={selection.has(w.id)}
            focused={focusedId === w.id}
            selecting={selecting}
            picker={rowPicker?.id === w.id ? rowPicker.kind : null}
            onPicker={onPicker}
            onClick={onRowClick}
            onHover={onHover}
            onToggleSelect={toggleSelect}
            targetsFor={targetsFor}
            hideLocation={hideLocation}
          />
        )}
      />
    );
  })();

  const bulkTrigger = (kind: WorkOrderPickerKind, icon: ReactNode, label: string) => (
    <WorkOrderPicker
      kind={kind}
      targets={selected}
      open={bulkPicker === kind}
      onOpenChange={o => setBulkPicker(o ? kind : null)}
      align="center"
      trigger={<button type="button" className={bulkButton}>{icon} {label}</button>}
    />
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            {toolbarStart}
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
            {viewDirty && canEditView && (
              <span className="ml-1 flex items-center gap-1">
                <button type="button" onClick={() => void saveCurrentView()} className="ghost-chip h-8 gap-1.5 text-primary"><Save className="h-3.5 w-3.5" /> Save view</button>
                <button type="button" onClick={list.reset} className="ghost-chip h-8 gap-1.5 text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
              </span>
            )}
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['work order', 'work orders']}
        search={typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : ''}
        onSearch={q => setFilters(f => ({ ...f, [SEARCH_KEY]: q || undefined }))}
        searchPlaceholder="Search title, resident, ID…"
        layout={layout}
        layouts={['list', 'board', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={isFetching && !isPending}
        display={
          <DisplayMenu
            options={options}
            onChange={setOptions}
            groupings={GROUPINGS}
            orderings={ORDERINGS}
            properties={DISPLAY_PROPERTIES}
            closedLabel="Show completed & canceled"
            onReset={list.reset}
            isDirty={list.isDirty && !savedView}
          />
        }
        more={
          <>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </DropdownMenuItem>
            {!savedView && (
              <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setSaveOpen(true)}>
                <Save className="h-3.5 w-3.5" /> Save as view…
              </DropdownMenuItem>
            )}
            {savedView && canEditView && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setSaveOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Rename or share view…
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger"
                  onSelect={async () => {
                    if (!(await app.confirm({ title: `Delete “${savedView.name}”?`, description: 'The view is removed for everyone it’s shared with. Work orders aren’t affected.', confirmLabel: 'Delete view', destructive: true }))) return;
                    try {
                      await saveView({ action: 'delete', id: savedView.id });
                      invalidate(qc, 'bootstrap');
                      navigate('/work-orders');
                      toast.success('View deleted');
                    } catch (e) {
                      toast.error(errorMessage(e, 'Couldn’t delete the view'));
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete view
                </DropdownMenuItem>
              </>
            )}
          </>
        }
      />
      {floatingPicker && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-40">
          <WorkOrderPicker kind={floatingPicker.kind} targets={floatingPicker.targets} open onOpenChange={o => !o && setFloatingPicker(null)} align="center" trigger={<span className="block h-0 w-0" />} />
        </div>
      )}
      <div ref={scrollRef} className={layout === 'board' ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'}>
        {content}
      </div>
      <BulkBar count={selected.length} noun={['work order', 'work orders']} onClear={clearSelection}>
        {bulkTrigger('status', <CircleDashed />, 'Status')}
        {bulkTrigger('priority', <Signal />, 'Priority')}
        {bulkTrigger('assignee', <UserRound />, 'Assign')}
        {ws.can('maintenance.manage') && bulkTrigger('vendor', <Wrench />, 'Vendor')}
        {bulkTrigger('due', <Flag />, 'Due')}
      </BulkBar>
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        scope="work_orders"
        config={{ filters: cleanFilters(filters), options }}
        existing={savedView ? { id: savedView.id, name: savedView.name, shared: savedView.shared } : null}
      />
    </div>
  );
}
