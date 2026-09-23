import { Building2, CalendarDays, ExternalLink, Home, Mail, Phone, Receipt, Users, Wallet, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { useOwnerProperty, type OwnerProperty } from '../../components/owner/data';
import { AreaSkeleton, Fact, LoadError, PageHeader, Panel, Segmented, StatTile, money, telHref, workOrderTone } from '../../components/owner/kit';
import { Alert, Container, LinkButton, StatusPill } from '../../components/ui';
import { longDate, plural, shortDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * One property: details and who manages it, the rent roll with each
 * household's balance, vacancies and how they're marketed, repairs and their
 * costs, and income and expenses this month and this year.
 */
export default function OwnerPropertyPage() {
  const { id = '' } = useParams();
  const q = useOwnerProperty(id);
  useDocumentTitle(q.data?.property.name ?? 'Property');

  if (q.isPending) return <AreaSkeleton variant="detail" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="that property" home={{ to: '/owner', label: 'Back to your portfolio' }} />;
  const d = q.data;
  const p = d.property;
  const c = d.currency;
  const s = d.stats;
  const occupied = s.occupied + s.notice;

  return (
    <div className="animate-fade-in">
      <PageHeader
        back={{ to: '/owner', label: 'Overview' }}
        eyebrow={[p.propertyType, p.yearBuilt ? `Built ${p.yearBuilt}` : null, plural(s.units, 'unit')].filter(Boolean).join(' · ')}
        title={p.name}
        subtitle={p.address}
        actions={
          <LinkButton to={`/owner/statements?property=${p.id}`} variant="secondary">
            <Receipt aria-hidden /> Statement
          </LinkButton>
        }
      />
      <Container className="space-y-5 pb-4 pt-4">
        {d.warnings.length > 0 && (
          <Alert tone="warning" title="Some figures are being reconciled">
            The office is reviewing a difference in this property’s books. Numbers may change slightly once it’s resolved.
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Occupancy" value={`${s.units ? Math.round((occupied / s.units) * 100) : 0}%`} detail={`${occupied} of ${plural(s.units, 'unit')}${s.notice ? ` · ${s.notice} on notice` : ''}`} />
          <StatTile label="Monthly rent" value={money(s.scheduledRent, c, { cents: false })} detail={`Market rent ${money(s.marketRent, c, { cents: false })}`} />
          <StatTile label="Past due" value={money(s.pastDue, c, { cents: false })} tone={s.pastDue > 0 ? 'danger' : undefined} detail={s.pastDue > 0 ? `${plural(d.rentRoll.filter(r => r.pastDue > 0).length, 'household')} behind` : 'Everyone is paid up'} />
          <StatTile label="Available to distribute" value={money(Math.max(0, s.available), c, { cents: false })} detail={`${money(s.cash, c, { cents: false })} cash on hand`} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <RentRoll d={d} />
            <Vacancies d={d} />
            <Maintenance d={d} />
          </div>
          <aside className="min-w-0 space-y-5">
            <About d={d} />
            <Finances d={d} />
            <CashPosition d={d} />
          </aside>
        </div>
      </Container>
    </div>
  );
}

function RentRoll({ d }: { d: OwnerProperty }) {
  const c = d.currency;
  return (
    <Panel title="Rent roll" icon={Users} description={`${plural(d.rentRoll.filter(r => r.occupancy !== 'Vacant').length, 'household')} · balances as of today`} flush>
      {d.rentRoll.length === 0 ? (
        <p className="px-5 py-8 text-center text-[15px] text-muted-foreground">No units have been set up for this property.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[15px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-sm text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Unit</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Residents</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Lease ends</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Rent</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Balance</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.rentRoll.map(r => (
                <tr key={r.unitId} className={cn(r.occupancy === 'Vacant' && 'text-muted-foreground')}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground sm:px-5">{/^main$/i.test(r.unitName) ? 'Home' : r.unitName}</td>
                  <td className="max-w-[240px] px-3 py-3">
                    {r.residents.length ? <span className="line-clamp-2 break-words">{r.residents.join(', ')}</span> : <span>—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {r.occupancy === 'Vacant' ? '—' : r.moveOutDate ? <span>Moving out {shortDate(r.moveOutDate)}</span> : r.leaseEnd ? shortDate(r.leaseEnd) : 'Month to month'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.occupancy === 'Vacant' ? money(r.marketRent, c, { cents: false }) : money(r.rent, c)}</td>
                  <td className={cn('whitespace-nowrap px-3 py-3 text-right tabular-nums', r.balance > 0 && 'font-medium text-foreground', r.balance < 0 && 'text-tone-success')}>
                    {r.occupancy === 'Vacant' ? '—' : r.balance < 0 ? `${money(-r.balance, c)} credit` : money(r.balance, c)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                    {r.status === 'Vacant' ? (
                      <StatusPill tone="neutral">Vacant</StatusPill>
                    ) : r.status === 'Past due' ? (
                      <StatusPill tone="danger">Past due</StatusPill>
                    ) : r.occupancy === 'Notice' ? (
                      <StatusPill tone="warning">Notice</StatusPill>
                    ) : (
                      <StatusPill tone="success">Current</StatusPill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Vacancies({ d }: { d: OwnerProperty }) {
  const c = d.currency;
  if (!d.vacancies.length) {
    return (
      <Panel title="Vacancies" icon={Home}>
        <p className="text-[15px] text-muted-foreground">Every unit is leased, and nobody has given notice.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Vacancies and upcoming move-outs" icon={Home} flush>
      <ul className="divide-y">
        {d.vacancies.map(v => (
          <li key={v.unitId} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="font-medium">
                {/^main$/i.test(v.unitName) ? 'The home' : `Unit ${v.unitName}`}
                <span className="ml-2 font-normal text-muted-foreground">{v.occupancy === 'Notice' ? `Resident moving out${v.availableOn ? ` ${shortDate(v.availableOn)}` : ''}` : v.readiness === 'Ready' ? 'Ready to rent' : `${v.readiness}${v.availableOn ? ` · ready ${shortDate(v.availableOn)}` : ''}`}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {v.upcomingLeaseStart ? `New lease starts ${shortDate(v.upcomingLeaseStart)}` : v.listing ? v.listing.title : 'Not listed yet'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {v.upcomingLeaseStart ? (
                <StatusPill tone="success">Leased</StatusPill>
              ) : v.listing?.status === 'Published' ? (
                <>
                  <span className="text-sm tabular-nums text-muted-foreground">{plural(v.listing.views, 'view')}</span>
                  <StatusPill tone="info">Listed at {money(v.listing.rent, c, { cents: false })}</StatusPill>
                  <Link to={`/homes/${v.listing.slug}`} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:underline" aria-label={`View the listing for unit ${v.unitName}`}>
                    Listing <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </>
              ) : v.listing ? (
                <StatusPill tone="neutral">Listing {v.listing.status.toLowerCase()}</StatusPill>
              ) : (
                <StatusPill tone="warning">Not listed</StatusPill>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Maintenance({ d }: { d: OwnerProperty }) {
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const open = d.workOrders.filter(w => w.open);
  const done = d.workOrders.filter(w => !w.open);
  const rows = tab === 'open' ? open : done;
  const c = d.currency;
  return (
    <Panel
      title="Maintenance"
      icon={Wrench}
      flush
      action={
        <Segmented
          label="Maintenance"
          value={tab}
          onChange={v => setTab(v as 'open' | 'done')}
          options={[
            { value: 'open', label: 'Open', count: open.length },
            { value: 'done', label: 'Completed', count: done.length },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[15px] text-muted-foreground">{tab === 'open' ? 'No open repairs right now.' : 'No completed repairs yet.'}</p>
      ) : (
        <ul className="divide-y">
          {rows.map(w => (
            <li key={w.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="break-words font-medium leading-snug">{w.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {[`WO-${w.number}`, w.unitName && !/^main$/i.test(w.unitName) ? `Unit ${w.unitName}` : 'Common area', w.vendorName, w.completedAt ? `Done ${shortDate(w.completedAt)}` : w.scheduledFor ? `Scheduled ${shortDate(w.scheduledFor)}` : w.reportedAt ? `Reported ${shortDate(w.reportedAt)}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {w.ownerApproval === 'Pending' && w.open ? (
                  <Link to="/owner/approvals">
                    <StatusPill tone="warning">Needs your approval</StatusPill>
                  </Link>
                ) : (
                  <StatusPill tone={w.priority === 'Emergency' && w.open ? 'danger' : workOrderTone(w.status)}>{w.priority === 'Emergency' && w.open ? 'Emergency' : w.status}</StatusPill>
                )}
                {w.cost != null ? (
                  <span className="text-sm font-medium tabular-nums">{money(w.cost, c)}</span>
                ) : w.estimate != null ? (
                  <span className="text-sm tabular-nums text-muted-foreground">Est. {money(w.estimate, c)}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function About({ d }: { d: OwnerProperty }) {
  const p = d.property;
  return (
    <Panel flush>
      {p.photoUrl ? (
        <img src={p.photoUrl} alt={`${p.name}`} className="aspect-[16/10] w-full object-cover" />
      ) : (
        <div className="flex aspect-[16/10] w-full items-center justify-center" style={{ background: `${p.color}14` }}>
          <Building2 className="h-10 w-10 text-muted-foreground" aria-hidden />
        </div>
      )}
      <div className="px-4 py-4 sm:px-5">
        {p.description && <p className="text-[15px] leading-relaxed text-foreground/85">{p.description}</p>}
        <dl className={cn('divide-y', p.description && 'mt-3')}>
          {p.acquiredOn && <Fact label="Owned since">{longDate(p.acquiredOn)}</Fact>}
          {p.parking && <Fact label="Parking">{p.parking}</Fact>}
          {p.petPolicy && <Fact label="Pets">{p.petPolicy}</Fact>}
          <Fact label="Reserve kept">{money(p.reserve, d.currency, { cents: false })}</Fact>
        </dl>
        {p.amenities.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Amenities">
            {p.amenities.map(a => (
              <li key={a} className="chip-soft text-sm">
                {a}
              </li>
            ))}
          </ul>
        )}
        {p.manager && (
          <div className="mt-4 rounded-lg border bg-muted/40 px-3.5 py-3">
            <p className="text-sm text-muted-foreground">Your property manager</p>
            <p className="font-medium">{p.manager.name}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {p.manager.phone && (
                <a href={telHref(p.manager.phone)} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Phone className="h-3.5 w-3.5" aria-hidden /> {p.manager.phone}
                </a>
              )}
              <Link to="/owner/messages" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <Mail className="h-3.5 w-3.5" aria-hidden /> Send a message
              </Link>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Finances({ d }: { d: OwnerProperty }) {
  const [range, setRange] = useState<'month' | 'ytd'>('month');
  const f = d.finances[range];
  const c = d.currency;
  return (
    <Panel
      title="Cash flow"
      icon={CalendarDays}
      action={
        <Segmented
          label="Period"
          value={range}
          onChange={v => setRange(v as 'month' | 'ytd')}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'ytd', label: 'Year' },
          ]}
        />
      }
    >
      <p className="text-sm text-muted-foreground">{f.label} · cash basis</p>
      <LineGroup title="Income" lines={f.income.lines} total={f.income.total} currency={c} empty="No income received yet" />
      <LineGroup title="Expenses" lines={f.expenses.lines} total={f.expenses.total} currency={c} empty="No expenses paid yet" />
      <div className="mt-3 flex items-baseline justify-between border-t pt-3">
        <span className="font-semibold">Net operating cash flow</span>
        <span className={cn('font-semibold tabular-nums', f.netOperatingCashFlow < 0 && 'text-tone-danger')}>{money(f.netOperatingCashFlow, c)}</span>
      </div>
      {f.distributions > 0 && (
        <div className="mt-1 flex items-baseline justify-between text-sm text-muted-foreground">
          <span>Distributed to you</span>
          <span className="tabular-nums">{money(f.distributions, c)}</span>
        </div>
      )}
    </Panel>
  );
}

function LineGroup({ title, lines, total, currency, empty }: { title: string; lines: Array<{ key: string; label: string; amount: number }>; total: number; currency: string; empty: string }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold">{title}</p>
      {lines.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <dl className="mt-1 space-y-1 text-[15px]">
          {lines.map(l => (
            <div key={l.key} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 break-words text-foreground/85">{l.label}</dt>
              <dd className="shrink-0 tabular-nums">{money(l.amount, currency)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t pt-1 font-medium">
            <dt>Total {title.toLowerCase()}</dt>
            <dd className="tabular-nums">{money(total, currency)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function CashPosition({ d }: { d: OwnerProperty }) {
  const s = d.stats;
  const c = d.currency;
  return (
    <Panel title="Cash position" icon={Wallet}>
      <dl className="divide-y">
        <Fact label="Cash on hand">{money(s.cash, c)}</Fact>
        <Fact label="Security deposits held">−{money(s.depositsHeld, c)}</Fact>
        <Fact label="Reserve">−{money(s.reserve, c)}</Fact>
        <Fact label="Unpaid bills">−{money(s.unpaidBills, c)}</Fact>
        <Fact label="Available to distribute" className="font-semibold">
          <span className="text-base font-semibold">{money(Math.max(0, s.available), c)}</span>
        </Fact>
      </dl>
      {s.available <= 0 && <p className="mt-2 text-sm text-muted-foreground">Residents’ deposits, the reserve and unpaid bills are covered before anything is paid out.</p>}
    </Panel>
  );
}
