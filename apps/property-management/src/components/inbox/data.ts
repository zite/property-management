import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { listNotifications, updateNotifications, type ListNotificationsOutputType } from 'zitejs/api';
import type { Bootstrap } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { invalidate, qk } from '../../lib/queries';

/**
 * Inbox data: the signed-in member's notifications, grouped and filtered on
 * the client, with every action applied to the cache (and the sidebar count)
 * before the request leaves. Failure restores the snapshot and says so.
 */

export type Notification = ListNotificationsOutputType['notifications'][number];
export type InboxAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze' | 'unsnooze';

export const ik = {
  lists: [...qk.inbox, 'list'] as const,
  list: (includeArchived: boolean) => [...qk.inbox, 'list', includeArchived] as const,
};

export function useNotifications(includeArchived: boolean) {
  return useQuery({
    queryKey: ik.list(includeArchived),
    queryFn: () => listNotifications({ includeArchived }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}

export const isSnoozed = (n: Notification, now = Date.now()) => Boolean(n.snoozedUntil && Date.parse(n.snoozedUntil) > now);
export const isUnread = (n: Notification) => !n.readAt && !n.archivedAt;

// ─── Kinds ──────────────────────────────────────────────────────────────────

export type KindGroup = 'work' | 'money' | 'leasing' | 'messages' | 'tasks' | 'compliance' | 'other';

export const KIND_GROUPS: ReadonlyArray<{ value: KindGroup; label: string }> = [
  { value: 'work', label: 'Work orders' },
  { value: 'messages', label: 'Messages and mentions' },
  { value: 'leasing', label: 'Leasing and leases' },
  { value: 'money', label: 'Payments and bills' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'compliance', label: 'Insurance and inspections' },
  { value: 'other', label: 'Everything else' },
];

export function kindGroup(kind: string): KindGroup {
  if (kind.startsWith('work_order')) return 'work';
  if (kind.startsWith('payment') || kind === 'bill_due' || kind === 'invoice_submitted') return 'money';
  if (['application_submitted', 'inquiry_received', 'lease_signed', 'lease_expiring', 'renewal_response', 'notice_given'].includes(kind)) return 'leasing';
  if (kind === 'message_received' || kind === 'mention') return 'messages';
  if (kind.startsWith('task')) return 'tasks';
  if (kind === 'insurance_expiring' || kind === 'inspection_due') return 'compliance';
  return 'other';
}

export const KIND_LABEL: Record<string, string> = {
  work_order_created: 'New request',
  work_order_assigned: 'Assigned to you',
  work_order_updated: 'Work order',
  work_order_message: 'Reply',
  work_order_approval: 'Owner approval',
  payment_received: 'Payment',
  payment_failed: 'Payment failed',
  application_submitted: 'Application',
  inquiry_received: 'Inquiry',
  lease_signed: 'Lease signed',
  lease_expiring: 'Lease ending',
  renewal_response: 'Renewal',
  notice_given: 'Notice to vacate',
  message_received: 'Message',
  task_assigned: 'Task',
  task_due: 'Task due',
  mention: 'Mention',
  bill_due: 'Bills due',
  invoice_submitted: 'Invoice',
  insurance_expiring: 'Insurance',
  inspection_due: 'Inspection',
  automation: 'System',
};

// ─── Grouping by time ───────────────────────────────────────────────────────

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function timeBucket(iso: string, now = new Date()) {
  const t = Date.parse(iso);
  const today = startOfDay(now);
  if (t >= today) return 'today';
  if (t >= today - 86_400_000) return 'yesterday';
  if (t >= today - 6 * 86_400_000) return 'week';
  return 'older';
}

export const TIME_BUCKETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'older', label: 'Older' },
] as const;

// ─── Snooze presets ─────────────────────────────────────────────────────────

export function snoozePresets(now = new Date()) {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const monday = at(((8 - now.getDay()) % 7) || 7, 8);
  const presets = [
    { key: 'later', label: 'In 3 hours', until: new Date(now.getTime() + 3 * 3_600_000) },
    { key: 'tomorrow', label: 'Tomorrow', until: at(1, 8) },
    { key: 'week', label: 'Next week', until: monday },
  ];
  return presets.filter(p => p.key !== 'later' || now.getHours() < 18);
}

// ─── Optimistic writes ──────────────────────────────────────────────────────

type Snapshot = Array<[readonly unknown[], unknown]>;

function apply(n: Notification, action: InboxAction, until: string | null, now: string): Notification {
  switch (action) {
    case 'read': return n.readAt ? n : { ...n, readAt: now };
    case 'unread': return { ...n, readAt: null };
    case 'archive': return { ...n, archivedAt: n.archivedAt ?? now, readAt: n.readAt ?? now };
    case 'unarchive': return { ...n, archivedAt: null };
    case 'snooze': return { ...n, snoozedUntil: until };
    case 'unsnooze': return { ...n, snoozedUntil: null };
  }
}

/** The sidebar badge, recomputed from the cache so it moves with the click. */
function syncSidebarCount(qc: QueryClient) {
  const lists = qc.getQueriesData<ListNotificationsOutputType>({ queryKey: ik.lists });
  const data = lists.find(([, d]) => d)?.[1];
  if (!data) return;
  const now = Date.now();
  const unread = data.notifications.filter(n => isUnread(n) && !isSnoozed(n, now)).length;
  qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, counts: { ...old.counts, inboxUnread: unread } } : old));
}

let reconcileTimer: number | undefined;
function reconcileSoon(qc: QueryClient) {
  window.clearTimeout(reconcileTimer);
  reconcileTimer = window.setTimeout(() => invalidate(qc, 'inbox', 'bootstrap'), 1500);
}

export function useInboxActions() {
  const qc = useQueryClient();

  const act = useCallback(
    async (ids: string[], action: InboxAction, opts: { until?: string; toast?: string; undo?: () => void } = {}) => {
      if (!ids.length) return;
      await qc.cancelQueries({ queryKey: qk.inbox });
      const snap: Snapshot = [...qc.getQueriesData({ queryKey: ik.lists }), [qk.bootstrap, qc.getQueryData(qk.bootstrap)]];
      const set = new Set(ids);
      const now = new Date().toISOString();
      qc.setQueriesData<ListNotificationsOutputType>({ queryKey: ik.lists }, old => (old ? { ...old, notifications: old.notifications.map(n => (set.has(n.id) ? apply(n, action, opts.until ?? null, now) : n)) } : old));
      syncSidebarCount(qc);
      try {
        await updateNotifications({ action, ids, until: opts.until });
        reconcileSoon(qc);
        if (opts.toast) toast.success(opts.toast, opts.undo ? { action: { label: 'Undo', onClick: opts.undo } } : undefined);
      } catch (e) {
        for (const [key, data] of snap) qc.setQueryData(key, data);
        toast.error(errorMessage(e, 'Couldn’t update your inbox'));
        throw e;
      }
    },
    [qc],
  );

  const markAllRead = useCallback(async () => {
    const lists = qc.getQueriesData<ListNotificationsOutputType>({ queryKey: ik.lists });
    const unreadIds = [...new Set(lists.flatMap(([, d]) => d?.notifications ?? []).filter(isUnread).map(n => n.id))];
    if (!unreadIds.length) return;
    const snap: Snapshot = [...lists, [qk.bootstrap, qc.getQueryData(qk.bootstrap)]];
    const now = new Date().toISOString();
    qc.setQueriesData<ListNotificationsOutputType>({ queryKey: ik.lists }, old => (old ? { ...old, notifications: old.notifications.map(n => (isUnread(n) ? { ...n, readAt: now } : n)) } : old));
    syncSidebarCount(qc);
    try {
      await updateNotifications({ action: 'read', allUnread: true });
      reconcileSoon(qc);
      toast.success(`Marked ${unreadIds.length} ${unreadIds.length === 1 ? 'notification' : 'notifications'} read`, { action: { label: 'Undo', onClick: () => void act(unreadIds, 'unread').catch(() => undefined) } });
    } catch (e) {
      for (const [key, data] of snap) qc.setQueryData(key, data);
      toast.error(errorMessage(e, 'Couldn’t mark everything read'));
    }
  }, [qc, act]);

  return { act, markAllRead };
}
