import { ArrowRight, Building2, CircleDashed, DoorOpen, Download, Hammer, Megaphone, Plus } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { UNIT_READINESS } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { sumMoney } from '@project/shared/money';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDate } from '../../lib/format';
import { countFilters, useListState, type ListOptions } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { OccupancyGlyph, Pill, PropertySwatch } from '../primitives/glyphs';
import { ListingStatusPill } from './bits';
import { useVacancies, type Vacancy } from './data';

type Options = ListOptions<'none', 'days'>;
const DEFAULTS: Options = { layout: 'table', grouping: 'none', ordering: 'days', properties: [], showEmptyGroups: false, showClosed: false };

type Step = { label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' | 'success'; rank: number };

/** The one thing to do next for a vacancy, in the order a leasing agent would work. */
export function nextStep(v: Vacancy): Step {
  if (v.upcomingLease) return { label: `${v.upcomingLease.status === 'Pending signature' ? 'Lease out for signature' : 'Moving in'}${v.upcomingLease.startDate ? ` ${shortDate(v.upcomingLease.startDate)}` : ''}`, tone: 'success', rank: 6 };
  if (v.approvedApplications > 0) return { label: 'Create the lease', tone: 'info', rank: 1 };
  if (v.openApplications > 0) return { label: `Review ${v.openApplications} ${v.openApplications === 1 ? 'application' : 'applications'}`, tone: 'info', rank: 2 };
  if (v.readiness === 'Down' || v.readiness === 'Off market') return { label: v.readiness === 'Down' ? 'Unit is down' : 'Off market', tone: 'neutral', rank: 7 };
  if (!v.listing) return { label: v.readiness === 'Make ready' ? 'Create listing while it’s made ready' : 'Create a listing', tone: 'danger', rank: 0 };
  if (v.listing.status === 'Draft') return { label: 'Publish the listing', tone: 'warning', rank: 3 };
  if (v.listing.status === 'Paused') return { label: 'Listing is paused', tone: 'warning', rank: 4 };
  if (v.openLeads > 0) return { label: `Follow up ${v.openLeads} ${v.openLeads === 1 ? 'lead' : 'leads'}`, tone: 'info', rank: 4 };
  if (v.readiness === 'Make ready') return { label: 'Finish make-ready', tone: 'warning', rank: 5 };
  return { label: 'Listed — waiting for leads', tone: 'neutral', rank: 8 };
}

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'warning' }) {
  return (
    <div className="min-w-0">
      <div className={cn('num text-[18px] font-semibold leading-6', tone === 'danger' && 'text-tone-danger', tone === 'warning' && 'text-tone-warning')}>{value}</div>
      <div className="truncate text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * The leasing to-do list: vacant and on-notice units with how long they've
 * been empty, what they rented for, whether they're ready and how they're
 * being marketed — and the next step for each.
 */
export function VacanciesView() {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const list = useListState<'none', 'days'>('leasing:vacancies', DEFAULTS, {});
  const { filters, setFilters } = list;
  const { data, isPending, isError, error, refetch, isFetching } = useVacancies();
  const all = data?.vacancies ?? [];
  const occ = Array.isArray(filters.occupancy) ? (filters.occupancy as string[]) : [];
  const props = Array.isArray(filters.propertyIds) ? (filters.propertyIds as string[]) : [];
  const readiness = Array.isArray(filters.readiness) ? (filters.readiness as string[]) : [];
  const marketing = typeof filters.marketing === 'string' ? filters.marketing : '';
  const search = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';

  const rows = useMemo(
    () =>
      all
        .filter(v => (!occ.length || occ.includes(v.occupancy)) && (!props.length || props.includes(v.propertyId)) && (!readiness.length || readiness.includes(v.readiness)))
        .filter(v => (marketing === 'unlisted' ? !v.listing : marketing === 'live' ? v.listing?.status === 'Published' : marketing === 'draft' ? v.listing && v.listing.status !== 'Published' : true))
        .filter(v => !search || ws.unitLabel(v.unitId).toLowerCase().includes(search))
        .sort((a, b) => nextStep(a).rank - nextStep(b).rank || (b.daysVacant ?? -1) - (a.daysVacant ?? -1) || (a.daysUntilMoveOut ?? 999) - (b.daysUntilMoveOut ?? 999)),
    [all, occ.join(), props.join(), readiness.join(), marketing, search, ws],
  );
  const nav = useListNav({ items: rows, getId: v => v.unitId, onOpen: v => navigate(v.listing ? `/listings/${v.listing.id}` : `/units/${v.unitId}`) });

  const vacant = all.filter(v => v.occupancy === 'Vacant' && !v.upcomingLease);
  const loss = sumMoney(vacant.map(v => v.marketRent ?? 0));
  const unlisted = all.filter(v => !v.listing && !v.upcomingLease).length;

  const filterDefs: FilterDef[] = useMemo(() => [
    listFilter('occupancy', 'Occupancy', <DoorOpen />, () => [{ value: 'Vacant', label: 'Vacant', icon: <OccupancyGlyph occupancy="Vacant" /> }, { value: 'Notice', label: 'On notice', icon: <OccupancyGlyph occupancy="Notice" /> }]),
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> }))),
    listFilter('readiness', 'Readiness', <Hammer />, () => UNIT_READINESS.map(r => ({ value: r, label: r }))),
    singleFilter('marketing', 'Marketing', <Megaphone />, () => [{ value: 'unlisted', label: 'No listing' }, { value: 'draft', label: 'Draft or paused listing' }, { value: 'live', label: 'Live listing' }]),
  ], [ws]);

  const columns: Column<Vacancy>[] = useMemo(() => [
    { key: 'unit', header: 'Unit', cell: v => <Link to={`/units/${v.unitId}`} onClick={e => e.stopPropagation()} className="inline-flex max-w-[230px] items-center gap-1.5 font-medium hover:underline"><PropertySwatch color={ws.propertyById.get(v.propertyId)?.color} /><span className="truncate">{ws.unitLabel(v.unitId)}</span></Link>, sort: v => ws.unitLabel(v.unitId) },
    {
      key: 'occupancy', header: 'Vacancy', cell: v => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <OccupancyGlyph occupancy={v.occupancy} />
          {v.occupancy === 'Notice'
            ? <span>Moves out {v.moveOutDate ? shortDate(v.moveOutDate) : 'soon'}{v.daysUntilMoveOut != null && v.daysUntilMoveOut >= 0 ? <span className="text-muted-foreground"> · {v.daysUntilMoveOut}d</span> : null}</span>
            : <span className={cn((v.daysVacant ?? 0) > 30 && 'font-medium text-tone-danger', (v.daysVacant ?? 0) > 14 && (v.daysVacant ?? 0) <= 30 && 'text-tone-warning')}>Vacant {v.daysVacant ?? 0}d</span>}
        </span>
      ), sort: v => (v.occupancy === 'Vacant' ? 10_000 + (v.daysVacant ?? 0) : -(v.daysUntilMoveOut ?? 0)),
    },
    { key: 'readiness', header: 'Readiness', cell: v => <Pill tone={v.readiness === 'Ready' ? 'success' : v.readiness === 'Make ready' ? 'warning' : 'neutral'}>{v.readiness}</Pill>, sort: v => UNIT_READINESS.indexOf(v.readiness as never), hideBelow: 'md' },
    { key: 'market', header: 'Market rent', align: 'right', cell: v => <Money value={v.marketRent} cents={false} muted0 />, sort: v => v.marketRent ?? 0 },
    { key: 'last', header: 'Last rent', align: 'right', cell: v => <Money value={v.lastRent} cents={false} muted0 />, sort: v => v.lastRent ?? 0, hideBelow: 'lg' },
    { key: 'available', header: 'Available', cell: v => (v.availableOn ? (v.availableOn <= ws.today ? 'Now' : shortDate(v.availableOn)) : <span className="text-muted-foreground">—</span>), sort: v => v.availableOn, hideBelow: 'lg' },
    {
      key: 'listing', header: 'Listing', cell: v => (v.listing ? (
        <Link to={`/listings/${v.listing.id}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1.5 hover:underline">
          <ListingStatusPill status={v.listing.status} />
          {v.listing.daysOnMarket != null && <span className="text-sm tabular-nums text-muted-foreground">{v.listing.daysOnMarket}d</span>}
        </Link>
      ) : v.upcomingLease ? <span className="text-muted-foreground">—</span> : (
        <button type="button" className="ghost-chip h-6 whitespace-nowrap border-dashed border-border px-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); app.openCreate('listing', { unitId: v.unitId, propertyId: v.propertyId }); }}><Plus className="h-3 w-3" /> Create listing</button>
      )), sort: v => (v.listing ? ['Published', 'Paused', 'Draft'].indexOf(v.listing.status) : 9),
    },
    { key: 'leads', header: 'Leads', align: 'right', cell: v => (v.openLeads ? v.openLeads : <span className="text-muted-foreground">0</span>), sort: v => v.openLeads, hideBelow: 'md' },
    { key: 'apps', header: 'Applications', align: 'right', cell: v => (v.openApplications ? <Link to={`/leasing/applications`} onClick={e => e.stopPropagation()} className="font-medium text-primary hover:underline">{v.openApplications}</Link> : <span className="text-muted-foreground">0</span>), sort: v => v.openApplications, hideBelow: 'md' },
    {
      key: 'next', header: 'Next step', cell: v => {
        const s = nextStep(v);
        return (
          <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-[13.5px]', s.tone === 'danger' ? 'text-tone-danger' : s.tone === 'warning' ? 'text-tone-warning' : s.tone === 'info' ? 'text-tone-info' : s.tone === 'success' ? 'text-tone-success' : 'text-muted-foreground')}>
            {s.label}
            {v.upcomingLease && <Link to={`/leases/${v.upcomingLease.id}`} onClick={e => e.stopPropagation()} className="text-muted-foreground hover:underline">{leaseRef(v.upcomingLease.number)}</Link>}
            {s.rank <= 3 && <ArrowRight className="h-3 w-3" />}
          </span>
        );
      }, sort: v => nextStep(v).rank,
    },
  ], [ws, app]);

  const exportCsv = () =>
    downloadCsv('vacancies', ['Unit', 'Occupancy', 'Days vacant', 'Move-out', 'Readiness', 'Market rent', 'Last rent', 'Available', 'Listing', 'Open leads', 'Open applications', 'Next step'], rows.map(v => [ws.unitLabel(v.unitId), v.occupancy, v.daysVacant ?? '', v.moveOutDate ?? '', v.readiness, v.marketRent, v.lastRent, v.availableOn ?? '', v.listing?.status ?? 'None', v.openLeads, v.openApplications, nextStep(v).label]));

  const hasFilter = countFilters(filters) > 0 || Boolean(search);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!isPending && !isError && all.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b px-5 py-3 sm:grid-cols-4">
          <Figure label="Vacant today" value={vacant.length} tone={vacant.length ? 'danger' : undefined} />
          <Figure label="On notice" value={all.filter(v => v.occupancy === 'Notice').length} />
          <Figure label="Not listed yet" value={unlisted} tone={unlisted ? 'warning' : undefined} />
          <Tip label="Market rent of vacant units with no lease signed — what an empty month costs.">
            <div><Figure label="Vacancy cost / month" value={ws.money(loss, { cents: false })} /></div>
          </Tip>
        </div>
      )}
      <ListToolbar
        start={<><FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} /><FilterChips defs={filterDefs} filters={filters} onChange={setFilters} /></>}
        count={isPending ? null : rows.length}
        countLabel={['unit', 'units']}
        search={search}
        onSearch={s => setFilters(f => ({ ...f, search: s || undefined }))}
        searchPlaceholder="Search units…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>}
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={8} className="px-3 pt-2" />
        ) : isError ? (
          <EmptyState className="py-20" title="Vacancies didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          hasFilter ? (
            <EmptyState className="py-20" icon={<CircleDashed />} title="No units match" description="Try removing a filter." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<DoorOpen />} title="Every unit is occupied" description="Units show up here the day they’re vacant or a resident gives notice." />
          )
        ) : (
          <DataTable rows={rows} columns={columns} getId={v => v.unitId} onRowClick={v => navigate(v.listing ? `/listings/${v.listing.id}` : `/units/${v.unitId}`)} focusedId={nav.focusedId} onHover={nav.onHover} className="pb-24" caption="Vacancies" />
        )}
      </div>
    </div>
  );
}
