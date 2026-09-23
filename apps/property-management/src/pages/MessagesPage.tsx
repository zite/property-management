import { ArrowLeft, Loader2, Mail, MailOpen, MessageSquare, PanelRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { useHotkeys } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useWorkspace } from '../lib/workspace';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { EmptyState, IconButton, Kbd, Tip } from '../components/primitives/bits';
import { ContextPanel } from '../components/comms/ContextPanel';
import { Conversation, ConversationSkeleton } from '../components/comms/Conversation';
import { KIND_LABEL, THREAD_FILTERS, threadPath, useThread, useThreadReadState, useThreads, type ThreadFilter, type ThreadRow } from '../components/comms/data';
import { PersonAvatar } from '../components/comms/MessageTools';
import { ThreadComposer, type ThreadComposerHandle } from '../components/comms/ThreadComposer';
import { ThreadListEmpty, ThreadListRow, ThreadListSkeleton, ThreadSearch } from '../components/comms/ThreadList';

/**
 * Messages: every conversation with residents, owners, vendors and applicants
 * (and each work order's), one pane to pick and one to read and reply.
 *
 *   J / K or ↓ / ↑   next / previous conversation     ↵ or →   reply
 *   U                mark unread                      E        mark read
 *   N                new message                      /        search
 *   Esc (in the reply box) back to the list
 */

const FILTER_VALUES = new Set(THREAD_FILTERS.map(f => f.value));

export function MessagesPage() {
  useDocumentTitle('Messages');
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const threadKey = params.thread ? decodeURIComponent(params.thread) : null;
  const filter = (FILTER_VALUES.has(search.get('filter') as ThreadFilter) ? search.get('filter') : 'all') as ThreadFilter;
  const query = search.get('q') ?? '';
  const desktop = useMediaQuery('(min-width: 768px)');
  const wide = useMediaQuery('(min-width: 1280px)');
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelSheet, setPanelSheet] = useState(false);

  const threadsQ = useThreads(filter, query);
  const threads = useMemo(() => threadsQ.data?.pages.flatMap(p => p.threads) ?? [], [threadsQ.data]);
  const counts = threadsQ.data?.pages[0]?.counts;
  const listRef = useRef<HTMLDivElement>(null);
  const composer = useRef<ThreadComposerHandle>(null);
  const setRead = useThreadReadState();

  const suffix = useMemo(() => {
    const s = new URLSearchParams();
    if (filter !== 'all') s.set('filter', filter);
    if (query) s.set('q', query);
    const str = s.toString();
    return str ? `?${str}` : '';
  }, [filter, query]);

  const open = useCallback((key: string) => navigate(`${threadPath(key)}${suffix}`), [navigate, suffix]);
  const setQuery = (q: string) => {
    const s = new URLSearchParams(search);
    if (q) s.set('q', q);
    else s.delete('q');
    setSearch(s, { replace: true });
  };

  // Keep the open conversation visible in the list as J/K moves through it.
  useEffect(() => {
    if (!threadKey) return;
    listRef.current?.querySelector(`[data-thread="${CSS.escape(threadKey)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [threadKey, threads.length]);

  const index = threadKey ? threads.findIndex(t => t.thread === threadKey) : -1;
  const step = (delta: number) => {
    if (!threads.length) return;
    const next = threads[index < 0 ? 0 : Math.max(0, Math.min(threads.length - 1, index + delta))];
    if (next && next.thread !== threadKey) open(next.thread);
    if (delta > 0 && index >= threads.length - 3 && threadsQ.hasNextPage && !threadsQ.isFetchingNextPage) void threadsQ.fetchNextPage();
  };
  const row = index >= 0 ? threads[index] : undefined;

  useHotkeys({
    j: () => step(1),
    down: () => step(1),
    k: () => step(-1),
    up: () => step(-1),
    enter: () => threadKey && composer.current?.focus(),
    right: () => threadKey && composer.current?.focus(),
    n: () => app.openCompose({ recipients: [] }),
  });

  const tabs = THREAD_FILTERS.map(f => {
    const s = new URLSearchParams();
    if (f.value !== 'all') s.set('filter', f.value);
    if (query) s.set('q', query);
    const qs = s.toString();
    return { to: `${threadKey ? threadPath(threadKey) : '/messages'}${qs ? `?${qs}` : ''}`, label: f.label, count: f.value === 'all' ? null : counts?.[f.value] ?? null, active: filter === f.value };
  });

  const showList = desktop || !threadKey;
  const showThread = desktop || Boolean(threadKey);

  return (
    <>
      <PageHeader
        icon={<MessageSquare />}
        title="Messages"
        tabs={tabs}
        actions={
          <Tip label="New message" keys={['N']}>
            <button type="button" onClick={() => app.openCompose({ recipients: [] })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New message</span>
            </button>
          </Tip>
        }
      />
      <div className="flex min-h-0 flex-1">
        {showList && (
          <aside className="flex min-h-0 w-full shrink-0 flex-col border-r md:w-[340px] xl:w-[380px]">
            <div className="border-b p-2">
              <ThreadSearch value={query} onChange={setQuery} />
            </div>
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Conversations">
              {threadsQ.isPending ? (
                <ThreadListSkeleton />
              ) : threadsQ.isError ? (
                <EmptyState className="py-16" title="Conversations didn’t load" description={errorMessage(threadsQ.error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9 border border-border" onClick={() => void threadsQ.refetch()}>Try again</button>} />
              ) : threads.length === 0 ? (
                <ThreadListEmpty filter={filter} search={query} onClear={() => navigate(threadKey ? threadPath(threadKey) : '/messages')} onCompose={() => app.openCompose({ recipients: [] })} />
              ) : (
                <>
                  {threads.map(t => (
                    <ThreadListRow key={t.thread} t={t} active={t.thread === threadKey} onSelect={open} />
                  ))}
                  {threadsQ.hasNextPage && (
                    <div className="p-3 text-center">
                      <button type="button" onClick={() => void threadsQ.fetchNextPage()} disabled={threadsQ.isFetchingNextPage} className="ghost-chip h-9 border border-border text-muted-foreground">
                        {threadsQ.isFetchingNextPage ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</> : 'Load older conversations'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
        {showThread && (
          <section className="flex min-h-0 min-w-0 flex-1">
            {threadKey ? (
              <ThreadView
                key={threadKey}
                threadKey={threadKey}
                row={row}
                composerRef={composer}
                onBack={() => navigate(`/messages${suffix}`)}
                onFocusList={() => (document.activeElement as HTMLElement | null)?.blur()}
                panel={wide ? panelOpen : false}
                onTogglePanel={() => (wide ? setPanelOpen(o => !o) : setPanelSheet(true))}
                panelSheet={!wide && panelSheet}
                onPanelSheet={setPanelSheet}
                setRead={setRead}
              />
            ) : (
              <EmptyState
                className="flex-1"
                icon={<MessageSquare />}
                title={threads.length ? 'Pick a conversation' : 'Your conversations will show here'}
                description={threads.length ? <>Use <Kbd>J</Kbd> and <Kbd>K</Kbd> to move through them, <Kbd>N</Kbd> to start a new one.</> : 'Start one with New message, or wait for a resident to write in from the portal.'}
              />
            )}
          </section>
        )}
      </div>
    </>
  );
}

function ThreadView({ threadKey, row, composerRef, onBack, onFocusList, panel, onTogglePanel, panelSheet, onPanelSheet, setRead }: {
  threadKey: string;
  row: ThreadRow | undefined;
  composerRef: React.RefObject<ThreadComposerHandle>;
  onBack: () => void;
  onFocusList: () => void;
  panel: boolean;
  onTogglePanel: () => void;
  panelSheet: boolean;
  onPanelSheet: (o: boolean) => void;
  setRead: ReturnType<typeof useThreadReadState>;
}) {
  const ws = useWorkspace();
  const { data, isPending, isError, error, refetch } = useThread(threadKey);
  const scroller = useRef<HTMLDivElement>(null);
  const userMarkedUnread = useRef(false);
  const unreadIds = (data?.messages ?? []).filter(m => m.direction === 'Inbound' && !m.readAt).map(m => m.id).join(',');
  useDocumentTitle(data?.title ?? row?.name ?? 'Messages');

  // Opening a conversation reads it — unless someone just marked it unread on purpose.
  useEffect(() => {
    if (userMarkedUnread.current) return;
    if ((row?.unread ?? 0) > 0 || unreadIds) void setRead(threadKey, true, { silent: true });
  }, [threadKey, unreadIds]);

  // Land at the newest message, and follow new ones.
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, threadKey]);

  const title = data?.title ?? row?.name ?? '';
  const kind = data?.kind ?? row?.kind ?? 'tenant';
  const subtitle = (() => {
    if (!data && !row) return '';
    if (kind === 'work_order') {
      const n = data?.workOrder?.number ?? row?.workOrderNumber;
      return [workOrderRef(n), ws.unitLabel(data?.workOrder?.unitId ?? row?.unitId, data?.workOrder?.propertyId ?? row?.propertyId) || 'Common area'].join(' · ');
    }
    if (kind === 'tenant') {
      const lease = data?.tenant?.leases.find(l => l.status === 'Active') ?? data?.tenant?.leases[0];
      return [KIND_LABEL.tenant, ws.unitLabel(lease?.unitId ?? row?.unitId, lease?.propertyId ?? row?.propertyId)].filter(Boolean).join(' · ');
    }
    if (kind === 'vendor') return [KIND_LABEL.vendor, data?.vendor?.trade ?? row?.subtitle].filter(Boolean).join(' · ');
    if (kind === 'applicant') return [KIND_LABEL.applicant, data?.application?.status ?? row?.subtitle].filter(Boolean).join(' · ');
    return [KIND_LABEL.owner, data?.owner?.contactName && data.owner.contactName !== title ? data.owner.contactName : ''].filter(Boolean).join(' · ');
  })();

  const markUnread = () => {
    userMarkedUnread.current = true;
    void setRead(threadKey, false);
  };
  const markRead = () => {
    userMarkedUnread.current = false;
    void setRead(threadKey, true);
  };
  useHotkeys({ u: markUnread, e: markRead });

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-3">
          <IconButton onClick={onBack} aria-label="Back to conversations" className="md:hidden"><ArrowLeft /></IconButton>
          {title ? <PersonAvatar kind={kind} name={title} size={28} /> : <div className="skeleton h-7 w-7 rounded-full" />}
          <div className="min-w-0 flex-1">
            {title ? <h2 className="truncate text-[14.5px] font-semibold leading-tight">{title}</h2> : <div className="skeleton h-3.5 w-40" />}
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <Tip label="Mark unread" keys={['U']}>
            <IconButton onClick={markUnread} aria-label="Mark unread"><Mail /></IconButton>
          </Tip>
          <Tip label="Mark read" keys={['E']}>
            <IconButton onClick={markRead} aria-label="Mark read"><MailOpen /></IconButton>
          </Tip>
          <Tip label={panel ? 'Hide details' : 'Show details'}>
            <IconButton onClick={onTogglePanel} active={panel} aria-label="Toggle details"><PanelRight /></IconButton>
          </Tip>
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-subtle/40">
          {isPending ? (
            <ConversationSkeleton />
          ) : isError || !data ? (
            <EmptyState className="py-20" title="This conversation didn’t load" description={errorMessage(error, 'It may have been removed.')} action={<button type="button" className="ghost-chip h-9 border border-border" onClick={() => void refetch()}>Try again</button>} />
          ) : data.messages.length === 0 ? (
            <EmptyState className="py-20" icon={<MessageSquare />} title={`No messages with ${data.title} yet`} description="Write the first one below. It goes to their email and their portal." />
          ) : (
            <Conversation detail={data} />
          )}
        </div>
        {data && (
          <div className="shrink-0 border-t bg-background p-3">
            <ThreadComposer ref={composerRef} detail={data} onEscape={onFocusList} className="mx-auto max-w-[760px]" />
          </div>
        )}
      </div>
      {panel && data && (
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l bg-subtle/40 xl:block">
          <ContextPanel detail={data} />
        </aside>
      )}
      <Sheet open={panelSheet} onOpenChange={onPanelSheet}>
        <SheetContent side="right" className={cn('w-full overflow-y-auto p-0 sm:max-w-[340px]')}>
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">Details about this conversation</SheetDescription>
          <div className="pt-10">{data && <ContextPanel detail={data} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
