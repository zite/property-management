import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ChevronDown, ClipboardCheck, SearchX, Send } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveApplicationDraft, submitApplication } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { StepFields } from '../../components/apply/ApplySteps';
import { focusField } from '../../components/apply/fields';
import { ReviewStep } from '../../components/apply/ReviewStep';
import { SaveIndicator } from '../../components/apply/SaveIndicator';
import { StepList, type StepState } from '../../components/apply/StepList';
import { ListingPhoto } from '../../components/homes/ListingPhoto';
import { SignInPrompt } from '../../components/SignInPrompt';
import { Alert, BackLink, Button, Card, Container, EmptyState, LinkButton, ProgressBar, Skeleton, StatusPill } from '../../components/ui';
import { applicationKeys, localToday, statusCopy, useApplicationForListing, type ApplicationDetail } from '../../lib/apply';
import { readBackup, useAutosave } from '../../lib/applyAutosave';
import {
  APPLY_STEPS, CONTENT_STEPS, coerceForm, completedSteps, emptyForm, firstInvalidStep, signatureMatches, stepTouched, validateStep,
  type ApplicationForm, type Errors, type StepId,
} from '../../lib/applyRules';
import { useSession } from '../../lib/auth';
import { errorMessage, isNotFound } from '../../lib/errors';
import { mediumDateTime } from '../../lib/format';
import { availability, homesKeys, money } from '../../lib/listings';
import { qk, usePortal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

const FeePayment = lazy(() => import('../../components/apply/FeePayment'));

/**
 * The rental application: six short steps with the step in the URL (so back,
 * reload and "Fix" links all work), answers saved a second after typing
 * stops, and one draft per person per home that picks up wherever it was left.
 */
export default function ApplyPage() {
  const { slug } = useParams();
  const { user, isLoading } = useSession();
  const q = useApplicationForListing(slug);
  useDocumentTitle(q.data ? `Apply · ${q.data.listing.title}` : 'Apply');

  if (isLoading) return <ApplySkeleton />;
  if (!user) {
    return <SignInPrompt title="Sign in to apply" body="Any email address works. Your application saves as you go, so you can finish it later on any device." hashPath={`/homes/${slug}/apply`} />;
  }
  // Cached answers from an earlier visit may be out of date: wait for this visit's copy before opening the editor.
  if (q.isPending || !q.isFetchedAfterMount) return <ApplySkeleton />;
  if (q.isError || !q.data) {
    return (
      <Container size="narrow" className="py-16">
        {isNotFound(q.error) ? (
          <EmptyState icon={SearchX} title="This home isn’t taking applications" action={<LinkButton to="/homes">See available homes <ArrowRight aria-hidden /></LinkButton>}>
            It may have been rented or taken off the market.
          </EmptyState>
        ) : (
          <Alert tone="danger" title="The application didn’t load" action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}>Try again</Button>}>
            {errorMessage(q.error, 'Check your connection and try again.')}
          </Alert>
        )}
      </Container>
    );
  }

  const { application, listing } = q.data;
  if (application && application.status !== 'Draft') {
    const copy = statusCopy(application.status);
    return (
      <Container size="narrow" className="py-16">
        <EmptyState icon={ClipboardCheck} title="You’ve already applied for this home" action={<LinkButton to={`/applications/${application.id}`}>View your application <ArrowRight aria-hidden /></LinkButton>}>
          <span className="flex flex-col items-center gap-2">
            <StatusPill tone={copy.tone}>{copy.pill}</StatusPill>
            <span>
              {application.reference}
              {application.submittedAt ? ` · sent ${mediumDateTime(application.submittedAt)}` : ''}
            </span>
          </span>
        </EmptyState>
      </Container>
    );
  }
  if (!listing.published) {
    return (
      <Container size="narrow" className="py-16">
        <EmptyState
          icon={SearchX}
          title="This home is no longer taking applications"
          action={
            <>
              <LinkButton to="/homes">See available homes</LinkButton>
              {application && <LinkButton to="/applications" variant="secondary">My applications</LinkButton>}
            </>
          }
        >
          {listing.title} may have been rented or taken off the market.{application ? ' Your draft is still saved in case it comes back.' : ''}
        </EmptyState>
      </Container>
    );
  }
  if (!application && !q.data.applicationsOpen) return <ClosedState />;
  return <ApplyFlow key={application?.id ?? 'new'} data={q.data} slug={slug!} email={user.email ?? ''} />;
}

function ClosedState() {
  const portal = usePortal();
  const phone = portal.data?.settings.phone;
  return (
    <Container size="narrow" className="py-16">
      <EmptyState icon={ClipboardCheck} title="Online applications are paused" action={<LinkButton to="/homes" variant="secondary">Back to homes</LinkButton>}>
        {phone ? `Call ${phone} and the leasing team will help you apply.` : 'Contact the office and the leasing team will help you apply.'}
      </EmptyState>
    </Container>
  );
}

function ApplyFlow({ data, slug, email }: { data: ApplicationDetail; slug: string; email: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { name: sessionName } = useSession();
  const portal = usePortal();
  const settings = portal.data?.settings;
  const currency = settings?.currency ?? 'USD';
  const { listing } = data;
  const app = data.application;

  const today = localToday();
  const ctx = useMemo(() => ({ today, applicantEmail: email }), [today, email]);
  const storageKey = `resident-portal:apply:${email}:${slug}`;

  const [restored] = useState(() => {
    const b = readBackup<ApplicationForm>(storageKey, app?.lastSavedAt);
    return b ? coerceForm(b) : null;
  });
  const [initial] = useState<ApplicationForm>(() => restored ?? app?.form ?? emptyForm({ applicantName: sessionName.includes(' ') ? sessionName : '' }));
  const [form, setForm] = useState<ApplicationForm>(initial);
  const formRef = useRef(form);
  const idRef = useRef<string | null>(app?.id ?? null);
  const [appId, setAppId] = useState<string | null>(app?.id ?? null);

  const autosave = useAutosave<ApplicationForm>({
    save: async value => {
      const res = await saveApplicationDraft({ slug, id: idRef.current, form: value });
      idRef.current = res.id;
      setAppId(res.id);
      if (res.created) {
        void qc.invalidateQueries({ queryKey: applicationKeys.list });
        void qc.invalidateQueries({ queryKey: qk.me });
        void qc.invalidateQueries({ queryKey: homesKeys.detail(slug) });
      }
      return res;
    },
    storageKey,
    // Submitted in another tab, or the home was taken down: reload to show where things stand.
    onFatal: () => void qc.invalidateQueries({ queryKey: applicationKeys.forListing(slug) }),
  });

  useEffect(() => {
    if (!restored) return;
    autosave.change(restored);
    toast.success('We restored answers that hadn’t finished saving.');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Steps and where to resume.
  const stepIds = APPLY_STEPS.map(s => s.id) as StepId[];
  const [resume] = useState<StepId>(() => (app || restored ? firstInvalidStep(initial, ctx) ?? 'review' : 'about'));
  const requested = params.get('step') as StepId | null;
  const step: StepId = requested && stepIds.includes(requested) ? requested : resume;
  const index = stepIds.indexOf(step);
  const meta = APPLY_STEPS[index];

  const [visited, setVisited] = useState<Set<StepId>>(() => new Set<StepId>([...CONTENT_STEPS.filter(s => stepTouched(initial, s)), step]));
  const [attempted, setAttempted] = useState<Set<StepId>>(new Set());
  const [blocked, setBlocked] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setVisited(v => (v.has(step) ? v : new Set(v).add(step)));
  }, [step]);

  const errorsByStep = useMemo(() => Object.fromEntries(CONTENT_STEPS.map(s => [s, validateStep(form, s, ctx)])) as Record<string, Errors>, [form, ctx]);
  const errors = attempted.has(step) ? errorsByStep[step] ?? {} : {};
  const done = completedSteps(form, ctx);
  const allValid = done === CONTENT_STEPS.length;

  const states = Object.fromEntries(
    stepIds.map((s, i) => {
      if (s === step) return [s, 'current'];
      if (s === 'review') return [s, allValid || visited.has('review') ? 'todo' : 'locked'];
      const valid = Object.keys(errorsByStep[s] ?? {}).length === 0;
      if (valid && visited.has(s)) return [s, 'done'];
      if (visited.has(s) && (attempted.has(s) || stepTouched(form, s))) return [s, 'attention'];
      return [s, visited.has(s) || i <= index ? 'todo' : 'locked'];
    }),
  ) as Record<StepId, StepState>;

  const update = (patch: Partial<ApplicationForm>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    if (blocked) setBlocked(null);
    autosave.change(next);
  };

  const goTo = (id: StepId, fieldToFocus?: string) => {
    setBlocked(null);
    setStepsOpen(false);
    setParams({ step: id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (fieldToFocus) {
      setAttempted(a => new Set(a).add(id));
      window.setTimeout(() => focusField(fieldToFocus), 150);
    } else {
      window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 80);
    }
  };

  const next = () => {
    if (step === 'review') return;
    setAttempted(a => new Set(a).add(step));
    const keys = Object.keys(errorsByStep[step] ?? {});
    if (keys.length) {
      setBlocked(keys.length === 1 ? 'One answer on this step needs attention.' : `${keys.length} answers on this step need attention.`);
      focusField(keys[0]);
      return;
    }
    goTo(stepIds[index + 1]);
  };

  // Review and submit.
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState('');
  const [signErrors, setSignErrors] = useState<{ consent?: string; signature?: string }>({});
  const [leaving, setLeaving] = useState(false);

  const ready = async () => {
    const current = formRef.current;
    const invalid = firstInvalidStep(current, ctx);
    if (invalid) {
      const first = Object.keys(validateStep(current, invalid, ctx))[0];
      goTo(invalid, first);
      toast.error(`“${APPLY_STEPS.find(s => s.id === invalid)?.title}” needs another look before you can submit.`);
      return false;
    }
    const e: { consent?: string; signature?: string } = {};
    if (!consent) e.consent = 'Check the box to authorize screening.';
    if (!signatureMatches(signature, current.applicantName)) {
      e.signature = signature.trim() ? `Your signature must match your legal name exactly: ${current.applicantName.trim()}.` : 'Type your full legal name to sign.';
    }
    setSignErrors(e);
    if (e.consent || e.signature) {
      focusField(e.consent ? 'consent' : 'signature');
      return false;
    }
    try {
      if (!idRef.current) autosave.change(current);
      await autosave.flush();
    } catch (err) {
      toast.error(errorMessage(err, 'Your latest answers haven’t saved yet. Check your connection and try again.'));
      return false;
    }
    return Boolean(idRef.current);
  };

  const submit = useMutation({
    mutationFn: () => submitApplication({ id: idRef.current!, consent, signature }),
    onSuccess: res => {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      void qc.invalidateQueries({ queryKey: applicationKeys.all });
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: homesKeys.all });
      navigate(`/applications/${res.id}?submitted=1`, { replace: true });
    },
    onError: e => setBlocked(errorMessage(e, 'Your application wasn’t submitted. Try again.')),
  });

  const doSubmit = async () => {
    if (submit.isPending) return;
    setBlocked(null);
    if (await ready()) submit.mutate();
  };

  const saveAndExit = async () => {
    setLeaving(true);
    try {
      await autosave.flush();
      if (idRef.current) {
        toast.success('Saved. Pick up where you left off any time.');
        navigate('/applications');
      } else {
        navigate(`/homes/${slug}`);
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Your latest answers haven’t saved yet. Check your connection and try again.'));
    } finally {
      setLeaving(false);
    }
  };

  const fee = app?.feeAmount ?? listing.applicationFee;
  const payOnline = data.collectFeeOnline && fee > 0 && !app?.feePaidAt;
  const avail = availability(listing.availableOn);
  const isReview = step === 'review';

  const stepList = <StepList states={states} onSelect={s => goTo(s)} />;

  return (
    <div className="pb-28 sm:pb-12">
      <div className="border-b bg-background">
        <Container size="form" className="py-4 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <BackLink to={`/homes/${slug}`}>Back to the listing</BackLink>
            <SaveIndicator state={autosave.state} savedAt={autosave.savedAt} serverSavedAt={app?.lastSavedAt} onRetry={autosave.retryNow} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <ListingPhoto src={listing.cover} alt="" width={240} eager className="h-12 w-16 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">Rental application</p>
              <h1 className="truncate text-lg font-semibold sm:text-2xl">{listing.title}</h1>
            </div>
            {listing.rent != null && (
              <div className="hidden shrink-0 text-right sm:block">
                <p className="font-semibold tabular-nums">
                  {money(listing.rent, currency)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-sm text-muted-foreground">{avail.label}</p>
              </div>
            )}
          </div>
        </Container>
      </div>

      <Container size="form" className="pt-6">
        <div className="grid gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-10">
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              <div>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{done} of {CONTENT_STEPS.length} sections done</span>
                </div>
                <ProgressBar value={done / CONTENT_STEPS.length} label="Application progress" tone={allValid ? 'success' : 'primary'} />
              </div>
              <nav aria-label="Application steps">{stepList}</nav>
              <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={saveAndExit} disabled={leaving}>
                Save and finish later
              </Button>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-4 lg:hidden">
              <button
                type="button"
                onClick={() => setStepsOpen(o => !o)}
                aria-expanded={stepsOpen}
                aria-controls="mobile-steps"
                className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-2xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">
                    Step {index + 1} of {stepIds.length} · <span className="font-medium text-foreground">{meta.title}</span>
                  </p>
                  <ProgressBar value={(index + 1) / stepIds.length} className="mt-2 h-1.5" label="Step progress" />
                </div>
                <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', stepsOpen && 'rotate-180')} aria-hidden />
              </button>
              {stepsOpen && (
                <nav id="mobile-steps" aria-label="Application steps" className="mt-2 rounded-xl border bg-card p-2 animate-fade-in">
                  {stepList}
                </nav>
              )}
            </div>

            <Card className="p-5 sm:p-8">
              <p className="text-sm font-medium text-primary">
                Step {index + 1} of {stepIds.length}
              </p>
              <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight outline-none">
                {meta.title}
              </h2>
              <p className="mt-1 text-[15px] text-muted-foreground">{meta.blurb}</p>

              <form
                className="mt-7"
                noValidate
                onSubmit={e => {
                  e.preventDefault();
                  if (!isReview) next();
                  else if (!payOnline) void doSubmit();
                }}
              >
                {isReview ? (
                  <ReviewStep
                    form={form}
                    email={email}
                    errorsByStep={errorsByStep}
                    onEdit={(s, f) => goTo(s, f)}
                    currency={currency}
                    organizationName={settings?.organizationName ?? 'the property manager'}
                    fee={fee}
                    collectOnline={data.collectFeeOnline}
                    feePaidAt={app?.feePaidAt ?? null}
                    consent={consent}
                    onConsent={v => {
                      setConsent(v);
                      if (v) setSignErrors(s => ({ ...s, consent: undefined }));
                    }}
                    signature={signature}
                    onSignature={v => {
                      setSignature(v);
                      if (signErrors.signature) setSignErrors(s => ({ ...s, signature: undefined }));
                    }}
                    signErrors={signErrors}
                  >
                    {payOnline &&
                      (appId ? (
                        <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
                          <FeePayment applicationId={appId} amount={fee} currency={currency} beforePay={ready} onPaid={async () => void (await submit.mutateAsync())} submitting={submit.isPending} />
                        </Suspense>
                      ) : (
                        <Skeleton className="h-40 w-full rounded-lg" />
                      ))}
                  </ReviewStep>
                ) : (
                  <div key={step} className="animate-fade-in">
                    <StepFields step={step} form={form} errors={errors} update={update} email={email} today={today} rent={listing.rent} incomeMultiple={data.incomeMultiple} currency={currency} />
                  </div>
                )}

                {blocked && (
                  <Alert tone="danger" className="mt-7">
                    {blocked}
                  </Alert>
                )}

                <div className="no-print fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur sm:static sm:mt-10 sm:border-t sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-6 sm:shadow-none sm:backdrop-blur-none">
                  {index > 0 ? (
                    <Button variant="secondary" size="lg" onClick={() => goTo(stepIds[index - 1])} className="px-4">
                      <ArrowLeft aria-hidden /> Back
                    </Button>
                  ) : (
                    <Button variant="ghost" size="lg" onClick={saveAndExit} disabled={leaving} className="px-3 text-muted-foreground lg:hidden">
                      Finish later
                    </Button>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    {index > 0 && (
                      <Button variant="ghost" size="lg" className="hidden text-muted-foreground sm:inline-flex lg:hidden" onClick={saveAndExit} disabled={leaving}>
                        Finish later
                      </Button>
                    )}
                    {!isReview ? (
                      <Button type="submit" size="lg" className="min-w-[9rem]">
                        {step === 'references' ? 'Review' : 'Continue'} <ArrowRight aria-hidden />
                      </Button>
                    ) : !payOnline ? (
                      <Button type="submit" size="lg" loading={submit.isPending} className="min-w-[11rem]">
                        <Send aria-hidden /> Submit application
                      </Button>
                    ) : null}
                  </div>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </Container>
    </div>
  );
}

function ApplySkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b bg-background">
        <Container size="form" className="py-5">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 flex items-center gap-3">
            <Skeleton className="h-12 w-16 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-6 w-2/3 max-w-md" />
            </div>
          </div>
        </Container>
      </div>
      <Container size="form" className="pt-6">
        <div className="grid gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-10">
          <div className="hidden space-y-2 lg:block">
            <Skeleton className="h-2 w-full" />
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
          <Card className="space-y-5 p-5 sm:p-8">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-48" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            ))}
          </Card>
        </div>
      </Container>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
