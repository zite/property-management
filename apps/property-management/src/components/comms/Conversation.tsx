import { ArrowDownLeft, CheckCheck, Lock, Mail, Megaphone, MessageSquare, Paperclip, TriangleAlert } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { dateTime, timeAgo, timeOnly } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { MemberAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { PersonAvatar } from './MessageTools';
import type { ThreadDetail, ThreadMessage } from './data';

/**
 * A conversation read top to bottom: what they sent on the left, what the
 * team sent on the right, internal notes as full-width amber cards only staff
 * see. A subject shows when it changes; failed emails and announcement copies
 * are marked; a day divider starts each day.
 */

const normalizeSubject = (s: string) => s.replace(/^((re|fwd?):\s*)+/i, '').trim().toLowerCase();
const isNote = (m: ThreadMessage) => m.direction === 'Internal' || m.channel === 'Note';

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function renderMentions(body: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(/@\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    parts.push(body.slice(last, m.index));
    parts.push(<span key={m.index} className="rounded bg-primary/10 px-1 font-medium text-primary">@{m[1]}</span>);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}

function Files({ files, align }: { files: ThreadMessage['attachments']; align?: 'end' }) {
  if (!files.length) return null;
  return (
    <div className={cn('mt-2 flex flex-wrap gap-1.5', align === 'end' && 'justify-end')}>
      {files.map(f => (
        <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="chip max-w-[220px] bg-background hover:bg-accent">
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" /> <span className="truncate">{f.name}</span>
        </a>
      ))}
    </div>
  );
}

export function Conversation({ detail }: { detail: ThreadDetail }) {
  const ws = useWorkspace();
  const messages = detail.messages;
  let lastSubject = '';
  let lastDay = '';

  return (
    <ol className="mx-auto flex w-full max-w-[760px] flex-col gap-1 px-4 pb-6 pt-4 sm:px-6" aria-label={`Conversation with ${detail.title}`}>
      {detail.truncated && <li className="pb-3 text-center text-sm text-muted-foreground">Showing the latest 400 messages</li>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const day = new Date(m.sentAt).toDateString();
        const showDay = day !== lastDay;
        lastDay = day;
        const note = isNote(m);
        const inbound = m.direction === 'Inbound';
        const subjectKey = normalizeSubject(m.subject);
        const showSubject = !note && Boolean(m.subject) && !/^note$/i.test(m.subject) && subjectKey !== lastSubject && !m.announcementId;
        if (!note && m.subject) lastSubject = subjectKey;
        // Consecutive messages from the same side within 10 minutes read as one block.
        const grouped = !showDay && !showSubject && prev && !isNote(prev) === !note && prev.direction === m.direction && (prev.senderMemberId ?? prev.senderName) === (m.senderMemberId ?? m.senderName) && Date.parse(m.sentAt) - Date.parse(prev.sentAt) < 10 * 60_000;
        const member = m.senderMemberId ? ws.memberById.get(m.senderMemberId) : undefined;
        const sender = member?.name ?? m.senderName ?? (inbound ? detail.title : ws.settings.organizationName);

        const divider = showDay ? (
          <li className="flex items-center gap-3 py-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-2xs font-medium uppercase tracking-wide text-faint">{dayLabel(m.sentAt)}</span>
            <span className="h-px flex-1 bg-border" />
          </li>
        ) : null;

        if (note) {
          return (
            <Fragment key={m.id}>
              {divider}
              <li className={cn('flex gap-2.5', !grouped && 'mt-2')} data-message-id={m.id}>
                <span className="mt-0.5 w-7 shrink-0">{!grouped && (member ? <MemberAvatar member={member} size={26} /> : <PersonAvatar kind="work_order" name={sender} size={26} />)}</span>
                <div className="min-w-0 flex-1 rounded-lg border border-tone-warning/25 bg-tone-warning/[0.06] px-3.5 py-2.5">
                  {!grouped && (
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium text-foreground">{sender}</span>
                      <span className="inline-flex items-center gap-1 text-tone-warning"><Lock className="h-3 w-3" /> Internal note</span>
                      <Tip label={dateTime(m.sentAt)}><span className="ml-auto text-faint">{timeOnly(m.sentAt)}</span></Tip>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{renderMentions(m.body)}</p>
                  <Files files={m.attachments} />
                </div>
              </li>
            </Fragment>
          );
        }

        const failed = m.delivery === 'Failed';
        const seen = !inbound && m.readAt;
        return (
          <Fragment key={m.id}>
            {divider}
            <li className={cn('flex gap-2.5', inbound ? 'pr-6 sm:pr-16' : 'flex-row-reverse pl-6 sm:pl-16', !grouped && 'mt-2')} data-message-id={m.id}>
              <span className="mt-0.5 w-7 shrink-0">
                {!grouped && (inbound ? <PersonAvatar kind={detail.kind === 'work_order' ? (m.vendorId ? 'vendor' : 'tenant') : detail.kind} name={sender} size={26} /> : member ? <MemberAvatar member={member} size={26} /> : <PersonAvatar kind="work_order" name={sender} size={26} />)}
              </span>
              <div className={cn('flex min-w-0 max-w-full flex-col', inbound ? 'items-start' : 'items-end')}>
                {!grouped && (
                  <div className={cn('mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-0.5 text-sm text-muted-foreground', !inbound && 'justify-end')}>
                    <span className="font-medium text-foreground">{sender}</span>
                    {detail.kind === 'work_order' && m.counterpart && !inbound && <span>to {m.counterpart}</span>}
                    {inbound ? (
                      <span className="inline-flex items-center gap-1"><ArrowDownLeft className="h-3 w-3" /> {m.channel === 'Email' ? 'Email' : 'Portal'}</span>
                    ) : (
                      <Tip label={m.channel === 'Email' ? 'Emailed and shown in their portal' : 'Shown in their portal only'}>
                        <span className="inline-flex items-center gap-1">{m.channel === 'Email' ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />} {m.channel === 'Email' ? 'Email' : 'Portal only'}</span>
                      </Tip>
                    )}
                    {m.announcementId && (
                      <span className="inline-flex items-center gap-1 text-tone-info"><Megaphone className="h-3 w-3" /> Announcement</span>
                    )}
                    <Tip label={dateTime(m.sentAt)}><span className="text-faint">{timeOnly(m.sentAt)}</span></Tip>
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-full rounded-2xl border px-3.5 py-2.5 text-[14px] leading-relaxed shadow-2xs',
                    inbound ? 'rounded-tl-md bg-card' : 'rounded-tr-md border-primary/15 bg-primary/[0.06] dark:bg-primary/[0.09]',
                    failed && 'border-tone-danger/40',
                    grouped && (inbound ? 'rounded-tl-2xl' : 'rounded-tr-2xl'),
                  )}
                >
                  {(showSubject || m.announcementId) && <p className="mb-1 font-medium">{m.announcementTitle && m.announcementId ? m.subject || m.announcementTitle : m.subject}</p>}
                  <p className="whitespace-pre-wrap break-words text-foreground/90">{renderMentions(m.body)}</p>
                  <Files files={m.attachments} align={inbound ? undefined : 'end'} />
                </div>
                {(failed || seen) && (
                  <div className="mt-1 flex items-center gap-1 px-1 text-2xs">
                    {failed ? (
                      <Tip label="The email bounced or couldn’t be sent. It’s still in their portal.">
                        <span className="inline-flex items-center gap-1 font-medium text-tone-danger"><TriangleAlert className="h-3 w-3" /> Email not delivered</span>
                      </Tip>
                    ) : (
                      <Tip label={`Read in the portal ${dateTime(seen as string)}`}>
                        <span className="inline-flex items-center gap-1 text-faint"><CheckCheck className="h-3 w-3" /> Seen {timeAgo(seen as string)}</span>
                      </Tip>
                    )}
                  </div>
                )}
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-8" aria-hidden>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={cn('flex gap-2.5', i % 2 ? 'flex-row-reverse' : '')}>
          <div className="skeleton h-7 w-7 rounded-full" />
          <div className={cn('flex flex-col gap-1.5', i % 2 ? 'items-end' : '')}>
            <div className="skeleton h-3 w-28" />
            <div className="skeleton h-14 rounded-2xl" style={{ width: `${200 + ((i * 83) % 180)}px` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

