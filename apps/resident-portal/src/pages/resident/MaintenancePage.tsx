import { CalendarClock, ChevronRight, Image as ImageIcon, Plus, Star, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CategoryGlyph, EmergencyCard, LoadError, RequestStatusPill, ResidentSkeleton } from '../../components/resident/bits';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Segmented } from '../../components/resident/Segmented';
import { Card, Container, EmptyState, LinkButton } from '../../components/ui';
import { shortDate } from '../../lib/format';
import { categoryMeta, requestStatus, visitTime } from '../../lib/residentFormat';
import { useResidentLease } from '../../lib/residentLease';
import { useResidentRequests, type RequestRow } from '../../lib/residentQueries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/** Maintenance requests for the resident's home: what's open and when someone's coming, and what was fixed before. */
export default function MaintenancePage() {
  useDocumentTitle('Maintenance');
  const { leaseId } = useResidentLease();
  const q = useResidentRequests(leaseId);
  const [tab, setTab] = useState<'open' | 'past' | null>(null);

  if (q.isPending) return <ResidentSkeleton variant="list" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your requests" />;

  const d = q.data;
  const active = tab ?? (d.open.length === 0 && d.past.length > 0 ? 'past' : 'open');
  const rows = active === 'open' ? d.open : d.past;

  return (
    <div className="animate-fade-in">
      <ResidentHeader
        title="Maintenance"
        subtitle={<LeaseSwitcher />}
        actions={
          d.canRequest ? (
            <LinkButton to="/resident/maintenance/new" size="lg" className="w-full sm:w-auto">
              <Plus aria-hidden /> New request
            </LinkButton>
          ) : null
        }
      />
      <Container className="pb-4 pt-4">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Segmented
                label="Requests"
                value={active}
                onChange={v => setTab(v as 'open' | 'past')}
                options={[
                  { value: 'open', label: 'Open', count: d.open.length },
                  { value: 'past', label: 'Past', count: d.past.length },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <Card>
                {active === 'open' ? (
                  <EmptyState
                    icon={Wrench}
                    title="Nothing needs fixing"
                    action={
                      d.canRequest ? (
                        <LinkButton to="/resident/maintenance/new" variant="secondary">
                          Request maintenance
                        </LinkButton>
                      ) : null
                    }
                  >
                    {d.canRequest ? 'When something breaks, send a request with a few photos and we’ll take it from there.' : 'You have no open requests.'}
                  </EmptyState>
                ) : (
                  <EmptyState icon={Wrench} title="No past requests">
                    Finished and canceled requests will be listed here.
                  </EmptyState>
                )}
              </Card>
            ) : (
              <ul className="space-y-2.5">
                {rows.map(r => (
                  <li key={r.id}>
                    <RequestCard r={r} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <aside className="space-y-4">
            {d.canRequest && <EmergencyCard phone={d.emergencyPhone} />}
            <Card className="p-4">
              <p className="text-[15px] font-semibold">What happens next</p>
              <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
                <li><span className="font-medium text-foreground">Received</span> — we review every request, usually within one business day.</li>
                <li><span className="font-medium text-foreground">Scheduled</span> — we’ll tell you when someone is coming and who.</li>
                <li><span className="font-medium text-foreground">Done</span> — you’ll get a note when it’s finished, and can tell us how it went.</li>
              </ol>
            </Card>
          </aside>
        </div>
      </Container>
    </div>
  );
}

function RequestCard({ r }: { r: RequestRow }) {
  const status = requestStatus(r.status);
  const when =
    r.status === 'Scheduled' && r.scheduledFor
      ? { icon: CalendarClock, text: visitTime(r.scheduledFor) }
      : r.status === 'Completed' && r.completedAt
        ? { icon: null, text: `Finished ${shortDate(r.completedAt)}` }
        : { icon: null, text: `Reported ${shortDate(r.reportedAt)}` };
  return (
    <Link
      to={`/resident/maintenance/${r.number}`}
      className="group flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-xs transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:gap-4 sm:p-4"
    >
      <CategoryGlyph category={r.category} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-words text-[15px] font-semibold leading-snug">{r.title}</p>
          <RequestStatusPill status={r.status} className="hidden sm:inline-flex" />
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          WO-{r.number} · {categoryMeta(r.category).label}
        </p>
        {r.vendorName && r.status !== 'Canceled' && <p className="truncate text-sm text-muted-foreground">{r.vendorName}</p>}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <RequestStatusPill status={r.status} className="h-6 sm:hidden" />
          <span className="inline-flex items-center gap-1.5 text-foreground/80">
            {when.icon && <when.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
            {when.text}
          </span>
          {r.photoCount > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" aria-hidden /> {r.photoCount}
            </span>
          )}
          {r.tenantRating != null && (
            <span className="inline-flex items-center gap-1 text-muted-foreground" aria-label={`You rated ${r.tenantRating} out of 5`}>
              <Star className="h-3.5 w-3.5 fill-current text-tone-warning" aria-hidden /> {r.tenantRating}/5
            </span>
          )}
          {r.unread > 0 && <span className="rounded-full bg-primary px-2 py-px text-2xs font-semibold text-primary-foreground">{r.unread === 1 ? 'New message' : `${r.unread} new messages`}</span>}
        </p>
        <span className="sr-only">{status.hint}</span>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
