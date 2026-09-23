import {
  ArrowRight, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, FileText, KeyRound, Megaphone, MessageSquare, PenLine, Pin, Receipt, Sparkles, Star, Truck, Wrench, type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { CategoryGlyph, EmergencyCard, LoadError, Panel, RequestStatusPill, ResidentSkeleton } from '../../components/resident/bits';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Card, LinkButton, StatusPill } from '../../components/ui';
import { firstName, formatMoney, longDate, shortDate, timeAgo } from '../../lib/format';
import { usePortal } from '../../lib/queries';
import { dateRange, greeting, leasePhase, ordinal, relativeDays, visitTime } from '../../lib/residentFormat';
import { useResidentLease } from '../../lib/residentLease';
import { useResidentHome, type ResidentHome } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The resident's home: what they owe and why, what's waiting on them, what's
 * happening in their building, and one tap to the things people come here for.
 * Designed for a phone first.
 */
export default function ResidentHomePage() {
  useDocumentTitle('Home');
  const { leaseId, me } = useResidentLease();
  const portal = usePortal();
  const q = useResidentHome(leaseId);

  if (q.isPending) return <ResidentSkeleton />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your home page" />;

  const d = q.data;
  const currency = portal.data?.settings.currency ?? 'USD';
  const emergencyPhone = portal.data?.settings.emergencyPhone || portal.data?.settings.phone || '';
  const name = firstName(me?.name);

  return (
    <div className="animate-fade-in">
      <ResidentHeader title={`${greeting()}${name ? `, ${name}` : ''}`} subtitle={<LeaseSwitcher />} />
      <div className="mx-auto w-full max-w-page px-4 pb-4 pt-4 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <BalanceCard d={d} currency={currency} />
            <Attention d={d} currency={currency} />
            <QuickActions className="lg:hidden" maintenance={d.maintenanceEnabled && d.lease.status === 'Active'} unread={d.messages.unread} />
            {d.announcements.some(a => a.pinned) && <Announcements items={d.announcements.filter(a => a.pinned)} className="lg:hidden" />}
            <RequestsCard d={d} />
            <MessagesCard d={d} />
          </div>
          <aside className="min-w-0 space-y-5">
            <QuickActions className="hidden lg:grid" maintenance={d.maintenanceEnabled && d.lease.status === 'Active'} unread={d.messages.unread} />
            {d.announcements.length > 0 && <Announcements items={d.announcements} className={cn(d.announcements.some(a => a.pinned) && 'hidden lg:block')} />}
            {d.announcements.some(a => !a.pinned) && d.announcements.some(a => a.pinned) && <Announcements items={d.announcements.filter(a => !a.pinned)} className="lg:hidden" title="Earlier news" />}
            <LeaseCard d={d} currency={currency} />
            {d.lease.status === 'Active' && <EmergencyCard phone={emergencyPhone} />}
          </aside>
        </div>
      </div>
    </div>
  );
}

// ── Balance ──────────────────────────────────────────────────────────────────

function BalanceCard({ d, currency }: { d: ResidentHome; currency: string }) {
  const { money, lease } = d;
  const m = (n: number) => formatMoney(n, currency);
  const next = money.nextCharges;
  const owes = money.balance > 0;

  if (lease.status === 'Pending signature') {
    return (
      <Card className="p-5 sm:p-6">
        <p className="text-sm font-medium text-muted-foreground">Before you move in</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{lease.startDate ? `Your lease starts ${longDate(lease.startDate)}` : 'Your new lease'}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/60 px-3.5 py-3">
            <dt className="text-sm text-muted-foreground">Monthly rent</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{m(lease.rent)}</dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-3.5 py-3">
            <dt className="text-sm text-muted-foreground">Due each month</dt>
            <dd className="mt-0.5 text-lg font-semibold">The {ordinal(lease.rentDueDay)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-[15px] text-muted-foreground">Your deposit and first month’s charges will show here once everyone has signed and the lease is active.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-5 sm:p-6">
        {owes ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-muted-foreground">{lease.status === 'Ended' ? 'Final balance' : 'Amount due'}</p>
              {money.pastDue > 0 && <StatusPill tone="danger">{money.pastDue >= money.balance ? 'Past due' : `${m(money.pastDue)} past due`}</StatusPill>}
            </div>
            <p className="mt-1 text-[40px] font-semibold leading-none tracking-tight tabular-nums sm:text-5xl">{m(money.balance)}</p>
            {money.openCharges.length > 0 && (
              <ul className="mt-5 divide-y rounded-lg border" aria-label="What makes up your balance">
                {money.openCharges.slice(0, 4).map(c => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[15px]">
                    <span className="min-w-0">
                      <span className="block break-words">{c.description}</span>
                      {c.dueDate && <span className={cn('block text-sm', c.overdue ? 'text-tone-danger' : 'text-muted-foreground')}>{c.overdue ? `Was due ${shortDate(c.dueDate)}` : `Due ${shortDate(c.dueDate)}`}</span>}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {m(c.open)}
                      {c.open < c.amount && <span className="block text-right text-xs font-normal text-muted-foreground">of {m(c.amount)}</span>}
                    </span>
                  </li>
                ))}
                {money.openCharges.length > 4 && (
                  <li className="px-3.5 py-2.5 text-sm text-muted-foreground">
                    and {money.openCharges.length - 4} more — <Link to="/resident/payments" className="font-medium text-primary hover:underline">see all</Link>
                  </li>
                )}
              </ul>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <LinkButton to="/resident/pay" size="lg" className="w-full sm:w-auto sm:min-w-[180px]">
                Pay {m(money.balance)} <ArrowRight aria-hidden />
              </LinkButton>
              <LinkButton to="/resident/payments" size="lg" variant="ghost" className="w-full sm:w-auto">
                Payment history
              </LinkButton>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tone-success/10 text-tone-success animate-pop">
                <CheckCircle2 className="h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-semibold tracking-tight">You’re all paid up</p>
                <p className="text-[15px] text-muted-foreground">
                  {money.credit > 0 ? `You have a ${m(money.credit)} credit — it goes toward your next charges.` : money.lastPayment ? `Last payment ${m(money.lastPayment.amount)} on ${shortDate(money.lastPayment.date)}.` : 'Nothing is due right now.'}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {next && lease.status === 'Active' && (
                <LinkButton to="/resident/pay" size="lg" variant="secondary" className="w-full sm:w-auto">
                  Pay early
                </LinkButton>
              )}
              <LinkButton to="/resident/payments" size="lg" variant="ghost" className="w-full sm:w-auto">
                Payment history
              </LinkButton>
            </div>
          </>
        )}
      </div>
      {next && (
        <div className="flex items-start gap-3 border-t bg-subtle px-5 py-3.5 sm:px-6">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 text-[15px]">
            <span className="font-medium">
              Next: {m(next.total)} due {shortDate(next.dueDate)}
            </span>{' '}
            <span className="text-muted-foreground">
              ({relativeDays(next.dueDate)})
              {next.items.length > 1 ? ` · ${next.items.map(i => i.description.replace(/ —.*$/, '')).join(' · ')}` : ''}
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Things waiting on the resident ──────────────────────────────────────────

function Attention({ d, currency }: { d: ResidentHome; currency: string }) {
  const items: Array<{ key: string; icon: LucideIcon; tone: 'accent' | 'warning' | 'info' | 'success'; title: string; body: string; to: string; cta: string }> = [];
  const { actions } = d;
  if (actions.signing) {
    const waiting = actions.signing.signers.filter(s => !s.signed && !s.isMe).map(s => s.name);
    if (!actions.signing.iSigned) {
      const signedOthers = actions.signing.signers.filter(s => s.signed && !s.isMe).map(s => firstName(s.name));
      items.push({ key: 'sign', icon: PenLine, tone: 'accent', title: 'Your lease is ready to sign', body: signedOthers.length ? `${signedOthers.join(' and ')} already signed. Review it and add your signature.` : 'Read it through and sign online — it takes a couple of minutes.', to: '/resident/lease', cta: 'Review and sign' });
    } else if (waiting.length) {
      items.push({ key: 'signed', icon: CheckCircle2, tone: 'success', title: 'You’ve signed your lease', body: `Waiting on ${waiting.join(' and ')}. Once everyone signs, the office countersigns.`, to: '/resident/lease', cta: 'View lease' });
    } else {
      items.push({ key: 'countersign', icon: CheckCircle2, tone: 'success', title: 'Everyone has signed', body: 'The office will countersign and send you a copy.', to: '/resident/lease', cta: 'View lease' });
    }
  }
  if (actions.renewal) {
    const r = actions.renewal;
    items.push({ key: 'renewal', icon: Sparkles, tone: 'accent', title: 'You have a renewal offer', body: `${r.termMonths} months at ${formatMoney(r.rent, currency)}/mo.${r.expiresOn ? ` Please respond by ${shortDate(r.expiresOn)}.` : ''}`, to: '/resident/lease#renewal', cta: 'Review offer' });
  }
  if (actions.notice?.moveOutDate) {
    items.push({ key: 'notice', icon: Truck, tone: 'warning', title: `Moving out ${longDate(actions.notice.moveOutDate)}`, body: `${actions.notice.noticeGivenOn ? `Notice given ${shortDate(actions.notice.noticeGivenOn)}. ` : ''}We’ll be in touch about your move-out inspection and keys.`, to: '/resident/lease#notice', cta: 'What happens next' });
  }
  if (actions.inspectionsToAcknowledge > 0) {
    items.push({ key: 'inspection', icon: ClipboardCheck, tone: 'info', title: actions.inspectionsToAcknowledge === 1 ? 'An inspection report is ready' : `${actions.inspectionsToAcknowledge} inspection reports are ready`, body: 'Look it over and let us know you’ve seen it.', to: '/resident/lease#inspections', cta: 'Review report' });
  }
  if (d.requests.toRate) {
    items.push({ key: 'rate', icon: Star, tone: 'success', title: `How did “${d.requests.toRate.title}” go?`, body: 'Rate the work — it takes ten seconds and helps us pick the right people.', to: `/resident/maintenance/${d.requests.toRate.number}`, cta: 'Rate the work' });
  }
  if (!items.length) return null;

  const toneClass = { accent: 'bg-tone-accent/10 text-tone-accent', warning: 'bg-tone-warning/10 text-tone-warning', info: 'bg-tone-info/10 text-tone-info', success: 'bg-tone-success/10 text-tone-success' };
  return (
    <section aria-label="Needs your attention" className="space-y-3">
      {items.map(i => (
        <Card key={i.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', toneClass[i.tone])}>
              <i.icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug">{i.title}</p>
              <p className="mt-0.5 text-[15px] text-muted-foreground">{i.body}</p>
            </div>
          </div>
          <LinkButton to={i.to} variant="ink" className="w-full shrink-0 sm:w-auto">
            {i.cta}
          </LinkButton>
        </Card>
      ))}
    </section>
  );
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

function QuickActions({ className, maintenance, unread }: { className?: string; maintenance: boolean; unread: number }) {
  const actions = [
    maintenance ? { to: '/resident/maintenance/new', label: 'Request maintenance', icon: Wrench } : { to: '/resident/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/resident/messages', label: 'Message the office', icon: MessageSquare, badge: unread },
    { to: '/resident/documents', label: 'Documents', icon: FileText },
  ];
  return (
    <nav aria-label="Shortcuts" className={cn('grid grid-cols-3 gap-2.5 lg:grid-cols-1', className)}>
      {actions.map(a => (
        <Link
          key={a.to}
          to={a.to}
          className="group relative flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border bg-card px-2 py-3 text-center shadow-xs transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 lg:min-h-0 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:py-3 lg:text-left"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
            <a.icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="text-sm font-medium leading-tight lg:flex-1 lg:text-[15px]">{a.label}</span>
          {a.badge ? <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-semibold text-primary-foreground lg:static">{a.badge}</span> : null}
          <ChevronRight className="hidden h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 lg:block" aria-hidden />
        </Link>
      ))}
    </nav>
  );
}

// ── News ─────────────────────────────────────────────────────────────────────

function Announcements({ items, className, title = 'News from the office' }: { items: ResidentHome['announcements']; className?: string; title?: string }) {
  return (
    <Panel title={title} icon={Megaphone} className={className} bodyClassName="p-0 sm:p-0">
      <ul className="divide-y">
        {items.map(a => (
          <Announcement key={a.id} a={a} />
        ))}
      </ul>
    </Panel>
  );
}

function Announcement({ a }: { a: ResidentHome['announcements'][number] }) {
  const [open, setOpen] = useState(false);
  const long = a.body.length > 160;
  return (
    <li className={cn('px-4 py-3.5 sm:px-5', a.pinned && 'bg-tone-warning/[0.04]')}>
      <div className="flex items-start gap-2">
        {a.pinned && <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-tone-warning" aria-label="Pinned" />}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug">{a.title}</p>
          <p className={cn('mt-1 whitespace-pre-line text-[15px] text-foreground/80', !open && long && 'line-clamp-3')}>{a.body}</p>
          <div className="mt-1.5 flex items-center gap-3 text-sm text-muted-foreground">
            {a.sentAt && <span>{timeAgo(a.sentAt)}</span>}
            {long && (
              <button type="button" onClick={() => setOpen(o => !o)} className="font-medium text-primary hover:underline" aria-expanded={open}>
                {open ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Maintenance ──────────────────────────────────────────────────────────────

function RequestsCard({ d }: { d: ResidentHome }) {
  const canRequest = d.maintenanceEnabled && d.lease.status === 'Active';
  return (
    <Panel
      title={d.requests.open ? `Maintenance · ${d.requests.open} open` : 'Maintenance'}
      icon={Wrench}
      bodyClassName="p-0 sm:p-0"
      action={
        <Link to="/resident/maintenance" className="rounded-md px-1.5 py-1 text-sm font-medium text-primary hover:underline">
          All requests
        </Link>
      }
    >
      {d.requests.items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-[15px] text-muted-foreground">{canRequest ? 'Nothing open right now. If something breaks, tell us here and we’ll get it fixed.' : d.lease.status === 'Pending signature' ? 'Once your lease starts, you can request repairs here.' : 'No open requests.'}</p>
          {canRequest && (
            <LinkButton to="/resident/maintenance/new" variant="secondary" className="shrink-0">
              New request
            </LinkButton>
          )}
        </div>
      ) : (
        <ul className="divide-y">
          {d.requests.items.map(r => (
            <li key={r.id}>
              <Link to={`/resident/maintenance/${r.number}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none sm:px-5">
                <CategoryGlyph category={r.category} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{r.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{r.status === 'Scheduled' && r.scheduledFor ? visitTime(r.scheduledFor) : `Reported ${shortDate(r.reportedAt)}`}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.unread > 0 && <span className="h-2 w-2 rounded-full bg-primary" aria-label="New message" />}
                  <RequestStatusPill status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

function MessagesCard({ d }: { d: ResidentHome }) {
  return (
    <Panel
      title={d.messages.unread ? `Messages · ${d.messages.unread} new` : 'Messages'}
      icon={MessageSquare}
      bodyClassName="p-0 sm:p-0"
      action={
        <Link to="/resident/messages" className="rounded-md px-1.5 py-1 text-sm font-medium text-primary hover:underline">
          Open
        </Link>
      }
    >
      {d.messages.latest.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-[15px] text-muted-foreground">Questions about your home or your account? Message the office — replies land here and in your email.</p>
          <LinkButton to="/resident/messages" variant="secondary" className="shrink-0">
            Write a message
          </LinkButton>
        </div>
      ) : (
        <ul className="divide-y">
          {d.messages.latest.map(m => (
            <li key={m.id}>
              <Link to="/resident/messages" className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:bg-accent/60 focus-visible:outline-none sm:px-5">
                <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', m.unread ? 'bg-primary' : 'bg-transparent')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className={cn('truncate text-[15px]', m.unread ? 'font-semibold' : 'font-medium')}>{m.mine ? 'You' : m.senderName}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">{timeAgo(m.sentAt)}</span>
                  </p>
                  {m.subject && <p className="truncate text-[15px]">{m.subject}</p>}
                  <p className="line-clamp-1 text-sm text-muted-foreground">{m.preview}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Lease ────────────────────────────────────────────────────────────────────

function LeaseCard({ d, currency }: { d: ResidentHome; currency: string }) {
  const { lease, money } = d;
  const phase = leasePhase(lease.phase);
  return (
    <Panel title="Your lease" icon={KeyRound} action={<StatusPill tone={phase.tone}>{phase.label}</StatusPill>}>
      <p className="text-[15px] font-medium">{lease.home}</p>
      {lease.address && <p className="text-sm text-muted-foreground">{lease.address}</p>}
      <dl className="mt-4 space-y-2.5 text-[15px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Term</dt>
          <dd className="text-right">{dateRange(lease.startDate, lease.endDate) || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Rent</dt>
          <dd className="text-right tabular-nums">
            {formatMoney(lease.rent, currency)} <span className="text-muted-foreground">on the {ordinal(lease.rentDueDay)}</span>
          </dd>
        </div>
        {money.depositHeld > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Deposit held</dt>
            <dd className="text-right tabular-nums">{formatMoney(money.depositHeld, currency)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
        <Link to="/resident/lease" className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:underline">
          Lease details <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
        {lease.status !== 'Pending signature' && (
          <Link to="/resident/payments" className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:underline">
            <Receipt className="h-4 w-4" aria-hidden /> Receipts
          </Link>
        )}
      </div>
    </Panel>
  );
}
