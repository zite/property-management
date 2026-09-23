import { MessageSquare, Paperclip, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { initials, mediumDateTime, timeAgo } from '../../lib/format';
import { Button, textareaClass } from '../ui';

/**
 * A conversation with the office: their messages on the left, yours on the
 * right, newest at the bottom, and a composer that sends with ⌘/Ctrl+Enter.
 * Used by owners (their thread) and vendors (a work order's thread).
 */

export type ThreadMessage = { id: string; mine: boolean; senderName: string; subject?: string; body: string; sentAt: string; unread?: boolean; attachments?: Array<{ name: string; url: string }>; pending?: boolean };

export function Conversation({
  messages,
  officeName,
  onSend,
  sending,
  emptyText,
  composerLabel,
  placeholder,
  hint,
  disabledReason,
  scroll,
}: {
  messages: ThreadMessage[];
  officeName: string;
  onSend: (body: string) => Promise<unknown>;
  sending: boolean;
  emptyText: string;
  composerLabel: string;
  placeholder: string;
  hint: string;
  disabledReason?: string | null;
  /** On wide screens, keep the thread in its own scroll area pinned to the newest message. Phones scroll the page. */
  scroll?: boolean;
}) {
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    const el = listRef.current;
    if (el && scroll) el.scrollTop = el.scrollHeight;
  }, [count, scroll]);

  const submit = async () => {
    const text = body.trim();
    if (!text) {
      setProblem('Write a message before sending.');
      return;
    }
    setProblem(null);
    const before = body;
    setBody('');
    try {
      await onSend(text);
    } catch {
      setBody(before);
    }
  };

  return (
    <div>
      <div ref={listRef} className={cn(scroll && 'lg:max-h-[60vh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1')}>
        {messages.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-[15px] text-muted-foreground">
            <MessageSquare className="h-5 w-5 shrink-0" aria-hidden />
            {emptyText}
          </div>
        ) : (
          <ol className="space-y-5" aria-label="Messages">
            {messages.map(m => (
              <li key={m.id} className={cn('flex gap-3', m.mine && 'flex-row-reverse', m.pending && 'opacity-60')}>
                <span className={cn('mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', m.mine ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground')} aria-hidden>
                  {m.mine ? 'You' : initials(m.senderName || officeName)}
                </span>
                <div className={cn('min-w-0 max-w-[88%] sm:max-w-[80%]', m.mine && 'text-right')}>
                  <p className={cn('mb-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground', m.mine && 'justify-end')}>
                    <span className="font-medium text-foreground">{m.mine ? 'You' : m.senderName || officeName}</span>
                    {m.pending ? <span>Sending…</span> : m.sentAt && <time dateTime={m.sentAt} title={mediumDateTime(m.sentAt)}>{timeAgo(m.sentAt)}</time>}
                    {m.unread && <span className="rounded-full bg-primary px-2 py-px text-2xs font-semibold text-primary-foreground">New</span>}
                  </p>
                  <div className={cn('rounded-xl px-4 py-3 text-left text-[15px] leading-relaxed shadow-2xs', m.mine ? 'rounded-tr-md bg-primary/[0.08] ring-1 ring-inset ring-primary/15' : 'rounded-tl-md border bg-background')}>
                    {!m.mine && m.subject && !m.body.startsWith(m.subject) && <p className="mb-1 break-words font-semibold">{m.subject}</p>}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {m.attachments && m.attachments.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {m.attachments.map(a => (
                          <li key={a.url}>
                            <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-sm hover:bg-accent">
                              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              <span className="truncate">{a.name}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {disabledReason ? (
        <p className="mt-5 rounded-lg bg-muted px-4 py-3 text-[15px] text-muted-foreground">{disabledReason}</p>
      ) : (
        <form
          className="mt-5 border-t pt-4"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={id} className="text-[15px] font-medium">
            {composerLabel}
          </label>
          <textarea
            id={id}
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
            maxLength={5000}
            placeholder={placeholder}
            aria-invalid={Boolean(problem) || undefined}
            aria-describedby={problem ? `${id}-error` : `${id}-hint`}
            className={textareaClass('mt-2 min-h-[96px]')}
          />
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {problem ? (
              <p id={`${id}-error`} role="alert" className="text-sm text-tone-danger">
                {problem}
              </p>
            ) : (
              <p id={`${id}-hint`} className="text-sm text-muted-foreground">
                {hint}
              </p>
            )}
            <Button type="submit" loading={sending} className="sm:ml-3">
              {!sending && <Send aria-hidden />} Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
