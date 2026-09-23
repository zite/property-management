import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ChevronDown, CircleSlash, ClipboardList, FileSignature, Home, Hourglass, Inbox, PartyPopper, PenLine, SearchX, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { withdrawApplication } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { MessageThread } from '../../components/apply/MessageThread';
import { ApplicationSummary } from '../../components/apply/ReviewStep';
import { Timeline } from '../../components/apply/Timeline';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListingPhoto } from '../../components/homes/ListingPhoto';
import { SignInPrompt } from '../../components/SignInPrompt';
import { Alert, BackLink, Button, Card, Container, EmptyState, LinkButton, Skeleton, StatusPill } from '../../components/ui';
import { applicationKeys, statusCopy, useMyApplication, type ApplicationDetail } from '../../lib/apply';
import { useSession } from '../../lib/auth';
import { errorMessage, isNotFound } from '../../lib/errors';
import { formatMoney, mediumDateTime, shortDate } from '../../lib/format';
import { availability, homesKeys, money, sizeLine } from '../../lib/listings';
import { qk, useMe, usePortal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

const STATUS_ICON = { Draft: PenLine, Submitted: Inbox, Screening: Hourglass, Approved: CheckCircle2, Denied: CircleSlash, Withdrawn: X, Leased: PartyPopper } as const;
const ICON_TONE: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-tone-info/10 text-tone-info',
  warning: 'bg-tone-warning/10 text-tone-warning',
  success: 'bg-tone-success/10 text-tone-success',
  danger: 'bg-tone-danger/10 text-tone-danger',
  accent: 'bg-tone-accent/10 text-tone-accent',
};

/**
 * One application from the applicant's side: where it stands in plain words,
 * what happened when, the conversation with the office, and exactly what was
 * sent. Withdrawing is here too, behind a confirmation that says what it does.
 */
export default function ApplicationStatusPage() {
  const { id } = useParams();
  const { user, isLoading } = useSession();
  const q = useMyApplication(id);
  useDocumentTitle(q.data?.application ? `${q.data.application.reference === 'Draft' ? 'Draft application' : q.data.application.reference} · ${q.data.listing.title}` : 'Application');

  if (isLoading) return <StatusSkeleton />;
  if (!user) return <SignInPrompt title="Sign in to see your application" body="Use the email address you applied with to check its status and message the leasing team." hashPath={`/applications/${id}`} />;
  if (q.isPending) return <StatusSkeleton />;
  if (q.isError || !q.data?.application) {
    return (
      <Container size="narrow" className="py-16">
        {q.isError && !isNotFound(q.error) ? (
          <Alert tone="danger" title="Your application didn’t load" action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}>Try again</Button>}>
            {errorMessage(q.error, 'Check your connection and try again.')}
          </Alert>
        ) : (
          <EmptyState icon={SearchX} title="We couldn’t find that application" action={<LinkButton to="/applications">My applications</LinkButton>}>
            It may have been deleted, or started with a different email address. You’re signed in as {user.email}.
          </EmptyState>
        )}
      </Container>
    );
  }
  return <Status data={q.data} />;
}

function Status({ data }: { data: ApplicationDetail }) {
  const a = data.application!;
  const { listing } = data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const portal = usePortal();
  const me = useMe();
  const org = portal.data?.settings.organizationName ?? 'The leasing team';
  const currency = portal.data?.settings.currency ?? 'USD';
  const copy = statusCopy(a.status, org);
  const Icon = STATUS_ICON[a.status as keyof typeof STATUS_ICON] ?? ClipboardList;
  const [confirming, setConfirming] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const justSubmitted = params.get('submitted') === '1' && a.status === 'Submitted';
  const isDraft = a.status === 'Draft';
  const avail = availability(listing.availableOn);

  const withdraw = useMutation({
    mutationFn: (reason: string) => withdrawApplication({ id: a.id, reason }),
    onSuccess: res => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: applicationKeys.all });
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: homesKeys.all });
      if (res.deleted) {
        try {
          localStorage.removeItem(`resident-portal:apply:${a.email}:${listing.slug}`);
        } catch {
          /* ignore */
        }
        toast.success('Draft deleted.');
        navigate('/applications', { replace: true });
      } else {
        toast.success('Application withdrawn. The leasing team has been told.');
      }
    },
  });

  return (
    <div className="pb-12">
      <div className="border-b bg-background">
        <Container className="py-5 sm:py-6">
          <BackLink to="/applications">My applications</BackLink>
          <div className="mt-4 flex items-start gap-4">
            <ListingPhoto src={listing.cover} alt="" width={320} eager className="hidden h-16 w-24 shrink-0 rounded-lg sm:block" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">
                {isDraft ? 'Draft application' : a.reference}
                {a.submittedAt ? ` · sent ${shortDate(a.submittedAt)}` : isDraft && a.lastSavedAt ? ` · saved ${shortDate(a.lastSavedAt)}` : ''}
              </p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{listing.title}</h1>
              <p className="mt-1 truncate text-[15px] text-muted-foreground">{[listing.propertyName, [listing.city, listing.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
            </div>
            <StatusPill tone={copy.tone} className="mt-1 hidden sm:inline-flex">
              {copy.pill}
            </StatusPill>
          </div>
        </Container>
      </div>

      <Container className="pt-6 sm:pt-8">
        {justSubmitted && (
          <Card className="mb-6 flex items-start gap-4 border-tone-success/30 bg-tone-success/[0.05] p-5 animate-fade-up">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tone-success/15 text-tone-success animate-pop">
              <CheckCircle2 className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1" role="status">
              <p className="text-lg font-semibold">Application sent</p>
              <p className="mt-0.5 text-[15px] text-foreground/85">
                Your application number is <span className="font-semibold">{a.reference}</span>. We’ve emailed a copy to {a.email}. The leasing team reviews applications in the order they arrive.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setParams({}, { replace: true })}
              className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <div className="min-w-0 space-y-6">
            <Card className="p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', ICON_TONE[copy.tone])}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <StatusPill tone={copy.tone} className="mb-2 sm:hidden">
                    {copy.pill}
                  </StatusPill>
                  <h2 className="text-xl font-semibold tracking-tight">{copy.headline}</h2>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-foreground/85">
                    {a.leaseReady && a.status === 'Approved' ? 'Congratulations. Your lease is ready — review and sign it in your resident portal, where you’ll also find move-in details.' : copy.body}
                  </p>
                  {a.decidedAt && (a.status === 'Approved' || a.status === 'Denied') && <p className="mt-2 text-sm text-muted-foreground">Decision made {mediumDateTime(a.decidedAt)}</p>}
                  <div className="mt-4 flex flex-wrap gap-2 empty:hidden">
                    {isDraft && listing.published && (
                      <LinkButton to={`/homes/${listing.slug}/apply`}>
                        Continue application <ArrowRight aria-hidden />
                      </LinkButton>
                    )}
                    {isDraft && !listing.published && <Alert tone="warning" className="w-full">This home is no longer taking applications, so this draft can’t be sent.</Alert>}
                    {a.leaseReady && (
                      <LinkButton to="/resident/lease">
                        <FileSignature aria-hidden /> Review and sign your lease
                      </LinkButton>
                    )}
                    {a.status === 'Leased' && me.data?.resident && (
                      <LinkButton to="/resident">
                        <Home aria-hidden /> Go to your resident portal
                      </LinkButton>
                    )}
                    {a.status === 'Withdrawn' && listing.published && (
                      <LinkButton to={`/homes/${listing.slug}`} variant="secondary">
                        View the listing
                      </LinkButton>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-5 lg:hidden">
              <h2 className="mb-4 text-base font-semibold">Progress</h2>
              <Timeline items={a.timeline} />
            </Card>

            {!isDraft && (
              <Card as="section" className="p-5 sm:p-6" aria-labelledby="messages-heading">
                <h2 id="messages-heading" className="mb-5 text-lg font-semibold tracking-tight">
                  Messages
                </h2>
                <MessageThread applicationId={a.id} messages={a.messages} organizationName={org} canReply={a.canMessage} />
              </Card>
            )}

            {!isDraft && (
              <Card as="section" className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAnswers(s => !s)}
                  aria-expanded={showAnswers}
                  aria-controls="your-answers"
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35 sm:px-6"
                >
                  <span>
                    <span className="block text-lg font-semibold tracking-tight">What you sent</span>
                    <span className="block text-sm text-muted-foreground">
                      Your answers{a.signature ? `, signed “${a.signature}”` : ''}
                    </span>
                  </span>
                  <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', showAnswers && 'rotate-180')} aria-hidden />
                </button>
                {showAnswers && (
                  <div id="your-answers" className="border-t bg-subtle p-4 sm:p-6 animate-fade-in">
                    <ApplicationSummary form={a.form} email={a.email} errorsByStep={{}} onEdit={() => undefined} currency={currency} readOnly />
                    <p className="mt-4 text-sm text-muted-foreground">Need to change something? Send the leasing team a message above.</p>
                  </div>
                )}
              </Card>
            )}
          </div>

          <aside className="space-y-6">
            <Card className="hidden p-5 lg:block">
              <h2 className="mb-4 text-base font-semibold">Progress</h2>
              <Timeline items={a.timeline} />
            </Card>

            <Card className="overflow-hidden">
              <ListingPhoto src={listing.cover} alt="" width={640} className="aspect-[16/9]" />
              <div className="p-5">
                <p className="text-lg font-semibold tabular-nums">
                  {listing.rent != null ? money(listing.rent, currency) : '—'}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-[15px] text-foreground/85">{sizeLine(listing)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{[listing.street, listing.city].filter(Boolean).join(', ')}</p>
                {listing.published ? (
                  <>
                    <p className={cn('mt-2 text-sm', avail.now ? 'text-tone-success' : 'text-muted-foreground')}>{avail.label}</p>
                    <LinkButton to={`/homes/${listing.slug}`} variant="secondary" size="sm" className="mt-4 w-full">
                      View listing
                    </LinkButton>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No longer listed</p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold">Application fee</h2>
                <p className="font-semibold tabular-nums">{a.feeAmount > 0 ? formatMoney(a.feeAmount, currency) : 'None'}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {a.feeAmount <= 0 ? 'No fee for this home.' : a.feePaidAt ? `Paid ${shortDate(a.feePaidAt)}.` : data.collectFeeOnline && isDraft ? 'Paid by card when you submit.' : 'Due at your showing or lease signing.'}
              </p>
            </Card>

            {a.canWithdraw && (
              <div className="rounded-xl border border-dashed p-5">
                <p className="text-[15px] font-medium">{isDraft ? 'Not applying after all?' : 'Changed your plans?'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isDraft ? 'Delete this draft and its saved answers.' : 'Withdraw so the leasing team stops reviewing it. This can’t be undone, but you can apply again while the home is listed.'}
                </p>
                <Button variant="secondary" size="sm" className="mt-3 text-tone-danger hover:text-tone-danger" onClick={() => setConfirming(true)}>
                  <Trash2 aria-hidden /> {isDraft ? 'Delete draft' : 'Withdraw application'}
                </Button>
              </div>
            )}
          </aside>
        </div>
      </Container>

      <ConfirmDialog
        open={confirming}
        onOpenChange={o => {
          setConfirming(o);
          if (!o) withdraw.reset();
        }}
        title={isDraft ? 'Delete this draft?' : `Withdraw ${a.reference}?`}
        description={
          isDraft
            ? `Your saved answers for ${listing.title} will be deleted. You can start a new application any time the home is listed.`
            : `${org} will stop reviewing your application for ${listing.title} and be told you withdrew. You can’t reopen it, but you can apply again while the home is listed.`
        }
        confirmLabel={isDraft ? 'Delete draft' : 'Withdraw application'}
        tone="danger"
        pending={withdraw.isPending}
        error={withdraw.isError ? errorMessage(withdraw.error, 'That didn’t work. Try again.') : null}
        note={isDraft ? undefined : { label: 'Let them know why', placeholder: 'Found another place, plans changed…' }}
        onConfirm={reason => withdraw.mutate(reason)}
      />
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b bg-background">
        <Container className="py-6">
          <Skeleton className="h-4 w-28" />
          <div className="mt-4 flex gap-4">
            <Skeleton className="hidden h-16 w-24 rounded-lg sm:block" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-8 w-2/3 max-w-lg" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </Container>
      </div>
      <Container className="pt-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
          <div className="space-y-6">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </Container>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
