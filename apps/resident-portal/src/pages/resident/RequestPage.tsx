import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, DoorOpen, Images, Lock, MessageSquare, Star, Wrench, XCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { addRequestMessage, cancelRequest, markResidentMessagesRead, rateRequest } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CategoryGlyph, EmergencyCard, LoadError, Panel, RequestStatusPill, ResidentSkeleton } from '../../components/resident/bits';
import { Conversation } from '../../components/resident/Conversation';
import { ResidentHeader } from '../../components/resident/ResidentHeader';
import { FileList } from '../../components/resident/uploads';
import { Button, Card, Container, textareaClass } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { mediumDateTime, shortDate } from '../../lib/format';
import { qk } from '../../lib/queries';
import { categoryMeta, PRIORITY_WORDS, requestStatus, visitTime } from '../../lib/residentFormat';
import { useReturnFocus } from '../../lib/residentFocus';
import { useResidentLease } from '../../lib/residentLease';
import { rk, useRefreshResident, useResidentRequest, type ResidentRequestDetail } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * One maintenance request: where it stands in plain words, when someone is
 * coming, the photos, the conversation with the office — and, at the end, a
 * chance to say how it went.
 */
export default function RequestPage() {
  const params = useParams();
  const number = Number(params.number);
  const { leaseId, me } = useResidentLease();
  const q = useResidentRequest(leaseId, number);
  const qc = useQueryClient();
  useDocumentTitle(q.data ? `${q.data.request.ref} · ${q.data.request.title}` : 'Maintenance request');

  // Opening the request reads the office's replies; clear them so the badges agree.
  const unread = q.data?.messages.some(m => m.unread) ?? false;
  const marked = useRef(false);
  useEffect(() => {
    if (!unread || marked.current || !leaseId) return;
    marked.current = true;
    markResidentMessagesRead({ leaseId, workOrderNumber: number })
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.me });
        void qc.invalidateQueries({ queryKey: rk.requests(leaseId) });
        void qc.invalidateQueries({ queryKey: rk.home(leaseId) });
      })
      .catch(() => undefined);
  }, [unread, leaseId, number, qc]);

  if (!Number.isInteger(number) || number <= 0) return <LoadError error={new Error('API call failed (404): {"message":"We couldn\'t find that request."}')} onRetry={() => undefined} what="that request" />;
  if (q.isPending) return <ResidentSkeleton variant="document" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="that request" />;
  return <RequestView d={q.data} leaseId={leaseId!} myName={me?.name ?? 'You'} />;
}

function RequestView({ d, leaseId, myName }: { d: ResidentRequestDetail; leaseId: string; myName: string }) {
  const r = d.request;
  const qc = useQueryClient();
  const refresh = useRefreshResident();
  const status = requestStatus(r.status);
  const [cancelOpen, setCancelOpen] = useState(false);
  useReturnFocus(cancelOpen);
  const key = rk.request(leaseId, r.number);

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelRequest({ leaseId, number: r.number, reason }),
    onSuccess: () => {
      setCancelOpen(false);
      toast.success(`${r.ref} was canceled.`);
      void refresh();
    },
  });

  const open = ['New', 'Scheduled', 'In progress', 'On hold'].includes(r.status);

  return (
    <div className="animate-fade-in">
      <ResidentHeader
        back={{ to: '/resident/maintenance', label: 'Maintenance' }}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <CategoryGlyph category={r.category} size="sm" />
            <span>
              {r.ref} · {categoryMeta(r.category).label}
              {r.priority === 'Emergency' || r.priority === 'High' ? ` · ${PRIORITY_WORDS[r.priority]}` : ''}
            </span>
          </span>
        }
        title={<span className="break-words">{r.title}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <RequestStatusPill status={r.status} />
            <span>{status.hint}</span>
          </span>
        }
      />
      <Container className="pb-4 pt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            {r.status === 'Scheduled' && r.scheduledFor && (
              <Card className="flex items-start gap-3 border-tone-accent/30 bg-tone-accent/[0.05] p-4 sm:p-5">
                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-tone-accent" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{visitTime(r.scheduledFor)}</p>
                  <p className="mt-0.5 text-[15px] text-foreground/80">
                    {r.vendorName ? `${r.vendorName} is scheduled to come by.` : 'Our maintenance team is scheduled to come by.'} {r.permissionToEnter ? 'You said it’s OK to enter if you’re out.' : 'You asked us to contact you before entering.'}
                  </p>
                </div>
              </Card>
            )}

            {r.status === 'Completed' && <RateCard d={d} leaseId={leaseId} />}

            <Panel title="Details" icon={Wrench}>
              {r.description ? <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{r.description}</p> : <p className="text-[15px] text-muted-foreground">No description was added.</p>}
              {r.photos.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Images className="h-4 w-4" aria-hidden /> {r.photos.length} photo{r.photos.length === 1 ? '' : 's'}
                  </p>
                  <FileList files={r.photos} />
                </div>
              )}
              {r.completionNotes && (
                <div className="mt-4 rounded-lg bg-tone-success/[0.06] px-3.5 py-3">
                  <p className="text-sm font-medium text-tone-success">What was done</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[15px]">{r.completionNotes}</p>
                </div>
              )}
            </Panel>

            <Panel title="Conversation" icon={MessageSquare}>
              <Conversation
                messages={d.messages}
                organizationName={d.organizationName}
                myName={myName}
                emptyTitle="No messages yet"
                emptyBody="Questions, a better time for the visit, another photo — send it here and whoever is handling your request will see it."
                composerLabel="Add a message or photos"
                placeholder={open ? 'e.g. It’s gotten worse since this morning' : 'Anything else we should know?'}
                attachLabel="Add photos"
                hideSubject={subject => new RegExp(`^(re:\\s*)?${r.ref}\\b`, 'i').test(subject.trim())}
                maxAttachments={6}
                hint="The office and whoever is handling your request will see this."
                send={async payload => {
                  const res = await addRequestMessage({ leaseId, number: r.number, body: payload.body, attachments: payload.attachments });
                  qc.setQueryData<ResidentRequestDetail>(key, prev =>
                    prev ? { ...prev, messages: [...prev.messages, res.message], request: { ...prev.request, photos: [...prev.request.photos, ...payload.attachments.filter(a => /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i.test(a.name) && !prev.request.photos.some(p => p.url === a.url))] } } : prev,
                  );
                  void qc.invalidateQueries({ queryKey: key });
                }}
              />
            </Panel>
          </div>

          <aside className="min-w-0 space-y-5">
            <Panel title="Progress">
              {d.timeline.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">Reported {shortDate(r.reportedAt)}.</p>
              ) : (
                <ol className="relative">
                  {d.timeline.map((e, i) => {
                    const last = i === d.timeline.length - 1;
                    return (
                      <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {!last && <span className="absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5 rounded-full bg-border" aria-hidden />}
                        <span className={cn('relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', last ? 'bg-primary text-primary-foreground ring-4 ring-primary/15' : 'bg-muted text-muted-foreground')} aria-hidden>
                          {e.tone === 'neutral' && e.label === 'Canceled' ? <XCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium">{e.label}</p>
                          {e.detail && <p className="break-words text-sm text-foreground/80">{/^\d{4}-\d{2}-\d{2}T/.test(e.detail) ? visitTime(e.detail) : e.detail}</p>}
                          <p className="text-sm text-muted-foreground">{mediumDateTime(e.at)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel>

            <Panel title="Getting in" icon={r.permissionToEnter ? DoorOpen : Lock}>
              <p className="text-[15px] font-medium">{r.permissionToEnter ? 'OK to enter if you’re not home' : 'Contact you before entering'}</p>
              {r.entryNotes && <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] text-muted-foreground">{r.entryNotes}</p>}
              {r.vendorName && r.status !== 'Canceled' && (
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                  Handled by <span className="font-medium text-foreground">{r.vendorName}</span>
                </p>
              )}
            </Panel>

            {open && <EmergencyCard phone={d.emergencyPhone} compact />}

            {r.canCancel && (
              <Card className="p-4">
                <p className="text-[15px] font-medium">Don’t need this anymore?</p>
                <p className="mt-0.5 text-sm text-muted-foreground">You can cancel until it’s scheduled.</p>
                <Button variant="secondary" className="mt-3 w-full text-tone-danger hover:text-tone-danger" onClick={() => setCancelOpen(true)}>
                  Cancel request
                </Button>
              </Card>
            )}
          </aside>
        </div>
      </Container>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={o => {
          setCancelOpen(o);
          if (!o) cancel.reset();
        }}
        title={`Cancel ${r.ref}?`}
        description={
          <p>
            We’ll stop working on <span className="font-medium text-foreground">{r.title}</span> and let the maintenance team know. If the problem comes back, send a new request.
          </p>
        }
        confirmLabel="Cancel request"
        tone="danger"
        pending={cancel.isPending}
        error={cancel.isError ? errorMessage(cancel.error, "The request wasn't canceled. Try again.") : null}
        note={{ label: 'Why are you canceling?', placeholder: 'For example, it fixed itself.' }}
        onConfirm={reason => cancel.mutate(reason)}
      />
    </div>
  );
}

const STAR_WORDS = ['', 'Poor', 'Not great', 'OK', 'Good', 'Excellent'];

function RateCard({ d, leaseId }: { d: ResidentRequestDetail; leaseId: string }) {
  const r = d.request;
  const qc = useQueryClient();
  const refresh = useRefreshResident();
  const id = useId();
  const [rating, setRating] = useState<number>(r.tenantRating ?? 0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState(r.tenantFeedback);
  const [editing, setEditing] = useState(r.tenantRating == null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => rateRequest({ leaseId, number: r.number, rating, feedback: feedback.trim() }),
    onMutate: () => {
      // Show the rating as saved straight away; roll back if it fails.
      const key = rk.request(leaseId, r.number);
      const prev = qc.getQueryData<ResidentRequestDetail>(key);
      qc.setQueryData<ResidentRequestDetail>(key, p => (p ? { ...p, request: { ...p.request, tenantRating: rating, tenantFeedback: feedback.trim() } } : p));
      setEditing(false);
      return { prev, key };
    },
    onSuccess: () => {
      toast.success(rating >= 4 ? 'Thanks for the rating.' : 'Thanks — we’ll look into what went wrong.');
      void refresh();
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      setEditing(true);
      setProblem(errorMessage(e, "Your rating didn't save. Try again."));
    },
  });

  if (!editing && r.tenantRating != null) {
    return (
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Your rating</p>
          <p className="mt-1 flex items-center gap-1" aria-label={`${r.tenantRating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} className={cn('h-5 w-5', n <= (r.tenantRating ?? 0) ? 'fill-current text-tone-warning' : 'text-border')} aria-hidden />
            ))}
            <span className="ml-1.5 text-[15px] font-medium">{STAR_WORDS[r.tenantRating ?? 0]}</span>
          </p>
          {r.tenantFeedback && <p className="mt-1.5 break-words text-[15px] text-foreground/80">“{r.tenantFeedback}”</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="self-start sm:self-center">
          Change rating
        </Button>
      </Card>
    );
  }

  return (
    <Card as="section" className="p-4 sm:p-5" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-[15px] font-semibold">
        How did it go?
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Your rating helps us choose who we send next time.</p>
      <form
        className="mt-3"
        onSubmit={e => {
          e.preventDefault();
          if (!rating) {
            setProblem('Choose a star rating.');
            return;
          }
          setProblem(null);
          save.mutate();
        }}
      >
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map(n => {
            const lit = n <= (hover || rating);
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'} — ${STAR_WORDS[n]}`}
                onMouseEnter={() => setHover(n)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                onClick={() => {
                  setRating(n);
                  setProblem(null);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-lg transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              >
                <Star className={cn('h-7 w-7 transition-colors', lit ? 'fill-current text-tone-warning' : 'text-muted-foreground/40')} aria-hidden />
              </button>
            );
          })}
          <span className="ml-2 text-[15px] font-medium text-muted-foreground" aria-live="polite">
            {STAR_WORDS[hover || rating]}
          </span>
        </div>
        {rating > 0 && (
          <div className="mt-3 animate-fade-up">
            <label htmlFor={`${id}-fb`} className="text-sm font-medium">
              {rating <= 3 ? 'What could have gone better?' : 'Anything to add?'} <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea id={`${id}-fb`} value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={2000} className={textareaClass('mt-1.5 min-h-[80px]')} />
          </div>
        )}
        {problem && <p role="alert" className="mt-2 text-sm text-tone-danger">{problem}</p>}
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="ink" loading={save.isPending}>
            Save rating
          </Button>
          {r.tenantRating != null && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
