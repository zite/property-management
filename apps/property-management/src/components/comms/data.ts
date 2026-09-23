import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  getAnnouncement, getThread, listAnnouncements, listThreads, markThreadRead, sendAnnouncement, sendMessages,
  type GetAnnouncementOutputType, type GetThreadOutputType, type ListAnnouncementsOutputType, type ListThreadsOutputType, type SendMessagesInputType, type SendMessagesOutputType,
} from 'zitejs/api';
import { MERGE_TAGS } from '@project/shared/merge';
import type { ComposeRecipient } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { invalidate, qk, retryUnlessNotFound } from '../../lib/queries';
import type { Bootstrap } from '../../lib/types';

/**
 * Messages and announcements on the client: query keys, the thread list and
 * thread queries, optimistic read state, chunked sending and the announcement
 * send loop (which keeps going after its dialog closes).
 */

export type ThreadFilter = 'all' | 'unread' | 'tenant' | 'owner' | 'vendor' | 'applicant' | 'work_order';
export type ThreadPage = ListThreadsOutputType;
export type ThreadRow = ThreadPage['threads'][number];
export type ThreadDetail = GetThreadOutputType;
export type ThreadMessage = ThreadDetail['messages'][number];
export type ThreadParty = ThreadDetail['parties'][number];
export type Announcement = ListAnnouncementsOutputType['announcements'][number];
export type AnnouncementDetail = GetAnnouncementOutputType;
export type PersonKind = ComposeRecipient['kind'];

export const mk = {
  threadLists: [...qk.messages, 'threads'] as const,
  threads: (filter: ThreadFilter, search: string) => [...qk.messages, 'threads', filter, search] as const,
  threadDetails: [...qk.messages, 'thread'] as const,
  thread: (key: string) => [...qk.messages, 'thread', key] as const,
  preview: [...qk.messages, 'preview'] as const,
  announcementList: [...qk.announcements, 'list'] as const,
  announcement: (id: string) => [...qk.announcements, 'detail', id] as const,
};

export const THREAD_FILTERS: Array<{ value: ThreadFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'tenant', label: 'Residents' },
  { value: 'owner', label: 'Owners' },
  { value: 'vendor', label: 'Vendors' },
  { value: 'applicant', label: 'Applicants' },
  { value: 'work_order', label: 'Work orders' },
];

export const KIND_LABEL: Record<ThreadRow['kind'], string> = { tenant: 'Resident', owner: 'Owner', vendor: 'Vendor', applicant: 'Applicant', work_order: 'Work order' };

/** Thread keys travel in the URL: `/messages/tenant:1b2c…`. */
export const threadPath = (key: string) => `/messages/${key}`;

export function useThreads(filter: ThreadFilter, search: string) {
  return useInfiniteQuery({
    queryKey: mk.threads(filter, search),
    queryFn: ({ pageParam }) => listThreads({ filter, search: search || undefined, limit: 60, cursor: pageParam ?? null }),
    initialPageParam: null as ThreadPage['nextCursor'],
    getNextPageParam: last => last.nextCursor,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useThread(key: string | null) {
  return useQuery({
    queryKey: mk.thread(key ?? ''),
    queryFn: () => getThread({ thread: key! }),
    enabled: Boolean(key),
    staleTime: 10_000,
    refetchInterval: 45_000,
    retry: retryUnlessNotFound,
  });
}

/** Write a thread's unread count into every cached list, the open thread and the sidebar badge. Returns an undo. */
function applyUnread(qc: QueryClient, key: string, unread: number) {
  const lists = qc.getQueriesData<InfiniteData<ThreadPage>>({ queryKey: mk.threadLists });
  let before = 0;
  for (const [, data] of lists) {
    const hit = data?.pages.flatMap(p => p.threads).find(t => t.thread === key);
    if (hit) before = hit.unread;
  }
  const delta = unread - before;
  const threadDelta = before === 0 && unread > 0 ? 1 : before > 0 && unread === 0 ? -1 : 0;
  const kind = key.split(':')[0] as keyof ThreadPage['counts'];
  const snapshots = lists.map(([k, data]) => [k, data] as const);
  for (const [k, data] of lists) {
    if (!data) continue;
    qc.setQueryData<InfiniteData<ThreadPage>>(k, {
      ...data,
      pages: data.pages.map(p => ({
        ...p,
        threads: p.threads.map(t => (t.thread === key ? { ...t, unread } : t)),
        counts: { ...p.counts, unread: Math.max(0, p.counts.unread + threadDelta), ...(kind in p.counts && kind !== 'all' ? { [kind]: Math.max(0, p.counts[kind] + threadDelta) } : {}) },
      })),
    });
  }
  const boot = qc.getQueryData<Bootstrap>(qk.bootstrap);
  if (boot && delta !== 0) qc.setQueryData<Bootstrap>(qk.bootstrap, { ...boot, counts: { ...boot.counts, messagesUnread: Math.max(0, boot.counts.messagesUnread + delta) } });
  return () => {
    for (const [k, data] of snapshots) qc.setQueryData(k, data);
    if (boot) qc.setQueryData(qk.bootstrap, boot);
  };
}

export function useThreadReadState() {
  const qc = useQueryClient();
  return useCallback(
    async (key: string, read: boolean, opts: { silent?: boolean } = {}) => {
      const undo = applyUnread(qc, key, read ? 0 : 1);
      try {
        const res = await markThreadRead({ thread: key, read });
        if (!read && res.unread === 0) {
          undo();
          toast('Nothing to mark unread', { description: 'Only replies from them can be unread — this conversation has none yet.' });
          return;
        }
        if (!opts.silent) toast.success(read ? 'Marked as read' : 'Marked as unread');
      } catch (e) {
        undo();
        toast.error(errorMessage(e, read ? 'Couldn’t mark it read' : 'Couldn’t mark it unread'));
      } finally {
        invalidate(qc, 'bootstrap', 'inbox');
        void qc.invalidateQueries({ queryKey: mk.threadLists, refetchType: 'none' });
      }
    },
    [qc],
  );
}

/** Everything a sent message can appear on: threads, timelines of the people and records it links to. */
export function afterMessage(qc: QueryClient) {
  invalidate(qc, 'messages', 'residents', 'leases', 'owners', 'vendors', 'workOrders', 'leasing', 'activity', 'bootstrap');
}

export type SendPeopleInput = Extract<SendMessagesInputType, { mode: 'people' }>;
export type SendResult = SendMessagesOutputType['results'][number];

/**
 * Send one message per recipient, 20 people per request, retrying the
 * people a request didn't get to (it stops early near the platform timeout).
 * `onProgress` reports how many are done.
 */
export async function sendToPeople(input: Omit<SendPeopleInput, 'recipients' | 'mode'> & { recipients: Array<{ kind: PersonKind; id: string }> }, onProgress?: (done: number, total: number) => void) {
  const results: SendResult[] = [];
  let queue = [...input.recipients];
  let stalls = 0;
  while (queue.length) {
    const chunk = queue.slice(0, 20);
    const res = await sendMessages({ ...input, mode: 'people', recipients: chunk });
    results.push(...res.results);
    const handled = new Set(res.results.map(r => `${r.kind}:${r.id}`));
    const rest = chunk.filter(r => !handled.has(`${r.kind}:${r.id}`));
    stalls = res.results.length ? 0 : stalls + 1;
    if (stalls > 2) throw new Error('Sending stopped responding. Some messages may not have gone out.');
    queue = [...rest, ...queue.slice(20)];
    onProgress?.(results.length, input.recipients.length);
  }
  return results;
}

/** "Sent to 12 · 1 email failed · 2 portal only". */
export function summarizeResults(results: SendResult[]) {
  const ok = results.filter(r => r.messageId);
  const failed = ok.filter(r => r.delivery === 'Failed').length;
  const portal = ok.filter(r => r.delivery === 'Portal only').length;
  const errors = results.filter(r => !r.messageId).length;
  const parts = [ok.length === 1 ? `Sent to ${ok[0].name}` : `Sent to ${ok.length}`];
  if (failed) parts.push(`${failed} ${failed === 1 ? 'email' : 'emails'} failed`);
  if (portal && portal !== ok.length) parts.push(`${portal} portal only`);
  if (portal && portal === ok.length && ok.length > 0) parts.push('portal only');
  if (errors) parts.push(`${errors} not sent`);
  return { text: parts.join(' · '), ok: ok.length, failed, portal, errors };
}

// ── Announcements ───────────────────────────────────────────────────────────

export function useAnnouncements() {
  return useQuery({ queryKey: mk.announcementList, queryFn: () => listAnnouncements({}), staleTime: 15_000 });
}

export function useAnnouncement(id: string | null) {
  return useQuery({
    queryKey: mk.announcement(id ?? ''),
    queryFn: () => getAnnouncement({ id: id! }),
    enabled: Boolean(id),
    staleTime: 5_000,
    retry: retryUnlessNotFound,
    refetchInterval: q => (q.state.data?.announcement.state === 'Sending' ? 4_000 : false),
  });
}

/** "Pool closed {{recipient_first_name}}" → "Pool closed [Recipient first name]", for places that show text only. */
export const labelTags = (text: string) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, tag: string) => `[${MERGE_TAGS.find(t => t.tag === tag.toLowerCase())?.label ?? tag}]`);

const running = new Set<string>();
export const isSendingHere = (id: string) => running.has(id);

/**
 * Send (or resume) an announcement to the end: call the endpoint batch by
 * batch with a progress toast. Lives outside React so closing the dialog
 * doesn't stop it; the server never double-sends if the tab closes mid-way.
 */
export async function runAnnouncementSend(qc: QueryClient, id: string, rawTitle: string, mode: 'send' | 'resume', onOpen?: () => void) {
  if (running.has(id)) return;
  const title = labelTags(rawTitle);
  running.add(id);
  const toastId = `announcement:${id}`;
  let totals = { sent: 0, emailed: 0, failed: 0, portalOnly: 0 };
  try {
    toast.loading(`Sending “${title}”…`, { id: toastId });
    let next: 'send' | 'resume' | 'continue' = mode;
    for (let i = 0; i < 400; i++) {
      const r = await sendAnnouncement({ mode: next, id });
      totals = { sent: totals.sent + r.sent, emailed: totals.emailed + r.emailed, failed: totals.failed + r.failed, portalOnly: totals.portalOnly + r.portalOnly };
      void qc.invalidateQueries({ queryKey: mk.announcement(id) });
      void qc.invalidateQueries({ queryKey: mk.announcementList });
      if (r.done) break;
      toast.loading(`Sending “${title}” · ${r.total - r.remaining} of ${r.total}`, { id: toastId });
      next = 'continue';
    }
    const parts = [`Sent to ${totals.sent.toLocaleString()} ${totals.sent === 1 ? 'person' : 'people'}`];
    if (totals.failed) parts.push(`${totals.failed} ${totals.failed === 1 ? 'email' : 'emails'} failed`);
    toast.success(parts.join(' · '), { id: toastId, description: title, action: onOpen ? { label: 'View', onClick: onOpen } : undefined });
  } catch (e) {
    toast.error(errorMessage(e, 'Sending stopped part-way. Open the announcement to resume — nobody gets it twice.'), { id: toastId, description: totals.sent ? `${totals.sent} sent before it stopped` : undefined });
  } finally {
    running.delete(id);
    afterMessage(qc);
    void qc.invalidateQueries({ queryKey: qk.announcements });
  }
}

export const AUDIENCE_OPTIONS = [
  { value: 'residents', label: 'All current residents', kind: 'tenant' },
  { value: 'residents_properties', label: 'Residents of properties', kind: 'tenant' },
  { value: 'residents_units', label: 'Residents of units', kind: 'tenant' },
  { value: 'owners', label: 'All owners', kind: 'owner' },
  { value: 'owners_properties', label: 'Owners of properties', kind: 'owner' },
  { value: 'vendors', label: 'All active vendors', kind: 'vendor' },
] as const;

export type AudienceKey = (typeof AUDIENCE_OPTIONS)[number]['value'];
