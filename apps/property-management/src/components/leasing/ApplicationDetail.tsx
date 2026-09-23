import { useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarDays, CircleCheck, ExternalLink, FileSignature, Inbox, KeyRound, Lock, Mail, MessageSquare, Phone, TriangleAlert, Undo2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { addApplicationMessage } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { applicationRef, leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dateTime, fullDate, shortDate, telHref, timeAgo } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { DocumentsPanel } from '../detail/DocumentsPanel';
import { Composer, Timeline, type ComposerMode } from '../detail/Timeline';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { Facts, Money } from '../primitives/data';
import { ApplicationStatusGlyph, PropertySwatch } from '../primitives/glyphs';
import { ApplicationPicker, MoveInPicker, type ApplicationPickerKind } from './ApplicationPicker';
import { ApplicationStatusPill, IncomeRatio, ListingStatusPill, ScreeningMeter } from './bits';
import { lk, useApplicationActions, type ApplicationDetail } from './data';
import { leaseDefaultsFor, type DecisionKind } from './DecisionDialog';
import { incomeRatio, incomeTone } from './rules';
import { ScreeningChecklist } from './ScreeningChecklist';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

const months = (n: number | null) => {
  if (n == null) return null;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y ? `${y} ${y === 1 ? 'year' : 'years'}` : '', m ? `${m} ${m === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(', ') || 'Less than a month';
};

const answer = (v: string | null | undefined) => (v && v.trim() ? v : null);

function Banner({ tone, icon, title, children, action }: { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'accent'; icon: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const cls = {
    success: 'border-tone-success/30 bg-tone-success/[0.06] [&>svg]:text-tone-success',
    danger: 'border-tone-danger/25 bg-tone-danger/[0.05] [&>svg]:text-tone-danger',
    warning: 'border-tone-warning/30 bg-tone-warning/[0.06] [&>svg]:text-tone-warning',
    accent: 'border-tone-accent/30 bg-tone-accent/[0.06] [&>svg]:text-tone-accent',
    neutral: 'bg-subtle/60 [&>svg]:text-muted-foreground',
  }[tone];
  return (
    <div className={cn('mt-5 flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 [&>svg]:mt-0.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0', cls)}>
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        {children && <div className="mt-0.5 text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}

function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="num mt-0.5 truncate text-[17px] font-semibold leading-6">{children}</div>
      {hint && <div className="truncate text-sm text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** The decision banners, the unit conflict warning, and what the applicant told us. */
export function ApplicationMain({ detail, onDecide }: { detail: ApplicationDetail; onDecide: (kind: DecisionKind) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const actions = useAppActions();
  const { update } = useApplicationActions();
  const a = detail.application;
  const decider = a.decidedById ? ws.memberName(a.decidedById) : null;
  const ratio = incomeRatio(a.householdIncome, a.rent);
  const multiple = detail.incomeMultiple || 3;
  const tone = incomeTone(ratio, multiple);
  const openOthers = detail.others.filter(o => ['Submitted', 'Screening', 'Approved'].includes(o.status));
  const decidedOther = detail.others.find(o => o.status === 'Approved' || o.status === 'Leased');
  const undecided = a.status === 'Submitted' || a.status === 'Screening';
  const markedRead = useRef(false);

  useEffect(() => {
    if (detail.unread > 0 && !markedRead.current) {
      markedRead.current = true;
      void addApplicationMessage({ mode: 'read', applicationId: a.id }).then(() => invalidate(qc, 'bootstrap', 'inbox', 'messages')).catch(() => undefined);
    }
  }, [a.id, detail.unread]);

  const modes: ComposerMode[] = [
    { value: 'note', label: 'Internal note', icon: <Lock />, placeholder: 'Add a note for your team…' },
    ...(a.email && ws.can('communications.send') ? [{ value: 'applicant', label: `Message ${a.applicantName.split(' ')[0]}`, icon: <UserRound />, placeholder: `Write to ${a.applicantName}…`, hint: 'Emailed, and shown on their application page in the portal.' }] : []),
  ];
  const send = async ({ mode, body }: { mode: string; body: string }) => {
    try {
      const res = await addApplicationMessage(mode === 'note' ? { mode: 'note', applicationId: a.id, body } : { mode: 'applicant', applicationId: a.id, body });
      await qc.invalidateQueries({ queryKey: lk.applicationDetail(a.number ?? 0) });
      invalidate(qc, 'messages', 'inbox');
      if (mode !== 'note') {
        if (res.delivery === 'Failed') toast.error(`The email to ${a.email} couldn’t be delivered`, { description: 'It’s still on their application page in the portal.' });
        else toast.success('Message sent');
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send'));
      throw e;
    }
  };

  return (
    <div>
      <h1 className="break-words text-[22px] font-semibold leading-8 tracking-tight">{a.applicantName}</h1>
      <p className="mt-1 text-[14px] text-muted-foreground">
        {applicationRef(a.number)}
        {detail.listing ? <> · applied for <Link to={`/listings/${detail.listing.id}`} className="text-foreground/85 hover:underline">{detail.listing.title}</Link></> : a.unitId ? <> · {ws.unitLabel(a.unitId, a.propertyId)}</> : null}
        {a.submittedAt && <> · <Tip label={dateTime(a.submittedAt)}><span>submitted {timeAgo(a.submittedAt)}</span></Tip></>}
        {a.coApplicants.length > 0 && <> · with {a.coApplicants.map(c => c.name || c.email).join(', ')}</>}
      </p>

      {a.status === 'Approved' && (
        <Banner
          tone="success"
          icon={<CircleCheck />}
          title={<>Approved{decider ? ` by ${decider}` : ''}{a.decidedAt ? ` · ${shortDate(a.decidedAt)}` : ''}</>}
          action={
            detail.lease ? (
              <Link to={`/leases/${detail.lease.id}`} className="ghost-chip h-8 bg-background"><KeyRound className="h-3.5 w-3.5" /> {leaseRef(detail.lease.number)} · {detail.lease.status}</Link>
            ) : ws.can('residents.manage') ? (
              <button type="button" className="ghost-chip h-8 bg-background" onClick={() => actions.openCreate('lease', leaseDefaultsFor(a))}><FileSignature className="h-3.5 w-3.5" /> Create lease</button>
            ) : undefined
          }
        >
          {a.decisionReason && a.decisionReason !== 'Approved' ? a.decisionReason : detail.lease ? 'The lease has been created.' : 'Next: create the lease and send it for signature.'}
        </Banner>
      )}
      {a.status === 'Leased' && (
        <Banner tone="accent" icon={<KeyRound />} title={<>Leased{detail.lease ? <> → <Link to={`/leases/${detail.lease.id}`} className="hover:underline">{leaseRef(detail.lease.number)}</Link></> : null}</>}>
          {detail.lease ? `${detail.lease.name}${detail.lease.startDate ? ` · starts ${fullDate(detail.lease.startDate)}` : ''}` : 'A lease was signed from this application.'}
        </Banner>
      )}
      {a.status === 'Denied' && (
        <Banner tone="danger" icon={<Ban />} title={<>Denied{decider ? ` by ${decider}` : ''}{a.decidedAt ? ` · ${shortDate(a.decidedAt)}` : ''}</>} action={<button type="button" className="ghost-chip h-8 bg-background" onClick={() => onDecide('reopen')}>Reopen</button>}>
          <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> {a.decisionReason || 'No reason recorded.'}</span>
        </Banner>
      )}
      {a.status === 'Withdrawn' && (
        <Banner tone="neutral" icon={<Undo2 />} title={<>Withdrawn{a.decidedAt ? ` · ${shortDate(a.decidedAt)}` : ''}</>} action={<button type="button" className="ghost-chip h-8 bg-background" onClick={() => onDecide('reopen')}>Reopen</button>}>
          {a.decisionReason || undefined}
        </Banner>
      )}
      {undecided && decidedOther && (
        <Banner tone="warning" icon={<TriangleAlert />} title={<><Link to={`/applications/${decidedOther.number}`} className="hover:underline">{applicationRef(decidedOther.number)}</Link> ({decidedOther.applicantName}) was {decidedOther.status === 'Leased' ? 'leased' : 'approved'} for this unit</>}>
          Decide on this application with that in mind — if the home is no longer available, deny it with “Another applicant was approved first”.
        </Banner>
      )}
      {a.status === 'Approved' && openOthers.filter(o => o.status !== 'Approved').length > 0 && (
        <Banner tone="warning" icon={<TriangleAlert />} title={`${openOthers.filter(o => o.status !== 'Approved').length} other ${openOthers.length === 1 ? 'application for this unit is' : 'applications for this unit are'} still open`}>
          {openOthers.filter(o => o.status !== 'Approved').map((o, i) => <span key={o.id}>{i > 0 && ', '}<Link to={`/applications/${o.number}`} className="hover:underline">{applicationRef(o.number)} {o.applicantName}</Link></span>)}. Let them know once the lease is signed.
        </Banner>
      )}

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Figure label="Household income" hint={a.coApplicants.length ? `${a.coApplicants.length + 1} incomes` : 'per month'}><Money value={a.householdIncome} cents={false} /></Figure>
        <Figure label="Rent" hint={a.rent ? `${multiple}× is ${ws.money((a.rent ?? 0) * multiple, { cents: false })}` : undefined}>{a.rent ? <Money value={a.rent} cents={false} /> : <span className="text-muted-foreground">—</span>}</Figure>
        <Figure label="Income to rent" hint={ratio == null ? undefined : tone === 'success' ? 'Meets your guideline' : `Below your ${multiple}× guideline`}>
          <span className={cn(tone === 'success' && 'text-tone-success', tone === 'warning' && 'text-tone-warning', tone === 'danger' && 'text-tone-danger')}>{ratio == null ? '—' : `${ratio.toFixed(1)}×`}</span>
        </Figure>
        <Figure label="Screening" hint={a.screeningFlags ? `${a.screeningFlags} flagged` : a.screeningDone === a.screeningTotal ? 'Complete' : 'In progress'}>
          <ScreeningMeter done={a.screeningDone} flags={a.screeningFlags} total={a.screeningTotal} checks={a.screening} className="text-[17px] font-semibold text-foreground" />
        </Figure>
      </div>

      <SectionHeading action={<span className="text-sm text-muted-foreground">Same checks for every applicant</span>}>Screening</SectionHeading>
      <ScreeningChecklist application={a} locked={a.status === 'Leased'} />
      <ScreeningNotes value={a.screeningNotes} onSave={v => void update([a], { screeningNotes: v }, { toast: 'Screening notes saved' }).catch(() => undefined)} />

      <SectionHeading>Applicants</SectionHeading>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
          <div className="flex items-center gap-2 text-[14px] font-medium"><UserRound className="h-3.5 w-3.5 text-muted-foreground" /> {a.applicantName}<span className="text-sm font-normal text-muted-foreground">Primary</span></div>
          <div className="mt-1.5 space-y-1 text-[14px]">
            {a.email && <a href={`mailto:${a.email}`} className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{a.email}</span></a>}
            {a.phone && <a href={telHref(a.phone)} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Phone className="h-3 w-3" />{a.phone}</a>}
            {a.portalEmail && a.portalEmail.toLowerCase() !== a.email.toLowerCase() && <p className="text-sm text-muted-foreground">Signed in to the portal as {a.portalEmail}</p>}
          </div>
          <div className="mt-2 border-t pt-2 text-sm text-muted-foreground">
            {a.consentAt ? <>Authorized screening and signed as “{a.signature || a.applicantName}” · {fullDate(a.consentAt)}</> : 'No screening authorization on file'}
          </div>
        </div>
        {a.coApplicants.map((c, i) => (
          <div key={i} className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
            <div className="flex items-center gap-2 text-[14px] font-medium"><UserRound className="h-3.5 w-3.5 text-muted-foreground" /> {c.name || 'Co-applicant'}{c.relationship && <span className="text-sm font-normal text-muted-foreground">{c.relationship}</span>}</div>
            <div className="mt-1.5 space-y-1 text-[14px] text-muted-foreground">
              {c.email && <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-foreground"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{c.email}</span></a>}
              <p>{[c.employer, c.monthlyIncome != null ? `${ws.money(c.monthlyIncome, { cents: false })}/mo` : null].filter(Boolean).join(' · ') || 'No income reported'}</p>
            </div>
          </div>
        ))}
      </div>

      <SectionHeading>Residence and rental history</SectionHeading>
      <div className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
        <Facts
          columns={2}
          items={[
            { label: 'Current address', value: answer(a.currentAddress) },
            { label: 'Lived there', value: months(a.residenceMonths) },
            { label: 'Landlord', value: answer(a.currentLandlord) },
            { label: 'Landlord phone', value: a.landlordPhone ? <a href={telHref(a.landlordPhone)} className="hover:underline">{a.landlordPhone}</a> : null },
            { label: 'Current rent', value: a.currentRent != null ? <Money value={a.currentRent} cents={false} /> : null },
            { label: 'Prior eviction', value: a.priorEviction ? <span className="text-tone-warning">Yes, disclosed</span> : 'No' },
            { label: 'Reason for moving', value: answer(a.reasonForMoving) },
          ]}
        />
      </div>

      <SectionHeading>Employment and income</SectionHeading>
      <div className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
        <Facts
          columns={2}
          items={[
            { label: 'Employer', value: answer(a.employer) },
            { label: 'Job title', value: answer(a.jobTitle) },
            { label: 'Time employed', value: months(a.employmentMonths) },
            { label: 'Monthly income (before tax)', value: a.monthlyIncome != null ? <Money value={a.monthlyIncome} cents={false} /> : null },
          ]}
        />
        <div className="mt-3 border-t pt-3 text-[14px]">
          <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{a.applicantName}</span><Money value={a.monthlyIncome ?? 0} cents={false} /></div>
          {a.coApplicants.map((c, i) => <div key={i} className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{c.name || 'Co-applicant'}</span><Money value={c.monthlyIncome ?? 0} cents={false} /></div>)}
          <div className="mt-1 flex items-center justify-between gap-3 border-t pt-1 font-medium"><span>Household income</span><Money value={a.householdIncome} cents={false} /></div>
          {a.rent ? (
            <div className="flex items-center justify-between gap-3 text-muted-foreground">
              <span>Required at {multiple}× the {ws.money(a.rent, { cents: false })} rent</span>
              <span className="inline-flex items-center gap-2"><Money value={a.rent * multiple} cents={false} /><IncomeRatio income={a.householdIncome} rent={a.rent} /></span>
            </div>
          ) : null}
        </div>
      </div>

      <SectionHeading>Household</SectionHeading>
      <div className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
        <Facts
          columns={3}
          items={[
            { label: 'People living in the home', value: a.occupants != null ? String(a.occupants) : null },
            { label: 'Pets', value: answer(a.pets) },
            { label: 'Vehicles', value: answer(a.vehicles) ?? 'None' },
          ]}
        />
      </div>

      {(a.references.length > 0 || a.emergencyContact || a.extraAnswers.length > 0) && (
        <>
          <SectionHeading>References and other answers</SectionHeading>
          <div className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
            <Facts
              columns={2}
              items={[
                ...a.references.map((r, i) => ({ label: `Reference${a.references.length > 1 ? ` ${i + 1}` : ''}${r.relationship ? ` · ${r.relationship}` : ''}`, value: <>{r.name}{r.phone && <> · <a href={telHref(r.phone)} className="hover:underline">{r.phone}</a></>}{r.email && <> · {r.email}</>}</> })),
                ...(a.emergencyContact ? [{ label: `Emergency contact${a.emergencyContact.relationship ? ` · ${a.emergencyContact.relationship}` : ''}`, value: <>{a.emergencyContact.name}{a.emergencyContact.phone && <> · {a.emergencyContact.phone}</>}</> }] : []),
                ...a.extraAnswers.map(x => ({ label: x.key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), value: <span className="break-words">{x.value}</span> })),
              ]}
            />
          </div>
        </>
      )}

      <SectionHeading>Documents</SectionHeading>
      <DocumentsPanel scope="applicationId" id={a.id} links={{ applicationId: a.id, propertyId: a.propertyId, unitId: a.unitId }} defaultCategory="Identification" />

      {detail.others.length > 0 && (
        <>
          <SectionHeading count={detail.others.length}>Other applications for this unit</SectionHeading>
          <div className="overflow-hidden rounded-lg border">
            {detail.others.map(o => (
              <Link key={o.id} to={`/applications/${o.number}`} className="flex h-9 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">
                <span className="w-[62px] shrink-0 text-sm tabular-nums text-muted-foreground">{applicationRef(o.number)}</span>
                <ApplicationStatusGlyph status={o.status} />
                <span className="min-w-0 flex-1 truncate">{o.applicantName}</span>
                <ApplicationStatusPill status={o.status} />
                <span className="hidden w-16 text-right text-sm text-muted-foreground sm:inline">{o.submittedAt ? timeAgo(o.submittedAt) : ''}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionHeading action={undecided ? <span className="flex items-center gap-1"><button type="button" className="ghost-chip h-8 text-sm" onClick={() => onDecide('deny')}><Ban className="h-3.5 w-3.5" /> Deny</button><button type="button" className="ghost-chip h-8 text-sm" onClick={() => onDecide('approve')}><CircleCheck className="h-3.5 w-3.5" /> Approve</button></span> : undefined}>Activity</SectionHeading>
      <Timeline activity={detail.activity} messages={detail.messages} />
      <Composer className="mt-4" modes={modes} onSend={send} />
    </div>
  );
}

function ScreeningNotes({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
      rows={2}
      maxLength={5000}
      placeholder="Screening summary — what the checks showed overall"
      className="mt-2 block w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70 hover:border-input focus:border-ring focus:bg-background"
    />
  );
}

/** Status, people, the home and the paperwork — each editable in place where it can change. */
export function ApplicationRail({ detail, picker, setPicker, onDecide }: { detail: ApplicationDetail; picker: ApplicationPickerKind | null; setPicker: (k: ApplicationPickerKind | null) => void; onDecide: (kind: DecisionKind) => void }) {
  const ws = useWorkspace();
  const { update } = useApplicationActions();
  const a = detail.application;
  const assignee = a.assigneeId ? ws.memberById.get(a.assigneeId) : undefined;
  const property = a.propertyId ? ws.propertyById.get(a.propertyId) : undefined;
  const unit = a.unitId ? ws.unitById.get(a.unitId) : undefined;
  const targets = [a];
  return (
    <>
      <RailSection>
        <RailRow label="Status">
          <ApplicationPicker kind="status" targets={targets} open={picker === 'status'} onOpenChange={o => setPicker(o ? 'status' : null)} align="end" onDecide={k => onDecide(k)} trigger={<button type="button" className={chip}><ApplicationStatusGlyph status={a.status} /> {a.status}</button>} />
        </RailRow>
        <RailRow label="Assignee">
          <ApplicationPicker kind="assignee" targets={targets} open={picker === 'assignee'} onOpenChange={o => setPicker(o ? 'assignee' : null)} align="end" trigger={<button type="button" className={chip}>{assignee ? <><MemberAvatar member={assignee} size={18} /><span className="truncate">{assignee.name}</span></> : <><UnassignedAvatar size={18} /><span className="text-muted-foreground">Unassigned</span></>}</button>} />
        </RailRow>
        <RailRow label="Move-in">
          <MoveInPicker value={a.desiredMoveIn} open={picker === 'moveIn'} onOpenChange={o => setPicker(o ? 'moveIn' : null)} align="end" onChange={d => void update(targets, { desiredMoveIn: d }).catch(() => undefined)} trigger={<button type="button" className={chip}><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{a.desiredMoveIn ? fullDate(a.desiredMoveIn) : <span className="text-muted-foreground">Not given</span>}</button>} />
        </RailRow>
      </RailSection>

      <RailSection title="Home">
        {detail.listing && (
          <RailRow label="Listing">
            <Link to={`/listings/${detail.listing.id}`} className={chip}><span className="truncate">{detail.listing.title}</span></Link>
          </RailRow>
        )}
        <RailRow label="Unit">
          {property ? <Link to={unit ? `/units/${unit.id}` : `/properties/${property.id}`} className={chip}><PropertySwatch color={property.color} /><span className="truncate">{ws.unitLabel(a.unitId, a.propertyId)}</span></Link> : <span className="px-1.5 text-[14px] text-muted-foreground">—</span>}
        </RailRow>
        <RailRow label="Rent"><span className="px-1.5 text-[14px]">{a.rent != null ? <Money value={a.rent} /> : '—'}</span></RailRow>
        <RailRow label="Deposit"><span className="px-1.5 text-[14px]">{a.deposit != null ? <Money value={a.deposit} /> : '—'}</span></RailRow>
        {detail.listing && detail.listing.status !== 'Published' && <RailRow label="Listing status"><span className="px-1.5"><ListingStatusPill status={detail.listing.status} /></span></RailRow>}
      </RailSection>

      <RailSection title="Application">
        <RailRow label="Fee">
          {a.feeAmount ? (
            <span className="flex min-w-0 items-center gap-2 px-1.5 text-[14px]">
              <Money value={a.feeAmount} />
              {a.feePaidAt ? <Tip label={dateTime(a.feePaidAt)}><span className="text-sm text-tone-success">Paid {shortDate(a.feePaidAt)}</span></Tip> : <button type="button" className="text-sm text-tone-warning underline-offset-2 hover:underline" onClick={() => void update(targets, { feePaid: true }, { toast: 'Fee recorded as paid' }).catch(() => undefined)}>Unpaid · mark paid</button>}
            </span>
          ) : <span className="px-1.5 text-[14px] text-muted-foreground">No fee</span>}
        </RailRow>
        <RailRow label="Submitted"><Tip label={dateTime(a.submittedAt)}><span className="truncate px-1.5 text-[14px]">{a.submittedAt ? shortDate(a.submittedAt) : '—'} · {a.source}</span></Tip></RailRow>
        {detail.inquiry && (
          <RailRow label="Lead">
            <Link to={`/leasing/leads?lead=${detail.inquiry.id}`} className={chip}><Inbox className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{detail.inquiry.source} · {detail.inquiry.receivedAt ? shortDate(detail.inquiry.receivedAt) : ''}</span></Link>
          </RailRow>
        )}
        {a.decidedAt && <RailRow label="Decided"><span className="truncate px-1.5 text-[14px]">{shortDate(a.decidedAt)}{a.decidedById ? ` · ${ws.memberName(a.decidedById)}` : ''}</span></RailRow>}
        {detail.lease && (
          <RailRow label="Lease">
            <Link to={`/leases/${detail.lease.id}`} className={chip}><KeyRound className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{leaseRef(detail.lease.number)} · {detail.lease.status}</span></Link>
          </RailRow>
        )}
        {detail.messageCount > 0 && <RailRow label="Messages"><span className="flex items-center gap-1.5 px-1.5 text-[14px]"><MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />{detail.messageCount}</span></RailRow>}
        {detail.statusLink && (
          <RailRow label="Portal">
            <a href={detail.statusLink} target="_blank" rel="noreferrer" className={cn(chip, 'text-muted-foreground')}><ExternalLink className="h-3.5 w-3.5" /> Their status page</a>
          </RailRow>
        )}
      </RailSection>
    </>
  );
}
