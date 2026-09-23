import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { getTask, listTasks, updateTasks, type GetTaskOutputType, type ListTasksInputType, type ListTasksOutputType } from 'zitejs/api';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import { applicationRef, workOrderRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { addDays } from '../../lib/format';
import { invalidate, qk, retryUnlessNotFound } from '../../lib/queries';
import type { Workspace } from '../../lib/workspace';

/**
 * Task data: types, queries, grouping and optimistic writes.
 *
 * A completion is written into every cached list and the open task before the
 * request leaves, so the circle fills instantly; failure restores the snapshot.
 * Lists catch up with the server on a short debounce, long enough that a task
 * you just completed stays visible (struck through) while its undo toast shows.
 */

export type Task = ListTasksOutputType['tasks'][number];
export type TaskDetail = GetTaskOutputType;
export type TaskFilters = NonNullable<ListTasksInputType['filters']>;
export type TaskScope = NonNullable<TaskFilters['scope']>;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type TaskPatch = Partial<{ title: string; description: string; status: TaskStatus; priority: TaskPriority; category: TaskCategory; dueDate: string | null; assigneeId: string | null }>;

export const tk = {
  lists: [...qk.tasks, 'list'] as const,
  list: (filters: TaskFilters) => [...qk.tasks, 'list', filters] as const,
  details: [...qk.tasks, 'detail'] as const,
  detail: (id: string) => [...qk.tasks, 'detail', id] as const,
};

export function useTasks(filters: TaskFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: tk.list(filters), queryFn: () => listTasks({ filters }), placeholderData: keepPreviousData, staleTime: 20_000, enabled: opts.enabled ?? true });
}

export function useTask(id: string | null | undefined) {
  return useQuery({ queryKey: tk.detail(id ?? ''), queryFn: () => getTask({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000 });
}

export const isClosed = (t: Pick<Task, 'status'>) => t.status === 'Done' || t.status === 'Canceled';
export const canManageTasks = (ws: Workspace) => ws.can('maintenance.manage') || ws.can('settings.manage');

/** Task priorities share the work order glyph; Urgent draws as the red square. */
export const glyphPriority = (p: string) => (p === 'Urgent' ? 'Emergency' : p);

// ─── Related record ─────────────────────────────────────────────────────────

export type RelatedKind = 'workOrder' | 'lease' | 'application' | 'tenant' | 'vendor' | 'owner' | 'unit' | 'property';
export type Related = { kind: RelatedKind; id: string; label: string; to: string | null; noun: string };

const ROUTE_CAPABILITY: Partial<Record<RelatedKind, Parameters<Workspace['can']>[0]>> = {
  workOrder: 'maintenance.create',
  lease: 'residents.manage',
  tenant: 'residents.manage',
  application: 'leasing.manage',
  vendor: 'vendors.manage',
  owner: 'owners.manage',
};

/** Everything a task is linked to, most specific first. Links the person can't open render as plain text. */
export function relatedList(t: Task, ws: Workspace): Related[] {
  const out: Related[] = [];
  const route = (kind: RelatedKind, to: string) => (ROUTE_CAPABILITY[kind] && !ws.can(ROUTE_CAPABILITY[kind]!) ? null : to);
  if (t.workOrderId) out.push({ kind: 'workOrder', id: t.workOrderId, noun: 'Work order', label: t.workOrderNumber ? `${workOrderRef(t.workOrderNumber)} ${t.workOrderTitle ?? ''}`.trim() : 'Work order', to: t.workOrderNumber ? route('workOrder', `/work-orders/${t.workOrderNumber}`) : null });
  if (t.leaseId) out.push({ kind: 'lease', id: t.leaseId, noun: 'Lease', label: t.leaseName ?? 'Lease', to: route('lease', `/leases/${t.leaseId}`) });
  if (t.applicationId) out.push({ kind: 'application', id: t.applicationId, noun: 'Application', label: t.applicationNumber ? `${applicationRef(t.applicationNumber)} ${t.applicationName ?? ''}`.trim() : 'Application', to: t.applicationNumber ? route('application', `/applications/${t.applicationNumber}`) : null });
  if (t.tenantId) out.push({ kind: 'tenant', id: t.tenantId, noun: 'Resident', label: t.tenantName ?? 'Resident', to: route('tenant', `/residents/${t.tenantId}`) });
  if (t.vendorId) out.push({ kind: 'vendor', id: t.vendorId, noun: 'Vendor', label: t.vendorName ?? ws.vendorById.get(t.vendorId)?.name ?? 'Vendor', to: route('vendor', `/vendors/${t.vendorId}`) });
  if (t.ownerId) out.push({ kind: 'owner', id: t.ownerId, noun: 'Owner', label: t.ownerName ?? ws.ownerById.get(t.ownerId)?.name ?? 'Owner', to: route('owner', `/owners/${t.ownerId}`) });
  if (t.unitId && ws.unitById.has(t.unitId)) out.push({ kind: 'unit', id: t.unitId, noun: 'Unit', label: ws.unitLabel(t.unitId), to: `/units/${t.unitId}` });
  if (t.propertyId && ws.propertyById.has(t.propertyId)) out.push({ kind: 'property', id: t.propertyId, noun: 'Property', label: ws.propertyName(t.propertyId), to: `/properties/${t.propertyId}` });
  return out;
}

/** The one link a row shows. A unit beats its property; a lease beats both. */
export const primaryRelated = (t: Task, ws: Workspace) => relatedList(t, ws)[0] ?? null;

// ─── Grouping & ordering ────────────────────────────────────────────────────

export type TaskGrouping = 'due' | 'assignee' | 'category' | 'property' | 'priority' | 'none';
export type TaskOrdering = 'due' | 'priority' | 'newest' | 'title' | 'completed';

export const GROUPINGS: ReadonlyArray<{ value: TaskGrouping; label: string }> = [
  { value: 'due', label: 'Due date' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'category', label: 'Category' },
  { value: 'property', label: 'Property' },
  { value: 'priority', label: 'Priority' },
  { value: 'none', label: 'No grouping' },
];

export const ORDERINGS: ReadonlyArray<{ value: TaskOrdering; label: string }> = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'newest', label: 'Newest' },
  { value: 'title', label: 'Title' },
  { value: 'completed', label: 'Recently completed' },
];

export const DISPLAY_PROPERTIES = [
  { key: 'priority', label: 'Priority' },
  { key: 'related', label: 'Linked record' },
  { key: 'category', label: 'Category' },
  { key: 'due', label: 'Due date' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'created', label: 'Created' },
];

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
const nullsLast = (a: string | null, b: string | null) => (a && b ? (a < b ? -1 : a > b ? 1 : 0) : a ? -1 : b ? 1 : 0);

export function compareTasks(ordering: TaskOrdering) {
  const newest = (a: Task, b: Task) => (b.openedAt ?? '').localeCompare(a.openedAt ?? '');
  const rank = (a: Task, b: Task) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  switch (ordering) {
    case 'priority': return (a: Task, b: Task) => rank(a, b) || nullsLast(a.dueDate, b.dueDate) || newest(a, b);
    case 'newest': return newest;
    case 'title': return (a: Task, b: Task) => a.title.localeCompare(b.title);
    case 'completed': return (a: Task, b: Task) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || newest(a, b);
    default: return (a: Task, b: Task) => nullsLast(a.dueDate, b.dueDate) || rank(a, b) || newest(a, b);
  }
}

export type TaskGroup = { key: string; label: string; items: Task[]; kind: TaskGrouping; color?: string };

export const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
  { key: 'closed', label: 'Completed' },
] as const;

/** Completed in the last minute (usually just now, by you): the row stays where it was until the list refreshes. */
const justClosed = (t: Task) => isClosed(t) && Boolean(t.completedAt) && Date.now() - Date.parse(t.completedAt!) < 60_000;

export function dueBucket(t: Task, today: string) {
  if (isClosed(t) && !justClosed(t)) return 'closed';
  if (!t.dueDate) return 'none';
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  if (t.dueDate <= addDays(7, today)) return 'week';
  return 'later';
}

export function groupTasks(rows: Task[], grouping: TaskGrouping, ordering: TaskOrdering, ws: Workspace, opts: { today: string; showEmpty?: boolean }): TaskGroup[] {
  const sorted = [...rows].sort(compareTasks(ordering));
  if (grouping === 'none') return [{ key: 'all', label: 'All tasks', items: sorted, kind: 'none' }];
  const keyOf = (t: Task): string => {
    if (grouping !== 'due' && isClosed(t) && !justClosed(t)) return '__closed__';
    switch (grouping) {
      case 'due': return dueBucket(t, opts.today);
      case 'assignee': return t.assigneeId ?? '__none__';
      case 'category': return t.category;
      case 'priority': return t.priority;
      case 'property': return t.propertyId ?? '__none__';
      default: return 'all';
    }
  };
  const buckets = new Map<string, Task[]>();
  for (const t of sorted) {
    const k = keyOf(t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }
  const make = (key: string, label: string, color?: string): TaskGroup => ({ key, label, items: buckets.get(key) ?? [], kind: grouping, color });
  const keep = (key: string) => opts.showEmpty || buckets.has(key);
  let groups: TaskGroup[] = [];
  switch (grouping) {
    case 'due':
      groups = DUE_BUCKETS.filter(b => (b.key === 'closed' ? buckets.has(b.key) : keep(b.key))).map(b => make(b.key, b.label));
      break;
    case 'priority':
      groups = TASK_PRIORITIES.filter(keep).map(p => make(p, p));
      break;
    case 'category':
      groups = TASK_CATEGORIES.filter(keep).map(c => make(c, c));
      break;
    case 'assignee': {
      const ids = [...buckets.keys()].filter(k => k !== '__none__' && k !== '__closed__');
      const me = ids.includes(ws.me.id) ? [make(ws.me.id, `${ws.memberName(ws.me.id)} (you)`)] : [];
      groups = [...me, ...ids.filter(k => k !== ws.me.id).map(k => make(k, ws.memberName(k))).sort((a, b) => a.label.localeCompare(b.label))];
      if (buckets.has('__none__')) groups.unshift(make('__none__', 'Unassigned'));
      break;
    }
    case 'property':
      groups = ws.orderedProperties.filter(p => buckets.has(p.id)).map(p => make(p.id, p.name, p.color));
      if (buckets.has('__none__')) groups.push(make('__none__', 'No property'));
      break;
  }
  if (grouping !== 'due' && buckets.has('__closed__')) groups.push(make('__closed__', 'Completed'));
  return groups;
}

// ─── Optimistic writes ──────────────────────────────────────────────────────

type Snapshot = Array<[readonly unknown[], unknown]>;
const snapshot = (qc: QueryClient): Snapshot => [...qc.getQueriesData({ queryKey: tk.lists }), ...qc.getQueriesData({ queryKey: tk.details })];
const restore = (qc: QueryClient, snap: Snapshot) => {
  for (const [key, data] of snap) qc.setQueryData(key, data);
};

export function applyTaskPatch<T extends Task>(t: T, patch: TaskPatch): T {
  const next = { ...t, ...patch } as T;
  if (patch.status === 'Done' && t.status !== 'Done') next.completedAt = new Date().toISOString();
  if (patch.status && patch.status !== 'Done' && patch.status !== 'Canceled') next.completedAt = null;
  return next;
}

export function patchTaskCaches(qc: QueryClient, ids: Set<string>, patch: TaskPatch) {
  qc.setQueriesData<ListTasksOutputType>({ queryKey: tk.lists }, old => (old ? { ...old, tasks: old.tasks.map(t => (ids.has(t.id) ? applyTaskPatch(t, patch) : t)) } : old));
  qc.setQueriesData<TaskDetail>({ queryKey: tk.details }, old => (old?.task && ids.has(old.task.id) ? { ...old, task: applyTaskPatch(old.task, patch) } : old));
}

let refreshTimer: number | undefined;
export function refreshTasksSoon(qc: QueryClient, delay = 1200) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => invalidate(qc, 'tasks', 'bootstrap', 'dashboard', 'activity'), delay);
}

const quoted = (t: Pick<Task, 'title'>) => `“${t.title.length > 48 ? `${t.title.slice(0, 46)}…` : t.title}”`;

export function describeTaskPatch(patch: TaskPatch, ws: Workspace, targets: Array<Pick<Task, 'title'>>) {
  const what = targets.length === 1 ? quoted(targets[0]) : `${targets.length} tasks`;
  if (patch.status === 'Done') return `Completed ${what}`;
  if (patch.status === 'Canceled') return `Canceled ${what}`;
  if (patch.status) return `Moved ${what} to ${patch.status}`;
  if (patch.assigneeId !== undefined) return patch.assigneeId ? `Assigned ${what} to ${patch.assigneeId === ws.me.id ? 'you' : ws.memberName(patch.assigneeId)}` : `Unassigned ${what}`;
  if (patch.dueDate !== undefined) return patch.dueDate ? `Rescheduled ${what}` : `Removed the due date from ${what}`;
  if (patch.priority) return `Set ${what} to ${patch.priority.toLowerCase()} priority`;
  if (patch.category) return `Moved ${what} to ${patch.category}`;
  return `Updated ${what}`;
}

export function useTaskActions() {
  const qc = useQueryClient();

  const update = useCallback(
    async (targets: Task[], patch: TaskPatch, opts: { toast?: string | false; undo?: boolean; ws?: Workspace } = {}) => {
      if (!targets.length) return;
      await qc.cancelQueries({ queryKey: qk.tasks });
      const snap = snapshot(qc);
      const ids = new Set(targets.map(t => t.id));
      const before = targets.map(t => ({ id: t.id, status: t.status, assigneeId: t.assigneeId, dueDate: t.dueDate, priority: t.priority, category: t.category }));
      patchTaskCaches(qc, ids, patch);
      try {
        await updateTasks({ action: 'update', ids: [...ids], patch });
        const closing = patch.status === 'Done' || patch.status === 'Canceled';
        refreshTasksSoon(qc, closing ? 4000 : targets.length > 1 ? 400 : 1200);
        const message = opts.toast === false ? null : opts.toast ?? (opts.ws ? describeTaskPatch(patch, opts.ws, targets) : null);
        if (message) {
          const undo = opts.undo
            ? {
                label: 'Undo',
                onClick: () => {
                  // Put each task back the way it was, grouped so one request restores many.
                  const keys = Object.keys(patch) as Array<keyof TaskPatch>;
                  const groups = new Map<string, { patch: TaskPatch; ids: string[] }>();
                  for (const b of before) {
                    const back = Object.fromEntries(keys.map(k => [k, (b as Record<string, unknown>)[k] ?? null])) as TaskPatch;
                    const key = JSON.stringify(back);
                    groups.set(key, { patch: back, ids: [...(groups.get(key)?.ids ?? []), b.id] });
                  }
                  void (async () => {
                    for (const g of groups.values()) {
                      patchTaskCaches(qc, new Set(g.ids), g.patch);
                      try {
                        await updateTasks({ action: 'update', ids: g.ids, patch: g.patch });
                      } catch (e) {
                        toast.error(errorMessage(e, 'Couldn’t undo that'));
                      }
                    }
                    refreshTasksSoon(qc, 400);
                  })();
                },
              }
            : undefined;
          toast.success(message, { action: undo });
        }
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, targets.length === 1 ? `Couldn’t update ${quoted(targets[0])}` : `Couldn’t update ${targets.length} tasks`));
        throw e;
      }
    },
    [qc],
  );

  const remove = useCallback(
    async (targets: Task[]) => {
      if (!targets.length) return;
      const snap = snapshot(qc);
      const ids = new Set(targets.map(t => t.id));
      qc.setQueriesData<ListTasksOutputType>({ queryKey: tk.lists }, old => (old ? { ...old, tasks: old.tasks.filter(t => !ids.has(t.id)) } : old));
      try {
        await updateTasks({ action: 'delete', ids: [...ids] });
        refreshTasksSoon(qc, 300);
        toast.success(targets.length === 1 ? `Deleted ${quoted(targets[0])}` : `Deleted ${targets.length} tasks`);
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, 'Couldn’t delete'));
        throw e;
      }
    },
    [qc],
  );

  return { update, remove };
}
