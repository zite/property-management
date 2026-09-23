import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { getWorkOrder, listWorkOrders, updateWorkOrders, type GetWorkOrderOutputType, type ListWorkOrdersInputType, type ListWorkOrdersOutputType } from 'zitejs/api';
import { COLORS, OPEN_WORK_ORDER_STATUSES, PRIORITY_COLOR, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, type WorkOrderPriority, type WorkOrderStatus } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { invalidate, qk, retryUnlessNotFound } from '../../lib/queries';
import type { Workspace } from '../../lib/workspace';

/**
 * Work order data: types, queries, grouping and optimistic writes.
 *
 * Every edit is written into every cached list and the open detail before the
 * request leaves, so a status change is instant on the list, the board, the
 * peek and the page at once. Failure restores the snapshot. Lists catch up
 * with the server on a short debounce so a burst of keyboard edits is one refetch.
 */

export type WorkOrder = ListWorkOrdersOutputType['workOrders'][number];
export type WorkOrderDetail = GetWorkOrderOutputType;
export type WorkOrderFilters = NonNullable<ListWorkOrdersInputType['filters']>;
export type WorkOrderPatch = Partial<{
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  category: (typeof WORK_ORDER_CATEGORIES)[number];
  propertyId: string;
  unitId: string | null;
  assigneeId: string | null;
  vendorId: string | null;
  scheduledFor: string | null;
  dueDate: string | null;
  permissionToEnter: boolean;
  entryNotes: string;
  estimateAmount: number | null;
  actualCost: number | null;
  completionNotes: string;
  photos: Array<{ url: string; name: string }>;
}>;

/** sessionStorage key holding the last list's visible order, so a record page can step J/K through it. */
export const NAV_ORDER_KEY = 'property-management:work-orders:order';

export const wok = {
  lists: [...qk.workOrders, 'list'] as const,
  list: (filters: WorkOrderFilters) => [...qk.workOrders, 'list', filters] as const,
  details: [...qk.workOrders, 'detail'] as const,
  detail: (number: number) => [...qk.workOrders, 'detail', number] as const,
};

export function useWorkOrders(filters: WorkOrderFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: wok.list(filters),
    queryFn: () => listWorkOrders({ filters }),
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    enabled: opts.enabled ?? true,
  });
}

export function useWorkOrder(number: number | null | undefined) {
  return useQuery({
    queryKey: wok.detail(number ?? 0),
    queryFn: () => getWorkOrder({ number: number! }),
    enabled: Boolean(number),
    retry: retryUnlessNotFound,
    staleTime: 10_000,
  });
}

// ─── Grouping & ordering ────────────────────────────────────────────────────

export type WorkOrderGrouping = 'status' | 'priority' | 'assignee' | 'vendor' | 'property' | 'category' | 'none';
export type WorkOrderOrdering = 'priority' | 'due' | 'newest' | 'oldest' | 'updated' | 'scheduled';

export const GROUPINGS: ReadonlyArray<{ value: WorkOrderGrouping; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'property', label: 'Property' },
  { value: 'category', label: 'Category' },
  { value: 'none', label: 'No grouping' },
];

export const ORDERINGS: ReadonlyArray<{ value: WorkOrderOrdering; label: string }> = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'scheduled', label: 'Scheduled time' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'updated', label: 'Last updated' },
];

export const DISPLAY_PROPERTIES = [
  { key: 'number', label: 'ID' },
  { key: 'priority', label: 'Priority' },
  { key: 'location', label: 'Unit' },
  { key: 'resident', label: 'Resident' },
  { key: 'category', label: 'Category' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'due', label: 'Due date' },
  { key: 'approval', label: 'Approval' },
  { key: 'messages', label: 'Messages' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'created', label: 'Created' },
];

const PRIORITY_RANK: Record<string, number> = { Emergency: 0, High: 1, Normal: 2, Low: 3 };

export function compareWorkOrders(ordering: WorkOrderOrdering) {
  const byNumberDesc = (a: WorkOrder, b: WorkOrder) => b.number - a.number;
  const nullsLast = (a: string | null, b: string | null) => (a && b ? (a < b ? -1 : a > b ? 1 : 0) : a ? -1 : b ? 1 : 0);
  switch (ordering) {
    case 'priority':
      return (a: WorkOrder, b: WorkOrder) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || nullsLast(a.dueDate, b.dueDate) || byNumberDesc(a, b);
    case 'due':
      return (a: WorkOrder, b: WorkOrder) => nullsLast(a.dueDate, b.dueDate) || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || byNumberDesc(a, b);
    case 'scheduled':
      return (a: WorkOrder, b: WorkOrder) => nullsLast(a.scheduledFor, b.scheduledFor) || byNumberDesc(a, b);
    case 'oldest':
      return (a: WorkOrder, b: WorkOrder) => a.number - b.number;
    case 'updated':
      return (a: WorkOrder, b: WorkOrder) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || byNumberDesc(a, b);
    default:
      return byNumberDesc;
  }
}

export type WorkOrderGroup = { key: string; label: string; items: WorkOrder[]; color?: string; kind: WorkOrderGrouping; droppable?: boolean };

export function groupWorkOrders(rows: WorkOrder[], grouping: WorkOrderGrouping, ordering: WorkOrderOrdering, ws: Workspace, opts: { showEmpty?: boolean; showClosed?: boolean; board?: boolean } = {}): WorkOrderGroup[] {
  const sorted = [...rows].sort(compareWorkOrders(ordering));
  if (grouping === 'none') return [{ key: 'all', label: 'All work orders', items: sorted, kind: 'none' }];
  const buckets = new Map<string, WorkOrder[]>();
  const keyOf = (w: WorkOrder): string => {
    switch (grouping) {
      case 'status': return w.status;
      case 'priority': return w.priority;
      case 'assignee': return w.assigneeId ?? '__none__';
      case 'vendor': return w.vendorId ?? '__none__';
      case 'property': return w.propertyId ?? '__none__';
      case 'category': return w.category;
      default: return 'all';
    }
  };
  for (const w of sorted) {
    const k = keyOf(w);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(w);
  }
  const make = (key: string, label: string, color?: string): WorkOrderGroup => ({ key, label, items: buckets.get(key) ?? [], color, kind: grouping });
  let groups: WorkOrderGroup[] = [];
  const showEmpty = opts.showEmpty || opts.board;
  switch (grouping) {
    case 'status': {
      const statuses = opts.showClosed || opts.board ? WORK_ORDER_STATUSES : OPEN_WORK_ORDER_STATUSES;
      groups = statuses.filter(s => showEmpty || buckets.has(s)).map(s => make(s, s));
      // A closed status the filters asked for still shows even when "show closed" is off.
      for (const s of WORK_ORDER_STATUSES) if (buckets.has(s) && !groups.some(g => g.key === s)) groups.push(make(s, s));
      if (opts.board && !opts.showClosed) groups = groups.filter(g => g.key !== 'Canceled' || g.items.length > 0);
      break;
    }
    case 'priority':
      groups = WORK_ORDER_PRIORITIES.filter(p => showEmpty || buckets.has(p)).map(p => make(p, p, PRIORITY_COLOR[p]));
      break;
    case 'category':
      groups = WORK_ORDER_CATEGORIES.filter(c => showEmpty || buckets.has(c)).map(c => make(c, c));
      break;
    case 'assignee': {
      const members = ws.activeMembers.filter(m => ws.can('maintenance.create') && (buckets.has(m.id) || (showEmpty && ['Admin', 'Property Manager', 'Maintenance'].includes(m.role))));
      const me = members.find(m => m.id === ws.me.id);
      const others = members.filter(m => m.id !== ws.me.id).sort((a, b) => a.name.localeCompare(b.name));
      groups = [...(me ? [make(me.id, `${me.name} (you)`)] : []), ...others.map(m => make(m.id, m.name))];
      for (const k of buckets.keys()) if (k !== '__none__' && !groups.some(g => g.key === k)) groups.push(make(k, ws.memberName(k)));
      if (showEmpty || buckets.has('__none__')) groups.unshift(make('__none__', 'Unassigned'));
      break;
    }
    case 'vendor': {
      const vendors = [...buckets.keys()].filter(k => k !== '__none__').map(k => ({ k, name: ws.vendorById.get(k)?.name ?? 'Former vendor' })).sort((a, b) => a.name.localeCompare(b.name));
      groups = vendors.map(v => make(v.k, v.name, ws.vendorById.get(v.k)?.color));
      if (showEmpty && opts.board) for (const v of ws.activeVendors) if (!buckets.has(v.id)) groups.push(make(v.id, v.name, v.color));
      if (showEmpty || buckets.has('__none__')) groups.unshift(make('__none__', 'In-house'));
      break;
    }
    case 'property': {
      groups = ws.orderedProperties.filter(p => buckets.has(p.id) || (showEmpty && p.status !== 'Archived')).map(p => make(p.id, p.name, p.color));
      if (buckets.has('__none__')) groups.push(make('__none__', 'No property'));
      break;
    }
  }
  if (opts.board) groups = groups.map(g => ({ ...g, droppable: grouping !== 'property' || g.key !== '__none__' }));
  return groups;
}

/** The patch that moves a work order into a group (board drops, "move to" menus). */
export function patchForGroup(grouping: WorkOrderGrouping, key: string): WorkOrderPatch | null {
  switch (grouping) {
    case 'status': return { status: key as WorkOrderStatus };
    case 'priority': return { priority: key as WorkOrderPriority };
    case 'assignee': return { assigneeId: key === '__none__' ? null : key };
    case 'vendor': return { vendorId: key === '__none__' ? null : key };
    case 'category': return { category: key as WorkOrderPatch['category'] };
    case 'property': return key === '__none__' ? null : { propertyId: key, unitId: null };
    default: return null;
  }
}

export const statusColor = (s: string) => (s === 'Canceled' ? COLORS.gray : undefined);

// ─── Optimistic writes ──────────────────────────────────────────────────────

type Snapshot = Array<[readonly unknown[], unknown]>;

function snapshot(qc: QueryClient): Snapshot {
  return [...qc.getQueriesData({ queryKey: wok.lists }), ...qc.getQueriesData({ queryKey: wok.details })];
}

function restore(qc: QueryClient, snap: Snapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

export function applyPatch<T extends WorkOrder>(w: T, patch: WorkOrderPatch): T {
  const now = new Date().toISOString();
  const next = { ...w, ...patch, lastActivityAt: now } as T;
  if (patch.scheduledFor && !patch.status && w.status === 'New') next.status = 'Scheduled';
  if (patch.status === 'In progress' && !w.startedAt) next.startedAt = now;
  if (patch.status === 'Completed') next.completedAt = now;
  if (patch.status && patch.status !== 'Completed' && w.status === 'Completed') next.completedAt = null;
  return next;
}

export function patchWorkOrderCaches(qc: QueryClient, ids: Set<string>, patch: WorkOrderPatch) {
  qc.setQueriesData<ListWorkOrdersOutputType>({ queryKey: wok.lists }, old => (old ? { ...old, workOrders: old.workOrders.map(w => (ids.has(w.id) ? applyPatch(w, patch) : w)) } : old));
  qc.setQueriesData<WorkOrderDetail>({ queryKey: wok.details }, old => (old?.workOrder && ids.has(old.workOrder.id) ? { ...old, workOrder: applyPatch(old.workOrder, patch) } : old));
}

const timers = new Map<string, number>();
export function refreshSoon(qc: QueryClient, delay = 1200) {
  const id = 'workOrders';
  window.clearTimeout(timers.get(id));
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id);
      invalidate(qc, 'workOrders', 'bootstrap', 'dashboard', 'inbox', 'vendors', 'units', 'properties');
    }, delay),
  );
}

export function describePatch(patch: WorkOrderPatch, ws: Workspace) {
  if (patch.status) return patch.status === 'Completed' ? 'Marked completed' : patch.status === 'Canceled' ? 'Canceled' : `Moved to ${patch.status}`;
  if (patch.priority) return `Priority set to ${patch.priority}`;
  if (patch.assigneeId !== undefined) return patch.assigneeId ? `Assigned to ${ws.memberName(patch.assigneeId)}` : 'Unassigned';
  if (patch.vendorId !== undefined) return patch.vendorId ? `Vendor set to ${ws.vendorById.get(patch.vendorId)?.name ?? 'vendor'}` : 'Vendor removed';
  if (patch.category) return `Category set to ${patch.category}`;
  if (patch.dueDate !== undefined) return patch.dueDate ? 'Due date updated' : 'Due date removed';
  if (patch.scheduledFor !== undefined) return patch.scheduledFor ? 'Scheduled' : 'Schedule cleared';
  return 'Updated';
}

export function useWorkOrderActions() {
  const qc = useQueryClient();

  const update = useCallback(
    async (targets: Array<Pick<WorkOrder, 'id' | 'number'>>, patch: WorkOrderPatch, opts: { silent?: boolean; toast?: string | false; undo?: WorkOrderPatch[] } = {}) => {
      if (!targets.length) return;
      await qc.cancelQueries({ queryKey: qk.workOrders });
      const snap = snapshot(qc);
      const ids = new Set(targets.map(t => t.id));
      patchWorkOrderCaches(qc, ids, patch);
      try {
        await updateWorkOrders({ ids: [...ids], patch, silent: opts.silent });
        refreshSoon(qc, targets.length > 1 ? 400 : 1200);
        if (opts.toast !== false && (opts.toast || targets.length > 1)) {
          toast.success(opts.toast || `Updated ${targets.length} work orders`);
        }
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, targets.length === 1 ? `Couldn’t update ${workOrderRef(targets[0].number)}` : `Couldn’t update ${targets.length} work orders`));
        throw e;
      }
    },
    [qc],
  );

  return { update };
}
