import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { Loader2, MessageSquare, Send } from 'lucide-react';
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { initials, mediumDateTime, timeOfDay } from '../../lib/format';
import type { ThreadMessage } from '../../lib/residentQueries';
import { Button, inputClass, textareaClass } from '../ui';
import { AttachButton, AttachmentChips, FileList, useUploads } from './uploads';

/**
 * A resident's conversation with the office. Reads like a chat — theirs on the
 * left, yours on the right — but keeps each message's subject, so a thread
 * that started as emails still reads as a history.
 */

export type SendPayload = { subject: string; body: string; attachments: Array<{ url: string; name: string }> };

type Pending = { key: string; subject: string; body: string; attachments: Array<{ url: string; name: string }>; sentAt: string };

function dayHeading(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'EEEE, MMMM d' : 'MMMM d, yyyy');
}

export function Conversation({
  messages, organizationName, myName, send, canReply = true, allowSubject = false, scrollable = false, composerLabel = 'Write a message', placeholder = 'Type your message…', hint, emptyTitle = 'No messages yet', emptyBody, maxAttachments = 6, attachLabel = 'Attach', hideSubject,
}: {
  messages: ThreadMessage[];
  organizationName: string;
  myName: string;
  send: (payload: SendPayload) => Promise<unknown>;
  canReply?: boolean;
  allowSubject?: boolean;
  scrollable?: boolean;
  composerLabel?: string;
  placeholder?: string;
  hint?: string;
  emptyTitle?: string;
  emptyBody?: string;
  maxAttachments?: number;
  attachLabel?: string;
  /** Subjects that only repeat what the page already says (a work order's own title). */
  hideSubject?: (subject: string) => boolean;
}) {
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [showSubject, setShowSubject] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const uploads = useUploads(maxAttachments);
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sending = pending.length > 0;

  // Keep the newest message in view when the thread lives in its own scroll area.
  useLayoutEffect(() => {
    if (!scrollable || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [scrollable, messages.length, pending.length]);

  useEffect(() => {
    if (!scrollable && pending.length) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [scrollable, pending.length]);

  const submit = async () => {
    const text = body.trim();
    if (uploads.uploading) {
      setProblem('Wait for your files to finish uploading.');
      return;
    }
    if (!text && !uploads.uploaded.length) {
      setProblem('Write a message before sending.');
      return;
    }
    setProblem(null);
    const payload: SendPayload = { subject: subject.trim(), body: text, attachments: uploads.uploaded };
    const entry: Pending = { key: Math.random().toString(36).slice(2), ...payload, sentAt: new Date().toISOString() };
    setPending(p => [...p, entry]);
    // Clear the composer at once — the message shows as sending — and put it back if it fails.
    setBody('');
    setSubject('');
    try {
      await send(payload);
      uploads.reset();
      setShowSubject(false);
    } catch (e) {
      setBody(text);
      setSubject(payload.subject);
      if (payload.subject) setShowSubject(true);
      setProblem(errorMessage(e, "Your message didn't send. Try again."));
      toast.error(errorMessage(e, "Your message didn't send. Try again."));
    } finally {
      setPending(p => p.filter(x => x.key !== entry.key));
    }
  };

  const groups: Array<{ day: string; items: ThreadMessage[] }> = [];
  for (const m of messages) {
    const day = m.sentAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }

  const thread = (
    <>
      {messages.length === 0 && pending.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <MessageSquare className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-[15px] font-semibold">{emptyTitle}</p>
          {emptyBody && <p className="mt-1 max-w-sm text-[15px] text-muted-foreground">{emptyBody}</p>}
        </div>
      ) : (
        <ol className="space-y-5" aria-label="Messages">
          {groups.map(g => (
            <Fragment key={g.day}>
              <li className="flex items-center gap-3 text-xs font-medium text-muted-foreground" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                {dayHeading(g.items[0].sentAt)}
                <span className="h-px flex-1 bg-border" />
              </li>
              {g.items.map(m => (
                <Bubble key={m.id} mine={m.mine} name={m.mine ? 'You' : m.senderName} org={organizationName} myName={myName} subject={hideSubject?.(m.subject) ? '' : m.subject} body={m.body} sentAt={m.sentAt} unread={m.unread} attachments={m.attachments} />
              ))}
            </Fragment>
          ))}
          {pending.map(p => (
            <Bubble key={p.key} mine name="You" org={organizationName} myName={myName} subject={hideSubject?.(p.subject) ? '' : p.subject} body={p.body} sentAt={p.sentAt} attachments={p.attachments} sending />
          ))}
          <div ref={endRef} />
        </ol>
      )}
    </>
  );

  return (
    <div>
      {scrollable ? (
        <div ref={scroller} className="max-h-[min(62vh,640px)] overflow-y-auto overscroll-contain px-4 py-5 sm:px-5" tabIndex={0} aria-label="Conversation history">
          {thread}
        </div>
      ) : (
        thread
      )}

      {canReply && (
        <form
          className={cn('no-print', scrollable ? 'border-t bg-subtle px-4 py-4 sm:px-5' : 'mt-6 border-t pt-5')}
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`${id}-body`} className={cn('text-[15px] font-medium', scrollable && 'sr-only')}>
            {composerLabel}
          </label>
          {allowSubject && showSubject && (
            <input id={`${id}-subject`} value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} placeholder="Subject" className={inputClass('mb-2 mt-2')} aria-label="Subject" />
          )}
          <textarea
            id={`${id}-body`}
            value={body}
            onChange={e => {
              setBody(e.target.value);
              if (problem) setProblem(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            maxLength={10000}
            rows={scrollable ? 3 : 4}
            placeholder={placeholder}
            aria-invalid={Boolean(problem) || undefined}
            aria-describedby={problem ? `${id}-error` : hint ? `${id}-hint` : undefined}
            className={textareaClass(cn('mt-2', scrollable && 'mt-0 min-h-[88px]'))}
          />
          {uploads.files.length > 0 && !sending && (
            <div className="mt-2">
              <AttachmentChips uploads={uploads} />
            </div>
          )}
          {problem ? (
            <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
              {problem}
            </p>
          ) : hint ? (
            <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted-foreground">
              {hint}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="-ml-3 flex items-center">
              <AttachButton uploads={uploads} label={attachLabel} />
              {allowSubject && !showSubject && (
                <button type="button" onClick={() => setShowSubject(true)} className="inline-flex h-10 items-center rounded-lg px-3 text-[15px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                  Add subject
                </button>
              )}
            </div>
            <Button type="submit" disabled={uploads.uploading || sending} className="min-w-[112px]">
              {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Bubble({ mine, name, org, myName, subject, body, sentAt, unread, attachments, sending }: { mine: boolean; name: string; org: string; myName: string; subject: string; body: string; sentAt: string; unread?: boolean; attachments: Array<{ url: string; name: string }>; sending?: boolean }) {
  const showSubject = subject && !/^(re:\s*)?(message|note|portal message)$/i.test(subject.trim()) && !body.trim().startsWith(subject.trim());
  return (
    <li className={cn('flex gap-2.5 sm:gap-3', mine && 'flex-row-reverse', sending && 'opacity-70')}>
      <span
        className={cn('mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', mine ? 'border bg-muted text-foreground/70' : 'bg-primary text-primary-foreground')}
        aria-hidden
      >
        {mine ? initials(myName) : initials(name === org ? org : name)}
      </span>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%]', mine && 'items-end')}>
        <p className={cn('mb-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground', mine && 'justify-end')}>
          <span className="font-medium text-foreground">{name}</span>
          {!mine && name !== org && <span className="hidden sm:inline">{org}</span>}
          <time dateTime={sentAt} title={mediumDateTime(sentAt)}>
            {sending ? 'Sending…' : timeOfDay(sentAt)}
          </time>
          {unread && <span className="rounded-full bg-primary px-2 py-px text-2xs font-semibold text-primary-foreground">New</span>}
        </p>
        <div className={cn('max-w-full rounded-2xl px-4 py-3 text-left text-[15px] leading-relaxed shadow-2xs', mine ? 'rounded-tr-md bg-primary/[0.08] ring-1 ring-inset ring-primary/15' : 'rounded-tl-md border bg-card')}>
          {showSubject && <p className="mb-1 font-semibold">{subject}</p>}
          {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
          {attachments.length > 0 && <FileList files={attachments} className={cn(body && 'mt-2.5')} />}
        </div>
      </div>
    </li>
  );
}
