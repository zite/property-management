import { ArrowDownLeft, ArrowUpRight, AtSign, CircleDot, Lock, Mail, MessageSquare, Paperclip, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { MOD } from '../../lib/hotkeys';
import { dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Avatar, MemberAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';

/**
 * A record's history in one column: small activity lines ("Luis moved it to
 * Scheduled · 2h ago") interleaved with messages and internal notes as cards.
 * Every detail page uses this; endpoints return `activity` and `messages` in
 * these shapes.
 */

export type TimelineActivity = { id: string; summary: string; actorId: string | null; actorName: string | null; action: string; occurredAt: string };
export type TimelineMessage = {
  id: string;
  subject: string;
  body: string;
  direction: 'Inbound' | 'Outbound' | 'Internal' | string;
  channel: 'Email' | 'Portal' | 'Note' | string;
  senderMemberId: string | null;
  senderName: string | null;
  delivery: string | null;
  sentAt: string;
  attachments: Array<{ name: string; url: string }>;
  /** Who it went to or came from, for outbound/inbound. */
  counterpart?: string | null;
};

type Entry = { kind: 'activity'; at: string; item: TimelineActivity } | { kind: 'message'; at: string; item: TimelineMessage };

function renderMentions(body: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(/@\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    parts.push(body.slice(last, m.index));
    parts.push(
      <span key={m.index} className="rounded bg-primary/10 px-1 font-medium text-primary">
        @{m[1]}
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}

export function Timeline({ activity, messages = [], emptyText = 'No activity yet', className, newestFirst = false }: { activity: TimelineActivity[]; messages?: TimelineMessage[]; emptyText?: string; className?: string; newestFirst?: boolean }) {
  const ws = useWorkspace();
  const [showAll, setShowAll] = useState(false);
  const entries = useMemo(() => {
    const all: Entry[] = [...activity.map(a => ({ kind: 'activity' as const, at: a.occurredAt, item: a })), ...messages.map(m => ({ kind: 'message' as const, at: m.sentAt, item: m }))];
    all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return newestFirst ? all.reverse() : all;
  }, [activity, messages, newestFirst]);
  if (!entries.length) return <p className={cn('py-4 text-[14px] text-muted-foreground', className)}>{emptyText}</p>;
  // Long histories collapse their middle, like a thread.
  const collapse = !showAll && entries.length > 14;
  const visible = collapse ? [...entries.slice(0, 3), null, ...entries.slice(-9)] : entries;

  return (
    <ol className={cn('relative space-y-0.5', className)}>
      <span className="absolute bottom-3 left-[11px] top-3 w-px bg-border" aria-hidden />
      {visible.map((e, i) => {
        if (!e) {
          return (
            <li key="more" className="relative py-2 pl-8">
              <button type="button" onClick={() => setShowAll(true)} className="text-sm text-muted-foreground hover:text-foreground">
                Show {entries.length - 12} earlier updates
              </button>
            </li>
          );
        }
        if (e.kind === 'activity') {
          const a = e.item;
          const member = a.actorId ? ws.memberById.get(a.actorId) : undefined;
          return (
            <li key={`a:${a.id}`} className="relative flex items-start gap-2.5 py-1.5 pl-0 text-[13.5px] text-muted-foreground">
              <span className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background">
                {member ? <MemberAvatar member={member} size={16} /> : <CircleDot className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 pt-[3px] leading-5">
                <span className="font-medium text-foreground/85">{member?.name ?? a.actorName ?? 'System'}</span> {a.summary}
                <Tip label={dateTime(a.occurredAt)}>
                  <span className="ml-1.5 whitespace-nowrap text-faint">· {timeAgo(a.occurredAt)}</span>
                </Tip>
              </span>
            </li>
          );
        }
        const m = e.item;
        const note = m.direction === 'Internal' || m.channel === 'Note';
        const inbound = m.direction === 'Inbound';
        const member = m.senderMemberId ? ws.memberById.get(m.senderMemberId) : undefined;
        return (
          <li key={`m:${m.id}`} className="relative flex items-start gap-2.5 py-2">
            <span className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background">
              {member ? <MemberAvatar member={member} size={22} /> : <Avatar name={m.senderName} size={22} color={inbound ? '#64748b' : undefined} />}
            </span>
            <div className={cn('min-w-0 flex-1 rounded-lg border px-3.5 py-2.5 shadow-2xs', note ? 'border-tone-warning/25 bg-tone-warning/[0.05]' : inbound ? 'bg-card' : 'bg-card')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]">
                <span className="font-medium">{member?.name ?? m.senderName ?? 'Someone'}</span>
                {note ? (
                  <span className="inline-flex items-center gap-1 text-tone-warning"><Lock className="h-3 w-3" /> Internal note</span>
                ) : inbound ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><ArrowDownLeft className="h-3 w-3" /> {m.channel === 'Email' ? 'via email' : 'via portal'}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ArrowUpRight className="h-3 w-3" /> {m.counterpart ? `to ${m.counterpart}` : 'sent'} {m.channel === 'Email' ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                  </span>
                )}
                {m.delivery === 'Failed' && (
                  <Tip label="The email couldn't be delivered. The message is still in their portal.">
                    <span className="inline-flex items-center gap-1 text-tone-danger"><TriangleAlert className="h-3 w-3" /> Not delivered</span>
                  </Tip>
                )}
                <Tip label={dateTime(m.sentAt)}>
                  <span className="ml-auto text-sm text-faint">{timeAgo(m.sentAt)}</span>
                </Tip>
              </div>
              {m.subject && !note && !/^(re: )?note$/i.test(m.subject) && <p className="mt-1 text-[14px] font-medium">{m.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground/90">{renderMentions(m.body)}</p>
              {m.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.attachments.map(f => (
                    <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="chip bg-background hover:bg-accent">
                      <Paperclip className="h-3 w-3" /> <span className="max-w-[180px] truncate">{f.name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type ComposerMode = { value: string; label: string; icon?: ReactNode; placeholder: string; hint?: string };

/**
 * Write a note or a message. Modes decide the audience ("Internal note",
 * "Message resident", "Message vendor"); ⌘↵ sends; `@` mentions teammates in notes.
 */
export function Composer({ modes, onSend, className, defaultMode }: {
  modes: ComposerMode[];
  onSend: (input: { mode: string; body: string }) => Promise<unknown>;
  className?: string;
  defaultMode?: string;
}) {
  const ws = useWorkspace();
  const [mode, setMode] = useState(defaultMode ?? modes[0]?.value ?? 'note');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const current = modes.find(m => m.value === mode) ?? modes[0];
  const isNote = mode === 'note';
  const candidates = mentionQuery == null ? [] : ws.activeMembers.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend({ mode, body: text });
      setBody('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn('relative rounded-lg border bg-card shadow-2xs focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/15', isNote && 'bg-tone-warning/[0.03]', className)}>
      {modes.length > 1 && (
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          {modes.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-sm transition-colors [&_svg]:h-3 [&_svg]:w-3', mode === m.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={body}
        onChange={e => {
          setBody(e.target.value);
          const match = isNote ? /@(\w*)$/.exec(e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length)) : null;
          setMentionQuery(match ? match[1] : null);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === 'Escape' && mentionQuery != null) setMentionQuery(null);
        }}
        rows={3}
        placeholder={current?.placeholder}
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
      />
      {candidates.length > 0 && (
        <div className="absolute left-3 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border bg-popover p-1 shadow-lg">
          {candidates.map(m => (
            <button
              key={m.id}
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                setBody(b => b.replace(/@(\w*)$/, `@[${m.name}](${m.id}) `));
                setMentionQuery(null);
              }}
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-[14px] hover:bg-accent"
            >
              <MemberAvatar member={m} size={16} /> {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {isNote ? <><AtSign className="h-3 w-3" /> Only your team sees notes. Type @ to mention.</> : current?.hint}
        </span>
        <button type="button" onClick={() => void send()} disabled={!body.trim() || sending} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-40">
          {sending ? 'Sending…' : isNote ? 'Add note' : 'Send'} <span className="opacity-70">{MOD}↵</span>
        </button>
      </div>
    </div>
  );
}
