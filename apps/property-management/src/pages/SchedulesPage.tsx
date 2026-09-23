import { useQueryClient } from '@tanstack/react-query';
import { Building2, Download, MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, SquareArrowOutUpRight, Trash2, Wrench, Zap } from 'lucide-react';
import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { generateScheduleNow, saveSchedule } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { SCHEDULE_FREQUENCIES } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { mk, useScheduleActions, useSchedules, type ScheduleRow } from '../components/maintenance/data';
import { ScheduleDialog } from '../components/maintenance/ScheduleDialog';
import { BulkBar, bulkButton } from '../components/list/BulkBar';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../components/list/Filters';
import { GroupedList, RowShell, type ListGroup } from '../components/list/GroupedList';
import { DisplayMenu, ListToolbar } from '../components/list/Toolbar';
import { useListNav } from '../components/list/useListNav';
import { MemberAvatar, UnassignedAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../components/primitives/bits';
import { Money } from '../components/primitives/data';
import { Pill, PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../components/primitives/glyphs';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { WorkOrdersView } from '../components/workOrders/WorkOrdersView';
import { useAppActions } from '../lib/app-actions';
import { downloadCsv } from '../lib/csv';
import { errorMessage } from '../lib/errors';
import { daysFromToday, fullDate, shortDate } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type ListOptions } from '../lib/listState';
import { invalidate } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';

type Grouping = 'due' | 'property' | 'frequency' | 'none';
type Ordering = 'due' | 'title' | 'estimate';
const DEFAULTS: ListOptions<Grouping, Ordering> = { layout: 'list', grouping: 'due', ordering: 'due', properties: ['location', 'frequency', 'vendor', 'estimate', 'last', 'assignee'], showEmptyGroups: false, showClosed: true };
const PROPS = [
  { key: 'location', label: 'Location' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'last', label: 'Last work order' },
  { key: 'assignee', label: 'Assignee' },
];
const FREQ_LABEL: Record<string, string> = { Monthly: 'Monthly', Quarterly: 'Quarterly', Semiannually: 'Twice a year', Annually: 'Yearly' };

/** Header tabs shared with the work orders page, so Recurring reads as part of the same place. */
function useWorkOrderTabs() {
  const ws = useWorkspace();
  return [
    { to: '/work-orders', label: 'All', end: true, active: false },
    { to: '/work-orders?tab=mine', label: 'Assigned to me', end: true, active: false },
    { to: '/work-orders?tab=unassigned', label: 'Unassigned', end: true, active: false },
    { to: '/work-orders?tab=approvals', label: 'Owner approval', count: ws.counts.approvalsPending, end: true, active: false },
    { to: '/work-orders/schedules', label: 'Recurring', end: false, active: true },
  ];
}

function useGenerate() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (s: ScheduleRow) => {
    if (busy) return;
    setBusy(s.id);
    try {
      const res = await generateScheduleNow({ id: s.id, expectedNextDueOn: s.nextDueOn });
      invalidate(qc, 'schedules', 'workOrders', 'bootstrap', 'dashboard');
      if (res.created && res.number) {
        toast.success(`${workOrderRef(res.number)} created`, { description: `“${s.title}”, due ${fullDate(res.dueDate)}. Next due ${fullDate(res.nextDueOn)}.`, action: { label: 'Open', onClick: () => navigate(`/work-orders/${res.number}`) } });
      } else {
        toast.success('Already created', { description: `${res.number ? workOrderRef(res.number) : 'A work order'} was already due ${fullDate(res.dueDate)}. The schedule moved on to ${fullDate(res.nextDueOn)}.` });
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t create the work order'));
      void qc.invalidateQueries({ queryKey: mk.scheduleList });
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

function DueLabel({ s, className }: { s: ScheduleRow; className?: string }) {
  if (!s.nextDueOn) return <span className={cn('text-sm text-muted-foreground', className)}>No due date</span>;
  const d = daysFromToday(s.nextDueOn) ?? 0;
  const creates = daysFromToday(s.generatesOn) ?? 0;
  const tone = !s.active ? 'text-muted-foreground' : d < 0 ? 'text-tone-danger' : creates <= 0 ? 'text-tone-warning' : 'text-muted-foreground';
  return (
    <Tip label={s.active ? (creates <= 0 ? `Due ${fullDate(s.nextDueOn)} — the work order is created on the next daily run` : `Due ${fullDate(s.nextDueOn)} — work order created ${fullDate(s.generatesOn)}`) : `Due ${fullDate(s.nextDueOn)} — paused`}>
      <span className={cn('whitespace-nowrap text-sm tabular-nums', tone, className)}>{d < 0 ? `Overdue · ${shortDate(s.nextDueOn)}` : d === 0 ? 'Due today' : `Due ${shortDate(s.nextDueOn)}`}</span>
    </Tip>
  );
}

function ScheduleDetail({ schedule: s, onEdit }: { schedule: ScheduleRow; onEdit: () => void }) {
  const ws = useWorkspace();
  const property = s.propertyId ? ws.propertyById.get(s.propertyId) : undefined;
  const vendor = s.vendorId ? ws.vendorById.get(s.vendorId) : undefined;
  const assignee = s.assigneeId ? ws.memberById.get(s.assigneeId) : undefined;
  const fact = (label: string, value: React.ReactNode) => (
    <div className="min-w-0 bg-card px-4 py-2.5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex min-h-6 min-w-0 items-center gap-1.5 text-[14px]">{value}</div>
    </div>
  );
  return (
    <div className="shrink-0 border-b bg-subtle/40 px-3 py-3 sm:px-5">
      {!s.active && <p className="mb-2 flex items-center gap-1.5 text-[14px] text-tone-warning"><Pause className="h-3.5 w-3.5" /> Paused — no work orders are created until you resume it.</p>}
      {s.description && <p className="mb-3 max-w-3xl whitespace-pre-line text-[14px] text-foreground/85">{s.description}</p>}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {fact('Location', property ? <Link to={`/properties/${property.id}`} className="flex min-w-0 items-center gap-1.5 hover:underline"><PropertySwatch color={property.color} /><span className="truncate">{ws.unitLabel(s.unitId, s.propertyId)}</span></Link> : '—')}
        {fact('Frequency', <><Repeat className="h-3.5 w-3.5 text-muted-foreground" /> {FREQ_LABEL[s.frequency] ?? s.frequency}</>)}
        {fact('Next due', s.nextDueOn ? <span className="tabular-nums">{fullDate(s.nextDueOn)}</span> : '—')}
        {fact('Work order created', s.generatesOn ? <Tip label={`${s.leadDays} ${s.leadDays === 1 ? 'day' : 'days'} before it’s due`}><span className="tabular-nums">{fullDate(s.generatesOn)}</span></Tip> : `${s.leadDays} days ahead`)}
        {fact('Vendor', vendor ? <Link to={`/vendors/${vendor.id}`} className="truncate hover:underline">{vendor.name}</Link> : <span className="text-muted-foreground">In-house</span>)}
        {fact('Assignee', assignee ? <><MemberAvatar member={assignee} size={16} /> <span className="truncate">{assignee.name}</span></> : <span className="text-muted-foreground">Unassigned</span>)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1"><PriorityGlyph priority={s.priority} size={12} /> {s.priority}</span>
        <span>{s.category}</span>
        {s.estimateAmount != null && <span>Estimate <Money value={s.estimateAmount} /></span>}
        <span>{s.lastGeneratedOn ? `Last generated ${fullDate(s.lastGeneratedOn)}` : 'Hasn’t generated a work order yet'}</span>
        <button type="button" onClick={onEdit} className="text-primary hover:underline">Edit</button>
      </div>
    </div>
  );
}

/** Preventive maintenance: recurring work that becomes work orders on its own, with each schedule's history. */
export function SchedulesPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabs = useWorkOrderTabs();
  const { data, isPending, isError, error, refetch, isFetching } = useSchedules();
  const { setActive } = useScheduleActions();
  const generate = useGenerate();
  const [dialog, setDialog] = useState<{ open: boolean; schedule: ScheduleRow | null }>({ open: false, schedule: null });
  const selectedId = params.get('schedule');
  const schedules = data?.schedules ?? [];
  const selected = selectedId ? schedules.find(s => s.id === selectedId) : undefined;
  useDocumentTitle(selected ? selected.title : 'Recurring maintenance');

  const list = useListState<Grouping, Ordering>('schedules', DEFAULTS);
  const { options, setOptions, filters, setFilters } = list;
  const props = useMemo(() => new Set(options.properties), [options.properties]);

  const rows = useMemo(() => {
    const arr = (k: string) => (Array.isArray(filters[k]) ? (filters[k] as string[]) : []);
    const q = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
    return schedules.filter(s => {
      if (arr('propertyIds').length && !arr('propertyIds').includes(s.propertyId ?? '')) return false;
      if (arr('frequencies').length && !arr('frequencies').includes(s.frequency)) return false;
      if (arr('vendorIds').length && !arr('vendorIds').some(v => (v === '__none__' ? !s.vendorId : v === s.vendorId))) return false;
      if (filters.state === 'active' && !s.active) return false;
      if (filters.state === 'paused' && s.active) return false;
      if (q && ![s.title, s.description, s.category, ws.unitLabel(s.unitId, s.propertyId), s.vendorId ? ws.vendorById.get(s.vendorId)?.name ?? '' : ''].some(t => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [schedules, filters, ws]);

  const sorted = useMemo(() => {
    const cmp: Record<Ordering, (a: ScheduleRow, b: ScheduleRow) => number> = {
      due: (a, b) => Number(!a.active) - Number(!b.active) || (a.nextDueOn ?? '9').localeCompare(b.nextDueOn ?? '9') || a.title.localeCompare(b.title),
      title: (a, b) => a.title.localeCompare(b.title),
      estimate: (a, b) => (b.estimateAmount ?? 0) - (a.estimateAmount ?? 0),
    };
    return [...rows].sort(cmp[options.ordering] ?? cmp.due);
  }, [rows, options.ordering]);

  const groups: ListGroup<ScheduleRow>[] = useMemo(() => {
    if (options.grouping === 'property') return ws.orderedProperties.map(p => ({ key: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, items: sorted.filter(s => s.propertyId === p.id) })).filter(g => g.items.length);
    if (options.grouping === 'frequency') return SCHEDULE_FREQUENCIES.map(f => ({ key: f, label: FREQ_LABEL[f], items: sorted.filter(s => s.frequency === f) })).filter(g => g.items.length);
    if (options.grouping === 'due') {
      const soon = (s: ScheduleRow) => s.active && (daysFromToday(s.nextDueOn) ?? 999) <= 30;
      return [
        { key: 'soon', label: 'Due in the next 30 days', items: sorted.filter(soon) },
        { key: 'later', label: 'Later', items: sorted.filter(s => s.active && !soon(s)) },
        { key: 'paused', label: 'Paused', items: sorted.filter(s => !s.active) },
      ].filter(g => g.items.length);
    }
    return [{ key: 'all', label: 'Schedules', items: sorted }];
  }, [sorted, options.grouping, ws]);

  const [collapsed, toggleCollapsed] = useCollapsedGroups('schedules');
  const visible = useMemo(() => groups.flatMap(g => (options.grouping !== 'none' && collapsed.has(g.key) ? [] : g.items)), [groups, collapsed, options.grouping]);
  const open = useCallback((s: ScheduleRow) => setParams({ schedule: s.id }), [setParams]);
  const nav = useListNav({ items: visible, getId: s => s.id, onOpen: open, enabled: !selected && !dialog.open });
  const { selection, focusedId, focused, onRowClick, onHover, toggleSelect, scrollRef, selecting, selected: chosen, clearSelection } = nav;

  const remove = async (s: ScheduleRow) => {
    if (!(await app.confirm({ title: `Delete “${s.title}”?`, description: s.workOrderCount ? `No more work orders will be created. The ${s.workOrderCount} it already created stay, without a link back to the schedule. Pausing keeps the history instead.` : 'No more work orders will be created from it. Pausing keeps it for later instead.', confirmLabel: 'Delete schedule', destructive: true }))) return;
    try {
      await saveSchedule({ action: 'delete', id: s.id });
      invalidate(qc, 'schedules');
      if (selectedId === s.id) setParams({});
      toast.success(`Deleted “${s.title}”`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t delete the schedule'));
    }
  };

  const toggle = async (s: ScheduleRow) => {
    if (!s.active && s.nextDueOn && (daysFromToday(s.generatesOn) ?? 1) <= 0) {
      const ok = await app.confirm({ title: `Resume “${s.title}”?`, description: `It was due ${fullDate(s.nextDueOn)}, so its work order is created on the next daily run. To skip that visit, edit the next due date first.`, confirmLabel: 'Resume' });
      if (!ok) return;
    }
    await setActive(s, !s.active);
  };

  useHotkeys({ e: () => (selected ?? focused) && setDialog({ open: true, schedule: selected ?? focused ?? null }) }, { enabled: !dialog.open });

  const setActiveMany = async (targets: ScheduleRow[], active: boolean) => {
    const changing = targets.filter(s => s.active !== active);
    let done = 0;
    // One at a time: the platform refuses bursts of parallel writes.
    for (const s of changing) {
      try {
        await saveSchedule({ action: 'setActive', id: s.id, active });
        done++;
      } catch (e) {
        toast.error(errorMessage(e, `Couldn’t ${active ? 'resume' : 'pause'} “${s.title}”`));
        break;
      }
    }
    invalidate(qc, 'schedules');
    if (done) toast.success(`${active ? 'Resumed' : 'Paused'} ${done} ${done === 1 ? 'schedule' : 'schedules'}`);
    clearSelection();
  };

  const exportCsv = (list: ScheduleRow[] = sorted) =>
    downloadCsv('recurring-maintenance', ['Title', 'Property', 'Unit', 'Frequency', 'Next due', 'Lead days', 'Work order created on', 'Category', 'Priority', 'Vendor', 'Assignee', 'Estimate', 'Active', 'Last generated', 'Work orders created'],
      list.map(s => [s.title, ws.propertyName(s.propertyId), s.unitId ? ws.unitById.get(s.unitId)?.name ?? '' : 'Whole property', s.frequency, s.nextDueOn ?? '', s.leadDays, s.generatesOn ?? '', s.category, s.priority, s.vendorId ? ws.vendorById.get(s.vendorId)?.name ?? '' : '', ws.memberName(s.assigneeId), s.estimateAmount ?? '', s.active ? 'Yes' : 'No', s.lastGeneratedOn ?? '', s.workOrderCount]));

  const filterDefs = useMemo<FilterDef[]>(() => [
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> }))),
    listFilter('frequencies', 'Frequency', <Repeat />, () => SCHEDULE_FREQUENCIES.map(f => ({ value: f, label: FREQ_LABEL[f] }))),
    listFilter('vendorIds', 'Vendor', <Wrench />, () => [{ value: '__none__', label: 'In-house (no vendor)' }, ...ws.vendors.map(v => ({ value: v.id, label: v.name, keywords: [v.trade] }))]),
    singleFilter('state', 'Status', <Pause />, () => [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]),
  ], [ws]);

  const actionsFor = (s: ScheduleRow, Item: typeof ContextMenuItem | typeof DropdownMenuItem) => (
    <>
      <Item className="h-9 gap-2 text-[14px]" disabled={!s.active || generate.busy === s.id} onSelect={() => void generate.run(s)}><Zap className="h-3.5 w-3.5" /> Generate now</Item>
      <Item className="h-9 gap-2 text-[14px]" onSelect={() => void toggle(s)}>{s.active ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}</Item>
      <Item className="h-9 gap-2 text-[14px]" onSelect={() => setDialog({ open: true, schedule: s })}><Pencil className="h-3.5 w-3.5" /> Edit</Item>
    </>
  );

  const renderRow = (s: ScheduleRow) => {
    const vendor = s.vendorId ? ws.vendorById.get(s.vendorId) : undefined;
    const assignee = s.assigneeId ? ws.memberById.get(s.assigneeId) : undefined;
    const property = s.propertyId ? ws.propertyById.get(s.propertyId) : undefined;
    return (
      <RowShell
        id={s.id}
        selected={selection.has(s.id)}
        focused={focusedId === s.id}
        selecting={selecting}
        onClick={(e: MouseEvent) => onRowClick(s, e)}
        onHover={() => onHover(s)}
        onToggleSelect={(e: MouseEvent) => toggleSelect(s, e)}
        muted={!s.active}
        menu={
          <div onClick={e => e.stopPropagation()}>
            <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => open(s)}><SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
            <ContextMenuSeparator />
            {actionsFor(s, ContextMenuItem)}
            <ContextMenuSeparator />
            <ContextMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void remove(s)}><Trash2 className="h-3.5 w-3.5" /> Delete…</ContextMenuItem>
          </div>
        }
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center"><Repeat className={cn('h-3.5 w-3.5', s.active ? 'text-tone-accent' : 'text-muted-foreground/60')} /></span>
        <span className="min-w-0 truncate font-medium">{s.title}</span>
        {!s.active && <Pill>Paused</Pill>}
        <span className="min-w-4 flex-1" />
        <span className="hidden min-w-0 items-center gap-2 md:flex">
          {props.has('location') && options.grouping !== 'property' && property && <span className="chip max-w-[200px]"><PropertySwatch color={property.color} /><span className="truncate">{ws.unitLabel(s.unitId, s.propertyId)}</span></span>}
          {props.has('frequency') && options.grouping !== 'frequency' && <span className="chip hidden lg:inline-flex">{FREQ_LABEL[s.frequency] ?? s.frequency}</span>}
          {props.has('vendor') && vendor && <span className="chip hidden max-w-[150px] xl:inline-flex"><Wrench className="h-3 w-3 text-muted-foreground" /><span className="truncate">{vendor.name}</span></span>}
          {props.has('estimate') && s.estimateAmount != null && <span className="hidden w-16 justify-end text-sm lg:inline-flex"><Money value={s.estimateAmount} cents={false} className="text-muted-foreground" /></span>}
          {props.has('last') && (s.lastWorkOrder ? (
            <Tip label={`Last: ${s.lastWorkOrder.title}${s.lastWorkOrder.dueDate ? `, due ${fullDate(s.lastWorkOrder.dueDate)}` : ''}`}>
              <Link to={`/work-orders/${s.lastWorkOrder.number}`} onClick={e => e.stopPropagation()} className="hidden items-center gap-1 text-sm tabular-nums text-muted-foreground hover:text-foreground lg:inline-flex"><WorkOrderStatusGlyph status={s.lastWorkOrder.status} size={12} /> {workOrderRef(s.lastWorkOrder.number)}</Link>
            </Tip>
          ) : <span className="hidden w-[60px] text-sm text-muted-foreground/60 lg:inline">—</span>)}
        </span>
        <DueLabel s={s} className="w-[104px] text-right" />
        <Tip label={s.active ? 'Create the next work order now' : 'Resume the schedule to generate'}>
          <IconButton size="sm" aria-label={`Generate the next work order for ${s.title}`} disabled={!s.active || generate.busy === s.id} onClick={e => { e.stopPropagation(); void generate.run(s); }} className="hidden sm:inline-flex"><Zap /></IconButton>
        </Tip>
        {props.has('assignee') && <span className="flex h-6 w-6 items-center justify-center">{assignee ? <MemberAvatar member={assignee} size={20} /> : <UnassignedAvatar size={20} />}</span>}
      </RowShell>
    );
  };

  const newButton = (
    <Tip label="New recurring maintenance">
      <button type="button" onClick={() => setDialog({ open: true, schedule: null })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
        <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New schedule</span>
      </button>
    </Tip>
  );

  // ── One schedule: its settings and every work order it has created ──
  if (selectedId) {
    return (
      <>
        <PageHeader
          icon={<Repeat />}
          breadcrumb={{ to: '/work-orders/schedules', label: 'Recurring' }}
          title={selected?.title ?? (isPending ? 'Schedule' : 'Schedule not found')}
          actions={
            selected && (
              <>
                <button type="button" onClick={() => void toggle(selected)} className="ghost-chip h-8 gap-1.5 text-[13.5px]">{selected.active ? <><Pause className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Pause</span></> : <><Play className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Resume</span></>}</button>
                <Tip label={selected.active ? 'Create the next work order now' : 'Resume the schedule to generate'}>
                  <button type="button" disabled={!selected.active || generate.busy === selected.id} onClick={() => void generate.run(selected)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
                    <Zap className="h-3.5 w-3.5" /> {generate.busy === selected.id ? 'Generating…' : 'Generate now'}
                  </button>
                </Tip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><IconButton aria-label="More schedule actions"><MoreHorizontal /></IconButton></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDialog({ open: true, schedule: selected })}><Pencil className="h-3.5 w-3.5" /> Edit <Kbd className="ml-auto">E</Kbd></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void remove(selected)}><Trash2 className="h-3.5 w-3.5" /> Delete…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )
          }
        />
        {isPending ? (
          <SkeletonRows rows={6} className="px-3 pt-3" />
        ) : !selected ? (
          <EmptyState className="flex-1" icon={<Repeat />} title={isError ? 'Schedules didn’t load' : 'Schedule not found'} description={isError ? errorMessage(error, 'Something went wrong.') : 'It may have been deleted.'} action={<button type="button" className="ghost-chip h-9" onClick={() => (isError ? void refetch() : setParams({}))}>{isError ? 'Try again' : 'Back to recurring maintenance'}</button>} />
        ) : (
          <>
            <ScheduleDetail schedule={selected} onEdit={() => setDialog({ open: true, schedule: selected })} />
            <WorkOrdersView
              key={selected.id}
              compact
              surfaceKey={`schedule:${selected.id}:work-orders`}
              baseFilters={{ scheduleId: selected.id, showClosed: true }}
              defaults={{ grouping: 'none', ordering: 'newest', properties: ['number', 'priority', 'vendor', 'scheduled', 'due', 'assignee', 'created'] }}
              createDefaults={{ propertyId: selected.propertyId, unitId: selected.unitId, title: selected.title, description: selected.description, category: selected.category, priority: selected.priority, vendorId: selected.vendorId }}
              emptyTitle="No work orders from this schedule yet"
              emptyDescription={selected.active ? `The first one is created ${selected.generatesOn ? fullDate(selected.generatesOn) : 'on schedule'} — or press Generate now.` : 'Resume the schedule to start creating work orders.'}
            />
          </>
        )}
        <ScheduleDialog open={dialog.open} onOpenChange={o => setDialog(d => ({ ...d, open: o }))} schedule={dialog.schedule} />
      </>
    );
  }

  return (
    <>
      <PageHeader icon={<Wrench />} title="Work orders" tabs={tabs} actions={newButton} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ListToolbar
          start={<><FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} /><FilterChips defs={filterDefs} filters={filters} onChange={setFilters} /></>}
          count={isPending ? null : rows.length}
          countLabel={['schedule', 'schedules']}
          search={typeof filters.search === 'string' ? filters.search : ''}
          onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
          searchPlaceholder="Search schedules…"
          fetching={isFetching && !isPending}
          display={<DisplayMenu options={options} onChange={setOptions} groupings={[{ value: 'due', label: 'When due' }, { value: 'property', label: 'Property' }, { value: 'frequency', label: 'Frequency' }, { value: 'none', label: 'No grouping' }]} orderings={[{ value: 'due', label: 'Next due' }, { value: 'title', label: 'Title' }, { value: 'estimate', label: 'Estimate' }]} properties={PROPS} onReset={list.reset} isDirty={list.isDirty} />}
          more={<DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => exportCsv()} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>}
        />
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <SkeletonRows rows={6} className="px-3 pt-2" />
          ) : isError ? (
            <EmptyState className="py-20" title="Schedules didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
          ) : !rows.length ? (
            countFilters(filters) > 0 || filters.search ? (
              <EmptyState className="py-20" icon={<Repeat />} title="No schedules match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
            ) : (
              <EmptyState className="py-20" icon={<Repeat />} title="No recurring maintenance yet" description="Pest control, filter changes, gutter cleaning, fire safety checks — set them up once and the work orders arrive on time." action={<button type="button" onClick={() => setDialog({ open: true, schedule: null })} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New schedule</button>} />
            )
          ) : (
            <GroupedList label="Recurring maintenance" groups={groups} single={options.grouping === 'none'} getId={s => s.id} collapsed={collapsed} onToggleCollapse={toggleCollapsed} renderRow={renderRow} />
          )}
        </div>
        <BulkBar count={chosen.length} noun={['schedule', 'schedules']} onClear={clearSelection}>
          {chosen.some(s => s.active) && <button type="button" className={bulkButton} onClick={() => void setActiveMany(chosen, false)}><Pause /> Pause</button>}
          {chosen.some(s => !s.active) && <button type="button" className={bulkButton} onClick={() => void setActiveMany(chosen, true)}><Play /> Resume</button>}
          <button type="button" className={bulkButton} onClick={() => exportCsv(chosen)}><Download /> Export</button>
        </BulkBar>
      </div>
      <ScheduleDialog open={dialog.open} onOpenChange={o => setDialog(d => ({ ...d, open: o }))} schedule={dialog.schedule} onSaved={id => !dialog.schedule && navigate(`/work-orders/schedules?schedule=${id}`)} />
    </>
  );
}
