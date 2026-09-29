import { CheckCheck, Home, Plus, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { periodLabel } from '@project/shared/dates';
import { ActivityFeed } from '../components/home/ActivityFeed';
import { Attention } from '../components/home/Attention';
import { ExpirationsChart, ReceivedChart, WorkOrderWeeksChart } from '../components/home/Charts';
import { useDashboard, type Dashboard } from '../components/home/data';
import { EmptyState, IconButton, Tip } from '../components/primitives/bits';
import { Card, Money, StatTile } from '../components/primitives/data';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { firstName, percent, plural } from '../lib/format';
import { useWorkspace, type Workspace } from '../lib/workspace';

type Tile = { key: string; label: string; value: ReactNode; hint?: ReactNode; to: string; tone?: 'danger' | 'warning' | 'success' };

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** The key figures for this person's job, in the order they'd look for them. */
function tilesFor(d: Dashboard, ws: Workspace): Tile[] {
  const f = d.figures;
  const t: Record<string, Tile | null> = {
    occupancy: {
      key: 'occupancy', label: 'Occupancy', to: '/properties',
      value: `${percent(f.units.occupied, f.units.active)}%`,
      hint: `${f.units.occupied} of ${plural(f.units.active, 'unit')}${f.units.notice ? ` · ${f.units.notice} on notice` : ''}`,
    },
    vacant: {
      key: 'vacant', label: 'Vacant units', to: '/properties', value: f.units.vacant,
      hint: f.units.vacant ? `${percent(f.units.vacant, f.units.active)}% of the portfolio` : f.units.active ? 'Every unit is leased' : 'No units yet',
    },
    collected: f.collections ? {
      key: 'collected', label: `Rent collected · ${periodLabel(f.collections.period, true).split(' ')[0]}`, to: '/accounting/receivables',
      value: <Money value={f.collections.collected} cents={false} />,
      hint: f.collections.billed > 0 ? <span><span className={cn('font-medium', percent(f.collections.collected, f.collections.billed) >= 95 ? 'text-tone-success' : percent(f.collections.collected, f.collections.billed) < 85 ? 'text-tone-warning' : 'text-foreground')}>{percent(f.collections.collected, f.collections.billed)}%</span> of {ws.money(f.collections.billed, { cents: false })} billed</span> : 'Nothing billed yet this month',
    } : null,
    billed: f.collections ? {
      key: 'billed', label: 'Billed this month', to: '/accounting/receivables', value: <Money value={f.collections.billed} cents={false} />,
      hint: `${ws.money(f.collections.received, { cents: false })} received so far`,
    } : null,
    pastDue: f.pastDue ? {
      key: 'pastDue', label: 'Past due', to: '/accounting/receivables', value: <Money value={f.pastDue.amount} cents={false} />, tone: f.pastDue.amount > 0 ? 'danger' : undefined,
      hint: f.pastDue.leases ? `Across ${plural(f.pastDue.leases, 'lease')}` : 'Everyone is paid up',
    } : null,
    workOrders: f.workOrders ? {
      key: 'workOrders', label: 'Open work orders', to: '/work-orders', value: f.workOrders.open,
      hint: f.workOrders.emergency || f.workOrders.overdue ? <span>{f.workOrders.emergency > 0 && <span className="font-medium text-tone-danger">{plural(f.workOrders.emergency, 'emergency', 'emergencies')}</span>}{f.workOrders.emergency > 0 && f.workOrders.overdue > 0 && ' · '}{f.workOrders.overdue > 0 && `${f.workOrders.overdue} overdue`}</span> : `${f.workOrders.new} new`,
    } : null,
    emergencies: f.workOrders ? {
      key: 'emergencies', label: 'Emergencies', to: '/work-orders', value: f.workOrders.emergency, tone: f.workOrders.emergency ? 'danger' : undefined,
      hint: f.workOrders.emergency ? 'Open and urgent' : 'None open',
    } : null,
    overdue: f.workOrders ? { key: 'overdue', label: 'Overdue work', to: '/work-orders', value: f.workOrders.overdue, tone: f.workOrders.overdue ? 'warning' : undefined, hint: `${f.workOrders.unassigned} unassigned` } : null,
    mine: f.workOrders ? { key: 'mine', label: 'Assigned to you', to: '/work-orders?tab=mine', value: f.workOrders.mine, hint: `${f.workOrders.open} open in total` } : null,
    approvals: f.workOrders ? { key: 'approvals', label: 'Waiting on owners', to: '/work-orders?tab=approvals', value: f.workOrders.approvals, hint: f.workOrders.approvals ? 'Estimates to approve' : 'Nothing waiting' } : null,
    applications: f.leasing ? { key: 'applications', label: 'Applications to review', to: '/leasing/applications', value: f.leasing.applications, hint: f.leasing.applications ? 'Submitted or screening' : 'All decided' } : null,
    expiring: f.leasing ? { key: 'expiring', label: 'Leases ending ≤ 60 days', to: '/leases', value: f.leasing.expiring, tone: f.leasing.expiring ? 'warning' : undefined, hint: 'Without a renewal decision' } : null,
    bills: f.bills ? { key: 'bills', label: 'Bills due this week', to: '/accounting/payables', value: <Money value={f.bills.amount} cents={false} />, hint: f.bills.count ? `${plural(f.bills.count, 'bill')}${f.bills.overdue ? ` · ${f.bills.overdue} overdue` : ''}` : 'Nothing due' } : null,
  };
  const order: Record<string, string[]> = {
    Admin: ['occupancy', 'collected', 'pastDue', 'workOrders', 'vacant'],
    'Property Manager': ['occupancy', 'collected', 'pastDue', 'workOrders', 'vacant'],
    'Leasing Agent': ['occupancy', 'vacant', 'applications', 'expiring', 'pastDue'],
    Maintenance: ['workOrders', 'emergencies', 'overdue', 'mine', 'approvals'],
    Accountant: ['collected', 'billed', 'pastDue', 'bills', 'occupancy'],
  };
  return (order[d.role] ?? order.Admin).map(k => t[k]).filter(Boolean) as Tile[];
}

export function HomePage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  useDocumentTitle('Home');
  const { data, isPending, isError, error, refetch, isFetching } = useDashboard();
  const name = firstName(ws.me.name);
  const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const header = (
    <PageHeader
      icon={<Home />}
      title="Home"
      actions={
        <>
          <Tip label="Refresh">
            <IconButton aria-label="Refresh" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={cn(isFetching && !isPending && 'animate-spin')} />
            </IconButton>
          </Tip>
          <button type="button" onClick={() => app.openCreate('task')} className="ghost-chip h-8 gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New task</span>
          </button>
        </>
      }
    />
  );

  if (isError && !data) {
    return (
      <>
        {header}
        <EmptyState className="flex-1" icon={<Home />} title="Home didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      </>
    );
  }

  const summary: ReactNode[] = [];
  if (ws.counts.inboxUnread) summary.push(<Link key="inbox" to="/inbox" className="hover:text-foreground hover:underline">{plural(ws.counts.inboxUnread, 'unread notification')}</Link>);
  if (ws.counts.tasksOverdue) summary.push(<Link key="tasks" to="/tasks" className="text-tone-danger hover:underline">{plural(ws.counts.tasksOverdue, 'overdue task')}</Link>);
  else if (ws.counts.myTasks) summary.push(<Link key="tasks" to="/tasks" className="hover:text-foreground hover:underline">{plural(ws.counts.myTasks, 'open task')}</Link>);

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1240px] px-4 pb-16 pt-6 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-[20px] font-semibold tracking-tight">{greeting()}, {name}</h2>
              <p className="mt-0.5 text-[14px] text-muted-foreground">
                {dateLine}
                {summary.map((s, i) => <span key={i}> · {s}</span>)}
              </p>
            </div>
          </div>

          {isPending || !data ? (
            <HomeSkeleton />
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {tilesFor(data, ws).map((tile, i) => (
                  <StatTile key={tile.key} label={tile.label} value={tile.value} hint={tile.hint} tone={tile.tone} onClick={() => navigate(tile.to)} className={cn(i === 4 && 'col-span-2 md:col-span-1')} />
                ))}
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0">
                  <div className="mb-2 flex h-6 items-center justify-between">
                    <h2 className="text-[14px] font-medium">Needs attention</h2>
                    {data.sections.length > 0 && <span className="hidden text-sm text-muted-foreground sm:inline">J/K to move · ↵ to open</span>}
                  </div>
                  {data.sections.length ? (
                    <Attention sections={data.sections} role={data.role} />
                  ) : (
                    <div className="rounded-lg border bg-card shadow-2xs">
                      <EmptyState className="py-14" icon={<CheckCheck />} title="All clear" description="Nothing urgent, overdue or waiting on you. New requests, applications and payments will show up here." />
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-4">
                  {data.charts.received && data.figures.collections && (
                    <Card
                      title="Payments received"
                      action={<span className="text-sm tabular-nums text-muted-foreground"><Money value={data.figures.collections.received} cents={false} className="font-medium text-foreground" /> in {periodLabel(data.period, true).split(' ')[0]}</span>}
                      bodyClassName="px-4 pb-3 pt-3"
                    >
                      <ReceivedChart period={data.period} days={data.charts.received} today={data.today} />
                    </Card>
                  )}
                  {data.charts.expirations && (
                    <Card title="Leases ending · next 6 months" action={<Link to="/leases" className="text-sm text-muted-foreground hover:text-foreground">Leases</Link>} bodyClassName="px-4 pb-3 pt-3">
                      <ExpirationsChart months={data.charts.expirations} />
                    </Card>
                  )}
                  {data.charts.workOrderWeeks && !data.charts.received && (
                    <Card title="Work orders · last 8 weeks" action={<Link to="/work-orders" className="text-sm text-muted-foreground hover:text-foreground">Work orders</Link>} bodyClassName="px-4 pb-3 pt-3">
                      <WorkOrderWeeksChart weeks={data.charts.workOrderWeeks} />
                    </Card>
                  )}
                  <Card title="Recent activity" bodyClassName="p-0">
                    <ActivityFeed items={data.activity} />
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={cn('rounded-lg border bg-card px-4 py-3 shadow-2xs', i === 4 && 'col-span-2 md:col-span-1')}>
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-2.5 h-6 w-16" />
            <div className="skeleton mt-2 h-2.5 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="skeleton mb-2 h-3.5 w-28" />
          {[4, 3, 2].map((rows, s) => (
            <div key={s} className="overflow-hidden rounded-lg border bg-card">
              <div className="flex h-10 items-center gap-2 border-b px-3"><div className="skeleton h-3 w-44" /></div>
              {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex h-10 items-center gap-3 border-b border-border/60 px-3 last:border-0">
                  <div className="skeleton h-3" style={{ width: `${30 + ((i * 23 + s * 11) % 35)}%` }} />
                  <div className="ml-auto skeleton h-3 w-14" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="h-[196px] rounded-lg border bg-card p-4"><div className="skeleton h-3 w-40" /><div className="skeleton mt-6 h-[120px] w-full" /></div>
          <div className="h-[220px] rounded-lg border bg-card p-4"><div className="skeleton h-3 w-36" /><div className="skeleton mt-6 h-[140px] w-full" /></div>
        </div>
      </div>
    </div>
  );
}
