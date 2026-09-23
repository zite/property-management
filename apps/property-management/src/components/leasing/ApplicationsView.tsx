import { useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarRange, CircleDashed, CircleDollarSign, DoorOpen, Download, FileText, Pencil, RotateCcw, Save, Trash2, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveView } from 'zitejs/api';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { APPLICATION_STATUSES, type ApplicationStatus } from '@project/shared/constants';
import { applicationRef, leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDate } from '../../lib/format';
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
import { ApplicationStatusGlyph, PropertySwatch } from '../primitives/glyphs';
import { ApplicationPicker, type ApplicationPickerKind } from './ApplicationPicker';
import { ApplicationCard, ApplicationMenu, ApplicationRow, type AppRowPicker } from './ApplicationRow';
import { FeeChip, IncomeRatio, ScreeningMeter } from './bits';
import {
  APP_NAV_ORDER_KEY, APPLICATION_GROUPINGS, APPLICATION_ORDERINGS, APPLICATION_PROPERTIES, compareApplications, groupApplications, useApplicationActions, useApplications,
  type Application, type ApplicationFilters, type ApplicationGrouping, type ApplicationOrdering,
} from './data';
import { DecisionDialog, type DecisionKind } from './DecisionDialog';
import { incomeRatio } from './rules';

type Options = ListOptions<ApplicationGrouping, ApplicationOrdering>;

export const APPLICATION_DEFAULT_OPTIONS: Options = {
  layout: 'list',
  grouping: 'status',
  ordering: 'newest',
  properties: ['number', 'unit', 'moveIn', 'income', 'screening', 'fee', 'submitted', 'assignee'],
  showEmptyGroups: false,
  showClosed: false,
};

const SEARCH_KEY = 'search';

function toQuery(base: ApplicationFilters, f: Filters, showClosed: boolean): ApplicationFilters {
  const arr = (k: string) => (Array.isArray(f[k]) && (f[k] as string[]).length ? (f[k] as string[]) : undefined);
  const q: ApplicationFilters = {
    ...base,
    statuses: (arr('statuses') as ApplicationFilters['statuses']) ?? base.statuses,
    propertyIds: arr('propertyIds') ?? base.propertyIds,
    unitIds: arr('unitIds') ?? base.unitIds,
    listingIds: arr('listingIds') ?? base.listingIds,
    assigneeIds: arr('assigneeIds') ?? base.assigneeIds,
    submitted: (typeof f.submitted === 'string' ? (f.submitted as ApplicationFilters['submitted']) : undefined) ?? base.submitted,
    feeUnpaid: f.feeUnpaid === 'true' || f.feeUnpaid === true || base.feeUnpaid || undefined,
    search: typeof f[SEARCH_KEY] === 'string' ? (f[SEARCH_KEY] as string) : undefined,
    showClosed: showClosed || base.showClosed || undefined,
  };
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as ApplicationFilters;
}

export type ApplicationsViewProps = {
  surfaceKey: string;
  baseFilters?: ApplicationFilters;
  lockedFilters?: string[];
  savedView?: SavedView | null;
  defaults?: Partial<Options>;
  hideUnit?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
};

/**
 * Every list, board and table of rental applications — the leasing queue, a
 * unit's or listing's applications, a saved view. Board columns are statuses;
 * dragging moves between Submitted and Screening, and dropping on Approved or
 * Denied opens the decision dialog rather than deciding by drag.
 */
export function ApplicationsView({ surfaceKey, baseFilters = {}, lockedFilters = [], savedView, defaults, hideUnit, emptyTitle, emptyDescription }: ApplicationsViewProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { update } = useApplicationActions();
  const viewConfig = useMemo(() => (savedView ? parseViewConfig(savedView.config) : null), [savedView]);
  const list = useListState<ApplicationGrouping, ApplicationOrdering>(surfaceKey, { ...APPLICATION_DEFAULT_OPTIONS, ...defaults, ...(viewConfig?.options as Partial<Options>) }, viewConfig?.filters ?? {});
  const { options, setOptions, filters, setFilters } = list;
  const layout = options.layout;
  // The board keeps a Denied column you can drop into, so it also shows the last month's denials.
  const boardRecent = layout === 'board' && !options.showClosed;
  const query = useMemo(() => ({ ...toQuery(baseFilters, filters, options.showClosed || boardRecent), ...(boardRecent && !filters.statuses ? { closedDays: 30 } : {}) }), [baseFilters, filters, options.showClosed, boardRecent]);
  const { data, isPending, isFetching, isError, error, refetch } = useApplications(query);
  const rows = useMemo(() => (data?.applications ?? []).filter(a => !boardRecent || (a.status !== 'Withdrawn' && a.status !== 'Leased')), [data, boardRecent]);

  const grouping: ApplicationGrouping = layout === 'board' ? 'status' : options.grouping;
  const groups = useMemo(() => groupApplications(rows, grouping, options.ordering, ws, { showEmpty: options.showEmptyGroups, showClosed: options.showClosed || Boolean(query.statuses?.length), board: layout === 'board' }), [rows, grouping, options.ordering, options.showEmptyGroups, options.showClosed, query.statuses, ws, layout]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups(surfaceKey);
  const visible = useMemo(() => (layout === 'table' ? [...rows].sort(compareApplications(options.ordering)) : groups.flatMap(g => (layout === 'list' && collapsed.has(g.key) ? [] : g.items))), [groups, collapsed, layout, rows, options.ordering]);

  useEffect(() => {
    try {
      sessionStorage.setItem(APP_NAV_ORDER_KEY, JSON.stringify(visible.slice(0, 2000).map(a => a.number).filter(Boolean)));
    } catch {
      /* storage unavailable */
    }
  }, [visible]);

  const [rowPicker, setRowPicker] = useState<AppRowPicker>(null);
  const [bulkPicker, setBulkPicker] = useState<ApplicationPickerKind | null>(null);
  const [floatingPicker, setFloatingPicker] = useState<{ kind: ApplicationPickerKind; targets: Application[] } | null>(null);
  const [decision, setDecision] = useState<{ kind: DecisionKind; target: Application } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const overlayOpen = Boolean(rowPicker || bulkPicker || floatingPicker || decision || saveOpen);

  const open = useCallback((a: Application) => navigate(`/applications/${a.number}`), [navigate]);
  const nav = useListNav({ items: visible, getId: a => a.id, onOpen: open, enabled: !overlayOpen });
  const { selection, selected, focusedId, focused, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  useEffect(() => {
    clearSelection();
    setRowPicker(null);
  }, [surfaceKey]);

  const onDecide = useCallback((kind: DecisionKind, a: Application) => setDecision({ kind, target: a }), []);
  const openPicker = (kind: ApplicationPickerKind) => {
    if (selection.size > 0) return setBulkPicker(kind);
    if (!focused) return;
    if (layout === 'list') setRowPicker({ id: focused.id, kind });
    else setFloatingPicker({ kind, targets: [focused] });
  };
  useHotkeys(
    {
      s: () => openPicker('status'),
      a: () => openPicker('assignee'),
      m: () => openPicker('moveIn'),
      i: () => {
        const t = targets().filter(x => x.assigneeId !== ws.me.id);
        if (t.length) void update(t, { assigneeId: ws.me.id }, { toast: t.length === 1 ? `${applicationRef(t[0].number)} assigned to you` : undefined }).catch(() => undefined);
      },
    },
    { enabled: !overlayOpen },
  );

  const onPicker = useCallback((id: string, kind: ApplicationPickerKind | null) => setRowPicker(kind ? { id, kind } : null), []);
  const properties = useMemo(() => new Set(options.properties.filter(p => !(p === 'assignee' && grouping === 'assignee' && layout === 'list'))), [options.properties, grouping, layout]);

  const listingOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of rows) if (a.listingId && a.listingTitle) seen.set(a.listingId, a.listingTitle);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filterDefs = useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      listFilter('statuses', 'Status', <CircleDashed />, () => APPLICATION_STATUSES.filter(s => s !== 'Draft').map(s => ({ value: s, label: s, icon: <ApplicationStatusGlyph status={s} /> }))),
      listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
      listFilter('unitIds', 'Unit', <DoorOpen />, () => ws.orderedProperties.flatMap(p => (ws.unitsByProperty.get(p.id) ?? []).filter(u => !u.archived).map(u => ({ value: u.id, label: ws.unitLabel(u.id), keywords: [p.name, p.code] })))),
      listFilter('listingIds', 'Listing', <FileText />, () => listingOptions),
      listFilter('assigneeIds', 'Assignee', <UserRound />, () => [
        { value: '__me__', label: 'Me', icon: <MemberAvatar member={ws.memberById.get(ws.me.id)} size={16} /> },
        { value: '__none__', label: 'Unassigned', icon: <UnassignedAvatar size={16} /> },
        ...ws.activeMembers.filter(m => m.id !== ws.me.id && ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)).map(m => ({ value: m.id, label: m.name, icon: <MemberAvatar member={m} size={16} /> })),
      ]),
      singleFilter('submitted', 'Submitted', <CalendarRange />, () => [
        { value: 'today', label: 'Today' },
        { value: 'week', label: 'In the last 7 days' },
        { value: 'month', label: 'In the last 30 days' },
      ]),
      singleFilter('feeUnpaid', 'Application fee', <CircleDollarSign />, () => [{ value: 'true', label: 'Not paid' }]),
    ];
    return defs.filter(d => !lockedFilters.includes(d.key));
  }, [ws, lockedFilters, listingOptions]);

  const viewDirty = Boolean(savedView) && list.isDirty;
  const canEditView = savedView && (savedView.ownerId === ws.me.id || ws.can('settings.manage'));
  const saveCurrentView = async () => {
    if (!savedView) return;
    try {
      await saveView({ action: 'update', id: savedView.id, config: { filters: cleanFilters(filters), options: options as unknown as Record<string, unknown> } });
      invalidate(qc, 'bootstrap');
      toast.success('View updated');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t update the view'));
    }
  };

  const exportCsv = () => {
    const sorted = [...rows].sort(compareApplications(options.ordering));
    downloadCsv(
      'applications',
      ['ID', 'Applicant', 'Co-applicants', 'Email', 'Phone', 'Status', 'Property', 'Unit', 'Listing', 'Desired move-in', 'Household income', 'Rent', 'Income to rent', 'Screening done', 'Screening flagged', 'Fee', 'Fee paid', 'Submitted', 'Assignee', 'Lease'],
      sorted.map(a => [applicationRef(a.number), a.applicantName, a.coApplicantNames.join('; '), a.email, a.phone, a.status, ws.propertyName(a.propertyId), a.unitId ? ws.unitById.get(a.unitId)?.name ?? '' : '', a.listingTitle ?? '', a.desiredMoveIn ?? '', a.householdIncome, a.rent, incomeRatio(a.householdIncome, a.rent) ?? '', a.screeningDone, a.screeningFlags, a.feeAmount, a.feePaidAt ? a.feePaidAt.slice(0, 10) : '', a.submittedAt?.slice(0, 10) ?? '', ws.memberName(a.assigneeId), a.leaseNumber ? leaseRef(a.leaseNumber) : '']),
    );
  };

  const listGroups: ListGroup<Application>[] = useMemo(
    () =>
      groups.map(g => ({
        key: g.key,
        label: g.label,
        items: g.items,
        icon: g.kind === 'status' ? <ApplicationStatusGlyph status={g.key} /> : g.kind === 'property' ? <PropertySwatch color={g.color} /> : g.kind === 'assignee' ? (g.key === '__none__' ? <UnassignedAvatar size={16} /> : <MemberAvatar member={ws.memberById.get(g.key)} size={16} />) : g.kind === 'listing' ? <FileText className="h-3.5 w-3.5 text-muted-foreground" /> : undefined,
      })),
    [groups, ws],
  );

  const columns: BoardColumn<Application>[] = useMemo(
    () =>
      listGroups.map(g => ({
        ...g,
        droppable: g.key === 'Submitted' || g.key === 'Screening' || g.key === 'Approved' || g.key === 'Denied',
        emptyText: g.key === 'Approved' ? 'Drop here to approve' : g.key === 'Denied' ? 'Drop here to deny' : 'Drop applications here',
      })),
    [listGroups],
  );

  const tableColumns: Column<Application>[] = useMemo(
    () => [
      { key: 'number', header: 'ID', width: 76, cell: a => <span className="tabular-nums text-muted-foreground">{applicationRef(a.number)}</span>, sort: a => a.number ?? 0 },
      { key: 'name', header: 'Applicant', cell: a => <span className="flex min-w-0 items-center gap-2"><ApplicationStatusGlyph status={a.status} /><span className="truncate font-medium">{a.applicantName}</span>{a.coApplicantNames.length > 0 && <span className="text-sm text-muted-foreground">+{a.coApplicantNames.length}</span>}</span>, sort: a => a.applicantName, className: 'max-w-[280px]' },
      { key: 'status', header: 'Status', cell: a => a.status, sort: a => APPLICATION_STATUSES.indexOf(a.status as ApplicationStatus), hideBelow: 'md' },
      { key: 'unit', header: 'Unit', cell: a => <span className="inline-flex max-w-[220px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(a.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(a.unitId, a.propertyId)}</span></span>, sort: a => ws.unitLabel(a.unitId, a.propertyId), hideBelow: 'md' },
      { key: 'moveIn', header: 'Move-in', cell: a => (a.desiredMoveIn ? shortDate(a.desiredMoveIn) : ''), sort: a => a.desiredMoveIn, hideBelow: 'lg' },
      { key: 'householdIncome', header: 'Income /mo', align: 'right', cell: a => <Money value={a.householdIncome} cents={false} muted0 />, sort: a => a.householdIncome, hideBelow: 'lg' },
      { key: 'rent', header: 'Rent', align: 'right', cell: a => <Money value={a.rent} cents={false} muted0 />, sort: a => a.rent ?? 0, hideBelow: 'xl' },
      { key: 'income', header: 'Ratio', align: 'right', cell: a => <IncomeRatio income={a.householdIncome} rent={a.rent} />, sort: a => incomeRatio(a.householdIncome, a.rent) ?? -1 },
      { key: 'screening', header: 'Screening', cell: a => <ScreeningMeter done={a.screeningDone} flags={a.screeningFlags} total={a.screeningTotal} />, sort: a => a.screeningDone - a.screeningFlags / 10, hideBelow: 'md' },
      { key: 'fee', header: 'Fee', cell: a => (a.feeAmount ? <FeeChip amount={a.feeAmount} paidAt={a.feePaidAt} /> : <span className="text-muted-foreground">—</span>), sort: a => (a.feePaidAt ? 1 : 0), hideBelow: 'xl' },
      { key: 'submitted', header: 'Submitted', cell: a => shortDate(a.submittedAt?.slice(0, 10)), sort: a => a.submittedAt, hideBelow: 'lg' },
      { key: 'assignee', header: 'Assignee', cell: a => (a.assigneeId ? <span className="inline-flex items-center gap-1.5"><MemberAvatar member={ws.memberById.get(a.assigneeId)} size={16} />{ws.memberName(a.assigneeId)}</span> : <span className="text-muted-foreground">—</span>), sort: a => ws.memberName(a.assigneeId), hideBelow: 'lg' },
    ],
    [ws],
  );

  const hasAnyFilter = countFilters(filters) > 0 || Boolean(filters[SEARCH_KEY]);

  const content = (() => {
    if (isPending) return <SkeletonRows rows={8} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Applications didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length && layout !== 'board') {
      return hasAnyFilter ? (
        <EmptyState className="py-20" icon={<FileText />} title="No applications match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState
          className="py-20"
          icon={<FileText />}
          title={emptyTitle ?? (options.showClosed ? 'No applications yet' : 'No applications to review')}
          description={emptyDescription ?? 'Applications submitted from a published listing arrive here. Share a listing’s link to start receiving them.'}
          action={!options.showClosed ? <button type="button" className="ghost-chip h-9" onClick={() => setOptions({ showClosed: true })}>Show decided applications</button> : <button type="button" className="ghost-chip h-9" onClick={() => navigate('/leasing/listings')}>Go to listings</button>}
        />
      );
    }
    if (layout === 'board') {
      return (
        <Board
          columns={columns}
          getId={a => a.id}
          selection={selection}
          focusedId={focusedId}
          onCardClick={onRowClick}
          menuFor={a => <ApplicationMenu targets={targetsFor(a)} onDecide={onDecide} />}
          renderCard={(a, s) => <ApplicationCard application={a} {...s} hideStatus />}
          onMove={(a, from, to) => {
            if (to === 'Approved' || to === 'Denied') {
              if (from !== 'Submitted' && from !== 'Screening' && !(to === 'Denied' && from === 'Approved')) {
                toast.error(`${applicationRef(a.number)} is ${from.toLowerCase()}. Reopen it before deciding again.`);
                return;
              }
              setDecision({ kind: to === 'Approved' ? 'approve' : 'deny', target: a });
              return;
            }
            if (from !== 'Submitted' && from !== 'Screening') {
              toast.error(`${applicationRef(a.number)} is ${from.toLowerCase()}. Reopen it to move it back into review.`);
              return;
            }
            const moving = (selection.has(a.id) && selection.size > 1 ? selected : [a]).filter(x => x.status === 'Submitted' || x.status === 'Screening');
            void update(moving, { status: to as 'Submitted' | 'Screening' }, { toast: moving.length === 1 ? `${applicationRef(a.number)} → ${to}` : undefined }).catch(() => undefined);
          }}
        />
      );
    }
    if (layout === 'table') {
      return (
        <DataTable
          rows={visible}
          columns={tableColumns.filter(c => ['name', 'status', 'householdIncome', 'rent'].includes(c.key) || options.properties.includes(c.key))}
          getId={a => a.id}
          onRowClick={onRowClick}
          selection={selection}
          onToggleSelect={(a, e) => toggleSelect(a, e)}
          onSelectAll={all => setSelection(all ? new Set(visible.map(a => a.id)) : new Set())}
          focusedId={focusedId}
          onHover={onHover}
          className="h-full pb-24"
          caption="Applications"
        />
      );
    }
    return (
      <GroupedList
        label="Applications"
        groups={listGroups}
        single={grouping === 'none'}
        getId={a => a.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(a => a.id)]))}
        renderRow={a => (
          <ApplicationRow
            application={a}
            properties={properties}
            selected={selection.has(a.id)}
            focused={focusedId === a.id}
            selecting={selecting}
            picker={rowPicker?.id === a.id ? rowPicker.kind : null}
            onPicker={onPicker}
            onClick={onRowClick}
            onHover={onHover}
            onToggleSelect={toggleSelect}
            targetsFor={targetsFor}
            onDecide={onDecide}
            hideUnit={hideUnit}
          />
        )}
      />
    );
  })();

  const bulkTrigger = (kind: ApplicationPickerKind, icon: ReactNode, label: string) => (
    <ApplicationPicker kind={kind} targets={selected} open={bulkPicker === kind} onOpenChange={o => setBulkPicker(o ? kind : null)} align="center" trigger={<button type="button" className={bulkButton}>{icon} {label}</button>} />
  );

  const otherOpenForDecision = decision ? rows.filter(r => r.unitId && r.unitId === decision.target.unitId && r.id !== decision.target.id && ['Submitted', 'Screening', 'Approved'].includes(r.status)).length : 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
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
        countLabel={['application', 'applications']}
        search={typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : ''}
        onSearch={q => setFilters(f => ({ ...f, [SEARCH_KEY]: q || undefined }))}
        searchPlaceholder="Search name, email, APP-…"
        layout={layout}
        layouts={['list', 'board', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={isFetching && !isPending}
        display={<DisplayMenu options={options} onChange={setOptions} groupings={APPLICATION_GROUPINGS} orderings={APPLICATION_ORDERINGS} properties={APPLICATION_PROPERTIES} closedLabel="Show denied, withdrawn & leased" onReset={list.reset} isDirty={list.isDirty && !savedView} />}
        more={
          <>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>
            {!savedView && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setSaveOpen(true)}><Save className="h-3.5 w-3.5" /> Save as view…</DropdownMenuItem>}
            {savedView && canEditView && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setSaveOpen(true)}><Pencil className="h-3.5 w-3.5" /> Rename or share view…</DropdownMenuItem>
                <DropdownMenuItem
                  className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger"
                  onSelect={async () => {
                    if (!(await app.confirm({ title: `Delete “${savedView.name}”?`, description: 'The view is removed for everyone it’s shared with. Applications aren’t affected.', confirmLabel: 'Delete view', destructive: true }))) return;
                    try {
                      await saveView({ action: 'delete', id: savedView.id });
                      invalidate(qc, 'bootstrap');
                      navigate('/leasing/applications');
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
          <ApplicationPicker kind={floatingPicker.kind} targets={floatingPicker.targets} open onOpenChange={o => !o && setFloatingPicker(null)} align="center" trigger={<span className="block h-0 w-0" />} onDecide={(k, t) => setDecision({ kind: k, target: t as Application })} />
        </div>
      )}
      <div ref={scrollRef} className={layout === 'board' ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'}>
        {content}
      </div>
      <BulkBar count={selected.length} noun={['application', 'applications']} onClear={clearSelection}>
        {bulkTrigger('status', <CircleDashed />, 'Status')}
        {bulkTrigger('assignee', <UserRound />, 'Assign')}
      </BulkBar>
      <DecisionDialog kind={decision?.kind ?? null} target={decision?.target ?? null} otherOpen={otherOpenForDecision} onOpenChange={o => !o && setDecision(null)} />
      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} scope="applications" config={{ filters: cleanFilters(filters), options }} existing={savedView ? { id: savedView.id, name: savedView.name, shared: savedView.shared } : null} />
    </div>
  );
}
