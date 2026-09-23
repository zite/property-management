import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronDown, FileText, History, MessageSquare, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { respondToApproval } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ownerKeys, useOwnerApprovals, type Approval, type OwnerApprovals } from '../../components/owner/data';
import { Thumb } from '../../components/owner/Thumb';
import { AreaSkeleton, LoadError, PageHeader, Panel, money, workOrderTone } from '../../components/owner/kit';
import { Button, Card, Container, EmptyState, StatusPill } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { longDate, mediumDateTime, shortDate, timeAgo } from '../../lib/format';
import { qk } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Repairs on the owner's properties that need their go-ahead, with what they
 * need to decide — the estimate, the vendor, photos, quotes and the
 * conversation — and every decision they've made before.
 */
export default function ApprovalsPage() {
  useDocumentTitle('Approvals');
  const q = useOwnerApprovals();
  if (q.isPending) return <AreaSkeleton variant="list" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your approvals" home={{ to: '/owner', label: 'Overview' }} />;
  const d = q.data;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Approvals" subtitle="Repairs above your approval limit wait here for your decision. The office and the vendor hear back as soon as you answer." />
      <Container className="space-y-8 pb-4 pt-4">
        <section aria-labelledby="pending-heading" className="space-y-4">
          <h2 id="pending-heading" className="text-lg font-semibold">
            Waiting for you <span className="text-sm font-normal tabular-nums text-faint">{d.pending.length}</span>
          </h2>
          {d.pending.length === 0 ? (
            <Card>
              <EmptyState icon={CheckCircle2} title="Nothing needs your approval">
                When a repair costs more than your approval limit, your property manager will send it here with the estimate and any quotes.
              </EmptyState>
            </Card>
          ) : (
            d.pending.map(a => <PendingCard key={a.id} a={a} currency={d.currency} />)
          )}
        </section>
        <HistoryList d={d} />
      </Container>
    </div>
  );
}

function PendingCard({ a, currency }: { a: Approval; currency: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<'Approved' | 'Declined' | null>(null);
  const [showThread, setShowThread] = useState(false);
  const respond = useMutation({
    mutationFn: (v: { decision: 'Approved' | 'Declined'; note: string }) => respondToApproval({ workOrderId: a.id, decision: v.decision, note: v.note || null }),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: ownerKeys.approvals });
      const prev = qc.getQueryData<OwnerApprovals>(ownerKeys.approvals);
      qc.setQueryData<OwnerApprovals>(ownerKeys.approvals, old =>
        old ? { ...old, pending: old.pending.filter(x => x.id !== a.id), history: [{ ...a, decision: v.decision, note: v.note, respondedAt: new Date().toISOString(), canRespond: false }, ...old.history] } : old,
      );
      setOpen(null);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ownerKeys.approvals, ctx.prev);
      toast.error(errorMessage(e, 'Your decision didn’t save. Try again.'));
    },
    onSuccess: r => {
      toast.success(r.decision === 'Approved' ? `Approved. ${a.vendor ? `${a.vendor.name} can go ahead.` : 'The office will schedule the work.'}` : 'Declined. Your property manager will follow up.');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.owner });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });

  const where = [a.propertyName, a.unitName && !/^main$/i.test(a.unitName) ? `Unit ${a.unitName}` : null].filter(Boolean).join(' · ');
  return (
    <Card as="article" className="overflow-hidden" aria-labelledby={`appr-${a.id}`}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium tabular-nums">WO-{a.number}</span>
            <span aria-hidden>·</span>
            <span>{where}</span>
            {a.priority === 'Emergency' || a.priority === 'High' ? <StatusPill tone={a.priority === 'Emergency' ? 'danger' : 'warning'}>{a.priority} priority</StatusPill> : null}
          </div>
          <h3 id={`appr-${a.id}`} className="mt-1.5 break-words text-xl font-semibold leading-snug tracking-tight">
            {a.title}
          </h3>
          {a.description && <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed text-foreground/85">{a.description}</p>}

          {a.photos.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Photos">
              {a.photos.map(p => (
                <li key={p.url}>
                  <Thumb url={p.url} name={p.name} className="h-24 w-24" />
                </li>
              ))}
            </ul>
          )}

          {a.quotes.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">Quotes and documents</p>
              <ul className="mt-1.5 space-y-1.5">
                {a.quotes.map(doc => (
                  <li key={doc.id}>
                    <a href={doc.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[15px] hover:border-foreground/25 hover:bg-accent">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate font-medium">{doc.name}</span>
                      {doc.uploadedAt && <span className="shrink-0 text-sm text-muted-foreground">{shortDate(doc.uploadedAt)}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.messages.length > 0 && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowThread(s => !s)} aria-expanded={showThread} className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                <MessageSquare className="h-4 w-4" aria-hidden />
                {showThread ? 'Hide the conversation' : `Conversation about this (${a.messages.length})`}
                <ChevronDown className={cn('h-4 w-4 transition-transform', showThread && 'rotate-180')} aria-hidden />
              </button>
              {showThread && (
                <ol className="mt-3 space-y-3 border-l-2 pl-4">
                  {a.messages.map(m => (
                    <li key={m.id}>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{m.mine ? 'You' : m.senderName || 'The office'}</span>
                        {m.sentAt && <span title={mediumDateTime(m.sentAt)}> · {timeAgo(m.sentAt)}</span>}
                      </p>
                      <p className="mt-0.5 whitespace-pre-line break-words text-[15px]">{m.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4 border-t bg-muted/30 p-4 sm:p-6 lg:border-l lg:border-t-0">
          <div>
            <p className="text-sm text-muted-foreground">Estimate</p>
            <p className="text-3xl font-semibold tracking-tight">{a.estimate != null ? money(a.estimate, currency) : 'Not given'}</p>
          </div>
          <dl className="space-y-2 text-[15px]">
            {a.vendor && (
              <div>
                <dt className="text-sm text-muted-foreground">Vendor</dt>
                <dd className="font-medium">{a.vendor.name}</dd>
                {a.vendor.trade && <dd className="text-sm text-muted-foreground">{a.vendor.trade}</dd>}
              </div>
            )}
            {a.requestedAt && (
              <div>
                <dt className="text-sm text-muted-foreground">Requested</dt>
                <dd>{longDate(a.requestedAt.slice(0, 10))}</dd>
              </div>
            )}
          </dl>
          <div className="mt-auto flex flex-col gap-2">
            <Button size="lg" onClick={() => setOpen('Approved')} disabled={respond.isPending}>
              <Check aria-hidden /> Approve
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setOpen('Declined')} disabled={respond.isPending}>
              <X aria-hidden /> Decline
            </Button>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={open !== null}
        onOpenChange={o => !o && setOpen(null)}
        title={open === 'Approved' ? `Approve ${a.estimate != null ? `the ${money(a.estimate, currency)} estimate` : 'this repair'}?` : 'Decline this repair?'}
        description={
          open === 'Approved'
            ? `${a.vendor ? `${a.vendor.name} will be cleared to do the work` : 'The office will schedule the work'} at ${a.propertyName}, and the cost will come out of the property’s operating cash.`
            : 'The work won’t go ahead. Your property manager will be told right away and may get back to you with other options.'
        }
        confirmLabel={open === 'Approved' ? 'Approve' : 'Decline repair'}
        tone={open === 'Declined' ? 'danger' : 'primary'}
        pending={respond.isPending}
        note={{ label: open === 'Approved' ? 'Note for your property manager' : 'Why are you declining?', placeholder: open === 'Approved' ? 'Anything they should know before the work starts' : 'For example: please get a second quote first' }}
        onConfirm={note => open && respond.mutate({ decision: open, note })}
      />
    </Card>
  );
}

function HistoryList({ d }: { d: OwnerApprovals }) {
  if (!d.history.length) return null;
  return (
    <Panel title="Past decisions" icon={History} flush>
      <ul className="divide-y">
        {d.history.map(h => (
          <li key={h.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="break-words font-medium leading-snug">{h.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[`WO-${h.number}`, h.propertyName, h.estimate != null ? `Estimate ${money(h.estimate, d.currency)}` : null, h.respondedAt ? `Decided ${shortDate(h.respondedAt)}` : null].filter(Boolean).join(' · ')}
              </p>
              {h.note && <p className="mt-1.5 break-words border-l-2 pl-3 text-[15px] italic text-foreground/80">“{h.note}”</p>}
            </div>
            <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end">
              <StatusPill tone={h.decision === 'Approved' ? 'success' : 'danger'}>{h.decision === 'Approved' ? 'You approved' : 'You declined'}</StatusPill>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" aria-hidden />
                <StatusPill tone={workOrderTone(h.status)} dot={false} className="h-6">
                  {h.status}
                </StatusPill>
                {h.cost != null && <span className="tabular-nums">{money(h.cost, d.currency)}</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
