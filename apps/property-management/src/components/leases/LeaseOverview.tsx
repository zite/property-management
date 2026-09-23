import { useQueryClient } from '@tanstack/react-query';
import {
  Ban, CalendarCheck, CheckCircle2, ChevronDown, CircleDashed, ClipboardCheck, Download, FilePen, FileSignature, LogOut, MoreHorizontal, Pencil, Plus, Printer, Repeat, Send, Trash2, Wallet,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { saveRecurringCharge } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import type { LeasePhase } from '@project/shared/constants';
import { addDays as addDayStr, addPeriods, daysBetween, periodOf, periodStart } from '@project/shared/dates';
import { leaseRef } from '@project/shared/leases';
import { ordinal } from '@project/shared/merge';
import { sumMoney } from '@project/shared/money';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dateTime, fullDate, shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { SectionHeading } from '../detail/DetailLayout';
import { IconButton, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill } from '../primitives/glyphs';
import { afterLeaseChange, type LeaseDetail } from './data';
import { SettlementStatement } from './DepositSettlement';
import type { ChargeDialogState } from './LeaseDialogs';
import { printElement } from './print';
import { renewalTerm } from './RenewalDialog';

type Person = LeaseDetail['people'][number];

export type LeaseDialogKind = 'activate' | 'activateDraft' | 'notice' | 'end' | 'settle' | 'renew' | 'addPerson' | 'editTerms';

/** What the lease page's sections can ask for; the page owns the dialogs so its header and sections share them. */
export type LeaseControls = {
  open: (kind: LeaseDialogKind) => void;
  recordSignature: (p: Person) => void;
  editCharge: (s: ChargeDialogState) => void;
  sendForSignature: (resend?: boolean) => void;
  cancel: () => void;
  lifecycle: (action: 'withdrawRenewal' | 'acceptRenewal' | 'declineRenewal' | 'monthToMonth' | 'rescindNotice') => void;
  pending: string | null;
};

const primaryBtn = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50';
const chipBtn = 'ghost-chip h-8 bg-background text-[13.5px]';

function Banner({ tone = 'neutral', icon, title, children, actions }: { tone?: 'neutral' | 'accent' | 'warning' | 'success' | 'info'; icon: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const tones = {
    neutral: 'border-border bg-subtle/60',
    accent: 'border-tone-accent/25 bg-tone-accent/[0.05]',
    warning: 'border-tone-warning/30 bg-tone-warning/[0.06]',
    success: 'border-tone-success/25 bg-tone-success/[0.05]',
    info: 'border-tone-info/25 bg-tone-info/[0.05]',
  };
  const iconTone = { neutral: 'text-muted-foreground', accent: 'text-tone-accent', warning: 'text-tone-warning', success: 'text-tone-success', info: 'text-tone-info' };
  return (
    <div className={cn('rounded-lg border px-4 py-3', tones[tone])}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn('mt-0.5 [&_svg]:h-4 [&_svg]:w-4', iconTone[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">{title}</p>
          {children && <div className="mt-0.5 text-sm text-muted-foreground">{children}</div>}
        </div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-7">{actions}</div>}
    </div>
  );
}

/** The state the lease is in, and the next thing to do about it. */
export function LifecycleBanner({ detail, controls }: { detail: LeaseDetail; controls: LeaseControls }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const l = detail.lease;
  const phase = l.phase as LeasePhase;
  const signers = detail.people.filter(p => p.role === 'Primary' || p.role === 'Co-tenant');

  if (l.status === 'Draft') {
    return (
      <Banner
        icon={<FilePen />}
        title="Draft — not sent yet"
        actions={
          <>
            <button type="button" className={primaryBtn} disabled={controls.pending === 'sendForSignature' || !signers.length} onClick={() => controls.sendForSignature()}>
              <Send className="h-3.5 w-3.5" /> Send for signature
            </button>
            <button type="button" className={chipBtn} onClick={() => controls.open('activateDraft')}><CheckCircle2 className="h-3.5 w-3.5" /> Mark signed &amp; activate</button>
            <button type="button" className={chipBtn} onClick={() => controls.open('editTerms')}><Pencil className="h-3.5 w-3.5" /> Edit terms</button>
            <button type="button" className={cn(chipBtn, 'text-tone-danger')} onClick={controls.cancel}><Ban className="h-3.5 w-3.5" /> Cancel</button>
          </>
        }
      >
        Nothing bills and residents can’t see it. Check the agreement below, then send it — each signer gets an email with a link to sign in the portal.
        {!signers.length && <span className="block text-tone-danger">Add a primary resident first.</span>}
      </Banner>
    );
  }

  if (l.status === 'Pending signature') {
    const signed = signers.filter(p => p.signedAt);
    const all = signers.length > 0 && signed.length === signers.length;
    return (
      <Banner
        tone={all ? 'success' : 'accent'}
        icon={all ? <CheckCircle2 /> : <FileSignature />}
        title={all ? 'Everyone has signed — ready to countersign' : `Waiting on ${signers.length - signed.length} of ${signers.length} ${signers.length === 1 ? 'signature' : 'signatures'}`}
        actions={
          <>
            {all ? (
              <button type="button" className={primaryBtn} onClick={() => controls.open('activate')}><CheckCircle2 className="h-3.5 w-3.5" /> Countersign &amp; activate</button>
            ) : (
              <>
                <button type="button" className={primaryBtn} disabled={controls.pending === 'sendForSignature'} onClick={() => controls.sendForSignature(true)}><Send className="h-3.5 w-3.5" /> Resend request</button>
                <button type="button" className={chipBtn} onClick={() => controls.open('activate')}>Activate with paper signatures…</button>
              </>
            )}
            <button type="button" className={cn(chipBtn, 'text-tone-danger')} onClick={controls.cancel}><Ban className="h-3.5 w-3.5" /> Cancel</button>
          </>
        }
      >
        {l.sentForSignatureAt ? <>Sent {timeAgo(l.sentForSignatureAt)}. Residents sign in the portal; you can record a paper signature too.</> : 'Not emailed yet — resend the request, or record signatures collected in person.'}
        <ul className="mt-2 divide-y rounded-md border bg-background text-[14px] text-foreground">
          {signers.map(p => {
            const sig = l.signatures.find(s => s.tenantId === p.id);
            return (
              <li key={p.id} className="flex min-h-9 flex-wrap items-center gap-2 px-3 py-1.5">
                {p.signedAt ? <CheckCircle2 className="h-3.5 w-3.5 text-tone-success" /> : <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-sm text-muted-foreground">· {p.role}</span></span>
                {p.signedAt ? (
                  <Tip label={dateTime(p.signedAt)}><span className="text-sm text-muted-foreground">Signed {shortDate(p.signedAt.slice(0, 10))}{sig?.by === 'staff' ? ' · recorded by the office' : ' · in the portal'}</span></Tip>
                ) : (
                  <button type="button" className="ghost-chip h-6 text-sm" onClick={() => controls.recordSignature(p)}>Record signature</button>
                )}
              </li>
            );
          })}
        </ul>
      </Banner>
    );
  }

  if (l.status === 'Canceled') {
    return <Banner icon={<Ban />} title="This lease was canceled">{l.notes ? l.notes.split('\n').slice(-1)[0] : 'It never became active. Its unit and residents are unaffected.'}</Banner>;
  }

  if (phase === 'Upcoming' && l.startDate) {
    const days = daysBetween(ws.today, l.startDate);
    return (
      <Banner
        tone="info"
        icon={<CalendarCheck />}
        title={`Moves in ${fullDate(l.startDate)} — ${days === 1 ? 'tomorrow' : `in ${days} days`}`}
        actions={ws.can('maintenance.manage') ? <button type="button" className={chipBtn} onClick={() => app.openCreate('inspection', { unitId: l.unitId, leaseId: l.id, propertyId: l.propertyId, type: 'Move-in' })}><ClipboardCheck className="h-3.5 w-3.5" /> Schedule move-in inspection</button> : undefined}
      >
        Signed and active. Rent bills from {fullDate(l.startDate.endsWith('-01') ? l.startDate : periodStart(addPeriods(periodOf(l.startDate), 1)))}{l.startDate.endsWith('-01') ? '' : ', after a prorated first month'}.
      </Banner>
    );
  }
  return null;
}

/** Renewal: offer, answer on the residents’ behalf, or go month-to-month. */
export function RenewalSection({ detail, controls }: { detail: LeaseDetail; controls: LeaseControls }) {
  const ws = useWorkspace();
  const l = detail.lease;
  const phase = l.phase as LeasePhase;
  if (l.status !== 'Active' || phase === 'Notice' || phase === 'Upcoming') return null;
  const m2m = l.leaseType === 'Month-to-month' || !l.endDate;
  const change = l.renewalRent && l.rent ? Math.round(((l.renewalRent - l.rent) / l.rent) * 1000) / 10 : 0;
  const busy = controls.pending;

  let body: ReactNode;
  if (l.renewalStatus === 'Offered') {
    const expired = Boolean(l.renewalExpiresOn && l.renewalExpiresOn < ws.today);
    const term = renewalTerm(l.endDate, ws.today, l.renewalTermMonths ?? 12);
    body = (
      <Banner
        tone={expired ? 'warning' : 'accent'}
        icon={<Repeat />}
        title={<>Renewal offered: <Money value={l.renewalRent} />/mo{change ? ` (${change > 0 ? '+' : ''}${change}%)` : ''} for {l.renewalTermMonths ?? 12} months</>}
        actions={
          <>
            <button type="button" className={primaryBtn} disabled={busy === 'acceptRenewal'} onClick={() => controls.lifecycle('acceptRenewal')}><CheckCircle2 className="h-3.5 w-3.5" /> Accept for the residents</button>
            <button type="button" className={chipBtn} disabled={busy === 'declineRenewal'} onClick={() => controls.lifecycle('declineRenewal')}>They declined</button>
            <button type="button" className={chipBtn} onClick={() => controls.open('renew')}>Change offer…</button>
            <button type="button" className={chipBtn} disabled={busy === 'withdrawRenewal'} onClick={() => controls.lifecycle('withdrawRenewal')}>Withdraw</button>
          </>
        }
      >
        {expired ? `The offer expired ${fullDate(l.renewalExpiresOn)}. You can still accept a late answer, or send a new offer.` : `Open until ${fullDate(l.renewalExpiresOn)}${l.renewalOfferedAt ? ` · sent ${timeAgo(l.renewalOfferedAt)}` : ''}. The residents can accept in the portal.`} New term {fullDate(term.start)} – {fullDate(term.end)}.
      </Banner>
    );
  } else if (l.renewalStatus === 'Accepted') {
    const next = detail.recurring.find(r => r.active && /^rent$/i.test(r.description) && r.startDate && r.startDate > ws.today);
    body = (
      <Banner tone="success" icon={<CheckCircle2 />} title={`Renewed through ${fullDate(l.endDate)}`}>
        {l.renewalRespondedAt ? `Accepted ${timeAgo(l.renewalRespondedAt)}. ` : ''}
        {next ? <>Rent changes to <Money value={next.amount} /> on {fullDate(next.startDate)}.</> : <>Rent is <Money value={l.rent} />/mo.</>}
      </Banner>
    );
  } else {
    const days = l.daysToEnd;
    body = (
      <Banner
        tone={phase === 'Expiring' || l.renewalStatus === 'Declined' ? 'warning' : 'neutral'}
        icon={<Repeat />}
        title={l.renewalStatus === 'Declined' ? 'The residents declined the renewal' : m2m ? 'Month-to-month' : days != null && days < 0 ? `The term ended ${fullDate(l.endDate)}` : `The term ends ${fullDate(l.endDate)}${days != null ? ` — in ${days} days` : ''}`}
        actions={
          <>
            <button type="button" className={phase === 'Expiring' || m2m ? primaryBtn : chipBtn} onClick={() => controls.open('renew')}><Repeat className="h-3.5 w-3.5" /> {m2m ? 'Offer a new term' : l.renewalStatus === 'Declined' ? 'Offer again' : 'Offer renewal'}</button>
            {!m2m && <button type="button" className={chipBtn} disabled={busy === 'monthToMonth'} onClick={() => controls.lifecycle('monthToMonth')}>Go month-to-month</button>}
            <button type="button" className={chipBtn} onClick={() => controls.open('notice')}><LogOut className="h-3.5 w-3.5" /> Record notice</button>
          </>
        }
      >
        {m2m
          ? 'It continues until someone gives notice. Offer a new fixed term to lock in rent.'
          : l.renewalStatus === 'Declined'
            ? 'Plan the move-out: record their notice and move-out date when you have it.'
            : `Offers usually go out ${ws.settings.renewalNoticeDays || 60} days before the end. Accepting extends this lease — the ledger and deposit carry on.`}
      </Banner>
    );
  }
  return (
    <>
      <SectionHeading>Renewal</SectionHeading>
      {body}
    </>
  );
}

/** Notice, the move-out checklist and the deposit settlement. */
export function MoveOutSection({ detail, controls }: { detail: LeaseDetail; controls: LeaseControls }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const l = detail.lease;
  const phase = l.phase as LeasePhase;
  if (!(phase === 'Notice' || l.status === 'Ended')) return null;
  const ended = l.status === 'Ended';
  const inspection = detail.inspections.find(i => i.type === 'Move-out' && i.status !== 'Canceled');
  const refunded = sumMoney(detail.moveOut.refunds.map(r => r.amount));
  const canMoney = ws.can('receivables.manage');
  const canEnd = Boolean(l.moveOutDate && l.moveOutDate <= ws.today);
  const noticeDays = l.noticeGivenOn && l.moveOutDate ? daysBetween(l.noticeGivenOn, l.moveOutDate) : null;

  return (
    <>
      <SectionHeading
        action={
          !ended && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="Move-out options"><MoreHorizontal /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => controls.open('notice')}><Pencil className="h-3.5 w-3.5" /> Change move-out details</DropdownMenuItem>
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => controls.lifecycle('rescindNotice')}><Repeat className="h-3.5 w-3.5" /> Withdraw notice</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      >
        Move-out
      </SectionHeading>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-[14px] font-medium">{ended ? `Moved out ${fullDate(l.moveOutDate)}` : `Moving out ${fullDate(l.moveOutDate)}`}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {l.noticeGivenOn ? `Notice given ${fullDate(l.noticeGivenOn)}${noticeDays != null ? ` · ${noticeDays} days’ notice` : ''}` : 'No notice date recorded'}
            {l.moveOutReason ? ` · ${l.moveOutReason}` : ''}
          </p>
          {l.forwardingAddress && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">Forwarding address: {l.forwardingAddress}</p>}
        </div>
        <ol className="divide-y">
          <Step
            done={inspection?.status === 'Completed'}
            title="Move-out inspection"
            detail={inspection ? `${inspection.status}${inspection.scheduledFor ? ` · ${shortDate(inspection.scheduledFor.slice(0, 10))}` : ''}${inspection.condition ? ` · ${inspection.condition}` : ''}` : 'Not scheduled'}
            action={
              inspection ? (
                <Link to={`/inspections/${inspection.id}`} className={chipBtn}>Open</Link>
              ) : ws.can('maintenance.manage') ? (
                <button type="button" className={chipBtn} onClick={() => app.openCreate('inspection', { unitId: l.unitId, leaseId: l.id, propertyId: l.propertyId, type: 'Move-out' })}><ClipboardCheck className="h-3.5 w-3.5" /> Schedule</button>
              ) : null
            }
          />
          <Step
            done={Boolean(l.depositSettledAt)}
            title="Final charges"
            detail={<>Balance <Money value={detail.balance} tone="balance" />{detail.moveOut.deductions.length ? ` · ${detail.moveOut.deductions.length} move-out ${detail.moveOut.deductions.length === 1 ? 'charge' : 'charges'}` : ''}</>}
            action={canMoney && !l.depositSettledAt ? <button type="button" className={chipBtn} onClick={() => app.openCreate('charge', { leaseId: l.id, accountId: ws.accountByKey.get('damage_income')?.id })}><Plus className="h-3.5 w-3.5" /> Charge</button> : null}
          />
          <Step
            done={Boolean(l.depositSettledAt)}
            title="Security deposit"
            detail={l.depositSettledAt ? <>Settled {fullDate(l.depositSettledAt.slice(0, 10))} · refunded <Money value={refunded} /></> : <>Holding <Money value={detail.depositHeld} /> of <Money value={l.deposit} /></>}
            action={!l.depositSettledAt && canMoney ? <button type="button" className={cn(ended ? primaryBtn : chipBtn)} onClick={() => controls.open('settle')}><Wallet className="h-3.5 w-3.5" /> Settle deposit</button> : null}
          />
          <Step
            done={ended}
            title="End the lease"
            detail={ended ? `Ended ${fullDate(l.moveOutDate)} · billing stopped` : canEnd ? 'Ready — the move-out date has passed' : `Available from ${fullDate(l.moveOutDate)}`}
            action={
              !ended ? (
                canEnd ? (
                  <button type="button" className={primaryBtn} onClick={() => controls.open('end')}><LogOut className="h-3.5 w-3.5" /> Complete move-out</button>
                ) : (
                  <Tip label={`You can complete the move-out on or after ${fullDate(l.moveOutDate)}`}>
                    <span><button type="button" className={chipBtn} disabled><LogOut className="h-3.5 w-3.5" /> Complete move-out</button></span>
                  </Tip>
                )
              ) : null
            }
          />
        </ol>
      </div>
      {(l.depositSettledAt || detail.moveOut.refunds.length > 0) && <div className="mt-3"><SettlementStatement detail={detail} /></div>}
    </>
  );
}

function Step({ done, title, detail, action }: { done: boolean; title: string; detail: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2">
      {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-tone-success" /> : <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className={cn('text-[14px]', done ? 'text-muted-foreground' : 'font-medium')}>{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {action}
    </li>
  );
}

/** What bills every month — add, re-price from a date, end. */
export function RecurringChargesSection({ detail, controls }: { detail: LeaseDetail; controls: LeaseControls }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const l = detail.lease;
  const editable = ws.can('receivables.manage') && l.status !== 'Ended' && l.status !== 'Canceled';
  const [showPast, setShowPast] = useState(false);
  const statusOf = (r: LeaseDetail['recurring'][number]) => {
    if (!r.active) return { label: 'Off', tone: 'neutral' as const, current: false };
    if (r.endDate && r.endDate < ws.today) return { label: `Ended ${shortDate(r.endDate)}`, tone: 'neutral' as const, current: false };
    if (r.startDate && r.startDate > ws.today) return { label: `Starts ${shortDate(r.startDate)}`, tone: 'info' as const, current: true };
    if (r.endDate) return { label: `Ends ${shortDate(r.endDate)}`, tone: 'warning' as const, current: true };
    return { label: 'Billing', tone: 'success' as const, current: true };
  };
  const rows = detail.recurring.map(r => ({ r, s: statusOf(r) }));
  const current = rows.filter(x => x.s.current);
  const past = rows.filter(x => !x.s.current);
  const monthly = sumMoney(current.filter(x => x.r.frequency === 'Monthly' && (!x.r.startDate || x.r.startDate <= ws.today)).map(x => x.r.amount));

  const remove = async (r: LeaseDetail['recurring'][number]) => {
    if (!(await app.confirm({ title: `Remove ${r.description}?`, description: 'It has never billed, so nothing on the ledger changes.', confirmLabel: 'Remove', destructive: true }))) return;
    try {
      const res = await saveRecurringCharge({ action: 'delete', id: r.id });
      afterLeaseChange(qc, { money: true });
      toast.success(res.message);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t remove the charge'));
    }
  };

  const list = showPast ? rows : current;
  return (
    <>
      <SectionHeading count={current.length} action={editable ? <button type="button" className="ghost-chip h-8 text-sm" onClick={() => controls.editCharge({ mode: 'add' })}><Plus className="h-3.5 w-3.5" /> Add charge</button> : undefined}>
        Recurring charges
      </SectionHeading>
      <div className="overflow-hidden rounded-lg border bg-card">
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">{l.status === 'Ended' || l.status === 'Canceled' ? 'Nothing bills on this lease anymore.' : 'Nothing bills automatically yet.'}</p>
        ) : (
          <ul className="divide-y">
            {list.map(({ r, s }) => (
              <li key={r.id} className={cn('flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[14px]', !s.current && 'text-muted-foreground')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.description}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {ws.accountById.get(r.accountId ?? '')?.name ?? 'Account'} · {r.frequency.toLowerCase()} on the {ordinal(r.dayOfMonth)} · {r.startDate ? fullDate(r.startDate) : 'lease start'} – {r.endDate ? fullDate(r.endDate) : 'ongoing'}
                    {r.lastPostedPeriod ? ` · billed through ${shortDate(addDayStr(periodStart(addPeriods(r.lastPostedPeriod, 1)), -1))}` : ''}
                  </p>
                </div>
                <Pill tone={s.tone}>{s.label}</Pill>
                <Money value={r.amount} className="w-[84px] text-right font-medium" />
                {editable && s.current ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" aria-label={`Options for ${r.description}`}><MoreHorizontal /></IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => controls.editCharge({ mode: 'change', charge: r })}><Pencil className="h-3.5 w-3.5" /> Change amount…</DropdownMenuItem>
                      <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => controls.editCharge({ mode: 'end', charge: r })}><CalendarCheck className="h-3.5 w-3.5" /> End…</DropdownMenuItem>
                      {r.postedCount === 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void remove(r)}><Trash2 className="h-3.5 w-3.5" /> Remove</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="w-6" />
                )}
              </li>
            ))}
          </ul>
        )}
        {(monthly > 0 || past.length > 0) && (
          <div className="flex items-center justify-between border-t bg-subtle/50 px-4 py-2 text-sm text-muted-foreground">
            {past.length > 0 ? (
              <button type="button" className="hover:text-foreground" onClick={() => setShowPast(v => !v)}>{showPast ? 'Hide' : 'Show'} {past.length} past {past.length === 1 ? 'charge' : 'charges'}</button>
            ) : (
              <span />
            )}
            {monthly > 0 && <span>Billing <Money value={monthly} className="font-medium text-foreground" /> a month</span>}
          </div>
        )}
      </div>
    </>
  );
}

/** The agreement: frozen when sent for signature, otherwise a live preview of the organization's template. */
export function LeaseDocumentSection({ detail }: { detail: LeaseDetail }) {
  const ws = useWorkspace();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const l = detail.lease;
  const doc = detail.document;
  return (
    <>
      <SectionHeading
        action={
          <>
            {l.documentUrl && (
              <a href={l.documentUrl} target="_blank" rel="noreferrer" className="ghost-chip h-8 text-sm"><Download className="h-3.5 w-3.5" /> Signed PDF</a>
            )}
            <button type="button" className="ghost-chip h-8 text-sm" onClick={() => printElement(ref.current, `Lease ${leaseRef(l.number)}`, `${ws.settings.organizationName} · ${leaseRef(l.number)} · ${ws.unitLabel(l.unitId, l.propertyId)}`)}>
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </>
        }
      >
        Lease agreement
      </SectionHeading>
      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground">
          {doc.frozen ? (
            <><FileSignature className="h-3.5 w-3.5" /> {l.sentForSignatureAt ? `The text residents sign, fixed when it was sent ${fullDate(l.sentForSignatureAt.slice(0, 10))}` : 'The text residents signed'}</>
          ) : (
            <><FilePen className="h-3.5 w-3.5" /> {l.status === 'Draft' ? 'Preview from your lease template — the text is fixed when it’s sent for signature' : l.documentUrl ? 'Your current template filled in for this lease — the signed copy is the PDF' : 'Your current template filled in for this lease'}</>
          )}
        </div>
        <div className={cn('relative px-5 py-4', !expanded && 'max-h-[320px] overflow-hidden')}>
          <div ref={ref} className="prose-ks [&>*:first-child]:mt-0 [&_h1]:text-[18px] [&_h2]:text-[15px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{doc.markdown}</ReactMarkdown>
          </div>
          {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" aria-hidden />}
        </div>
        <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} className="flex h-9 w-full items-center justify-center gap-1.5 border-t text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} /> {expanded ? 'Show less' : 'Read the full agreement'}
        </button>
      </div>
    </>
  );
}

/** Other households on the same unit: the lease before, the one after. */
export function OtherLeasesSection({ detail }: { detail: LeaseDetail }) {
  if (!detail.otherLeases.length) return null;
  return (
    <>
      <SectionHeading count={detail.otherLeases.length}>Other leases on this unit</SectionHeading>
      <div className="overflow-hidden rounded-lg border">
        {detail.otherLeases.map(o => (
          <Link key={o.id} to={`/leases/${o.id}`} className="flex h-9 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">
            <span className="w-[52px] shrink-0 text-sm tabular-nums text-muted-foreground">{leaseRef(o.number)}</span>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">{o.startDate ? fullDate(o.startDate) : ''}{o.endDate ? ` – ${fullDate(o.endDate)}` : ''}</span>
            <Pill tone={o.status === 'Active' ? 'success' : o.status === 'Pending signature' ? 'accent' : 'neutral'}>{o.status}</Pill>
          </Link>
        ))}
      </div>
    </>
  );
}
