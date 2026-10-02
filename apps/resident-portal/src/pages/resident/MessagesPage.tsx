import { useQueryClient } from '@tanstack/react-query';
import { Clock, MessageSquare, Phone, Wrench } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { markResidentMessagesRead, sendResidentMessage } from 'zitejs/api';
import { EmergencyCard, LoadError, ResidentSkeleton } from '../../components/resident/bits';
import { Conversation } from '../../components/resident/Conversation';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Card, Container } from '../../components/ui';
import { isDemoPreview, qk } from '../../lib/queries';
import { telHref } from '../../lib/residentFormat';
import { useResidentLease } from '../../lib/residentLease';
import { rk, useResidentMessages, type ResidentMessages } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/** The resident's conversation with the office — every portal message and email, in one thread. */
export default function MessagesPage() {
  useDocumentTitle('Messages');
  const { leaseId, me } = useResidentLease();
  const q = useResidentMessages(leaseId);
  const qc = useQueryClient();

  // Reading the thread marks the office's messages read, so the nav badge clears.
  const unreadIds = (q.data?.messages ?? []).filter(m => m.unread).map(m => m.id).join(',');
  const lastMarked = useRef('');
  useEffect(() => {
    if (!unreadIds || !leaseId || lastMarked.current === unreadIds || isDemoPreview()) return;
    lastMarked.current = unreadIds;
    markResidentMessagesRead({ leaseId })
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.me });
        void qc.invalidateQueries({ queryKey: rk.home(leaseId) });
      })
      .catch(() => undefined);
  }, [unreadIds, leaseId, qc]);

  if (q.isPending) return <ResidentSkeleton variant="document" />;
  if (q.isError || !q.data || !leaseId) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your messages" />;

  const d = q.data;
  const key = rk.messages(leaseId);

  return (
    <div className="animate-fade-in">
      <ResidentHeader title="Messages" subtitle={<LeaseSwitcher />} />
      <Container className="pb-4 pt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>
                <MessageSquare className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{d.organizationName}</p>
                <p className="truncate text-sm text-muted-foreground">{d.officeHours ? `Replies during office hours · ${d.officeHours}` : 'We usually reply within one business day'}</p>
              </div>
            </div>
            <Conversation
              scrollable
              allowSubject
              messages={d.messages}
              organizationName={d.organizationName}
              myName={d.myName || me?.name || 'You'}
              emptyTitle="Start a conversation"
              emptyBody="Questions about your home, your account or your lease? Write to the office — replies show up here and in your email."
              composerLabel="Message the office"
              placeholder={`Write to ${d.organizationName}…`}
              maxAttachments={10}
              send={async payload => {
                const res = await sendResidentMessage({ leaseId, subject: payload.subject, body: payload.body, attachments: payload.attachments });
                qc.setQueryData<ResidentMessages>(key, prev => (prev ? { ...prev, messages: [...prev.messages, res.message] } : prev));
                void qc.invalidateQueries({ queryKey: rk.home(leaseId) });
              }}
            />
          </Card>
          <aside className="space-y-4">
            <Card className="p-4">
              <p className="text-[15px] font-semibold">Something broken?</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Maintenance requests go straight to the maintenance team, with photos and updates in one place.</p>
              <Link to="/resident/maintenance/new" className="mt-2 inline-flex items-center gap-1.5 text-[15px] font-medium text-primary hover:underline">
                <Wrench className="h-4 w-4" aria-hidden /> Request maintenance
              </Link>
            </Card>
            {(d.phone || d.officeHours) && (
              <Card className="space-y-2 p-4">
                <p className="text-[15px] font-semibold">Call the office</p>
                {d.phone && (
                  <a href={telHref(d.phone)} className="flex items-center gap-2 text-[15px] font-medium text-primary hover:underline">
                    <Phone className="h-4 w-4" aria-hidden /> {d.phone}
                  </a>
                )}
                {d.officeHours && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" aria-hidden /> {d.officeHours}
                  </p>
                )}
              </Card>
            )}
            <EmergencyCard phone={d.emergencyPhone} compact />
          </aside>
        </div>
      </Container>
    </div>
  );
}
