import { Lock, Mail, MessageSquare, Paperclip, Search, TriangleAlert, X } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { useHotkeys } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState } from '../primitives/bits';
import { PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { KIND_LABEL, type ThreadFilter, type ThreadRow } from './data';
import { PersonAvatar } from './MessageTools';

/** The left pane: search, then conversations newest first. Unread ones are bold with a count. */

function whenLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
}

export const ThreadListRow = memo(function ThreadListRow({ t, active, onSelect }: { t: ThreadRow; active: boolean; onSelect: (key: string) => void }) {
  const ws = useWorkspace();
  const unread = t.unread > 0;
  const property = t.propertyId ? ws.propertyById.get(t.propertyId) : undefined;
  const context =
    t.kind === 'work_order'
      ? [workOrderRef(t.workOrderNumber), ws.unitLabel(t.unitId, t.propertyId) || 'Common area'].join(' · ')
      : t.kind === 'tenant'
        ? ws.unitLabel(t.unitId, t.propertyId) || 'No current lease'
        : t.kind === 'owner'
          ? (() => {
              const props = ws.properties.filter(p => p.ownerId === t.refId);
              return props.length ? (props.length === 1 ? props[0].name : `${props.length} properties`) : t.subtitle || 'Owner';
            })()
          : t.kind === 'vendor'
            ? t.subtitle || 'Vendor'
            : [t.applicationNumber ? `APP-${t.applicationNumber}` : 'Applicant', ws.unitLabel(t.unitId, t.propertyId), t.subtitle].filter(Boolean).join(' · ');
  const last = t.last;
  const note = last.direction === 'Internal' || last.channel === 'Note';
  const mine = last.direction === 'Outbound';
  const member = last.senderMemberId ? ws.memberById.get(last.senderMemberId) : undefined;
  // Teammates by first name; automated mail by the company's name.
  const staffName = member ? member.name.split(' ')[0] : last.senderName || ws.settings.organizationName;
  const who = note ? (member?.id === ws.me.id ? 'You' : staffName) : mine ? (last.senderMemberId === ws.me.id ? 'You' : staffName) : null;
  const snippet = last.snippet || (last.attachments ? `${last.attachments} ${last.attachments === 1 ? 'file' : 'files'}` : last.subject);

  return (
    <button
      type="button"
      data-thread={t.thread}
      onClick={() => onSelect(t.thread)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group relative flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary" aria-hidden />}
      <span className="relative mt-0.5">
        <PersonAvatar kind={t.kind} name={t.name} size={32} />
        {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[14.5px]', unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90')}>{t.name}</span>
          <span className={cn('shrink-0 text-sm tabular-nums', unread ? 'font-medium text-foreground' : 'text-faint')}>{whenLabel(t.lastAt)}</span>
        </span>
        <span className="mt-px flex items-center gap-1.5 text-sm text-muted-foreground">
          {t.kind === 'work_order' && t.workOrderStatus ? <WorkOrderStatusGlyph status={t.workOrderStatus} size={11} /> : property ? <PropertySwatch color={property.color} size={7} /> : null}
          <span className="truncate">{context}</span>
          <span className="ml-auto shrink-0 text-2xs text-faint">{KIND_LABEL[t.kind]}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5">
          {note ? <Lock className="h-3 w-3 shrink-0 text-tone-warning" /> : last.channel === 'Email' ? <Mail className="h-3 w-3 shrink-0 text-faint" /> : <MessageSquare className="h-3 w-3 shrink-0 text-faint" />}
          <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', unread ? 'text-foreground' : 'text-muted-foreground')}>
            {who && <span className={cn(note && 'text-tone-warning')}>{who}: </span>}
            {snippet}
          </span>
          {last.attachments > 0 && <Paperclip className="h-3 w-3 shrink-0 text-faint" aria-label="Has attachments" />}
          {t.failed > 0 && <TriangleAlert className="h-3 w-3 shrink-0 text-tone-danger" aria-label="An email wasn’t delivered" />}
          {unread && <span className="ml-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold tabular-nums text-primary-foreground">{t.unread}</span>}
        </span>
      </span>
    </button>
  );
});

export function ThreadSearch({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = window.setTimeout(() => text.trim() !== value && onChange(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);
  useHotkeys({ '/': () => ref.current?.focus() });
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-2 focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/15">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setText('');
            onChange('');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Search people, subjects, messages…"
        className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/80"
        aria-label="Search conversations"
      />
      {text ? (
        <button type="button" onClick={() => { setText(''); onChange(''); }} aria-label="Clear search" className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      ) : (
        <kbd className="kbd hidden sm:inline-flex">/</kbd>
      )}
    </div>
  );
}

export function ThreadListSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b border-border/60 px-3 py-3">
          <div className="skeleton h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="flex justify-between"><div className="skeleton h-3" style={{ width: `${40 + ((i * 17) % 30)}%` }} /><div className="skeleton h-3 w-10" /></div>
            <div className="skeleton h-2.5 w-1/3" />
            <div className="skeleton h-2.5" style={{ width: `${55 + ((i * 29) % 40)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThreadListEmpty({ filter, search, onClear, onCompose }: { filter: ThreadFilter; search: string; onClear: () => void; onCompose?: () => void }) {
  if (search || filter !== 'all') {
    return (
      <EmptyState
        className="py-16"
        icon={<Search />}
        title={search ? 'Nothing matches' : filter === 'unread' ? 'You’re all caught up' : 'No conversations here yet'}
        description={search ? `No conversation mentions “${search}”${filter !== 'all' ? ' with this filter' : ''}.` : filter === 'unread' ? 'Replies from residents, owners, vendors and applicants show up here first.' : 'When you message someone or they write in, the conversation appears here.'}
        action={<button type="button" className="ghost-chip h-9 border border-border" onClick={onClear}>{search ? 'Clear search' : 'Show all conversations'}</button>}
      />
    );
  }
  return (
    <EmptyState
      className="py-16"
      icon={<MessageSquare />}
      title="No conversations yet"
      description="Messages with residents, owners, vendors and applicants — and their replies from the portal — collect here."
      action={onCompose ? <button type="button" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={onCompose}>New message</button> : undefined}
    />
  );
}
