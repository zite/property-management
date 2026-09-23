import { Building2, CalendarClock, ChevronDown, Landmark, MessageSquare, Phone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { LoadError, Panel, ResidentSkeleton } from '../../components/resident/bits';
import { PayOnline, stripeKeyPresent } from '../../components/resident/PayOnline';
import { ReportPayment } from '../../components/resident/ReportPayment';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Card, Container, StatusPill } from '../../components/ui';
import { formatMoney, shortDate } from '../../lib/format';
import { usePortal } from '../../lib/queries';
import { relativeDays, telHref } from '../../lib/residentFormat';
import { useResidentLease } from '../../lib/residentLease';
import { useResidentLedger, type ResidentLedger } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Paying rent. With the organization's Stripe account connected, residents pay
 * by card or bank right here. Without it — or for anyone paying by check —
 * the page shows how to pay and lets them tell the office they've sent it.
 */
export default function PayPage() {
  useDocumentTitle('Pay rent');
  const { leaseId } = useResidentLease();
  const portal = usePortal();
  const q = useResidentLedger(leaseId);

  if (q.isPending || portal.isPending) return <ResidentSkeleton variant="document" />;
  if (q.isError || !q.data || !leaseId) return <LoadError error={q.error} onRetry={() => q.refetch()} what="the payment page" />;

  const d = q.data;
  const settings = portal.data?.settings;
  const online = Boolean(portal.data?.features.stripeReady && d.canPayOnline && stripeKeyPresent());
  const suggested = d.balance > 0 ? d.balance : d.nextCharges?.total ?? 0;

  return (
    <div className="animate-fade-in">
      <ResidentHeader title={online ? 'Pay rent' : 'How to pay'} subtitle={<LeaseSwitcher />} back={{ to: '/resident/payments', label: 'Payments' }} />
      <Container className="pb-4 pt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            {online ? (
              <>
                <PayOnline leaseId={leaseId} ledger={d} brandColor={settings?.brandColor ?? '#0f766e'} />
                <Collapsible title="Paying another way?" icon={Landmark}>
                  <Instructions d={d} text={settings?.paymentInstructions ?? ''} />
                  <div className="mt-5 border-t pt-5">
                    <h3 className="mb-3 text-[15px] font-semibold">Already sent a payment? Let us know</h3>
                    <ReportPayment leaseId={leaseId} currency={d.currency} suggested={suggested} />
                  </div>
                </Collapsible>
              </>
            ) : (
              <>
                <Panel title="Ways to pay" icon={Landmark}>
                  <Instructions d={d} text={settings?.paymentInstructions ?? ''} />
                  {portal.data?.features.onlinePayments && !portal.data.features.stripeReady && (
                    <p className="mt-4 rounded-lg bg-muted/60 px-3.5 py-2.5 text-sm text-muted-foreground">Card and bank payments in the portal aren’t switched on yet. Until they are, please use one of the options above.</p>
                  )}
                </Panel>
                <Panel title="Already paid? Tell us" icon={MessageSquare}>
                  <p className="mb-4 text-[15px] text-muted-foreground">Sent a check or a bank transfer? Let the office know so they can watch for it.</p>
                  <ReportPayment leaseId={leaseId} currency={d.currency} suggested={suggested} />
                </Panel>
              </>
            )}
            <BalanceHelp phone={settings?.phone ?? ''} className="lg:hidden" />
          </div>

          <aside className="order-first min-w-0 space-y-5 lg:order-none">
            <OwedSummary d={d} />
            <BalanceHelp phone={settings?.phone ?? ''} className="hidden lg:block" />
          </aside>
        </div>
      </Container>
    </div>
  );
}

function BalanceHelp({ phone, className }: { phone: string; className?: string }) {
  return (
            <Card className={cn('p-4 sm:p-5', className)}>
              <p className="text-[15px] font-semibold">Questions about your balance?</p>
              <p className="mt-1 text-sm text-muted-foreground">If something looks wrong or you need a payment plan, talk to us early — we’d rather hear from you.</p>
              <div className="mt-3 flex flex-col gap-1.5">
                <Link to="/resident/messages" className="inline-flex items-center gap-2 text-[15px] font-medium text-primary hover:underline">
                  <MessageSquare className="h-4 w-4" aria-hidden /> Message the office
                </Link>
                {phone && (
                  <a href={telHref(phone)} className="inline-flex items-center gap-2 text-[15px] font-medium text-primary hover:underline">
                    <Phone className="h-4 w-4" aria-hidden /> {phone}
                  </a>
                )}
              </div>
            </Card>
  );
}

function OwedSummary({ d }: { d: ResidentLedger }) {
  const m = (n: number) => formatMoney(n, d.currency);
  const open = d.entries.filter(e => e.type === 'charge' && !e.reversed && (e.open ?? 0) > 0);
  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{d.balance < 0 ? 'Credit on your account' : 'Balance today'}</p>
          {d.pastDue > 0 && <StatusPill tone="danger">Past due</StatusPill>}
        </div>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{m(Math.abs(d.balance))}</p>
        {open.length > 0 && (
          <ul className="mt-3 space-y-2 text-[15px]">
            {open.slice(0, 6).map(e => (
              <li key={e.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="block break-words">{e.label}</span>
                  {e.dueDate && <span className={cn('block text-sm', e.overdue ? 'text-tone-danger' : 'text-muted-foreground')}>Due {shortDate(e.dueDate)}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{m(e.open ?? 0)}</span>
              </li>
            ))}
            {open.length > 6 && <li className="text-sm text-muted-foreground">and {open.length - 6} more</li>}
          </ul>
        )}
      </div>
      {d.nextCharges && (
        <div className="border-t bg-subtle px-4 py-3 sm:px-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4" aria-hidden /> Next due {shortDate(d.nextCharges.dueDate)} ({relativeDays(d.nextCharges.dueDate)})
          </p>
          <ul className="mt-1.5 space-y-1 text-[15px]">
            {d.nextCharges.items.map(i => (
              <li key={i.description} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{i.description}</span>
                <span className="shrink-0 tabular-nums">{m(i.amount)}</span>
              </li>
            ))}
          </ul>
          {d.nextCharges.items.length > 1 && (
            <p className="mt-1.5 flex justify-between border-t pt-1.5 text-[15px] font-medium">
              <span>Total</span>
              <span className="tabular-nums">{m(d.nextCharges.total)}</span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Instructions({ d, text }: { d: ResidentLedger; text: string }) {
  const paragraphs = text.split(/\n{2,}|\n/).map(p => p.trim()).filter(Boolean);
  return (
    <div className="space-y-4">
      <div className="space-y-2 text-[15px] leading-relaxed">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <dl className="grid gap-3 rounded-xl border bg-subtle p-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Make checks payable to</dt>
          <dd className="text-[15px] font-medium">{d.payableTo}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Write in the memo</dt>
          <dd className="text-[15px] font-medium">{d.home}</dd>
        </div>
        {d.officeAddress && (
          <div className="sm:col-span-2">
            <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" aria-hidden /> Drop off or mail to
            </dt>
            <dd className="whitespace-pre-line text-[15px] font-medium">{d.officeAddress}</dd>
            {d.officeHours && <dd className="text-sm text-muted-foreground">Office hours {d.officeHours}</dd>}
          </div>
        )}
      </dl>
    </div>
  );
}

function Collapsible({ title, icon: Icon, children }: { title: string; icon: typeof Landmark; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/40 focus-visible:bg-accent/50 focus-visible:outline-none sm:px-5">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> {title}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="border-t px-4 py-4 sm:px-5">{children}</div>}
    </Card>
  );
}
