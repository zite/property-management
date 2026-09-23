import { ChevronRight, ClipboardCheck, DoorClosed, DoorOpen, Hourglass, MapPin, MessageSquare, Search, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { AreaSkeleton, LoadError, PageHeader, Segmented, money, telHref, workOrderTone } from '../../components/owner/kit';
import { JobActions } from '../../components/vendor/actions';
import { useVendorWorkOrders, type VendorRow } from '../../components/vendor/data';
import { visitLabel } from '../../components/vendor/format';
import { Button, Card, Container, EmptyState, StatusPill, inputClass } from '../../components/ui';
import { mediumDateTime, plural, shortDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The vendor's work: open jobs by priority — Emergency first — then by when
 * they're scheduled, with the next step one tap away; and completed jobs.
 */

export default function VendorHomePage() {
  useDocumentTitle('Work orders');
  const q = useVendorWorkOrders();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'done' ? 'done' : 'open';
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const all = q.data?.workOrders ?? [];
    const term = search.trim().toLowerCase();
    return all.filter(w => (tab === 'open' ? w.open : !w.open)).filter(w => !term || `${w.ref} ${w.title} ${w.address} ${w.propertyName} ${w.category}`.toLowerCase().includes(term));
  }, [q.data, tab, search]);

  if (q.isPending) return <AreaSkeleton variant="list" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your work orders" home={{ to: '/', label: 'Portal home' }} />;
  const d = q.data;
  const open = d.workOrders.filter(w => w.open);
  const done = d.workOrders.filter(w => !w.open);
  const emergencies = open.filter(w => w.priority === 'Emergency').length;
  const unscheduled = open.filter(w => !w.scheduledFor && !w.awaitingApproval && w.status !== 'In progress').length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={d.vendorName}
        title="Work orders"
        subtitle={
          open.length === 0
            ? 'No open jobs right now.'
            : [plural(open.length, 'open job'), emergencies ? `${emergencies} emergency` : null, unscheduled ? `${unscheduled} to schedule` : null].filter(Boolean).join(' · ')
        }
      />
      <Container className="space-y-4 pb-4 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented
            label="Work orders"
            value={tab}
            onChange={v => {
              const next = new URLSearchParams(params);
              if (v === 'done') next.set('tab', 'done');
              else next.delete('tab');
              setParams(next, { replace: true });
            }}
            options={[
              { value: 'open', label: 'Open', count: open.length },
              { value: 'done', label: 'Completed', count: done.length },
            ]}
          />
          {d.workOrders.length > 0 && (
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by address or job" aria-label="Search work orders" className={inputClass('pl-9')} />
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <Card>
            {search.trim() ? (
              <EmptyState icon={Search} title="Nothing matches" action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>}>
                No {tab === 'open' ? 'open' : 'completed'} jobs match “{search.trim()}”.
              </EmptyState>
            ) : tab === 'open' ? (
              <EmptyState icon={ClipboardCheck} title="You’re all caught up">
                New jobs show up here, and you’ll get an email when one is assigned to you.
                {d.office.phone && (
                  <>
                    {' '}
                    Questions? Call <a className="font-medium text-primary hover:underline" href={telHref(d.office.phone)}>{d.office.phone}</a>.
                  </>
                )}
              </EmptyState>
            ) : (
              <EmptyState icon={Wrench} title="No completed jobs yet">
                Jobs you finish will be listed here with what you charged.
              </EmptyState>
            )}
          </Card>
        ) : (
          <ul className="space-y-3" aria-label={tab === 'open' ? 'Open work orders' : 'Completed work orders'}>
            {rows.map(w => (
              <JobRow key={w.id} w={w} />
            ))}
          </ul>
        )}
      </Container>
    </div>
  );
}

function JobRow({ w }: { w: VendorRow }) {
  const emergency = w.priority === 'Emergency' && w.open;
  const visit = visitLabel(w.scheduledFor);
  return (
    <li>
      <Card className={cn('overflow-hidden transition-[border-color,box-shadow] hover:border-foreground/20', emergency && 'border-tone-danger/40 ring-1 ring-inset ring-tone-danger/20')}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
          <Link to={`/vendor/work-orders/${w.number}`} className="group min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular-nums text-muted-foreground">{w.ref}</span>
              {emergency ? (
                <StatusPill tone="danger">Emergency</StatusPill>
              ) : w.priority === 'High' && w.open ? (
                <StatusPill tone="warning" dot={false}>
                  High priority
                </StatusPill>
              ) : null}
              {w.awaitingApproval && w.open ? (
                <StatusPill tone="warning">
                  <Hourglass className="h-3 w-3" aria-hidden /> {w.approvalDeclined ? 'Owner declined' : 'Waiting for owner approval'}
                </StatusPill>
              ) : (
                <StatusPill tone={workOrderTone(w.status)}>{w.status}</StatusPill>
              )}
              {w.unreadMessages > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-2xs font-semibold text-primary-foreground">
                  <MessageSquare className="h-3 w-3" aria-hidden /> {w.unreadMessages} new
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-[17px] font-semibold leading-snug group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">{w.title}</p>
            <p className="mt-1 flex items-start gap-1.5 text-[15px] text-muted-foreground">
              <MapPin className="mt-1 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{w.address || w.propertyName}</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {w.open ? (
                <span className={cn('inline-flex items-center gap-1.5', visit ? 'font-medium text-foreground' : 'text-muted-foreground')} title={w.scheduledFor ? mediumDateTime(w.scheduledFor) : undefined}>
                  {visit ?? 'Not scheduled yet'}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {w.status === 'Canceled' ? 'Canceled' : w.completedAt ? `Completed ${shortDate(w.completedAt)}` : 'Completed'}
                  {w.actualCost != null && w.status === 'Completed' ? ` · ${money(w.actualCost)}` : ''}
                </span>
              )}
              {w.open && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  {w.permissionToEnter ? <DoorOpen className="h-4 w-4" aria-hidden /> : <DoorClosed className="h-4 w-4" aria-hidden />}
                  {w.permissionToEnter ? 'OK to enter' : 'Arrange entry'}
                </span>
              )}
            </p>
          </Link>
          {w.open && !w.awaitingApproval && (
            <div className="flex shrink-0 items-center gap-2 border-t pt-3 sm:border-0 sm:pt-0">
              <JobActions job={w} size="sm" only={w.status === 'In progress' ? ['complete'] : w.scheduledFor ? ['start'] : ['schedule']} />
              <Link to={`/vendor/work-orders/${w.number}`} aria-label={`Open ${w.ref}`} className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:flex">
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}
