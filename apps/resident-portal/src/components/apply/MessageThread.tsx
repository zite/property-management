import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sendApplicationMessage } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { applicationKeys, type ApplicationData, type ApplicationDetail } from '../../lib/apply';
import { errorMessage } from '../../lib/errors';
import { initials, mediumDateTime, timeAgo } from '../../lib/format';
import { Button, textareaClass } from '../ui';

type Message = ApplicationData['messages'][number];

/**
 * The conversation with the leasing office about one application. Their
 * messages sit left, yours right. Sending shows your message straight away and
 * takes it back (keeping your text) if it fails.
 */
export function MessageThread({ applicationId, messages, organizationName, canReply }: { applicationId: string; messages: Message[]; organizationName: string; canReply: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const endRef = useRef<HTMLLIElement>(null);
  const key = applicationKeys.detail(applicationId);

  const send = useMutation({
    mutationFn: (text: string) => sendApplicationMessage({ id: applicationId, body: text }),
    onMutate: async text => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ApplicationDetail>(key);
      const temp: Message = { id: `pending-${Date.now()}`, mine: true, senderName: 'You', subject: '', body: text, sentAt: new Date().toISOString(), unread: false };
      qc.setQueryData<ApplicationDetail>(key, prev => (prev?.application ? { ...prev, application: { ...prev.application, messages: [...prev.application.messages, temp] } } : prev));
      setBody('');
      return { previous, text, tempId: temp.id };
    },
    onSuccess: (msg, _text, ctx) => {
      qc.setQueryData<ApplicationDetail>(key, prev => (prev?.application ? { ...prev, application: { ...prev.application, messages: prev.application.messages.map(m => (m.id === ctx?.tempId ? msg : m)) } } : prev));
      void qc.invalidateQueries({ queryKey: applicationKeys.list });
      toast.success('Message sent. The leasing team will reply here and by email.');
    },
    onError: (e, _text, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      if (ctx?.text) setBody(ctx.text);
      setProblem(errorMessage(e, 'Your message didn’t send. Try again.'));
    },
  });

  const count = messages.length;
  useEffect(() => {
    if (send.isPending) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [count, send.isPending]);

  const submit = () => {
    const text = body.trim();
    if (!text) {
      setProblem('Write a message before sending.');
      document.getElementById(id)?.focus();
      return;
    }
    if (send.isPending) return;
    setProblem(null);
    send.mutate(text);
  };

  return (
    <div>
      {messages.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-[15px] text-muted-foreground">
          <MessageSquare className="h-5 w-5 shrink-0" aria-hidden />
          No messages yet. If the leasing team has a question, it will appear here and in your email.
        </div>
      ) : (
        <ol className="space-y-5" aria-label="Messages">
          {messages.map(m => {
            const pending = m.id.startsWith('pending-');
            return (
              <li key={m.id} className={cn('flex gap-3', m.mine && 'flex-row-reverse')}>
                <span className={cn('mt-6 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', m.mine ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground')} aria-hidden>
                  {m.mine ? 'You' : initials(m.senderName || organizationName)}
                </span>
                <div className={cn('min-w-0 max-w-[88%] sm:max-w-[80%]', m.mine && 'text-right')}>
                  <p className={cn('mb-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground', m.mine && 'justify-end')}>
                    <span className="font-medium text-foreground">{m.mine ? 'You' : m.senderName}</span>
                    {pending ? <span>Sending…</span> : m.sentAt && <time dateTime={m.sentAt} title={mediumDateTime(m.sentAt)}>{timeAgo(m.sentAt)}</time>}
                    {m.unread && <span className="rounded-full bg-primary px-2 py-px text-2xs font-semibold text-primary-foreground">New</span>}
                  </p>
                  <div className={cn('rounded-xl px-4 py-3 text-left text-[15px] leading-relaxed shadow-2xs', m.mine ? 'rounded-tr-md bg-primary/[0.08] ring-1 ring-inset ring-primary/15' : 'rounded-tl-md border bg-background', pending && 'opacity-70')}>
                    {m.subject && !m.mine && <p className="mb-1 font-semibold">{m.subject}</p>}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                </div>
              </li>
            );
          })}
          <li ref={endRef} aria-hidden />
        </ol>
      )}

      {canReply && (
        <form
          className="mt-6 border-t pt-5"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={id} className="text-[15px] font-medium">
            Message the leasing team
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
                submit();
              }
            }}
            maxLength={5000}
            placeholder="Ask a question or share an update…"
            aria-invalid={Boolean(problem) || undefined}
            aria-describedby={problem ? `${id}-error` : `${id}-hint`}
            className={textareaClass('mt-2 min-h-[96px]')}
          />
          {problem ? (
            <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
              {problem}
            </p>
          ) : (
            <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted-foreground">
              {organizationName} sees it right away. Replies arrive here and by email.
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Button type="submit" loading={send.isPending}>
              <Send aria-hidden /> Send message
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
