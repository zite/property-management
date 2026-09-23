import { Building2, CircleDashed, Download, Eye, FileText, ImageOff, LayoutGrid, Plus, Table2, UsersRound, Inbox } from 'lucide-react';
import { useMemo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { LISTING_STATUSES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { bedsBaths, shortDate } from '../../lib/format';
import { countFilters, useListState, type ListOptions } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, type FilterDef } from '../list/Filters';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { ListingStatusPill } from './bits';
import { useListings, type Listing } from './data';

type Options = ListOptions<'none', 'status'>;
const DEFAULTS: Options = { layout: 'board', grouping: 'none', ordering: 'status', properties: [], showEmptyGroups: false, showClosed: false };

function Stat({ icon, value, label, highlight }: { icon: React.ReactNode; value: number | string; label: string; highlight?: boolean }) {
  return (
    <Tip label={label}>
      <span className={cn('inline-flex items-center gap-1 text-sm tabular-nums', highlight ? 'font-medium text-primary' : 'text-muted-foreground')}>
        {icon}
        {value}
      </span>
    </Tip>
  );
}

function ListingCardView({ listing: l, focused, onClick, onHover }: { listing: Listing; focused: boolean; onClick: (e: MouseEvent) => void; onHover: () => void }) {
  const ws = useWorkspace();
  const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
  return (
    <div
      role="link"
      tabIndex={-1}
      data-row-id={l.id}
      onClick={onClick}
      onMouseMove={() => !focused && onHover()}
      className={cn('group flex cursor-default flex-col overflow-hidden rounded-lg border bg-card shadow-2xs transition-[border-color,box-shadow] hover:border-foreground/15 hover:shadow-sm', focused && 'border-foreground/25 ring-1 ring-foreground/10', l.status === 'Leased' && 'opacity-80')}
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted">
        {l.cover ? (
          <img src={l.cover} alt="" loading="lazy" className="h-full w-full object-cover" onError={e => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground"><ImageOff className="h-4 w-4" /> No photos yet</div>
        )}
        <span className="absolute left-2 top-2"><ListingStatusPill status={l.status} className="bg-background/90 shadow-xs backdrop-blur" /></span>
        {l.photos.length > 1 && <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-white">{l.photos.length} photos</span>}
      </div>
      <div className="flex flex-1 flex-col px-3 pb-2.5 pt-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[16px] font-semibold tabular-nums">{l.rent ? <Money value={l.rent} cents={false} /> : <span className="text-muted-foreground">No rent</span>}<span className="text-sm font-normal text-muted-foreground">{l.rent ? ' /mo' : ''}</span></span>
          <span className="truncate text-sm text-muted-foreground">{l.beds != null ? bedsBaths(l.beds, l.baths ?? 0, l.squareFeet) : ''}</span>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[36px] text-[14px] font-medium leading-[20px]">{l.title}</p>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <PropertySwatch color={property?.color} size={7} />
          <span className="truncate">{ws.unitLabel(l.unitId, l.propertyId) || 'No unit'}</span>
          {l.availableOn && <span className="shrink-0">· {l.availableOn <= ws.today ? 'Available now' : `Available ${shortDate(l.availableOn)}`}</span>}
        </span>
        <div className="mt-2.5 flex items-center gap-3 border-t pt-2">
          <Stat icon={<Eye className="h-3 w-3" />} value={l.views.toLocaleString()} label={`${l.views.toLocaleString()} views on the portal`} />
          <Stat icon={<Inbox className="h-3 w-3" />} value={l.leadCount} label={`${l.leadCount} leads${l.newLeadCount ? `, ${l.newLeadCount} new` : ''}`} highlight={l.newLeadCount > 0} />
          <Stat icon={<UsersRound className="h-3 w-3" />} value={l.applicationCount} label={`${l.applicationCount} applications${l.openApplicationCount ? `, ${l.openApplicationCount} open` : ''}`} highlight={l.openApplicationCount > 0} />
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">{l.daysOnMarket != null ? `${l.daysOnMarket}d on market` : l.status === 'Draft' ? 'Not published' : ''}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Listings as photo cards (how applicants see them) or a dense table. Leased
 * listings are hidden until asked for. J/K and Enter work on both.
 */
export function ListingsView() {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const list = useListState<'none', 'status'>('leasing:listings', DEFAULTS, {});
  const { options, setOptions, filters, setFilters } = list;
  const { data, isPending, isError, error, refetch, isFetching } = useListings();
  const all = data?.listings ?? [];
  const search = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
  const statuses = Array.isArray(filters.statuses) ? (filters.statuses as string[]) : [];
  const propertyIds = Array.isArray(filters.propertyIds) ? (filters.propertyIds as string[]) : [];
  const rows = useMemo(
    () =>
      all.filter(l =>
        (statuses.length ? statuses.includes(l.status) : options.showClosed || l.status !== 'Leased') &&
        (!propertyIds.length || propertyIds.includes(l.propertyId ?? '')) &&
        (!search || `${l.title} ${l.propertyName} ${l.unitName} ${l.slug}`.toLowerCase().includes(search)),
      ),
    [all, statuses.join(), propertyIds.join(), search, options.showClosed],
  );
  const leasedHidden = !statuses.length && !options.showClosed ? all.filter(l => l.status === 'Leased').length : 0;
  const nav = useListNav({ items: rows, getId: l => l.id, onOpen: l => navigate(`/listings/${l.id}`) });

  const filterDefs: FilterDef[] = useMemo(() => [
    listFilter('statuses', 'Status', <CircleDashed />, () => LISTING_STATUSES.map(s => ({ value: s, label: s === 'Published' ? 'Published (live)' : s }))),
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} /> }))),
  ], [ws]);

  const columns: Column<Listing>[] = useMemo(() => [
    { key: 'photo', header: '', width: 56, cell: l => (l.cover ? <img src={l.cover} alt="" className="h-9 w-11 rounded object-cover" loading="lazy" /> : <span className="flex h-9 w-11 items-center justify-center rounded bg-muted text-muted-foreground"><ImageOff className="h-3.5 w-3.5" /></span>) },
    { key: 'title', header: 'Listing', cell: l => <span className="block max-w-[320px] truncate font-medium">{l.title}</span>, sort: l => l.title },
    { key: 'unit', header: 'Unit', cell: l => <span className="inline-flex max-w-[200px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(l.unitId, l.propertyId)}</span></span>, sort: l => ws.unitLabel(l.unitId, l.propertyId), hideBelow: 'md' },
    { key: 'status', header: 'Status', cell: l => <ListingStatusPill status={l.status} />, sort: l => LISTING_STATUSES.indexOf(l.status as never) },
    { key: 'rent', header: 'Rent', align: 'right', cell: l => <Money value={l.rent} muted0 />, sort: l => l.rent ?? 0 },
    { key: 'deposit', header: 'Deposit', align: 'right', cell: l => <Money value={l.deposit} muted0 />, sort: l => l.deposit ?? 0, hideBelow: 'xl' },
    { key: 'available', header: 'Available', cell: l => (l.availableOn ? (l.availableOn <= ws.today ? 'Now' : shortDate(l.availableOn)) : ''), sort: l => l.availableOn, hideBelow: 'lg' },
    { key: 'dom', header: 'On market', align: 'right', cell: l => (l.daysOnMarket != null ? `${l.daysOnMarket}d` : '—'), sort: l => l.daysOnMarket ?? -1, hideBelow: 'lg' },
    { key: 'views', header: 'Views', align: 'right', cell: l => l.views.toLocaleString(), sort: l => l.views, hideBelow: 'md' },
    { key: 'leads', header: 'Leads', align: 'right', cell: l => <span className={cn(l.newLeadCount > 0 && 'font-medium text-primary')}>{l.leadCount}</span>, sort: l => l.leadCount },
    { key: 'apps', header: 'Applications', align: 'right', cell: l => <span className={cn(l.openApplicationCount > 0 && 'font-medium text-primary')}>{l.applicationCount}</span>, sort: l => l.applicationCount },
  ], [ws]);

  const exportCsv = () =>
    downloadCsv('listings', ['Title', 'Status', 'Property', 'Unit', 'Rent', 'Deposit', 'Available', 'Days on market', 'Views', 'Leads', 'Applications', 'Public link'], rows.map(l => [l.title, l.status, l.propertyName, l.unitName, l.rent, l.deposit, l.availableOn ?? '', l.daysOnMarket ?? '', l.views, l.leadCount, l.applicationCount, l.publicUrl ?? '']));

  const hasFilter = countFilters(filters) > 0 || Boolean(search);
  const cards = options.layout !== 'table';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={<><FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} /><FilterChips defs={filterDefs} filters={filters} onChange={setFilters} /></>}
        count={isPending ? null : rows.length}
        countLabel={['listing', 'listings']}
        search={search}
        onSearch={s => setFilters(f => ({ ...f, search: s || undefined }))}
        searchPlaceholder="Search listings…"
        fetching={isFetching && !isPending}
        display={
          <div className="flex h-8 items-center rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Layout">
            {([['board', 'Cards', <LayoutGrid key="c" className="h-3.5 w-3.5" />], ['table', 'Table', <Table2 key="t" className="h-3.5 w-3.5" />]] as const).map(([value, label, icon]) => (
              <Tip key={value} label={label}>
                <button type="button" role="radio" aria-checked={options.layout === value} aria-label={`${label} layout`} onClick={() => setOptions({ layout: value })} className={cn('flex h-full w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors', options.layout === value ? 'bg-accent text-foreground shadow-2xs' : 'hover:text-foreground')}>{icon}</button>
              </Tip>
            ))}
          </div>
        }
        more={
          <>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setOptions({ showClosed: !options.showClosed })}><FileText className="h-3.5 w-3.5" /> {options.showClosed ? 'Hide leased listings' : 'Show leased listings'}</DropdownMenuItem>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>
          </>
        }
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <div className="grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="overflow-hidden rounded-lg border"><div className="skeleton aspect-[3/2] rounded-none" /><div className="space-y-2 p-3"><div className="skeleton h-4 w-1/3" /><div className="skeleton h-3 w-4/5" /><div className="skeleton h-3 w-1/2" /></div></div>)}
          </div>
        ) : isError ? (
          <EmptyState className="py-20" title="Listings didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          hasFilter ? (
            <EmptyState className="py-20" icon={<FileText />} title="No listings match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<FileText />} title={all.length ? 'Every listing is leased' : 'No listings yet'} description={all.length ? 'Leased listings are hidden. Create a listing for your next vacancy.' : 'Create a listing from a vacant unit, add photos and publish it to your portal’s homes page.'} action={<button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('listing')}><Plus className="h-3.5 w-3.5" /> New listing</button>} />
          )
        ) : cards ? (
          <div className="grid gap-3 p-4 pb-24 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {rows.map(l => <ListingCardView key={l.id} listing={l} focused={nav.focusedId === l.id} onClick={() => navigate(`/listings/${l.id}`)} onHover={() => nav.onHover(l)} />)}
          </div>
        ) : (
          <DataTable rows={rows} columns={columns} getId={l => l.id} onRowClick={l => navigate(`/listings/${l.id}`)} focusedId={nav.focusedId} onHover={nav.onHover} className="pb-24" caption="Listings" />
        )}
        {!isPending && leasedHidden > 0 && rows.length > 0 && (
          <div className="-mt-20 pb-24 text-center">
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setOptions({ showClosed: true })}>{leasedHidden} leased {leasedHidden === 1 ? 'listing' : 'listings'} hidden · Show</button>
          </div>
        )}
      </div>
    </div>
  );
}
