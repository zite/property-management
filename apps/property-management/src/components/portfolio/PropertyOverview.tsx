import { ArrowRight, CalendarClock, LogIn, LogOut, TriangleAlert, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { OPEN_WORK_ORDER_STATUSES } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { daysFromToday, fullDate, percent, plural, relativeDays, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Timeline } from '../detail/Timeline';
import { EmptyState, ProgressBar, Tip } from '../primitives/bits';
import { Card, Money, StatTile } from '../primitives/data';
import { Pill, PriorityGlyph, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { DueChip } from '../workOrders/WorkOrderRow';
import { OccupancyBar, ReadinessGlyph } from './bits';
import { occupancyOf, type PropertyDetail } from './data';

/** The property's Overview tab: today's figures, the next 60 days, open work, the property itself, and what happened lately. */
export function PropertyOverview({ detail, onTab }: { detail: PropertyDetail; onTab: (tab: string) => void }) {
  const ws = useWorkspace();
  const p = detail.property;
  const f = detail.finances;
  const units = (ws.unitsByProperty.get(p.id) ?? []).filter(u => !u.archived);
  const occ = occupancyOf(units);
  const readiness = units.reduce<Record<string, number>>((a, u) => ({ ...a, [u.readiness]: (a[u.readiness] ?? 0) + 1 }), {});
  const vacantReady = units.filter(u => u.occupancy !== 'Occupied' && u.readiness === 'Ready').length;
  const bank = p.bankAccountId ? ws.accountById.get(p.bankAccountId) : undefined;
  const leasesLink = ws.can('residents.manage') || ws.can('portfolio.manage') || ws.can('accounting.view');
  const collectedShare = f && f.scheduledRent > 0 ? Math.min(1, f.collectedThisMonth / f.scheduledRent) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Occupancy"
          value={occ.total ? `${percent(occ.occupied + occ.notice, occ.total)}%` : '—'}
          hint={occ.total ? `${occ.occupied + occ.notice} of ${plural(occ.total, 'unit')}${occ.notice ? ` · ${occ.notice} on notice` : ''}` : 'No units yet'}
          onClick={() => onTab('units')}
        />
        {f ? (
          <>
            <StatTile label="Scheduled rent" value={<Money value={f.scheduledRent} cents={false} />} hint={`${plural(units.filter(u => u.currentLeaseId).length, 'current lease')} · per month`} />
            <StatTile
              label="Collected this month"
              value={<Money value={f.collectedThisMonth} cents={false} />}
              hint={<span className="flex w-full items-center gap-2"><ProgressBar value={collectedShare} tone={collectedShare >= 0.95 ? 'success' : 'primary'} className="w-16" /> {percent(f.collectedThisMonth, f.scheduledRent)}% of scheduled</span>}
            />
            <StatTile label="Past due" value={<Money value={f.pastDue} />} tone={f.pastDue > 0.005 ? 'danger' : undefined} hint={f.pastDue > 0.005 ? 'Open charges past their due date' : 'Everyone is paid up'} onClick={leasesLink ? () => onTab('leases') : undefined} />
          </>
        ) : (
          <>
            <StatTile label="Vacant" value={occ.vacant} hint={vacantReady ? `${vacantReady} rent-ready` : occ.vacant ? 'None rent-ready yet' : 'Fully leased'} onClick={() => onTab('units')} />
            <StatTile label="Open work orders" value={detail.workOrders.open} tone={detail.workOrders.emergency ? 'danger' : undefined} hint={detail.workOrders.emergency ? `${detail.workOrders.emergency} emergency` : detail.workOrders.overdue ? `${detail.workOrders.overdue} overdue` : 'Nothing overdue'} onClick={ws.can('maintenance.create') ? () => onTab('work-orders') : undefined} />
            <StatTile label="Coming up" value={detail.events.length} hint="Moves and lease ends in 60 days" />
          </>
        )}
      </div>

      {f && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Cash balance"
            value={<Money value={f.cash} />}
            hint={f.cashAccounts.length > 1 ? `Across ${f.cashAccounts.length} bank accounts` : bank ? bank.name : 'All bank accounts'}
          />
          <StatTile label="Security deposits held" value={<Money value={f.depositsHeld} />} hint="Owed back to residents" />
          <StatTile
            label="Available for distribution"
            value={<Money value={f.availableForDistribution} />}
            tone={f.availableForDistribution < -0.005 ? 'danger' : undefined}
            hint={
              <Tip label={`Cash ${ws.money(f.cash)} − deposits ${ws.money(f.depositsHeld)} − reserve ${ws.money(f.reserve)} − unpaid bills ${ws.money(f.unpaidBills)}`}>
                <span className="truncate underline decoration-dotted underline-offset-2">After {ws.money(f.reserve, { cents: false })} reserve{f.unpaidBills > 0 ? ` and ${ws.money(f.unpaidBills)} in bills` : ''}</span>
              </Tip>
            }
          />
        </div>
      )}
      {f && !f.statementReconciled && (
        <p className="flex items-center gap-2 rounded-md border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-sm text-tone-warning">
          <TriangleAlert className="h-3.5 w-3.5" /> This month’s transactions don’t add up to the bank lines for this property. The ledger needs a review before distributing.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card title={<span className="flex items-center gap-2">Coming up <span className="text-sm font-normal text-muted-foreground">next 60 days</span></span>} bodyClassName="p-0">
            {detail.events.length === 0 ? (
              <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">No move-ins, move-outs or lease ends in the next 60 days.</p>
            ) : (
              <ul className="divide-y">
                {detail.events.map(e => {
                  const days = daysFromToday(e.date) ?? 0;
                  const meta = EVENT_META[e.kind];
                  const body = (
                    <>
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-subtle [&_svg]:h-3.5 [&_svg]:w-3.5', meta.className)}>{meta.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-medium">{e.unitId ? ws.unitLabel(e.unitId) : p.name}</span>
                          {e.status === 'Pending signature' && <Pill tone="accent">Awaiting signature</Pill>}
                          {e.kind === 'expiring' && e.renewalStatus !== 'None' && <Pill tone={e.renewalStatus === 'Accepted' ? 'success' : e.renewalStatus === 'Declined' ? 'danger' : 'info'}>Renewal {e.renewalStatus.toLowerCase()}</Pill>}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">{meta.label} · {e.leaseName}</span>
                      </span>
                      <Tip label={fullDate(e.date)}>
                        <span className={cn('shrink-0 text-right text-sm tabular-nums', days <= 7 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                          {shortDate(e.date)}
                          <span className="block text-2xs text-muted-foreground">{relativeDays(e.date)}</span>
                        </span>
                      </Tip>
                    </>
                  );
                  return (
                    <li key={e.key}>
                      {ws.can('residents.manage') ? (
                        <Link to={`/leases/${e.leaseId}`} className="flex items-center gap-3 px-4 py-2 hover:bg-accent/40">{body}</Link>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-2">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {ws.can('maintenance.create') && (
            <Card
              title={<span className="flex items-center gap-2">Open work orders <span className="text-sm font-normal tabular-nums text-muted-foreground">{detail.workOrders.open}</span></span>}
              action={detail.workOrders.open > 0 && <button type="button" onClick={() => onTab('work-orders')} className="ghost-chip h-8 text-sm">View all <ArrowRight className="h-3 w-3" /></button>}
              bodyClassName="p-0"
            >
              {detail.workOrders.open === 0 ? (
                <EmptyState className="py-8" icon={<Wrench />} title="No open work orders" description="Nothing needs fixing here right now." />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-sm text-muted-foreground">
                    {OPEN_WORK_ORDER_STATUSES.filter(s => detail.workOrders.byStatus[s]).map(s => (
                      <span key={s} className="inline-flex items-center gap-1.5"><WorkOrderStatusGlyph status={s} size={12} /> {detail.workOrders.byStatus[s]} {s.toLowerCase()}</span>
                    ))}
                    {detail.workOrders.overdue > 0 && <span className="text-tone-danger">{detail.workOrders.overdue} overdue</span>}
                  </div>
                  <ul className="divide-y">
                    {detail.workOrders.top.map(w => (
                      <li key={w.id}>
                        <Link to={`/work-orders/${w.number}`} className="flex h-10 items-center gap-2.5 px-4 text-[14px] hover:bg-accent/40">
                          <PriorityGlyph priority={w.priority} />
                          <span className="hidden w-[62px] shrink-0 text-sm tabular-nums text-muted-foreground sm:inline">{workOrderRef(w.number)}</span>
                          <WorkOrderStatusGlyph status={w.status} />
                          <span className="min-w-0 flex-1 truncate">{w.title}</span>
                          {w.unitId && <span className="hidden max-w-[120px] shrink-0 truncate text-sm text-muted-foreground sm:inline">{ws.unitById.get(w.unitId)?.name}</span>}
                          <DueChip day={w.dueDate} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[14px] font-medium">Recent activity</h2>
              {detail.activity.length > 8 && <button type="button" onClick={() => onTab('activity')} className="ghost-chip h-8 text-sm">View all <ArrowRight className="h-3 w-3" /></button>}
            </div>
            <Timeline activity={detail.activity.slice(-8)} newestFirst emptyText="Nothing has happened here yet." />
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Units" action={<button type="button" onClick={() => onTab('units')} className="ghost-chip h-8 text-sm">Open <ArrowRight className="h-3 w-3" /></button>}>
            <OccupancyBar counts={occ} height={8} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {([['Occupied', occ.occupied], ['On notice', occ.notice], ['Vacant', occ.vacant]] as const).map(([label, n]) => (
                <div key={label} className="rounded-md bg-subtle px-2 py-1.5">
                  <dd className="num text-[16px] font-semibold">{n}</dd>
                  <dt className="text-2xs text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
            {Object.keys(readiness).some(r => r !== 'Ready') && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {(['Make ready', 'Down', 'Off market'] as const).filter(r => readiness[r]).map(r => (
                  <span key={r} className="inline-flex items-center gap-1.5"><ReadinessGlyph readiness={r} size={12} /> {readiness[r]} {r.toLowerCase()}</span>
                ))}
              </div>
            )}
          </Card>

          <Card title="About">
            {p.photoUrl && <img src={p.photoUrl} alt="" className="-mx-4 -mt-4 mb-3 aspect-[16/9] w-[calc(100%+2rem)] max-w-none rounded-t-lg object-cover" loading="lazy" />}
            {p.description && <p className="mb-3 text-[14px] leading-relaxed text-foreground/90">{p.description}</p>}
            <dl className="space-y-2 text-[14px]">
              <Fact label="Type">{p.propertyType}</Fact>
              {p.yearBuilt && <Fact label="Built">{p.yearBuilt}</Fact>}
              {p.acquiredOn && <Fact label="Acquired">{fullDate(p.acquiredOn)}</Fact>}
              {p.petPolicy && <Fact label="Pets">{p.petPolicy}</Fact>}
              {p.parking && <Fact label="Parking">{p.parking}</Fact>}
              {bank && <Fact label="Bank account">{bank.name}</Fact>}
              {ws.can('accounting.view') && <Fact label="Reserve"><Money value={p.reserveAmount} cents={false} /></Fact>}
              <Fact label="Management fee">
                {p.managementFeePercent != null ? `${p.managementFeePercent}% (property rate)` : p.ownerId && ws.ownerById.get(p.ownerId)?.managementFeePercent != null ? `${ws.ownerById.get(p.ownerId)!.managementFeePercent}% (owner rate)` : `${ws.settings.managementFeePercent}% (default)`}
              </Fact>
            </dl>
            {p.amenities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {p.amenities.map(a => <span key={a} className="chip max-w-full"><span className="truncate">{a}</span></span>)}
              </div>
            )}
            {p.notes && (
              <p className="mt-3 whitespace-pre-wrap rounded-md border border-tone-warning/25 bg-tone-warning/[0.05] px-3 py-2 text-sm leading-relaxed text-foreground/85">{p.notes}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[104px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const EVENT_META: Record<'move_in' | 'move_out' | 'expiring', { label: string; icon: ReactNode; className: string }> = {
  move_in: { label: 'Move-in', icon: <LogIn />, className: 'text-tone-success' },
  move_out: { label: 'Move-out', icon: <LogOut />, className: 'text-tone-warning' },
  expiring: { label: 'Lease ends', icon: <CalendarClock />, className: 'text-tone-info' },
};
