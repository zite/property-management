import {
  Archive, ArchiveRestore, AtSign, BellOff, CalendarClock, CheckCheck, ClipboardCheck, ClipboardList, Clock, DoorOpen, FileSignature, Inbox, ListChecks, Mail, MailOpen,
  MessageCircleQuestion, MessageSquare, Receipt, Repeat, ShieldAlert, ShieldQuestion, TriangleAlert, Wallet, Wrench, Zap,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Switch } from '@project/components/ui/switch';
import { COLORS } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { dateTime, timeAgo } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { useListState } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { Segmented, DateTimeInput } from '../form/fields';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { FilterChips, FilterMenu, listFilter, type FilterDef } from '../list/Filters';
import { GroupedList, RowShell, type ListGroup } from '../list/GroupedList';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { Avatar, MemberAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, Kbd, Tip } from '../primitives/bits';
import {
  isSnoozed, isUnread, KIND_GROUPS, KIND_LABEL, kindGroup, snoozePresets, TIME_BUCKETS, timeBucket, useInboxActions, useNotifications, type KindGroup, type Notification,
} from './data';

const KIND_ICON: Record<string, ReactNode> = {
  work_order_created: <Wrench />, work_order_assigned: <Wrench />, work_order_updated: <Wrench />, work_order_message: <MessageSquare />, work_order_approval: <ShieldQuestion />,
  payment_received: <Wallet />, payment_failed: <TriangleAlert />, application_submitted: <ClipboardList />, inquiry_received: <MessageCircleQuestion />, lease_signed: <FileSignature />,
  lease_expiring: <CalendarClock />, renewal_response: <Repeat />, notice_given: <DoorOpen />, message_received: <Mail />, task_assigned: <ListChecks />, task_due: <ListChecks />,
  mention: <AtSign />, bill_due: <Receipt />, invoice_submitted: <Receipt />, insurance_expiring: <ShieldAlert />, inspection_due: <ClipboardCheck />, automation: <Zap />,
};

const PALETTE = [COLORS.teal, COLORS.blue, COLORS.violet, COLORS.pink, COLORS.orange, COLORS.indigo, COLORS.green, COLORS.amber];
const colorForName = (name: string) => PALETTE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % PALETTE.length];

function Sender({ n, size = 28 }: { n: Notification; size?: number }) {
  const ws = useWorkspace();
  const member = n.actorId ? ws.memberById.get(n.actorId) : undefined;
  if (member) return <MemberAvatar member={member} size={size} />;
  if (n.actorName) return <Avatar name={n.actorName} color={colorForName(n.actorName)} size={size} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full border bg-subtle text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5" style={{ width: size, height: size }} aria-hidden>
      {KIND_ICON[n.kind] ?? <Zap />}
    </span>
  );
}

/** "Today, 7:23 PM", "Tue, 8:00 AM", "Mon, Sep 21, 8:00 AM". */
function snoozeLabel(d: Date) {
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days < 6) return `${d.toLocaleDateString('en-US', { weekday: 'short' })}, ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

/** Snooze until a preset or a chosen time. */
export function SnoozePicker({ trigger, open, onOpenChange, onSnooze, align = 'end' }: { trigger: ReactNode; open: boolean; onOpenChange: (o: boolean) => void; onSnooze: (untilIso: string, label: string) => void; align?: 'start' | 'center' | 'end' }) {
  const [custom, setCustom] = useState<string | null>(null);
  const presets = useMemo(() => (open ? snoozePresets() : []), [open]);
  useEffect(() => {
    if (open) setCustom(null);
  }, [open]);
  const quick = 'flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] outline-none hover:bg-accent focus-visible:bg-accent';
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-[300px] p-1 shadow-lg" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">Snooze until</div>
        {presets.map((p, i) => (
          <button
            key={p.key}
            type="button"
            autoFocus={i === 0}
            className={quick}
            onClick={() => {
              onSnooze(p.until.toISOString(), snoozeLabel(p.until).replace(/^Today, /, ''));
              onOpenChange(false);
            }}
          >
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">{p.label}</span>
            <span className="text-sm text-muted-foreground">{snoozeLabel(p.until)}</span>
          </button>
        ))}
        <div className="my-1 border-t" />
        <div className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-1">
          <DateTimeInput value={custom} onChange={setCustom} className="min-w-0 flex-1" />
          <button
            type="button"
            disabled={!custom || Date.parse(custom) <= Date.now()}
            onClick={() => {
              if (!custom) return;
              onSnooze(custom, snoozeLabel(new Date(custom)));
              onOpenChange(false);
            }}
            className="h-9 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            Snooze
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type RowProps = {
  n: Notification;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  snoozeOpen: boolean;
  onClick: (n: Notification, e: MouseEvent) => void;
  onHover: (n: Notification) => void;
  onToggleSelect: (n: Notification, e: MouseEvent) => void;
  onToggleRead: (n: Notification) => void;
  onArchive: (n: Notification) => void;
  onSnoozeOpen: (id: string | null) => void;
  onSnooze: (n: Notification, until: string, label: string) => void;
  onUnsnooze: (n: Notification) => void;
};

function NotificationRowInner({ n, selected, focused, selecting, snoozeOpen, onClick, onHover, onToggleSelect, onToggleRead, onArchive, onSnoozeOpen, onSnooze, onUnsnooze }: RowProps) {
  const unread = isUnread(n);
  const snoozed = isSnoozed(n);
  const archived = Boolean(n.archivedAt);
  return (
    <RowShell id={n.id} selected={selected} focused={focused} selecting={selecting} onClick={e => onClick(n, e)} onHover={() => onHover(n)} onToggleSelect={e => onToggleSelect(n, e)} height={60} className={cn('gap-3 pr-3', archived && 'opacity-70')}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} aria-label={unread ? 'Unread' : undefined} />
      <Sender n={n} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate text-[14px]', unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80')}>{n.title}</span>
          {snoozed && (
            <Tip label={`Snoozed until ${dateTime(n.snoozedUntil)}`}>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-tone-info/10 px-1.5 text-[12px] font-medium leading-5 text-tone-info">
                <Clock className="h-3 w-3" /> {snoozeLabel(new Date(n.snoozedUntil!))}
              </span>
            </Tip>
          )}
          {archived && <span className="shrink-0 rounded-[5px] bg-muted px-1.5 text-[12px] font-medium leading-5 text-muted-foreground">Archived</span>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13.5px] text-muted-foreground">
          <span className="flex shrink-0 items-center gap-1 [&_svg]:h-3 [&_svg]:w-3">{KIND_ICON[n.kind] ?? <Zap />} {KIND_LABEL[n.kind] ?? 'Update'}</span>
          {n.body && <span aria-hidden>·</span>}
          {n.body && <span className="truncate">{n.body}</span>}
        </div>
      </div>
      <div className="relative flex shrink-0 items-center">
        <Tip label={dateTime(n.occurredAt)}>
          <span className={cn('w-16 text-right text-sm tabular-nums text-muted-foreground transition-opacity', (focused || snoozeOpen) ? 'sm:opacity-0' : 'group-hover/row:sm:opacity-0')}>{timeAgo(n.occurredAt)}</span>
        </Tip>
        <div className={cn('absolute right-0 hidden items-center gap-0.5 rounded-md bg-background/90 sm:flex', focused || snoozeOpen ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100')}>
          <Tip label={unread ? 'Mark read' : 'Mark unread'} keys={['U']}>
            <IconButton size="sm" aria-label={unread ? 'Mark read' : 'Mark unread'} onClick={e => { e.stopPropagation(); onToggleRead(n); }}>
              {unread ? <MailOpen /> : <Mail />}
            </IconButton>
          </Tip>
          {snoozed ? (
            <Tip label="Unsnooze">
              <IconButton size="sm" aria-label="Unsnooze" onClick={e => { e.stopPropagation(); onUnsnooze(n); }}>
                <BellOff />
              </IconButton>
            </Tip>
          ) : (
            <SnoozePicker
              open={snoozeOpen}
              onOpenChange={o => onSnoozeOpen(o ? n.id : null)}
              onSnooze={(until, label) => onSnooze(n, until, label)}
              trigger={
                <IconButton size="sm" aria-label="Snooze" onClick={e => e.stopPropagation()}>
                  <Clock />
                </IconButton>
              }
            />
          )}
          <Tip label={archived ? 'Move back to inbox' : 'Done — archive'} keys={archived ? undefined : ['E']}>
            <IconButton size="sm" aria-label={archived ? 'Move back to inbox' : 'Archive'} onClick={e => { e.stopPropagation(); onArchive(n); }}>
              {archived ? <ArchiveRestore /> : <Archive />}
            </IconButton>
          </Tip>
        </div>
      </div>
    </RowShell>
  );
}

const NotificationRow = memo(NotificationRowInner);

type View = 'unread' | 'all';

/**
 * Linear-style inbox for the signed-in member. Unread by default; J/K to move,
 * ↵ opens the linked record and marks it read, E archives (done), U toggles
 * read, H snoozes, ⇧E marks everything read. Items read from the Unread view
 * stay put until you leave it, so the list doesn't jump under the cursor.
 */
export function InboxView({ onUnreadCount }: { onUnreadCount?: (n: number) => void }) {
  const navigate = useNavigate();
  const { act, markAllRead } = useInboxActions();
  const list = useListState('inbox', { layout: 'list', grouping: 'time', ordering: 'newest', properties: [], showEmptyGroups: false, showClosed: false }, { view: 'unread' });
  const { filters, setFilters, options, setOptions } = list;
  const view: View = filters.view === 'all' ? 'all' : 'unread';
  const kinds = Array.isArray(filters.kinds) ? (filters.kinds as KindGroup[]) : [];
  const showArchived = options.showClosed;
  const showSnoozed = filters.snoozed === true || filters.snoozed === 'true';

  const { data, isPending, isFetching, isError, error, refetch } = useNotifications(showArchived);
  const all = data?.notifications ?? [];

  // Rows read while looking at Unread stay visible until the view changes.
  const sticky = useRef(new Set<string>());
  const [, bump] = useState(0);
  useEffect(() => {
    sticky.current = new Set();
    bump(x => x + 1);
  }, [view, kinds.join(','), showArchived, showSnoozed]);

  const now = Date.now();
  const unreadCount = useMemo(() => all.filter(n => isUnread(n) && !isSnoozed(n, now)).length, [all]);
  const snoozedCount = useMemo(() => all.filter(n => !n.archivedAt && isSnoozed(n, now)).length, [all]);
  useEffect(() => onUnreadCount?.(unreadCount), [unreadCount]);

  const visibleRows = useMemo(() => {
    return all.filter(n => {
      if (n.archivedAt && !showArchived) return false;
      if (isSnoozed(n, now) && !showSnoozed && !sticky.current.has(n.id)) return false;
      if (kinds.length && !kinds.includes(kindGroup(n.kind))) return false;
      if (view === 'unread' && !isUnread(n) && !sticky.current.has(n.id) && !(showArchived && n.archivedAt)) return false;
      return true;
    });
  }, [all, view, kinds, showArchived, showSnoozed, now]);

  const groups: ListGroup<Notification>[] = useMemo(() => {
    const buckets = new Map<string, Notification[]>();
    for (const n of visibleRows) {
      const b = timeBucket(n.occurredAt);
      buckets.set(b, [...(buckets.get(b) ?? []), n]);
    }
    return TIME_BUCKETS.filter(b => buckets.has(b.key)).map(b => ({ key: b.key, label: b.label, items: buckets.get(b.key)! }));
  }, [visibleRows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visible = useMemo(() => groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items)), [groups, collapsed]);

  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [bulkSnooze, setBulkSnooze] = useState(false);
  const overlayOpen = Boolean(snoozeFor || bulkSnooze);

  const open = useCallback(
    (n: Notification) => {
      if (isUnread(n)) {
        sticky.current.add(n.id);
        void act([n.id], 'read').catch(() => undefined);
      }
      if (n.link) navigate(n.link.startsWith('/') ? n.link : `/${n.link}`);
    },
    [act, navigate],
  );

  const nav = useListNav({ items: visible, getId: (n: Notification) => n.id, onOpen: open, onPeek: () => undefined, enabled: !overlayOpen });
  const { selection, selected, focusedId, focused, selecting, targets, onRowClick, onHover, toggleSelect, clearSelection, setFocusedId, scrollRef } = nav;

  /** After items leave the list, keep the cursor where the eye is: the next row, else the previous. */
  const refocusAfter = (ids: string[]) => {
    const set = new Set(ids);
    const idx = visible.findIndex(n => set.has(n.id));
    const rest = visible.filter(n => !set.has(n.id));
    const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
    setFocusedId(next?.id ?? null);
  };

  const archive = (list: Notification[]) => {
    if (!list.length) return;
    const restore = list.every(n => n.archivedAt);
    const ids = list.map(n => n.id);
    // Archiving marks things read; undo puts back exactly what was unread.
    const wereUnread = list.filter(isUnread).map(n => n.id);
    if (!restore && !showArchived) refocusAfter(ids);
    for (const id of ids) sticky.current.delete(id);
    const undo = restore
      ? () => void act(ids, 'archive').catch(() => undefined)
      : () => {
          for (const id of ids) sticky.current.add(id);
          void act(ids, 'unarchive')
            .then(() => (wereUnread.length ? act(wereUnread, 'unread') : undefined))
            .catch(() => undefined);
        };
    void act(ids, restore ? 'unarchive' : 'archive', {
      toast: restore ? (ids.length === 1 ? 'Moved back to your inbox' : `Moved ${ids.length} back to your inbox`) : ids.length === 1 ? 'Archived' : `Archived ${ids.length} notifications`,
      undo,
    }).catch(() => undefined);
    clearSelection();
  };

  const toggleRead = (list: Notification[]) => {
    if (!list.length) return;
    const markRead = list.some(isUnread);
    const ids = list.map(n => n.id);
    if (markRead) for (const id of ids) sticky.current.add(id);
    void act(ids, markRead ? 'read' : 'unread', { toast: ids.length > 1 ? `Marked ${ids.length} ${markRead ? 'read' : 'unread'}` : undefined }).catch(() => undefined);
  };

  const snooze = (list: Notification[], until: string, label: string) => {
    if (!list.length) return;
    const ids = list.map(n => n.id);
    if (!showSnoozed) refocusAfter(ids);
    for (const id of ids) sticky.current.delete(id);
    void act(ids, 'snooze', { until, toast: `Snoozed ${ids.length === 1 ? '' : `${ids.length} `}until ${label}`.replace('  ', ' '), undo: () => void act(ids, 'unsnooze').catch(() => undefined) }).catch(() => undefined);
    clearSelection();
  };

  useHotkeys(
    {
      e: () => archive(targets()),
      u: () => toggleRead(targets()),
      h: () => {
        const t = targets();
        if (!t.length) return;
        if (selection.size > 0) setBulkSnooze(true);
        else if (focused) setSnoozeFor(focused.id);
      },
      'shift+e': () => void markAllRead(),
    },
    { enabled: !overlayOpen },
  );

  const filterDefs = useMemo<FilterDef[]>(() => [listFilter('kinds', 'Type', <Inbox />, () => KIND_GROUPS.map(k => ({ value: k.value, label: k.label })))], []);
  const hasKindFilter = kinds.length > 0;
  const readCount = all.filter(n => !n.archivedAt && !isUnread(n)).length;

  const content = (() => {
    if (isPending) return <InboxSkeleton />;
    if (isError) return <EmptyState className="py-20" title="Your inbox didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!visibleRows.length) {
      if (hasKindFilter) {
        return <EmptyState className="py-20" icon={<Inbox />} title="Nothing matches" description="No notifications of that type here." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, kinds: undefined }))}>Clear filters</button>} />;
      }
      return (
        <EmptyState
          className="py-24"
          icon={<CheckCheck />}
          title="You’re all caught up"
          description={view === 'unread' ? 'New requests, payments, applications and anything assigned to you land here.' : 'Notifications about your properties, residents and work land here.'}
          action={
            view === 'unread' && readCount > 0 ? (
              <button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, view: 'all' }))}>Show {readCount} read</button>
            ) : snoozedCount > 0 && !showSnoozed ? (
              <button type="button" className="ghost-chip h-9" onClick={() => setFilters(f => ({ ...f, snoozed: true }))}>Show {snoozedCount} snoozed</button>
            ) : undefined
          }
        />
      );
    }
    return (
      <GroupedList
        label="Notifications"
        groups={groups}
        getId={n => n.id}
        collapsed={collapsed}
        onToggleCollapse={key => setCollapsed(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
        renderRow={n => (
          <NotificationRow
            n={n}
            selected={selection.has(n.id)}
            focused={focusedId === n.id}
            selecting={selecting}
            snoozeOpen={snoozeFor === n.id}
            onClick={onRowClick}
            onHover={onHover}
            onToggleSelect={toggleSelect}
            onToggleRead={x => toggleRead([x])}
            onArchive={x => archive([x])}
            onSnoozeOpen={setSnoozeFor}
            onSnooze={(x, until, label) => snooze([x], until, label)}
            onUnsnooze={x => void act([x.id], 'unsnooze', { toast: 'Back in your inbox' }).catch(() => undefined)}
          />
        )}
      />
    );
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            <Segmented size="sm" value={view} onChange={v => setFilters(f => ({ ...f, view: v as View }))} options={[{ value: 'unread', label: <span className="tabular-nums">Unread{unreadCount ? ` ${unreadCount}` : ''}</span> }, { value: 'all', label: 'All' }]} />
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : visibleRows.length}
        countLabel={['notification', 'notifications']}
        fetching={isFetching && !isPending}
        display={
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ghost-chip h-8 gap-1.5 text-muted-foreground hover:text-foreground">
                <Archive className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Show</span>
                {(showArchived || showSnoozed) && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Showing hidden items" />}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] p-3 shadow-lg">
              <label className="flex h-9 cursor-pointer items-center justify-between gap-3 text-[14px]">
                <span>Snoozed{snoozedCount ? <span className="ml-1.5 tabular-nums text-muted-foreground">{snoozedCount}</span> : null}</span>
                <Switch checked={showSnoozed} onCheckedChange={v => setFilters(f => ({ ...f, snoozed: v || undefined }))} />
              </label>
              <label className="flex h-9 cursor-pointer items-center justify-between gap-3 text-[14px]">
                <span>Archived</span>
                <Switch checked={showArchived} onCheckedChange={v => setOptions({ showClosed: v })} />
              </label>
              <p className="mt-1 text-sm text-muted-foreground">Archived notifications from the last few months.</p>
            </PopoverContent>
          </Popover>
        }
      />
      {bulkSnooze && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-40">
          <SnoozePicker open align="center" onOpenChange={o => !o && setBulkSnooze(false)} onSnooze={(until, label) => snooze(selected.length ? selected : targets(), until, label)} trigger={<span className="block h-0 w-0" />} />
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {content}
        {!isPending && visibleRows.length > 0 && (
          <p className="hidden items-center justify-center gap-3 pb-8 pt-2 text-sm text-muted-foreground md:flex">
            <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> move</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="flex items-center gap-1"><Kbd>E</Kbd> archive</span>
            <span className="flex items-center gap-1"><Kbd>U</Kbd> read/unread</span>
            <span className="flex items-center gap-1"><Kbd>H</Kbd> snooze</span>
            <span className="flex items-center gap-1"><Kbd>⇧</Kbd><Kbd>E</Kbd> mark all read</span>
          </p>
        )}
      </div>
      <BulkBar count={selected.length} noun={['notification', 'notifications']} onClear={clearSelection}>
        <button type="button" className={bulkButton} onClick={() => toggleRead(selected)}>
          {selected.some(isUnread) ? <MailOpen /> : <Mail />} {selected.some(isUnread) ? 'Mark read' : 'Mark unread'}
        </button>
        <button type="button" className={bulkButton} onClick={() => setBulkSnooze(true)}>
          <Clock /> Snooze
        </button>
        <button type="button" className={bulkButton} onClick={() => archive(selected)}>
          {selected.every(n => n.archivedAt) ? <ArchiveRestore /> : <Archive />} {selected.every(n => n.archivedAt) ? 'Restore' : 'Archive'}
        </button>
      </BulkBar>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <div className="pt-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex h-[60px] items-center gap-3 border-b border-border/60 px-5">
          <div className="skeleton h-7 w-7 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3" style={{ width: `${34 + ((i * 29) % 36)}%` }} />
            <div className="skeleton h-2.5" style={{ width: `${48 + ((i * 17) % 30)}%` }} />
          </div>
          <div className="skeleton h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}
