import { useMutation } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck, CheckCircle2, ChevronDown, Circle, ClipboardCheck, Download, FileSignature, KeyRound, PartyPopper, PenLine, Receipt, Sparkles, Truck, Users } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { acknowledgeInspection, respondToRenewal, signLease, submitNotice } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Facts, LoadError, Panel, ResidentSkeleton } from '../../components/resident/bits';
import { InspectionReport } from '../../components/resident/InspectionReport';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Alert, Button, Card, Container, FieldRow, inputClass, LinkButton, StatusPill, textareaClass } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatMoney, longDate, mediumDateTime, shortDate } from '../../lib/format';
import { usePortal } from '../../lib/queries';
import { daysUntil, leasePhase, ordinal, relativeDays } from '../../lib/residentFormat';
import { useReturnFocus } from '../../lib/residentFocus';
import { useResidentLease } from '../../lib/residentLease';
import { useRefreshResident, useResidentLeaseDetail, type ResidentLeaseDetail } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The resident's lease and everything that changes it: signing, a renewal
 * offer, notice to vacate, and inspection reports to acknowledge. What needs
 * an answer sits at the top; the reference material follows.
 */
export default function LeasePage() {
  useDocumentTitle('Lease');
  const { leaseId } = useResidentLease();
  const q = useResidentLeaseDetail(leaseId);
  const location = useLocation();

  // Links from home land on a section (#renewal, #notice, #inspections).
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    const target = location.hash.replace('#', '');
    if (!q.data || !target || scrolled.current === target) return;
    scrolled.current = target;
    requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    const t = setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }), 120);
    return () => clearTimeout(t);
  }, [location.hash, q.data]);

  if (q.isPending) return <ResidentSkeleton variant="document" />;
  if (q.isError || !q.data || !leaseId) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your lease" />;
  return <LeaseView d={q.data} leaseId={leaseId} />;
}

function LeaseView({ d, leaseId }: { d: ResidentLeaseDetail; leaseId: string }) {
  const portal = usePortal();
  const currency = portal.data?.settings.currency ?? 'USD';
  const m = (n: number) => formatMoney(n, currency);
  const l = d.lease;
  const phase = leasePhase(l.phase);
  const recentlyRenewed = l.renewalStatus === 'Accepted' && l.renewalRespondedAt && Date.now() - Date.parse(l.renewalRespondedAt) < 45 * 86_400_000;

  return (
    <div className="animate-fade-in">
      <ResidentHeader
        title="Your lease"
        subtitle={<LeaseSwitcher />}
        actions={
          <span className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{l.ref}</span>
            <StatusPill tone={phase.tone}>{phase.label}</StatusPill>
          </span>
        }
      />
      <Container className="space-y-5 pb-4 pt-4">
        {d.signing && <SigningPanel d={d} leaseId={leaseId} currency={currency} />}
        {d.renewal && <RenewalPanel d={d} leaseId={leaseId} currency={currency} />}
        {recentlyRenewed && (
          <Alert tone="success" icon={PartyPopper} title="You renewed your lease">
            It now runs through {longDate(l.endDate)} at {m(l.rent)} a month. Thanks for staying with us.
          </Alert>
        )}
        {l.status === 'Active' && d.notice.moveOutDate && <NoticeSummary d={d} />}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <Panel title="Lease details" icon={KeyRound}>
              <p className="text-[15px] font-medium">{l.home}</p>
              {l.address && <p className="text-sm text-muted-foreground">{l.address}</p>}
              <Facts
                className="mt-4"
                items={[
                  { label: 'Term', value: l.startDate ? `${longDate(l.startDate)} – ${l.endDate ? longDate(l.endDate) : 'ongoing'}` : '—', hint: l.leaseType === 'Month-to-month' || l.phase === 'Month-to-month' ? 'Continues month to month' : l.endDate && l.status === 'Active' ? `Ends ${relativeDays(l.endDate)}` : null },
                  { label: 'Monthly rent', value: m(l.rent), hint: `Due on the ${ordinal(l.rentDueDay)} of each month` },
                  { label: 'Security deposit', value: m(l.deposit), hint: l.depositHeld > 0 ? `${m(l.depositHeld)} held until you move out` : l.status === 'Pending signature' ? 'Charged when the lease starts' : null },
                  l.moveInDate ? { label: 'Move-in', value: longDate(l.moveInDate) } : null,
                ]}
              />
            </Panel>

            <Panel title="Monthly charges" icon={Receipt} bodyClassName="p-0 sm:p-0">
              {d.charges.length === 0 ? (
                <p className="px-4 py-4 text-[15px] text-muted-foreground sm:px-5">No recurring charges on this lease.</p>
              ) : (
                <>
                  <ul className="divide-y">
                    {d.charges.map(c => (
                      <li key={c.id} className="flex items-baseline justify-between gap-3 px-4 py-3 sm:px-5">
                        <span className="min-w-0">
                          <span className="block break-words text-[15px] font-medium">{c.description}</span>
                          <span className="block text-sm text-muted-foreground">
                            {c.frequency === 'Monthly' ? `Monthly on the ${ordinal(c.dayOfMonth)}` : `${c.frequency} on the ${ordinal(c.dayOfMonth)}`}
                            {c.upcoming && c.startDate ? ` · starts ${shortDate(c.startDate)}` : ''}
                            {c.endDate ? ` · through ${shortDate(c.endDate)}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-[15px] font-medium tabular-nums">{m(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  {d.charges.filter(c => !c.upcoming && c.frequency === 'Monthly').length > 1 && (
                    <div className="flex justify-between gap-3 border-t bg-subtle px-4 py-2.5 text-[15px] font-medium sm:px-5">
                      <span>Total each month</span>
                      <span className="tabular-nums">{m(d.charges.filter(c => !c.upcoming && c.frequency === 'Monthly').reduce((a, c) => a + Math.round(c.amount * 100), 0) / 100)}</span>
                    </div>
                  )}
                </>
              )}
            </Panel>

            {!d.signing?.canSign && <LeaseDocument d={d} />}

            <section id="inspections" className="scroll-mt-24">
              <Panel title="Inspections" icon={ClipboardCheck}>
                {d.inspections.length === 0 ? (
                  <p className="text-[15px] text-muted-foreground">When the office inspects your home — at move-in, move-out or a routine visit — the report will be shared here.</p>
                ) : (
                  <InspectionList d={d} leaseId={leaseId} />
                )}
              </Panel>
            </section>
          </div>

          <aside className="min-w-0 space-y-5">
            <Panel title="On this lease" icon={Users}>
              <ul className="space-y-3">
                {d.household.map((h, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-semibold text-foreground/70" aria-hidden>
                      {h.name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {h.name}
                        {h.isMe && <span className="ml-1.5 text-sm font-normal text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{h.role === 'Primary' ? 'Primary resident' : h.role}</p>
                    </div>
                    {h.signer && (h.signedAt ? <CheckCircle2 className="h-4 w-4 shrink-0 text-tone-success" aria-label={`Signed ${shortDate(h.signedAt.slice(0, 10))}`} /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not signed yet" />)}
                  </li>
                ))}
              </ul>
              {(l.signedAt || l.countersignedAt) && (
                <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">
                  {l.signedAt && <>Signed by residents {shortDate(l.signedAt.slice(0, 10))}. </>}
                  {l.countersignedAt ? <>Countersigned {shortDate(l.countersignedAt.slice(0, 10))}.</> : l.status === 'Pending signature' && l.signedAt ? 'Waiting for the office to countersign.' : null}
                </p>
              )}
            </Panel>

            <section id="notice" className="scroll-mt-24">
              <NoticeCard d={d} leaseId={leaseId} />
            </section>
          </aside>
        </div>
      </Container>
    </div>
  );
}

// ── Lease document ───────────────────────────────────────────────────────────

function Terms({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn('prose prose-ks max-w-none text-[15px] prose-headings:tracking-tight prose-h1:mt-0 prose-h1:text-2xl [&>*:first-child]:mt-0 prose-h2:mt-6 prose-h2:text-lg prose-p:leading-relaxed', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function LeaseDocument({ d }: { d: ResidentLeaseDetail }) {
  const [open, setOpen] = useState(false);
  const l = d.lease;
  if (!l.terms && !l.documentUrl) return null;
  return (
    <Panel
      title="Lease agreement"
      icon={FileSignature}
      action={
        l.documentUrl ? (
          <a href={l.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-primary hover:underline">
            <Download className="h-4 w-4" aria-hidden /> {l.countersignedAt ? 'Signed PDF' : 'PDF'}
          </a>
        ) : null
      }
    >
      {l.terms ? (
        <>
          <div className={cn('relative', !open && 'max-h-[260px] overflow-hidden')}>
            <Terms markdown={l.terms} />
            {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent" aria-hidden />}
          </div>
          <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => setOpen(o => !o)} aria-expanded={open}>
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden /> {open ? 'Show less' : 'Read the full lease'}
          </Button>
        </>
      ) : (
        <p className="text-[15px] text-muted-foreground">Your signed lease is available as a PDF.</p>
      )}
    </Panel>
  );
}

// ── Signing ──────────────────────────────────────────────────────────────────

function SigningPanel({ d, leaseId, currency }: { d: ResidentLeaseDetail; leaseId: string; currency: string }) {
  const s = d.signing!;
  const refresh = useRefreshResident();
  const id = useId();
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const me = d.household.find(h => h.isMe);
  const signers = d.household.filter(h => h.signer);

  const sign = useMutation({
    mutationFn: () => signLease({ leaseId, typedName: name.trim(), consent: true }),
    onSuccess: res => {
      toast.success(res.allSigned ? 'Signed. Everyone has signed — the office will countersign next.' : 'Signed. We’ll let you know when everyone else has signed.');
      void refresh();
    },
    onError: e => setProblem(errorMessage(e, "Your signature wasn't saved. Try again.")),
  });

  const nameMismatch = name.trim().length > 1 && me && !me.name.toLowerCase().split(/\s+/).some(part => part.length > 1 && name.toLowerCase().includes(part));

  return (
    <Card as="section" className="overflow-hidden border-tone-accent/30" aria-labelledby={`${id}-h`}>
      <div className="border-b bg-tone-accent/[0.05] px-4 py-4 sm:px-6">
        <h2 id={`${id}-h`} className="flex items-center gap-2 text-lg font-semibold">
          <PenLine className="h-5 w-5 text-tone-accent" aria-hidden />
          {s.canSign ? 'Review and sign your lease' : s.allSigned ? 'Everyone has signed' : 'You’ve signed your lease'}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {signers.map((h, i) => (
            <li key={i} className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-sm', h.signedAt ? 'border-tone-success/30' : '')}>
              {h.signedAt ? <CheckCircle2 className="h-4 w-4 text-tone-success" aria-hidden /> : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />}
              <span className="font-medium">{h.isMe ? 'You' : h.name}</span>
              <span className="text-muted-foreground">{h.signedAt ? `signed ${shortDate(h.signedAt.slice(0, 10))}` : 'not yet'}</span>
            </li>
          ))}
        </ul>
      </div>

      {s.canSign ? (
        <div className="px-4 py-5 sm:px-6">
          <p className="text-[15px] text-muted-foreground">Please read the whole agreement. It starts {longDate(d.lease.startDate)} at {formatMoney(d.lease.rent, currency)} a month.</p>
          <div className="mt-4 max-h-[min(60vh,560px)] overflow-y-auto rounded-xl border bg-background px-4 py-4 sm:px-6" tabIndex={0} aria-label="Lease agreement">
            {d.lease.terms ? <Terms markdown={d.lease.terms} /> : <p className="text-[15px] text-muted-foreground">The office hasn’t attached the lease text. {d.lease.documentUrl ? 'Open the PDF to read it before signing.' : 'Message them before signing.'}</p>}
          </div>
          {d.lease.documentUrl && (
            <a href={d.lease.documentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <Download className="h-4 w-4" aria-hidden /> Download the PDF
            </a>
          )}

          <form
            className="mt-5 space-y-4"
            onSubmit={e => {
              e.preventDefault();
              if (!consent) return setProblem('Check the box to agree to sign electronically.');
              if (name.trim().length < 2) return setProblem('Type your full name to sign.');
              setProblem(null);
              sign.mutate();
            }}
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-[15px]">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 rounded accent-[hsl(var(--primary))]" />
              <span>I’ve read this lease and agree to its terms. I agree to sign electronically, and that my typed name below is my legal signature.</span>
            </label>
            <FieldRow id={`${id}-name`} label="Type your full name" hint={me ? `As it appears on the lease: ${me.name}` : undefined}>
              <input id={`${id}-name`} value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" className={inputClass('font-serif text-lg italic')} placeholder={me?.name} />
            </FieldRow>
            {nameMismatch && <p className="text-sm text-tone-warning">That doesn’t look like the name on the lease. Double-check before signing.</p>}
            {problem && <p role="alert" className="text-sm text-tone-danger">{problem}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="submit" size="lg" loading={sign.isPending} disabled={!consent || name.trim().length < 2} className="sm:min-w-[180px]">
                {!sign.isPending && <PenLine aria-hidden />} Sign lease
              </Button>
              <p className="text-sm text-muted-foreground">Signed {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          </form>
        </div>
      ) : (
        <div className="px-4 py-4 sm:px-6">
          <p className="text-[15px]">
            {s.mySignature ? (
              <>
                You signed as <span className="font-serif italic">“{s.mySignature.name}”</span> on {mediumDateTime(s.mySignature.signedAt)}.{' '}
              </>
            ) : null}
            {s.allSigned ? 'The office will countersign and your lease becomes active. We’ll send you a copy.' : `Waiting on ${signers.filter(h => !h.signedAt).map(h => h.name).join(' and ')} to sign.`}
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Renewal ──────────────────────────────────────────────────────────────────

function RenewalPanel({ d, leaseId, currency }: { d: ResidentLeaseDetail; leaseId: string; currency: string }) {
  const r = d.renewal!;
  const refresh = useRefreshResident();
  const [dialog, setDialog] = useState<'accept' | 'decline' | null>(null);
  useReturnFocus(dialog !== null);
  const m = (n: number) => formatMoney(n, currency);
  const change = Math.round((r.rent - r.currentRent) * 100) / 100;
  const pct = r.currentRent > 0 ? (change / r.currentRent) * 100 : 0;
  const left = daysUntil(r.expiresOn);

  const respond = useMutation({
    mutationFn: (v: { decision: 'accept' | 'decline'; note: string }) => respondToRenewal({ leaseId, decision: v.decision, note: v.note }),
    onSuccess: res => {
      setDialog(null);
      toast.success(res.decision === 'accept' ? 'Renewal accepted. Your lease has been extended.' : 'Thanks for letting us know. The office has been told.');
      void refresh();
    },
  });

  return (
    <section id="renewal" className="scroll-mt-24">
      <Card className="overflow-hidden border-primary/30">
        <div className="px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-primary" aria-hidden /> We’d love for you to stay
              </h2>
              <p className="mt-0.5 text-[15px] text-muted-foreground">Here’s your renewal offer for {d.lease.home}.</p>
            </div>
            {r.expiresOn && <StatusPill tone={r.expired ? 'danger' : left != null && left <= 7 ? 'warning' : 'info'}>{r.expired ? 'Offer expired' : `Respond by ${shortDate(r.expiresOn)}`}</StatusPill>}
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted/60 p-4">
              <dt className="text-sm text-muted-foreground">New monthly rent</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{m(r.rent)}</dd>
              <dd className="text-sm text-muted-foreground">{change === 0 ? 'Same as now' : `${change > 0 ? '+' : '−'}${m(Math.abs(change))} (${Math.abs(pct).toFixed(1)}%) from ${m(r.currentRent)}`}</dd>
            </div>
            <div className="rounded-xl bg-muted/60 p-4">
              <dt className="text-sm text-muted-foreground">Term</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight">{r.termMonths} months</dd>
              <dd className="text-sm text-muted-foreground">
                {shortDate(r.newStart)} – {shortDate(r.newEnd)}
              </dd>
            </div>
            <div className="rounded-xl bg-muted/60 p-4">
              <dt className="text-sm text-muted-foreground">Please respond by</dt>
              <dd className="mt-0.5 text-2xl font-semibold tracking-tight">{r.expiresOn ? shortDate(r.expiresOn) : '—'}</dd>
              <dd className="text-sm text-muted-foreground">{r.expiresOn ? (r.expired ? 'This offer has expired' : relativeDays(r.expiresOn).replace(/^in /, '').replace(/^today$/, 'Today').replace(/^tomorrow$/, 'Tomorrow') + (left != null && left > 1 ? ' left' : '')) : 'No deadline set'}</dd>
            </div>
          </dl>
          {r.expired ? (
            <Alert tone="warning" className="mt-4" title="This offer has expired">
              Message the office if you’d still like to renew — they can send a new offer.
            </Alert>
          ) : (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button size="lg" onClick={() => setDialog('accept')} className="sm:min-w-[180px]">
                Accept renewal <ArrowRight aria-hidden />
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setDialog('decline')}>
                No thanks
              </Button>
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={dialog === 'accept'}
        onOpenChange={o => {
          if (!o) {
            setDialog(null);
            respond.reset();
          }
        }}
        title="Accept this renewal?"
        description={
          <p>
            You’re agreeing to stay at <span className="font-medium text-foreground">{d.lease.home}</span> for {r.termMonths} more months, from {longDate(r.newStart)} to {longDate(r.newEnd)}, at <span className="font-medium text-foreground">{m(r.rent)}</span> a month. Your deposit and everything else on your lease stay the same.
          </p>
        }
        confirmLabel="Accept renewal"
        pending={respond.isPending}
        error={respond.isError ? errorMessage(respond.error, "Your answer wasn't saved. Try again.") : null}
        note={{ label: 'A note for the office', placeholder: 'Anything you’d like them to know' }}
        onConfirm={note => respond.mutate({ decision: 'accept', note })}
      />
      <ConfirmDialog
        open={dialog === 'decline'}
        onOpenChange={o => {
          if (!o) {
            setDialog(null);
            respond.reset();
          }
        }}
        title="Decline this renewal?"
        description={
          <p>
            The office will plan for your lease to end on <span className="font-medium text-foreground">{longDate(d.lease.endDate)}</span>. You can still give notice with your exact move-out date below. If you change your mind later, you’ll need to ask for a new offer.
          </p>
        }
        confirmLabel="Decline renewal"
        tone="danger"
        pending={respond.isPending}
        error={respond.isError ? errorMessage(respond.error, "Your answer wasn't saved. Try again.") : null}
        note={{ label: 'Would you tell us why?', placeholder: 'For example, we bought a home, or the rent increase is too much.' }}
        onConfirm={note => respond.mutate({ decision: 'decline', note })}
      />
    </section>
  );
}

// ── Notice to vacate ────────────────────────────────────────────────────────

function NoticeSummary({ d }: { d: ResidentLeaseDetail }) {
  const n = d.notice;
  const left = daysUntil(n.moveOutDate);
  return (
    <Card className="border-tone-warning/30 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tone-warning/10 text-tone-warning">
          <Truck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">
            You’re moving out {longDate(n.moveOutDate)}
            {left != null && left >= 0 && <span className="ml-2 text-[15px] font-normal text-muted-foreground">({left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} away`})</span>}
          </h2>
          <p className="mt-0.5 text-[15px] text-muted-foreground">{n.noticeGivenOn ? `Notice given ${longDate(n.noticeGivenOn)}.` : 'Your move-out date is set.'} Here’s what happens next:</p>
          <NextSteps forwarding="" missingAddress={!n.forwardingAddress} />
          {(n.reason || n.forwardingAddress) && (
            <dl className="mt-4 grid gap-3 rounded-lg bg-muted/50 px-3.5 py-3 text-[15px] sm:grid-cols-2">
              {n.reason && (
                <div>
                  <dt className="text-sm text-muted-foreground">Reason</dt>
                  <dd className="break-words">{n.reason}</dd>
                </div>
              )}
              {n.forwardingAddress && (
                <div>
                  <dt className="text-sm text-muted-foreground">Forwarding address</dt>
                  <dd className="whitespace-pre-line break-words">{n.forwardingAddress}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <LinkButton to="/resident/messages" variant="secondary">
              Message the office
            </LinkButton>
            <span className="text-sm text-muted-foreground">Need a different date? Let the office know.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function NextSteps({ forwarding, missingAddress }: { forwarding: string; missingAddress?: boolean }) {
  return (
    <ol className="mt-3 space-y-2.5 text-[15px]">
      {[
        { icon: CalendarCheck, text: 'We’ll schedule a move-out inspection with you, usually on or just after your last day.' },
        { icon: KeyRound, text: 'Return every key, fob and garage opener to the office by your move-out date.' },
        { icon: Sparkles, text: 'Leave the home clean and as you found it — normal wear and tear is fine.' },
        { icon: Receipt, text: `We’ll send your deposit and an itemized statement${forwarding ? ` to ${forwarding.replace(/\s*\n\s*/g, ', ')}` : ' to your forwarding address'} within the time the law requires.${missingAddress ? ' Message the office with your new address so it reaches you.' : ''}` },
      ].map((s, i) => (
        <li key={i} className="flex gap-3">
          <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-words">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function NoticeCard({ d, leaseId }: { d: ResidentLeaseDetail; leaseId: string }) {
  const [open, setOpen] = useState(false);
  const n = d.notice;
  if (d.lease.status !== 'Active') return null;
  const content = n.canGive ? (
    <Panel title="Moving out?" icon={Truck}>
      <p className="text-[15px] text-muted-foreground">
        Give written notice here. {d.lease.endDate ? `Your lease runs through ${longDate(d.lease.endDate)}` : 'Your lease is month to month'}; most leases ask for at least {n.minimumDays} days’ notice.
      </p>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setOpen(true)}>
        Give notice to move out
      </Button>
    </Panel>
  ) : null;
  // The dialog keeps its place in the tree, so its confirmation survives the page refreshing behind it.
  return (
    <>
      {content}
      <NoticeDialog open={open} onOpenChange={setOpen} d={d} leaseId={leaseId} />
    </>
  );
}

const REASONS = ['Buying a home', 'Moving for work or school', 'Need a bigger place', 'Need a smaller place', 'Cost', 'Moving in with someone', 'Other'];

const localToday = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

function NoticeDialog({ open, onOpenChange, d, leaseId }: { open: boolean; onOpenChange: (o: boolean) => void; d: ResidentLeaseDetail; leaseId: string }) {
  const id = useId();
  const refresh = useRefreshResident();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [address, setAddress] = useState('');
  const [confirm, setConfirm] = useState(false);
  useReturnFocus(open);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => submitNotice({ leaseId, moveOutDate: date, reason: reason === 'Other' ? other.trim() || 'Other' : reason, forwardingAddress: address.trim() }),
    onSuccess: () => void refresh(),
    onError: e => setProblem(errorMessage(e, "Your notice wasn't sent. Try again.")),
  });

  useEffect(() => {
    if (open) {
      setProblem(null);
      setConfirm(false);
      if (!submit.isSuccess) submit.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const days = date ? daysUntil(date) : null;
  const beforeEnd = Boolean(date && d.lease.endDate && date < d.lease.endDate);

  return (
    <Dialog open={open} onOpenChange={o => !submit.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-lg gap-0 overflow-y-auto rounded-2xl p-5 sm:p-6">
        {submit.isSuccess ? (
          <div>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-tone-success/10 text-tone-success animate-pop">
              <CheckCircle2 className="h-7 w-7" aria-hidden />
            </span>
            <DialogTitle className="mt-4 text-xl font-semibold">We’ve received your notice</DialogTitle>
            <DialogDescription className="mt-1 text-[15px] text-muted-foreground">
              Your move-out date is {longDate(submit.data.moveOutDate)}. The office has been told and will be in touch.
            </DialogDescription>
            <NextSteps forwarding={address} />
            <Button className="mt-6 w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={e => {
              e.preventDefault();
              if (!date) return setProblem('Choose your move-out date.');
              if (date < localToday()) return setProblem('Choose a date from today onward.');
              if (!confirm) return setProblem('Confirm that you’re giving notice.');
              setProblem(null);
              submit.mutate();
            }}
          >
            <DialogTitle className="text-xl font-semibold">Give notice to move out</DialogTitle>
            <DialogDescription className="mt-1 text-[15px] text-muted-foreground">This is your official written notice to {d.organizationName}.</DialogDescription>
            <div className="mt-5 space-y-4">
              <FieldRow id={`${id}-date`} label="Move-out date" hint="The day you’ll hand back the keys.">
                <input id={`${id}-date`} type="date" min={localToday()} value={date} onChange={e => setDate(e.target.value)} className={inputClass()} />
              </FieldRow>
              {days != null && days >= 0 && days < d.notice.minimumDays && (
                <Alert tone="warning">That’s {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} away`} — less than the {d.notice.minimumDays} days’ notice most leases require. You may be responsible for rent for the full notice period.</Alert>
              )}
              {beforeEnd && (
                <Alert tone="info">Your lease runs through {longDate(d.lease.endDate)}. Moving out earlier may mean you owe rent until then or until the home is re-rented — check your lease or ask the office.</Alert>
              )}
              <FieldRow id={`${id}-reason`} label="Reason for moving" optional>
                <select id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} className={inputClass()}>
                  <option value="">Prefer not to say</option>
                  {REASONS.map(r => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </FieldRow>
              {reason === 'Other' && <input value={other} onChange={e => setOther(e.target.value)} maxLength={200} placeholder="Tell us a little more" aria-label="Other reason" className={inputClass()} />}
              <FieldRow id={`${id}-address`} label="Forwarding address" hint="Where we’ll send your deposit and statement." optional>
                <textarea id={`${id}-address`} value={address} onChange={e => setAddress(e.target.value)} maxLength={500} className={textareaClass('min-h-[80px]')} placeholder={'Street\nCity, State ZIP'} />
              </FieldRow>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-[15px]">
                <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 rounded accent-[hsl(var(--primary))]" />
                <span>I’m giving notice that {d.household.filter(h => h.role !== 'Guarantor').length > 1 ? 'our household is' : 'I’m'} moving out{date ? ` on ${longDate(date)}` : ''}. I understand this can’t be undone online.</span>
              </label>
              {problem && <p role="alert" className="text-sm text-tone-danger">{problem}</p>}
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={submit.isPending} disabled={!date || !confirm}>
                Give notice
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Inspections ─────────────────────────────────────────────────────────────

function InspectionList({ d, leaseId }: { d: ResidentLeaseDetail; leaseId: string }) {
  const refresh = useRefreshResident();
  const [pending, setPending] = useState<string | null>(null);
  const ack = useMutation({
    mutationFn: (inspectionId: string) => acknowledgeInspection({ leaseId, inspectionId }),
    onMutate: id => setPending(id),
    onSuccess: () => {
      toast.success('Thanks — the office can see you’ve reviewed the report.');
      void refresh();
    },
    onError: e => toast.error(errorMessage(e, "That didn't save. Try again.")),
    onSettled: () => setPending(null),
  });
  return (
    <div className="space-y-3">
      {d.inspections.map(i => (
        <InspectionReport key={i.id} inspection={i} onAcknowledge={() => ack.mutate(i.id)} acknowledging={pending === i.id} />
      ))}
    </div>
  );
}
