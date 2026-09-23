import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronDown, ChevronUp, ClipboardCheck, ExternalLink, FileText, Home, Link2, LogOut, Megaphone, Pencil, Plus, UserRound, Wrench, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveUnit, type SaveUnitInputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { leaseRef } from '@project/shared/leases';
import { termMonths } from '@project/shared/dates';
import { DetailLayout, RailRow, RailSection, SectionHeading } from '../components/detail/DetailLayout';
import { DocumentsPanel } from '../components/detail/DocumentsPanel';
import { Timeline } from '../components/detail/Timeline';
import { DateInput } from '../components/form/fields';
import { MemberAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { Money } from '../components/primitives/data';
import { LeasePhasePill, OccupancyGlyph, Pill, PropertySwatch } from '../components/primitives/glyphs';
import { ChipsInput, ReadinessGlyph, ReadinessPicker } from '../components/portfolio/bits';
import { afterPortfolioWrite, hasCents, useUnitActions, useUnitDetail, type UnitDetail } from '../components/portfolio/data';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { Photos } from '../components/workOrders/Photos';
import { WorkOrdersView } from '../components/workOrders/WorkOrdersView';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl, bedsBaths, dateTime, fullDate, relativeDays, shortDate } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { retryUnlessNotFound } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';

/**
 * A unit: who lives there and on what terms, what's coming next, its
 * listing, work, inspections, documents and history. The rail edits the
 * unit in place (readiness, availability, features, photos). J/K step through
 * the property's units; E edits; S sets readiness.
 */

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

export function UnitPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const ws = useWorkspace();
  const app = useAppActions();
  const { data, isPending, isError, error, refetch } = useUnitDetail(id);
  const [picker, setPicker] = useState<'readiness' | null>(null);
  const known = ws.unitById.get(id);
  const label = known ? ws.unitLabel(known.id) : data ? `${data.property?.name ?? ''} · ${data.unit.name}` : 'Unit';
  useDocumentTitle(label);

  const propertyId = data?.unit.propertyId ?? known?.propertyId ?? '';
  const siblings = (ws.unitsByProperty.get(propertyId) ?? []).filter(u => !u.archived || u.id === id);
  const index = siblings.findIndex(u => u.id === id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const manage = ws.can('portfolio.manage');

  useHotkeys(
    {
      k: () => prev && navigate(`/units/${prev.id}`),
      j: () => next && navigate(`/units/${next.id}`),
      e: () => manage && data && app.openCreate('unit', { unitId: id, propertyId }),
      s: () => manage && data && !data.unit.archived && setPicker('readiness'),
      esc: () => propertyId && navigate(`/properties/${propertyId}/units`),
    },
    // Always registered (never toggled), so these stay ahead of the embedded work order list's own
    // J/K/S bindings; an open picker or dialog already mutes them via the overlay check.
    {},
  );

  const vacantish = data ? !data.currentLease || data.currentLease.phase === 'Notice' : false;
  const header = (
    <PageHeader
      breadcrumb={data?.property || known ? { to: `/properties/${propertyId}/units`, label: data?.property?.name ?? ws.propertyName(propertyId) } : { to: '/properties', label: 'Properties' }}
      icon={known ? <OccupancyGlyph occupancy={known.occupancy} /> : <Home />}
      title={data?.unit.name ?? known?.name ?? 'Unit'}
      actions={
        <>
          {index >= 0 && siblings.length > 1 && <span className="mr-1 hidden text-sm tabular-nums text-muted-foreground sm:inline">{index + 1} / {siblings.length}</span>}
          <Tip label="Previous unit" keys={['K']}><IconButton aria-label="Previous unit" disabled={!prev} onClick={() => prev && navigate(`/units/${prev.id}`)}><ChevronUp /></IconButton></Tip>
          <Tip label="Next unit" keys={['J']}><IconButton aria-label="Next unit" disabled={!next} onClick={() => next && navigate(`/units/${next.id}`)}><ChevronDown /></IconButton></Tip>
          <Tip label="Copy link"><IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/units/${id}`), 'Link copied')}><Link2 /></IconButton></Tip>
          {data && (
            <>
              {manage && <Tip label="Edit unit" keys={['E']}><button type="button" onClick={() => app.openCreate('unit', { unitId: id, propertyId })} className="ghost-chip hidden h-8 gap-1.5 sm:inline-flex"><Pencil className="h-3.5 w-3.5" /> Edit</button></Tip>}
              {ws.can('maintenance.create') && (
                <button type="button" onClick={() => app.openCreate('workOrder', { propertyId, unitId: id, tenantId: data.currentLease?.residents[0]?.id })} className={vacantish && ws.can('residents.manage') ? 'ghost-chip hidden h-8 gap-1.5 md:inline-flex' : 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90'}>
                  <Wrench className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New work order</span>
                </button>
              )}
              {ws.can('residents.manage') && !data.unit.archived && (
                <button type="button" onClick={() => app.openCreate('lease', { unitId: id, propertyId })} className={vacantish ? 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90' : 'ghost-chip hidden h-8 gap-1.5 md:inline-flex'}>
                  <FileText className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New lease</span>
                </button>
              )}
            </>
          )}
        </>
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header} rail={<div className="space-y-3 p-4">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-6 w-full" />)}</div>}>
        <div className="skeleton h-8 w-48" />
        <div className="skeleton mt-6 h-36 w-full rounded-lg" />
        <SkeletonRows rows={5} className="mt-6" />
      </DetailLayout>
    );
  }
  if (isError || !data) {
    const missing = !retryUnlessNotFound(0, error);
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<Home />} title={missing ? 'Unit not found' : 'This unit didn’t load'} description={errorMessage(error, missing ? 'It may have been deleted, or the link is wrong.' : 'Something went wrong.')} action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/properties')}>Back to properties</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      </DetailLayout>
    );
  }

  return (
    <DetailLayout header={header} rail={<UnitRail detail={data} picker={picker} setPicker={setPicker} />}>
      <UnitMain detail={data} />
    </DetailLayout>
  );
}

function UnitMain({ detail }: { detail: UnitDetail }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const u = detail.unit;
  const occ = ws.unitById.get(u.id)?.occupancy ?? (detail.currentLease ? 'Occupied' : 'Vacant');
  const lastEnded = detail.leases.filter(l => l.phase === 'Ended').sort((a, b) => (b.moveOutDate ?? b.endDate ?? '').localeCompare(a.moveOutDate ?? a.endDate ?? ''))[0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h1 className="text-[22px] font-semibold leading-8 tracking-tight">{ws.unitLabel(u.id, u.propertyId) || u.name}</h1>
        <Pill tone={occ === 'Occupied' ? 'success' : occ === 'Notice' ? 'warning' : 'danger'}><OccupancyGlyph occupancy={occ} size={11} /> {occ === 'Notice' ? 'On notice' : occ}</Pill>
        {u.archived && <Pill>Archived</Pill>}
      </div>
      <p className="mt-0.5 text-[14px] text-muted-foreground">{[bedsBaths(u.beds, u.baths, u.squareFeet), /\b(bd|ba|bed|bath|studio)\b/i.test(u.unitType) ? '' : u.unitType, u.floor ? `Floor ${u.floor}` : ''].filter(Boolean).join(' · ')}</p>
      {u.description && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{u.description}</p>}

      <SectionHeading action={detail.currentLease && ws.can('residents.manage') && <Link to={`/leases/${detail.currentLease.id}`} className="ghost-chip h-8 text-sm">Open lease <ExternalLink className="h-3 w-3" /></Link>}>
        {detail.currentLease ? 'Current lease' : 'Occupancy'}
      </SectionHeading>
      {detail.currentLease ? (
        <LeaseCard lease={detail.currentLease} money={detail.money} canOpen={ws.can('residents.manage')} />
      ) : (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-4 shadow-2xs">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-subtle"><OccupancyGlyph occupancy="Vacant" size={16} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Vacant{lastEnded ? ` since ${fullDate(lastEnded.moveOutDate ?? lastEnded.endDate)}` : ''}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Market rent {ws.money(u.marketRent, { cents: false })}{u.availableOn ? ` · available ${shortDate(u.availableOn)}` : ''} · <span className="inline-flex items-center gap-1"><ReadinessGlyph readiness={u.readiness} size={11} /> {u.readiness}</span>
            </p>
          </div>
          {ws.can('residents.manage') && !u.archived && !detail.upcomingLease && (
            <button type="button" onClick={() => app.openCreate('lease', { unitId: u.id, propertyId: u.propertyId })} className="ghost-chip h-9 gap-1.5"><Plus className="h-3.5 w-3.5" /> New lease</button>
          )}
        </div>
      )}
      {detail.upcomingLease && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-tone-info/25 bg-tone-info/[0.05] px-4 py-2.5 text-[14px]">
          <CalendarDays className="h-4 w-4 text-tone-info" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Next: {detail.upcomingLease.residents.filter(r => r.role !== 'Guarantor').map(r => r.name).join(', ') || 'a new lease'}</span>
            <span className="text-muted-foreground"> · starts {fullDate(detail.upcomingLease.startDate)} ({relativeDays(detail.upcomingLease.startDate)})</span>
          </span>
          <LeasePhasePill phase={detail.upcomingLease.phase} />
          {ws.can('residents.manage') && <Link to={`/leases/${detail.upcomingLease.id}`} className="ghost-chip h-8 text-sm">Open</Link>}
        </div>
      )}

      <SectionHeading
        count={detail.listings.length || undefined}
        action={ws.can('leasing.manage') && !u.archived && (!detail.listings.some(l => l.status === 'Published' || l.status === 'Draft')) && (
          <button type="button" onClick={() => app.openCreate('listing', { unitId: u.id, propertyId: u.propertyId })} className="ghost-chip h-8 text-sm"><Megaphone className="h-3.5 w-3.5" /> Create listing</button>
        )}
      >
        Listing
      </SectionHeading>
      {detail.listings.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-[14px] text-muted-foreground">Not listed. {occ !== 'Occupied' ? 'Create a listing to advertise it on your portal and take applications.' : 'You can list it once the resident gives notice.'}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {detail.listings.map(l => {
            const row = (
              <>
                <Megaphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{l.title}</span>
                <Pill tone={l.status === 'Published' ? 'success' : l.status === 'Paused' ? 'warning' : l.status === 'Leased' ? 'accent' : 'neutral'}>{l.status}</Pill>
                <span className="hidden text-sm tabular-nums text-muted-foreground sm:inline">{l.views} views</span>
                <Money value={l.rent} cents={false} className="w-16 text-right" />
              </>
            );
            return ws.can('leasing.manage') ? (
              <Link key={l.id} to={`/listings/${l.id}`} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">{row}</Link>
            ) : (
              <div key={l.id} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0">{row}</div>
            );
          })}
        </div>
      )}

      {ws.can('maintenance.create') && (
        <>
          <SectionHeading>Work orders</SectionHeading>
          <div className="flex max-h-[460px] flex-col overflow-hidden rounded-lg border bg-card [&_[role=grid]]:pb-2">
            <WorkOrdersView
              surfaceKey={`unit:${u.id}:work-orders`}
              baseFilters={{ unitIds: [u.id] }}
              lockedFilters={['propertyIds']}
              createDefaults={{ propertyId: u.propertyId, unitId: u.id, tenantId: detail.currentLease?.residents[0]?.id }}
              hideLocation
              compact
              keyboard={false}
              defaults={{ grouping: 'none', properties: ['priority', 'number', 'due', 'approval', 'messages', 'assignee'] }}
              emptyTitle="No open work orders"
              emptyDescription="Nothing needs fixing in this unit."
            />
          </div>
        </>
      )}

      {detail.seeLeases && (
        <>
          <SectionHeading count={detail.leases.length}>Lease history</SectionHeading>
          {detail.leases.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">No leases on this unit yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[14px]">
                <caption className="sr-only">Lease history</caption>
                <tbody>
                  {detail.leases.map(l => (
                    <tr key={l.id} className="border-b last:border-b-0 hover:bg-accent/40">
                      <td className="h-10 whitespace-nowrap pl-3 pr-2 tabular-nums text-muted-foreground">
                        {ws.can('residents.manage') ? <Link to={`/leases/${l.id}`} className="hover:underline">{leaseRef(l.number)}</Link> : leaseRef(l.number)}
                      </td>
                      <td className="max-w-[240px] truncate px-2">{l.residents.filter(r => r.role === 'Primary' || r.role === 'Co-tenant').map(r => r.name).join(', ') || '—'}</td>
                      <td className="px-2"><LeasePhasePill phase={l.phase} /></td>
                      <td className="hidden whitespace-nowrap px-2 text-muted-foreground sm:table-cell">{shortDate(l.startDate)} – {l.moveOutDate && (l.phase === 'Ended' || l.phase === 'Notice') ? shortDate(l.moveOutDate) : l.endDate ? shortDate(l.endDate) : 'ongoing'}</td>
                      {detail.money && <td className="num whitespace-nowrap px-3 text-right"><Money value={l.rent} cents={hasCents(l.rent)} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <SectionHeading count={detail.inspections.length || undefined}>Inspections</SectionHeading>
      {detail.inspections.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">No inspections yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {detail.inspections.map(i => {
            const inspector = i.inspectorId ? ws.memberById.get(i.inspectorId) : undefined;
            const row = (
              <>
                <ClipboardCheck className={cn('h-3.5 w-3.5 shrink-0', i.status === 'Completed' ? 'text-tone-success' : 'text-muted-foreground')} />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                {i.overallCondition && <span className="hidden text-sm text-muted-foreground sm:inline">{i.overallCondition}</span>}
                <Pill tone={i.status === 'Completed' ? 'success' : i.status === 'Canceled' ? 'neutral' : i.status === 'In progress' ? 'warning' : 'info'}>{i.status}</Pill>
                <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{shortDate((i.completedAt ?? i.scheduledFor)?.slice(0, 10))}</span>
                {inspector && <MemberAvatar member={inspector} size={18} />}
              </>
            );
            return ws.can('maintenance.manage') ? (
              <Link key={i.id} to={`/inspections/${i.id}`} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">{row}</Link>
            ) : (
              <div key={i.id} className="flex h-10 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0">{row}</div>
            );
          })}
        </div>
      )}

      <SectionHeading count={detail.documentCount || undefined}>Documents</SectionHeading>
      <DocumentsPanel scope="unitId" id={u.id} links={{ unitId: u.id, propertyId: u.propertyId }} showSharing={{ tenant: Boolean(detail.currentLease), owner: true }} compact />

      <SectionHeading>Activity</SectionHeading>
      <Timeline activity={detail.activity} emptyText="Nothing has happened in this unit yet." />
    </div>
  );
}

function LeaseCard({ lease: l, money, canOpen }: { lease: NonNullable<UnitDetail['currentLease']>; money: boolean; canOpen: boolean }) {
  const ws = useWorkspace();
  const months = termMonths(l.startDate, l.endDate);
  const people = l.residents.filter(r => r.role !== 'Guarantor');
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-2xs">
      {l.phase === 'Notice' && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-tone-warning/25 bg-tone-warning/[0.06] px-4 py-2 text-[14px]">
          <LogOut className="h-3.5 w-3.5 text-tone-warning" />
          <span className="whitespace-nowrap font-medium text-tone-warning">On notice</span>
          <span className="text-muted-foreground">{l.moveOutDate ? `Moving out ${fullDate(l.moveOutDate)} (${relativeDays(l.moveOutDate)})` : 'Move-out date not set'}{l.noticeGivenOn ? ` · notice given ${shortDate(l.noticeGivenOn)}` : ''}</span>
        </div>
      )}
      <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums text-muted-foreground">{leaseRef(l.number)}</span>
            <LeasePhasePill phase={l.phase} />
          </div>
          <ul className="mt-2 space-y-1">
            {people.map(r => (
              <li key={r.id} className="flex min-w-0 items-center gap-2 text-[14px]">
                <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {canOpen ? <Link to={`/residents/${r.id}`} className="truncate font-medium hover:underline">{r.name}</Link> : <span className="truncate font-medium">{r.name}</span>}
                {r.role !== 'Primary' && <span className="shrink-0 text-sm text-muted-foreground">{r.role}</span>}
                {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:inline">{r.phone}</a>}
              </li>
            ))}
            {!people.length && <li className="text-[14px] text-muted-foreground">No residents on this lease</li>}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            {l.startDate ? fullDate(l.startDate) : 'No start date'} – {l.endDate ? fullDate(l.endDate) : 'month-to-month'}
            {months ? ` · ${months}-month lease` : ''}
            {l.phase === 'Month-to-month' && l.endDate ? ' · now month-to-month' : ''}
          </p>
        </div>
        {money ? (
          <dl className="grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-1 sm:gap-2 sm:border-l sm:pl-4">
            <Fig label="Rent"><Money value={l.rent} /><span className="ml-1 text-sm text-muted-foreground">a month</span></Fig>
            <Fig label="Balance">
              {canOpen ? <Link to={`/leases/${l.id}/ledger`} className="hover:underline"><Money value={l.balance} tone="balance" /></Link> : <Money value={l.balance} tone="balance" />}
              {(l.pastDue ?? 0) > 0.005 && <span className="ml-1.5 text-sm text-tone-danger">{ws.money(l.pastDue)} past due</span>}
            </Fig>
            <Fig label="Deposit"><Money value={l.deposit} /></Fig>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground sm:border-l sm:pl-4">Rent and balances are visible to roles with access to financials.</p>
        )}
      </div>
    </div>
  );
}

function Fig({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline">{children}</dd>
    </div>
  );
}

function UnitRail({ detail, picker, setPicker }: { detail: UnitDetail; picker: 'readiness' | null; setPicker: (p: 'readiness' | null) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { update } = useUnitActions();
  const u = detail.unit;
  const p = detail.property;
  const manage = ws.can('portfolio.manage') && !u.archived;
  const [dateOpen, setDateOpen] = useState(false);

  const save = async (fields: Extract<SaveUnitInputType, { action: 'update' }>['fields'], message?: string) => {
    try {
      await saveUnit({ action: 'update', id: u.id, fields });
      afterPortfolioWrite(qc);
      if (message) toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t save the unit'));
    }
  };

  return (
    <>
      <RailSection>
        <RailRow label="Property">
          {p ? <Link to={`/properties/${p.id}`} className={chip}><PropertySwatch color={p.color} /> <span className="truncate">{p.name}</span></Link> : <span className="px-1.5 text-muted-foreground">—</span>}
        </RailRow>
        <RailRow label="Readiness">
          {manage ? (
            <ReadinessPicker
              value={u.readiness}
              onChange={r => { setPicker(null); if (r !== u.readiness) void update([u], { readiness: r }, { toast: `${u.name} → ${r}` }).catch(() => undefined); }}
              open={picker === 'readiness'}
              onOpenChange={o => setPicker(o ? 'readiness' : null)}
              align="end"
              trigger={<button type="button" className={chip}><ReadinessGlyph readiness={u.readiness} /> {u.readiness}</button>}
            />
          ) : (
            <span className="flex h-8 items-center gap-1.5 px-1.5 text-[14px]"><ReadinessGlyph readiness={u.readiness} /> {u.readiness}</span>
          )}
        </RailRow>
        <RailRow label="Available">
          {manage ? (
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button type="button" className={chip}>{u.availableOn ? <><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> {fullDate(u.availableOn)}</> : <span className="text-muted-foreground">Not set</span>}</button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-2 shadow-lg">
                <DateInput value={u.availableOn} onChange={d => { setDateOpen(false); void update([u], { availableOn: d }, { toast: d ? `${u.name} available ${shortDate(d)}` : 'Available date cleared' }).catch(() => undefined); }} />
                {u.availableOn && (
                  <button type="button" onClick={() => { setDateOpen(false); void update([u], { availableOn: null }, { toast: 'Available date cleared' }).catch(() => undefined); }} className="mt-1 flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-[14px] hover:bg-accent">
                    <X className="h-3.5 w-3.5 text-muted-foreground" /> Clear date
                  </button>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            <span className="px-1.5 text-[14px]">{u.availableOn ? fullDate(u.availableOn) : <span className="text-muted-foreground">Not set</span>}</span>
          )}
        </RailRow>
      </RailSection>

      <RailSection title="Details">
        <RailRow label="Layout"><span className="px-1.5 text-[14px]">{bedsBaths(u.beds, u.baths, u.squareFeet)}</span></RailRow>
        {u.unitType && !/\b(bd|ba|bed|bath|studio)\b/i.test(u.unitType) && <RailRow label="Type"><span className="truncate px-1.5 text-[14px]">{u.unitType}</span></RailRow>}
        {u.floor && <RailRow label="Floor"><span className="px-1.5 text-[14px]">{u.floor}</span></RailRow>}
        <RailRow label="Market rent"><span className="px-1.5 text-[14px]"><Money value={u.marketRent} cents={hasCents(u.marketRent)} /></span></RailRow>
        <RailRow label="Deposit"><span className="px-1.5 text-[14px]"><Money value={u.depositAmount} cents={hasCents(u.depositAmount)} /></span></RailRow>
      </RailSection>

      <RailSection title="Features">
        {manage ? (
          <FeaturesEditor value={u.features} onSave={features => void save({ features })} />
        ) : u.features.length ? (
          <div className="flex flex-wrap gap-1 px-0.5">{u.features.map(f => <span key={f} className="chip max-w-full"><span className="truncate">{f}</span></span>)}</div>
        ) : (
          <p className="px-1.5 text-[14px] text-muted-foreground">None listed</p>
        )}
      </RailSection>

      <RailSection title="Photos">
        {manage || u.photoUrls.length ? (
          <Photos photos={u.photoUrls.map((url, i) => ({ url, name: `Photo ${i + 1}` }))} onChange={manage ? photos => void save({ photoUrls: photos.map(ph => ph.url) }) : undefined} editable={manage} size={78} />
        ) : (
          <p className="px-1.5 text-[14px] text-muted-foreground">No photos</p>
        )}
      </RailSection>

      {u.notes && (
        <RailSection title="Notes">
          <p className="whitespace-pre-wrap px-1.5 text-[14px] text-foreground/85">{u.notes}</p>
        </RailSection>
      )}
      {detail.activity.length > 0 && (
        <RailSection>
          <p className="px-1.5 text-sm text-muted-foreground">Last change {dateTime(detail.activity[detail.activity.length - 1].occurredAt)}</p>
        </RailSection>
      )}
    </>
  );
}

function FeaturesEditor({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(value); setEditing(true); }} className="-mx-0.5 flex w-full flex-wrap gap-1 rounded-md p-0.5 text-left hover:bg-accent/60" aria-label="Edit features">
        {value.length ? value.map(f => <span key={f} className="chip max-w-full bg-background"><span className="truncate">{f}</span></span>) : <span className="px-1 py-0.5 text-[14px] text-muted-foreground">Add features…</span>}
      </button>
    );
  }
  return (
    <div
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { setEditing(false); onSave(draft); }
      }}
    >
      <ChipsInput value={draft} onChange={setDraft} placeholder="Type and press Enter" />
      <div className="mt-1.5 flex justify-end gap-1">
        <button type="button" onClick={() => setEditing(false)} className="h-8 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
        <button type="button" onClick={() => { setEditing(false); if (JSON.stringify(draft) !== JSON.stringify(value)) onSave(draft); }} className="h-8 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground">Save</button>
      </div>
    </div>
  );
}
