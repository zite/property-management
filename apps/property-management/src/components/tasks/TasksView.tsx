import { useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarDays, CircleCheck, CircleDashed, Download, Flag, ListChecks, Pencil, Plus, RotateCcw, Save, Signal, Tag, Trash2, UserRound, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveView } from 'zitejs/api';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import { useAppActions, type CreateDefaults } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { useHotkeys } from '../../lib/hotkeys';
import { cleanFilters, countFilters, useCollapsedGroups, useListState, type Filters, type ListOptions } from '../../lib/listState';
import { invalidate } from '../../lib/queries';
import type { SavedView } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, type ListGroup } from '../list/GroupedList';
import { parseViewConfig, SaveViewDialog } from '../list/SaveViewDialog';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { PriorityGlyph, PropertySwatch, TaskStatusGlyph } from '../primitives/glyphs';
import {
  canManageTasks, compareTasks, DISPLAY_PROPERTIES, glyphPriority, groupTasks, GROUPINGS, isClosed, ORDERINGS, primaryRelated, useTaskActions, useTasks,
  type Task, type TaskFilters, type TaskGrouping, type TaskOrdering, type TaskScope,
} from './data';
import { TaskPicker, type TaskPickerKind } from './TaskPicker';
import { TaskRow, type TaskRowPicker } from './TaskRow';
import { TaskSheet } from './TaskSheet';

type Options = ListOptions<TaskGrouping, TaskOrdering>;

export const DEFAULT_TASK_OPTIONS: Options = {
  layout: 'list',
  grouping: 'due',
  ordering: 'due',
  properties: ['priority', 'related', 'category', 'due', 'assignee'],
  showEmptyGroups: false,
  showClosed: false,
};

const SEARCH_KEY = 'search';
const ROW_SLOTS: Partial<Record<TaskPickerKind, string>> = { priority: 'priority', due: 'due', assignee: 'assignee' };

export type TasksViewProps = {
  /** Where display options and filters are remembered, e.g. `tasks:mine`, `view:<id>`. */
  surfaceKey: string;
  scope: TaskScope;
  /** A fixed scope merged under the person's own filters (a property's tasks). */
  baseFilters?: Omit<TaskFilters, 'scope'>;
  defaults?: Partial<Options>;
  defaultFilters?: Filters;
  savedView?: SavedView | null;
  lockedFilters?: string[];
  createDefaults?: CreateDefaults;
  emptyTitle?: string;
  emptyDescription?: string;
};

function toQuery(scope: TaskScope, base: Omit<TaskFilters, 'scope'>, f: Filters, showClosed: boolean): TaskFilters {
  const arr = (k: string) => (Array.isArray(f[k]) && (f[k] as string[]).length ? (f[k] as string[]) : undefined);
  const q: TaskFilters = {
    ...base,
    scope,
    statuses: (arr('statuses') as TaskFilters['statuses']) ?? base.statuses,
    priorities: (arr('priorities') as TaskFilters['priorities']) ?? base.priorities,
    categories: (arr('categories') as TaskFilters['categories']) ?? base.categories,
    assigneeIds: arr('assigneeIds') ?? base.assigneeIds,
    propertyIds: arr('propertyIds') ?? base.propertyIds,
    due: (typeof f.due === 'string' ? (f.due as TaskFilters['due']) : undefined) ?? base.due,
    source: (typeof f.source === 'string' ? (f.source as TaskFilters['source']) : undefined) ?? base.source,
    search: typeof f[SEARCH_KEY] === 'string' ? (f[SEARCH_KEY] as string) : undefined,
    showDone: scope !== 'done' && showClosed ? true : undefined,
  };
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as TaskFilters;
}

/**
 * Every task list in the app: my tasks, the team's open work, a saved view.
 * Owns fetching, filters, grouping, keyboard navigation, bulk edits, export,
 * saving views and the task sheet (`?task=<id>`).
 */
export function TasksView({ surfaceKey, scope: scopeProp, baseFilters = {}, defaults, defaultFilters = {}, savedView, lockedFilters = [], createDefaults, emptyTitle, emptyDescription }: TasksViewProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { update, remove } = useTaskActions();
  const manager = canManageTasks(ws);
  const viewConfig = useMemo(() => (savedView ? parseViewConfig(savedView.config) : null), [savedView]);
  const list = useListState<TaskGrouping, TaskOrdering>(surfaceKey, { ...DEFAULT_TASK_OPTIONS, ...defaults, ...(viewConfig?.options as Partial<Options>) }, viewConfig?.filters ?? defaultFilters);
  const { options, setOptions, filters, setFilters } = list;
  const scope: TaskScope = (typeof filters.scope === 'string' ? (filters.scope as TaskScope) : null) ?? scopeProp;

  const query = useMemo(() => toQuery(scope, baseFilters, filters, options.showClosed), [scope, baseFilters, filters, options.showClosed]);
  const { data, isPending, isFetching, isError, error, refetch } = useTasks(query);
  const rows = data?.tasks ?? [];
  const today = data?.today ?? ws.today;

  const grouping = options.grouping;
  const ordering: TaskOrdering = scope === 'done' && options.ordering === 'due' ? 'completed' : options.ordering;
  const groups = useMemo(() => groupTasks(rows, grouping, ordering, ws, { today, showEmpty: options.showEmptyGroups }), [rows, grouping, ordering, ws, today, options.showEmptyGroups]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups(surfaceKey);
  const visible = useMemo(() => groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items)), [groups, collapsed]);

  // ── The task sheet lives in the URL, so notifications and the dashboard can deep-link to it ──
  const sheetId = params.get('task');
  const openTask = useCallback((t: Task) => setParams(prev => { const next = new URLSearchParams(prev); next.set('task', t.id); return next; }), [setParams]);
  const closeTask = useCallback(() => setParams(prev => { const next = new URLSearchParams(prev); next.delete('task'); return next; }, { replace: true }), [setParams]);

  const [rowPicker, setRowPicker] = useState<TaskRowPicker>(null);
  const [bulkPicker, setBulkPicker] = useState<TaskPickerKind | null>(null);
  const [floatingPicker, setFloatingPicker] = useState<{ kind: TaskPickerKind; targets: Task[] } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const pickerOpen = Boolean(rowPicker || bulkPicker || floatingPicker);

  const nav = useListNav({ items: visible, getId: (t: Task) => t.id, onOpen: openTask, onPeek: openTask, enabled: !pickerOpen && !sheetId });
  const { selection, selected, focusedId, focused, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  useEffect(() => {
    clearSelection();
    setRowPicker(null);
  }, [surfaceKey, scope]);

  const toggleDone = useCallback((list: Task[]) => {
    if (!list.length) return;
    const reopen = list.every(isClosed);
    void update(list, { status: reopen ? 'To do' : 'Done' }, { ws, undo: true }).catch(() => undefined);
  }, [update, ws]);

  const openPicker = (kind: TaskPickerKind) => {
    if (selection.size > 0) return setBulkPicker(kind);
    if (!focused) return;
    const slot = ROW_SLOTS[kind];
    if (slot && properties.has(slot)) setRowPicker({ id: focused.id, kind });
    else setFloatingPicker({ kind, targets: [focused] });
  };

  const confirmDelete = async (list: Task[]) => {
    if (!list.length) return;
    if (list.some(t => t.systemKey)) {
      toast.error('Automatic tasks can’t be deleted — mark them done or canceled instead.');
      return;
    }
    if (!manager && list.some(t => t.createdById !== ws.me.id)) {
      toast.error('You can only delete tasks you created.');
      return;
    }
    const ok = await app.confirm({
      title: list.length === 1 ? `Delete “${list[0].title.slice(0, 60)}”?` : `Delete ${list.length} tasks?`,
      description: 'They’re removed for everyone and can’t be restored. Mark them done instead if you want to keep a record.',
      confirmLabel: list.length === 1 ? 'Delete task' : `Delete ${list.length} tasks`,
      destructive: true,
    });
    if (ok) void remove(list).then(clearSelection).catch(() => undefined);
  };

  useHotkeys(
    {
      s: () => openPicker('status'),
      p: () => openPicker('priority'),
      a: () => openPicker('assignee'),
      d: () => openPicker('due'),
      i: () => {
        const t = targets().filter(x => x.assigneeId !== ws.me.id);
        if (t.length) void update(t, { assigneeId: ws.me.id }, { ws, toast: t.length === 1 ? 'Assigned to you' : undefined }).catch(() => undefined);
      },
      'mod+shift+enter': () => toggleDone(targets()),
      n: () => app.openCreate('task', createDefaults),
    },
    { enabled: !pickerOpen && !sheetId },
  );

  const onPicker = useCallback((id: string, kind: TaskPickerKind | null) => setRowPicker(kind ? { id, kind } : null), []);
  const onToggleDone = useCallback((t: Task) => toggleDone([t]), [toggleDone]);
  // Your own list doesn't need your avatar on every row; A still reassigns.
  const properties = useMemo(() => new Set(options.properties.filter(p => !(p === 'assignee' && (grouping === 'assignee' || (scope === 'mine' && !options.showClosed))))), [options.properties, grouping, scope, options.showClosed]);

  // ── Filters ──
  const filterDefs = useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      listFilter('priorities', 'Priority', <Signal />, () => TASK_PRIORITIES.map(p => ({ value: p, label: p, icon: <PriorityGlyph priority={glyphPriority(p)} /> }))),
      listFilter('categories', 'Category', <Tag />, () => TASK_CATEGORIES.map(c => ({ value: c, label: c }))),
      singleFilter('due', 'Due', <Flag />, () => [
        { value: 'overdue', label: 'Overdue' },
        { value: 'today', label: 'Due today' },
        { value: 'week', label: 'Due within a week' },
        { value: 'none', label: 'No due date' },
      ]),
      listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
      singleFilter('source', 'Source', <Zap />, () => [
        { value: 'automatic', label: 'Opened automatically' },
        { value: 'manual', label: 'Created by people' },
      ]),
      ...(scope === 'done' || options.showClosed ? [listFilter('statuses', 'Status', <CircleDashed />, () => TASK_STATUSES.map(s => ({ value: s, label: s, icon: <TaskStatusGlyph status={s} size={14} /> })))] : []),
    ];
    if (scope !== 'mine') {
      defs.splice(0, 0, listFilter('assigneeIds', 'Assignee', <UserRound />, () => [
        { value: '__me__', label: 'Me', icon: <MemberAvatar member={ws.memberById.get(ws.me.id)} size={16} /> },
        { value: '__none__', label: 'Unassigned', icon: <UnassignedAvatar size={16} /> },
        ...ws.activeMembers.filter(m => m.id !== ws.me.id).map(m => ({ value: m.id, label: m.name, icon: <MemberAvatar member={m} size={16} />, keywords: [m.role] })),
      ]));
    }
    return defs.filter(d => !lockedFilters.includes(d.key));
  }, [ws, lockedFilters, scope, options.showClosed]);

  // ── Saved view ──
  const viewDirty = Boolean(savedView) && list.isDirty;
  const canEditView = savedView && (savedView.ownerId === ws.me.id || ws.can('settings.manage'));
  const saveCurrentView = async () => {
    if (!savedView) return;
    try {
      await saveView({ action: 'update', id: savedView.id, config: { filters: cleanFilters({ ...filters, scope }), options: options as unknown as Record<string, unknown> } });
      invalidate(qc, 'bootstrap');
      toast.success('View updated');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t update the view'));
    }
  };

  const exportCsv = () => {
    const sorted = [...rows].sort(compareTasks(ordering));
    downloadCsv(
      'tasks',
      ['Title', 'Status', 'Priority', 'Category', 'Due', 'Assignee', 'Linked to', 'Property', 'Unit', 'Created by', 'Opened', 'Completed', 'Automatic', 'Description'],
      sorted.map(t => [
        t.title, t.status, t.priority, t.category, t.dueDate ?? '', ws.memberName(t.assigneeId), primaryRelated(t, ws)?.label ?? '', ws.propertyName(t.propertyId),
        t.unitId ? ws.unitById.get(t.unitId)?.name ?? '' : '', t.systemKey ? 'System' : ws.memberName(t.createdById), t.openedAt?.slice(0, 10) ?? '', t.completedAt?.slice(0, 10) ?? '', t.systemKey ? 'Yes' : 'No', t.description,
      ]),
    );
  };

  const listGroups: ListGroup<Task>[] = useMemo(
    () =>
      groups.map(g => ({
        key: g.key,
        label: g.label,
        items: g.items,
        icon:
          g.kind === 'priority' ? <PriorityGlyph priority={glyphPriority(g.key)} /> :
          g.kind === 'assignee' ? (g.key === '__none__' ? <UnassignedAvatar size={16} /> : g.key === '__closed__' ? <TaskStatusGlyph status="Done" size={14} /> : <MemberAvatar member={ws.memberById.get(g.key)} size={16} />) :
          g.kind === 'property' && g.color ? <PropertySwatch color={g.color} /> :
          g.key === 'closed' || g.key === '__closed__' ? <TaskStatusGlyph status="Done" size={14} /> :
          g.key === 'overdue' ? <span className="h-2 w-2 rounded-full bg-tone-danger" aria-hidden /> :
          g.key === 'today' ? <span className="h-2 w-2 rounded-full bg-tone-warning" aria-hidden /> : undefined,
      })),
    [groups, ws],
  );

  const filterCount = countFilters(filters, ['search', 'scope']);
  const hasAnyFilter = filterCount > 0 || Boolean(filters[SEARCH_KEY]);

  const content = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Tasks didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length) {
      return hasAnyFilter ? (
        <EmptyState className="py-20" icon={<ListChecks />} title="No tasks match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => (f.scope ? { scope: f.scope } : {}))}>Clear filters</button>} />
      ) : (
        <EmptyState
          className="py-20"
          icon={scope === 'done' ? <CircleCheck /> : <ListChecks />}
          title={emptyTitle ?? 'No open tasks'}
          description={emptyDescription ?? 'Tasks you create and ones opened automatically for renewals, move-outs and vendor insurance show up here.'}
          action={scope !== 'done' ? <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('task', createDefaults)}><Plus className="h-3.5 w-3.5" /> New task</button> : undefined}
        />
      );
    }
    return (
      <GroupedList
        label="Tasks"
        groups={listGroups}
        single={grouping === 'none'}
        getId={t => t.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(t => t.id)]))}
        renderRow={t => (
          <TaskRow
            task={t}
            properties={properties}
            selected={selection.has(t.id)}
            focused={focusedId === t.id}
            selecting={selecting}
            picker={rowPicker?.id === t.id ? rowPicker.kind : null}
            onPicker={onPicker}
            onClick={onRowClick}
            onHover={onHover}
            onToggleSelect={toggleSelect}
            onToggleDone={onToggleDone}
            targetsFor={targetsFor}
            onOpen={openTask}
          />
        )}
      />
    );
  })();

  const bulkTrigger = (kind: TaskPickerKind, icon: ReactNode, label: string) => (
    <TaskPicker kind={kind} targets={selected} open={bulkPicker === kind} onOpenChange={o => setBulkPicker(o ? kind : null)} align="center" trigger={<button type="button" className={bulkButton}>{icon} {label}</button>} />
  );
  const sheetInitial = sheetId ? rows.find(t => t.id === sheetId) ?? null : null;
  const allSelectedClosed = selected.length > 0 && selected.every(isClosed);

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
        countLabel={['task', 'tasks']}
        search={typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : ''}
        onSearch={q => setFilters(f => ({ ...f, [SEARCH_KEY]: q || undefined }))}
        searchPlaceholder="Search tasks, residents, vendors…"
        fetching={isFetching && !isPending}
        display={
          <DisplayMenu
            options={options}
            onChange={setOptions}
            groupings={GROUPINGS}
            orderings={ORDERINGS}
            properties={DISPLAY_PROPERTIES}
            closedLabel={scope === 'done' ? undefined : 'Show completed (last 14 days)'}
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
                    if (!(await app.confirm({ title: `Delete “${savedView.name}”?`, description: 'The view is removed for everyone it’s shared with. Tasks aren’t affected.', confirmLabel: 'Delete view', destructive: true }))) return;
                    try {
                      await saveView({ action: 'delete', id: savedView.id });
                      invalidate(qc, 'bootstrap');
                      navigate('/tasks');
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
          <TaskPicker kind={floatingPicker.kind} targets={floatingPicker.targets} open onOpenChange={o => !o && setFloatingPicker(null)} align="center" trigger={<span className="block h-0 w-0" />} />
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {content}
      </div>
      <BulkBar count={selected.length} noun={['task', 'tasks']} onClear={clearSelection}>
        <button type="button" className={bulkButton} onClick={() => toggleDone(selected)}>
          {allSelectedClosed ? <RotateCcw /> : <CircleCheck />} {allSelectedClosed ? 'Reopen' : 'Done'}
        </button>
        {bulkTrigger('assignee', <UserRound />, 'Assign')}
        {bulkTrigger('due', <CalendarDays />, 'Due')}
        {bulkTrigger('priority', <Signal />, 'Priority')}
        {selected.every(t => !t.systemKey && (manager || t.createdById === ws.me.id)) && (
          <button type="button" className={`${bulkButton} text-tone-danger hover:text-tone-danger`} onClick={() => void confirmDelete(selected)}>
            <Trash2 /> Delete
          </button>
        )}
      </BulkBar>
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        scope="tasks"
        config={{ filters: cleanFilters({ ...filters, scope }), options }}
        existing={savedView ? { id: savedView.id, name: savedView.name, shared: savedView.shared } : null}
      />
      {sheetId && <TaskSheet key={sheetId} id={sheetId} initial={sheetInitial} onClose={closeTask} />}
    </div>
  );
}

