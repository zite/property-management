import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, MessagesSquare, Phone } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { markOwnerMessagesRead, sendOwnerMessage } from 'zitejs/api';
import { Conversation } from '../../components/owner/Conversation';
import { ownerKeys, useOwnerMessages, type OwnerMessages } from '../../components/owner/data';
import { AreaSkeleton, LoadError, PageHeader, Panel, telHref } from '../../components/owner/kit';
import { Container } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { qk, useMe, usePortal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/** The owner's conversation with the office, and who looks after their properties. Opening it marks everything read. */
export default function OwnerMessagesPage() {
  useDocumentTitle('Messages');
  const q = useOwnerMessages();
  const qc = useQueryClient();
  const me = useMe();
  const portal = usePortal();
  const marked = useRef(false);

  const unread = (q.data?.messages.filter(m => m.unread).length ?? 0) + (me.data?.owner?.unreadMessages ?? 0);
  useEffect(() => {
    if (!q.data || marked.current || unread === 0) return;
    marked.current = true;
    markOwnerMessagesRead({})
      .then(() => {
        qc.invalidateQueries({ queryKey: qk.me });
      })
      .catch(() => {
        marked.current = false;
      });
  }, [q.data, unread, qc]);

  const send = useMutation({
    mutationFn: (body: string) => sendOwnerMessage({ body }),
    onMutate: async body => {
      await qc.cancelQueries({ queryKey: ownerKeys.messages });
      const prev = qc.getQueryData<OwnerMessages>(ownerKeys.messages);
      const temp = { id: `temp-${Date.now()}`, mine: true, subject: '', body, senderName: prev?.ownerName ?? '', sentAt: new Date().toISOString(), unread: false, attachments: [] as Array<{ name: string; url: string }> };
      qc.setQueryData<OwnerMessages>(ownerKeys.messages, old => (old ? { ...old, messages: [...old.messages, temp] } : old));
      return { prev, tempId: temp.id };
    },
    onSuccess: (msg, _b, ctx) => {
      qc.setQueryData<OwnerMessages>(ownerKeys.messages, old => (old ? { ...old, messages: old.messages.map(m => (m.id === ctx?.tempId ? msg : m)) } : old));
      toast.success('Message sent. Your property manager will reply here.');
    },
    onError: (e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(ownerKeys.messages, ctx.prev);
      toast.error(errorMessage(e, 'Your message didn’t send. Try again.'));
    },
  });

  if (q.isPending) return <AreaSkeleton variant="detail" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your messages" home={{ to: '/owner', label: 'Overview' }} />;
  const d = q.data;
  const s = portal.data?.settings;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Messages" subtitle={`Your conversation with ${d.organizationName}`} />
      <Container className="pb-4 pt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title="Conversation" icon={MessagesSquare} className="min-w-0">
            <Conversation
              messages={d.messages.map(m => ({ ...m, pending: m.id.startsWith('temp-') }))}
              officeName={d.organizationName}
              onSend={body => send.mutateAsync(body)}
              sending={send.isPending}
              emptyText="No messages yet. Questions about a statement, a repair or your properties? Write to the office below."
              composerLabel="Write to your property manager"
              placeholder="Ask about a statement, a repair, a distribution…"
              hint="They’ll get it in their inbox. Press ⌘ Enter to send."
              scroll
            />
          </Panel>
          <aside className="min-w-0 space-y-5">
            <Panel title={d.managers.length === 1 ? 'Your property manager' : 'Your property managers'}>
              {d.managers.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">Messages go to the office’s owner services team.</p>
              ) : (
                <ul className="space-y-4">
                  {d.managers.map(m => (
                    <li key={m.id}>
                      <p className="font-medium">{m.name}</p>
                      {m.title && <p className="text-sm text-muted-foreground">{m.title}</p>}
                      <div className="mt-1.5 flex flex-col gap-1 text-sm">
                        {m.phone && (
                          <a href={telHref(m.phone)} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                            <Phone className="h-3.5 w-3.5" aria-hidden /> {m.phone}
                          </a>
                        )}
                        {m.email && (
                          <a href={`mailto:${m.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline">
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{m.email}</span>
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {s && (s.phone || s.officeHours) && (
              <Panel title="The office">
                <p className="text-[15px]">{s.organizationName}</p>
                {s.officeHours && <p className="text-sm text-muted-foreground">{s.officeHours}</p>}
                {s.phone && (
                  <a href={telHref(s.phone)} className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Phone className="h-3.5 w-3.5" aria-hidden /> {s.phone}
                  </a>
                )}
              </Panel>
            )}
          </aside>
        </div>
      </Container>
    </div>
  );
}
