import { ArrowRight, Banknote, Building2, ChevronRight, ShieldCheck, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { CashFlowChart } from '../../components/owner/CashFlowChart';
import { useOwnerOverview, type OwnerOverview } from '../../components/owner/data';
import { AreaSkeleton, LoadError, PageHeader, Panel, StatTile, greeting, money, workOrderTone } from '../../components/owner/kit';
import { Alert, Card, Container, EmptyState, LinkButton, ProgressBar, StatusPill } from '../../components/ui';
import { firstName, plural, shortDate, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * The owner's portfolio at a glance: how full the buildings are, this month's
 * rent, cash flow this month and this year, what can be paid out, each
 * property, anything waiting on them, and what's been happening.
 */
export default function OwnerHomePage() {
  useDocumentTitle('Overview');
  const q = useOwnerOverview();

  if (q.isPending) return <AreaSkeleton tiles={5} />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your portfolio" home={{ to: '/', label: 'Portal home' }} />;
  const d = q.data;
  const name = firstName(d.owner.contactName);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={d.owner.name}
        title={`${greeting()}${name ? `, ${name}` : ''}`}
        subtitle={d.properties.length ? `Here’s how your ${plural(d.properties.length, 'property', 'properties')} ${d.properties.length === 1 ? 'is' : 'are'} doing in ${d.periodLabel.split(' ')[0]}.` : 'Your owner portal'}
        actions={
          d.properties.length ? (
            <LinkButton to="/owner/statements" variant="secondary">
              Statements
            </LinkButton>
          ) : undefined
        }
      />
      <Container className="space-y-5 pb-4 pt-4">
        {d.properties.length === 0 ? (
          <Card>
            <EmptyState icon={Building2} title="No properties to show yet">
              When your property manager links your properties to this account, their performance, statements and repairs will appear here.
            </EmptyState>
          </Card>
        ) : (
          <>
            {d.approvals.length > 0 && <ApprovalsCallout approvals={d.approvals} currency={d.currency} />}
            {d.warnings.length > 0 && (
              <Alert tone="warning" title="Some figures are being reconciled">
                The office is reviewing a difference in the books. Numbers may change slightly once it’s resolved.
              </Alert>
            )}
            <Kpis d={d} />
            <Panel title="Income and expenses" description="Cash received and paid out, last 8 months">
              <CashFlowChart rows={d.cashFlow} currency={d.currency} partialLabel={`${d.periodLabel} is month to date.`} />
            </Panel>
            <Properties d={d} />
            <div className="grid gap-5 lg:grid-cols-2">
              <Distributions d={d} />
              <Maintenance d={d} />
            </div>
          </>
        )}
      </Container>
    </div>
  );
}

function ApprovalsCallout({ approvals, currency }: { approvals: OwnerOverview['approvals']; currency: string }) {
  const first = approvals[0];
  return (
    <Alert
      tone="warning"
      icon={ShieldCheck}
      title={approvals.length === 1 ? 'A repair needs your approval' : `${approvals.length} repairs need your approval`}
      action={
        <LinkButton to="/owner/approvals" size="sm">
          Review {approvals.length === 1 ? 'it' : 'them'} <ArrowRight aria-hidden />
        </LinkButton>
      }
    >
      <span className="break-words">
        {first.title} at {first.propertyName}
        {first.estimate != null ? ` — estimate ${money(first.estimate, currency)}` : ''}
        {approvals.length > 1 ? `, and ${plural(approvals.length - 1, 'more')}` : ''}.
      </span>
    </Alert>
  );
}

function Kpis({ d }: { d: OwnerOverview }) {
  const k = d.kpis;
  const c = d.currency;
  const occupiedNow = k.occupied + k.notice;
  const occupancy = k.units ? occupiedNow / k.units : 0;
  const charged = k.rentCharged || k.rentScheduled;
  const month = d.periodLabel.split(' ')[0];
  const lastDistribution = d.distributions[0];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatTile label="Occupancy" value={`${Math.round(occupancy * 100)}%`} detail={`${occupiedNow} of ${plural(k.units, 'unit')} occupied${k.notice ? ` · ${k.notice} on notice` : ''}`}>
        <ProgressBar value={occupancy} className="mt-2.5 h-1.5" label="Occupancy" tone="success" />
      </StatTile>
      <StatTile label="Rent collected" value={money(k.rentCollected, c, { cents: false })} detail={charged ? `of ${money(charged, c, { cents: false })} ${k.rentCharged ? 'charged' : 'scheduled'} in ${month}` : `Nothing charged in ${month} yet`}>
        <ProgressBar value={charged ? k.rentCollected / charged : 0} className="mt-2.5 h-1.5" label="Rent collected" />
      </StatTile>
      <StatTile label="Net cash flow" value={money(k.netCashFlowMonth, c, { cents: false })} tone={k.netCashFlowMonth < 0 ? 'danger' : undefined} detail={`${month} · ${money(k.netCashFlowYtd, c, { cents: false })} this year`} />
      <StatTile
        label="Available to distribute"
        value={money(Math.max(0, k.availableToDistribute), c, { cents: false })}
        detail={k.availableToDistribute > 0 ? 'After deposits, reserves and unpaid bills' : 'Deposits, reserves and bills come first'}
      />
      <StatTile
        className="col-span-2 lg:col-span-1"
        label={`Distributions, ${d.today.slice(0, 4)}`}
        value={money(k.distributionsYtd, c, { cents: false })}
        detail={lastDistribution ? `Last paid ${shortDate(lastDistribution.date)}` : 'None paid this year'}
      />
    </div>
  );
}

function Properties({ d }: { d: OwnerOverview }) {
  return (
    <section aria-labelledby="owner-properties">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="owner-properties" className="text-lg font-semibold">
          Properties <span className="text-sm font-normal tabular-nums text-faint">{d.properties.length}</span>
        </h2>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {d.properties.map(p => (
          <li key={p.id}>
            <Link
              to={`/owner/properties/${p.id}`}
              className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            >
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
                {p.photoUrl ? (
                  <img src={p.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center" style={{ background: `${p.color}14` }}>
                    <Building2 className="h-8 w-8 text-muted-foreground" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold leading-snug">{p.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{p.address}</p>
                  </div>
                  <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  <span className="chip-soft text-xs">{plural(p.units, 'unit')}</span>
                  {p.occupied > 0 && <StatusPill tone="success">{p.occupied} occupied</StatusPill>}
                  {p.notice > 0 && <StatusPill tone="warning">{p.notice} on notice</StatusPill>}
                  {p.vacant > 0 && <StatusPill tone="danger">{p.vacant} vacant</StatusPill>}
                </div>
                <dl className="mt-auto grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Income this month</dt>
                    <dd className="font-semibold tabular-nums">{money(p.incomeMonth, d.currency, { cents: false })}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Available</dt>
                    <dd className="font-semibold tabular-nums">{money(Math.max(0, p.available), d.currency, { cents: false })}</dd>
                  </div>
                </dl>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Distributions({ d }: { d: OwnerOverview }) {
  return (
    <Panel title="Recent distributions" icon={Banknote} action={<Link to="/owner/statements" className="text-sm font-medium text-primary hover:underline">Statements</Link>} flush>
      {d.distributions.length === 0 ? (
        <p className="px-5 py-8 text-center text-[15px] text-muted-foreground">No distributions have been paid yet. They’ll show here once your property manager sends one.</p>
      ) : (
        <ul className="divide-y">
          {d.distributions.map(x => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="truncate font-medium">{x.propertyName}</p>
                <p className="text-sm text-muted-foreground">
                  {shortDate(x.date)}
                  {x.method ? ` · ${x.method}` : ''}
                  {x.reference ? ` #${x.reference}` : ''}
                </p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums">{money(x.amount, d.currency)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Maintenance({ d }: { d: OwnerOverview }) {
  return (
    <Panel title="Recent maintenance" icon={Wrench} flush>
      {d.maintenance.length === 0 ? (
        <p className="px-5 py-8 text-center text-[15px] text-muted-foreground">No repairs on your properties yet.</p>
      ) : (
        <ul className="divide-y">
          {d.maintenance.map(w => (
            <li key={w.number} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="break-words font-medium leading-snug">{w.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {[w.propertyName, w.unitName && !/^main$/i.test(w.unitName) ? `#${w.unitName}` : ''].filter(Boolean).join(' ')}
                  {w.updatedAt ? ` · ${timeAgo(w.updatedAt)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusPill tone={w.priority === 'Emergency' && w.status !== 'Completed' ? 'danger' : workOrderTone(w.status)}>{w.priority === 'Emergency' && w.status !== 'Completed' ? 'Emergency' : w.status}</StatusPill>
                {w.cost != null && <span className={cn('text-sm font-medium tabular-nums')}>{money(w.cost, d.currency)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
