import { BedDouble, CircleDashed, DollarSign, Download, Home, Plus, TrendingDown } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenuCheckboxItem, DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { OCCUPANCY, UNIT_READINESS, type UnitReadiness } from '@project/shared/constants';
import { percentOf, toCents } from '@project/shared/money';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { bedsBaths, fullDate, plural, shortDate } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { countFilters, useListState, type ListOptions } from '../../lib/listState';
import type { Unit } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { MoneyInput, NumberInput, Segmented } from '../form/fields';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, type FilterDef } from '../list/Filters';
import { Slot } from '../list/GroupedList';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { OccupancyGlyph } from '../primitives/glyphs';
import { ReadinessGlyph, ReadinessPicker } from './bits';
import { hasCents, usePropertyLeases, useUnitActions } from './data';

/**
 * A property's units as a dense table: who lives there, what they pay against
 * market, when the lease ends, what they owe, and whether the unit is ready.
 * S sets readiness on the focused or selected units; X selects; ↵ opens.
 */

type Row = Unit & { balance: number | null; pastDue: number | null; belowMarket: boolean };

const DEFAULTS: ListOptions = { layout: 'table', grouping: 'none', ordering: 'name', properties: [], showEmptyGroups: false, showClosed: false };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function PropertyUnits({ propertyId, archived }: { propertyId: string; archived: boolean }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { update } = useUnitActions();
  const list = useListState(`property:${propertyId}:units`, DEFAULTS, {});
  const { options, setOptions, filters, setFilters } = list;
  const money = ws.can('accounting.view');
  const manage = ws.can('portfolio.manage');
  const leases = usePropertyLeases(propertyId, money);
  const balanceBy = useMemo(() => new Map((leases.data?.leases ?? []).map(l => [l.id, l])), [leases.data]);
  const search = typeof filters.search === 'string' ? filters.search : '';

  const all: Row[] = useMemo(
    () =>
      (ws.unitsByProperty.get(propertyId) ?? []).map(u => {
        const l = u.currentLeaseId ? balanceBy.get(u.currentLeaseId) : undefined;
        return { ...u, balance: l?.balance ?? null, pastDue: l?.pastDue ?? null, belowMarket: u.currentRent != null && u.marketRent > 0 && toCents(u.currentRent) < toCents(u.marketRent) };
      }),
    [ws.unitsByProperty, propertyId, balanceBy],
  );

  const arr = (k: string) => (Array.isArray(filters[k]) ? (filters[k] as string[]) : []);
  const rows = useMemo(() => {
    const occ = arr('occupancy');
    const ready = arr('readiness');
    const beds = arr('beds');
    const q = search.trim().toLowerCase();
    return all
      .filter(u => options.showClosed || !u.archived)
      .filter(u => !occ.length || occ.includes(u.occupancy))
      .filter(u => !ready.length || ready.includes(u.readiness))
      .filter(u => !beds.length || beds.includes(u.beds >= 3 ? '3' : String(u.beds)))
      .filter(u => !q || [u.name, u.residentNames, u.unitType].some(v => v.toLowerCase().includes(q)))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [all, filters, options.showClosed, search]);

  const [picker, setPicker] = useState<{ id: string } | null>(null);
  const [bulk, setBulk] = useState<'readiness' | 'rent' | null>(null);
  const open = useCallback((u: Row) => navigate(`/units/${u.id}`), [navigate]);
  const nav = useListNav({ items: rows, getId: u => u.id, onOpen: open, enabled: !picker && !bulk });
  const { selection, selected, focusedId, focused, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  const setReadiness = (targetRows: Row[], readiness: UnitReadiness) => {
    setPicker(null);
    setBulk(null);
    const changing = targetRows.filter(u => u.readiness !== readiness);
    if (!changing.length) return;
    void update(changing, { readiness }, { toast: changing.length === 1 ? `${changing[0].name} → ${readiness}` : `${plural(changing.length, 'unit')} → ${readiness}` }).catch(() => undefined);
  };

  useHotkeys(
    {
      s: () => {
        if (!manage) return;
        if (selection.size) setBulk('readiness');
        else if (focused) setPicker({ id: focused.id });
      },
    },
    { enabled: !picker && !bulk },
  );

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      listFilter('occupancy', 'Occupancy', <Home />, () => OCCUPANCY.map(o => ({ value: o, label: o === 'Notice' ? 'On notice' : o, icon: <OccupancyGlyph occupancy={o} /> }))),
      listFilter('readiness', 'Readiness', <CircleDashed />, () => UNIT_READINESS.map(r => ({ value: r, label: r, icon: <ReadinessGlyph readiness={r} /> }))),
      listFilter('beds', 'Bedrooms', <BedDouble />, () => [{ value: '0', label: 'Studio' }, { value: '1', label: '1 bedroom' }, { value: '2', label: '2 bedrooms' }, { value: '3', label: '3+ bedrooms' }]),
    ],
    [],
  );
  const hasFilters = countFilters(filters) > 0 || Boolean(search);

  const readinessCell = (u: Row): ReactNode => {
    const content = (
      <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap px-1.5 text-[13.5px]">
        <ReadinessGlyph readiness={u.readiness} /> {u.readiness}
      </span>
    );
    if (!manage || u.archived) return content;
    return (
      <Slot
        label={`Readiness: ${u.readiness}`}
        active={picker?.id === u.id}
        onActivate={() => setPicker({ id: u.id })}
        picker={trigger => <ReadinessPicker value={u.readiness} count={targetsFor(u).length} onChange={r => setReadiness(targetsFor(u), r)} open onOpenChange={o => !o && setPicker(null)} align="end" trigger={trigger} />}
      >
        {content}
      </Slot>
    );
  };

  const totalMarket = rows.reduce((a, u) => a + (u.archived ? 0 : u.marketRent), 0);
  const totalRent = rows.reduce((a, u) => a + (u.currentRent ?? 0), 0);
  const totalBalance = rows.reduce((a, u) => a + (u.balance ?? 0), 0);

  const columns: Column<Row>[] = [
    {
      key: 'name', header: 'Unit', sort: u => u.name, className: 'min-w-[120px]',
      cell: u => (
        <span className="flex min-w-0 items-center gap-2">
          <Tip label={u.occupancy === 'Notice' ? `On notice${u.moveOutDate ? ` · moving out ${shortDate(u.moveOutDate)}` : ''}` : u.occupancy}><span className="flex"><OccupancyGlyph occupancy={u.occupancy} /></span></Tip>
          <span className={cn('truncate font-medium', u.archived && 'text-muted-foreground line-through')}>{u.name}</span>
          {u.upcomingLeaseId && <Tip label="A new lease starts soon"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-tone-info" /></Tip>}
        </span>
      ),
    },
    { key: 'layout', header: 'Layout', sort: u => u.beds * 100 + u.baths, hideBelow: 'sm', cell: u => <span className="whitespace-nowrap text-muted-foreground">{bedsBaths(u.beds, u.baths, u.squareFeet)}</span> },
    { key: 'market', header: 'Market', align: 'right', sort: u => u.marketRent, hideBelow: 'md', cell: u => <Money value={u.marketRent} cents={hasCents(u.marketRent)} muted0 />, footer: <Money value={totalMarket} cents={false} /> },
    {
      key: 'rent', header: 'Rent', align: 'right', sort: u => u.currentRent ?? -1,
      cell: u =>
        u.currentRent == null ? <span className="text-muted-foreground/70">—</span> : (
          <span className="inline-flex items-center justify-end gap-1">
            {u.belowMarket && (
              <Tip label={`${ws.money(u.marketRent - u.currentRent, { cents: false })} below market`}>
                <TrendingDown className="h-3 w-3 text-tone-warning" aria-label="Below market" />
              </Tip>
            )}
            <Money value={u.currentRent} cents={hasCents(u.currentRent)} />
          </span>
        ),
      footer: <Money value={totalRent} cents={false} />,
    },
    { key: 'residents', header: 'Residents', sort: u => u.residentNames, className: 'max-w-[220px]', hideBelow: 'sm', cell: u => (u.residentNames ? <span className="block truncate">{u.residentNames}</span> : <span className="text-muted-foreground">{u.occupancy === 'Vacant' ? 'Vacant' : '—'}</span>) },
    { key: 'leaseEnd', header: 'Lease end', sort: u => u.moveOutDate ?? u.leaseEnd ?? '9999', hideBelow: 'lg', cell: u => (u.moveOutDate ? <Tip label={`Moving out ${fullDate(u.moveOutDate)}`}><span className="whitespace-nowrap text-tone-warning">Out {shortDate(u.moveOutDate)}</span></Tip> : u.leaseEnd ? <span className="whitespace-nowrap text-muted-foreground">{shortDate(u.leaseEnd)}</span> : u.currentLeaseId ? <span className="text-muted-foreground">Month-to-month</span> : null) },
    ...(money ? [{ key: 'balance', header: 'Balance', align: 'right' as const, sort: (u: Row) => u.balance ?? 0, hideBelow: 'md' as const, cell: (u: Row) => (leases.isPending ? <span className="skeleton inline-block h-3 w-12" /> : u.balance == null ? <span className="text-muted-foreground/70">—</span> : <Tip label={u.pastDue ? `${ws.money(u.pastDue)} past due` : 'Balance'}><span><Money value={u.balance} tone="balance" muted0 /></span></Tip>), footer: <Money value={totalBalance} tone="balance" /> }] : []),
    { key: 'readiness', header: 'Readiness', sort: u => UNIT_READINESS.indexOf(u.readiness as UnitReadiness), width: 140, cell: readinessCell },
  ];

  const exportCsv = () =>
    downloadCsv(
      `${ws.propertyName(propertyId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-units`,
      ['Unit', 'Beds', 'Baths', 'Sq ft', 'Market rent', 'Current rent', 'Residents', 'Occupancy', 'Lease end', 'Move-out', ...(money ? ['Balance', 'Past due'] : []), 'Readiness', 'Archived'],
      rows.map(u => [u.name, u.beds, u.baths, u.squareFeet ?? '', u.marketRent, u.currentRent ?? '', u.residentNames, u.occupancy, u.leaseEnd ?? '', u.moveOutDate ?? '', ...(money ? [u.balance ?? '', u.pastDue ?? ''] : []), u.readiness, u.archived ? 'Yes' : '']),
    );

  const addUnit = manage && !archived && (
    <button type="button" onClick={() => app.openCreate('unit', { propertyId })} className="ghost-chip h-8 gap-1.5">
      <Plus className="h-3.5 w-3.5" /> Add unit
    </button>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
          </>
        }
        count={rows.length}
        countLabel={['unit', 'units']}
        search={search}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search unit or resident…"
        display={addUnit || undefined}
        more={
          <>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>
            <DropdownMenuCheckboxItem className="h-9 text-[14px]" checked={options.showClosed} onCheckedChange={v => setOptions({ showClosed: Boolean(v) })}>Show archived units</DropdownMenuCheckboxItem>
            {manage && !archived && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('unit', { propertyId, many: true })}><Plus className="h-3.5 w-3.5" /> Add several units…</DropdownMenuItem>}
          </>
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {!all.length ? (
          <EmptyState className="py-20" icon={<Home />} title="No units yet" description="Add the apartments, homes or suites at this property so they can be listed and leased." action={manage && !archived ? <button type="button" onClick={() => app.openCreate('unit', { propertyId, many: true })} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Add units</button> : undefined} />
        ) : !rows.length ? (
          hasFilters ? (
            <EmptyState className="py-20" icon={<Home />} title="No units match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
          ) : (
            <EmptyState className="py-20" icon={<Home />} title="Every unit is archived" action={<button type="button" className="ghost-chip h-9" onClick={() => setOptions({ showClosed: true })}>Show archived units</button>} />
          )
        ) : money && leases.isPending && !leases.data ? (
          <SkeletonRows rows={Math.min(12, rows.length)} className="px-3 pt-2" />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getId={u => u.id}
            onRowClick={onRowClick}
            selection={manage ? selection : undefined}
            onToggleSelect={manage ? (u, e) => toggleSelect(u, e) : undefined}
            onSelectAll={on => setSelection(on ? new Set(rows.map(u => u.id)) : new Set())}
            focusedId={focusedId}
            onHover={onHover}
            rowClassName={u => (u.archived ? 'text-muted-foreground' : undefined)}
            className="pb-24"
            caption="Units"
          />
        )}
      </div>
      <BulkBar count={selected.length} noun={['unit', 'units']} onClear={clearSelection}>
        <ReadinessPicker
          value={selected.every(u => u.readiness === selected[0]?.readiness) ? selected[0]?.readiness ?? null : null}
          count={selected.length}
          onChange={r => setReadiness(selected, r)}
          open={bulk === 'readiness'}
          onOpenChange={o => setBulk(o ? 'readiness' : null)}
          align="center"
          trigger={<button type="button" className={bulkButton}><CircleDashed /> Readiness</button>}
        />
        <MarketRentPopover units={selected} open={bulk === 'rent'} onOpenChange={o => setBulk(o ? 'rent' : null)} />
      </BulkBar>
    </div>
  );
}

/** Set market rent on several units: an exact amount, or a percentage change rounded to whole dollars. */
function MarketRentPopover({ units, open, onOpenChange }: { units: Row[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const { update } = useUnitActions();
  const [mode, setMode] = useState<'set' | 'raise'>('set');
  const [amount, setAmount] = useState<number | null>(null);
  const [pct, setPct] = useState<number | null>(3);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => {
    if (mode === 'set') return amount == null ? [] : units.map(u => ({ unit: u, next: amount }));
    if (pct == null) return [];
    return units.map(u => ({ unit: u, next: Math.max(0, Math.round(u.marketRent + percentOf(u.marketRent, pct))) }));
  }, [mode, amount, pct, units]);

  const apply = async () => {
    const changes = plan.filter(p => toCents(p.next) !== toCents(p.unit.marketRent));
    if (!changes.length) return onOpenChange(false);
    setBusy(true);
    try {
      // One request per distinct amount, one after another.
      const byAmount = new Map<number, Row[]>();
      for (const c of changes) byAmount.set(c.next, [...(byAmount.get(c.next) ?? []), c.unit]);
      let i = 0;
      for (const [next, group] of byAmount) {
        i++;
        await update(group, { marketRent: next }, { toast: i === byAmount.size ? `Market rent updated on ${plural(changes.length, 'unit')}` : false });
      }
      onOpenChange(false);
    } catch {
      /* the action toasts and rolls back */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={bulkButton}><DollarSign /> Market rent</button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-[300px] p-3 shadow-lg" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void apply(); } }}>
        <Segmented value={mode} onChange={v => setMode(v as 'set' | 'raise')} options={[{ value: 'set', label: 'Set to' }, { value: 'raise', label: 'Change by %' }]} size="sm" className="w-full [&>button]:flex-1 [&>button]:justify-center" />
        <div className="mt-3">{mode === 'set' ? <MoneyInput value={amount} onChange={setAmount} autoFocus /> : <NumberInput value={pct} onChange={setPct} step={0.5} min={-50} max={100} suffix="%" />}</div>
        {plan.length > 0 && mode === 'raise' && (
          <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-sm text-muted-foreground">
            {plan.slice(0, 8).map(p => (
              <li key={p.unit.id} className="flex justify-between gap-2 tabular-nums"><span className="truncate">{p.unit.name}</span><span>{ws.money(p.unit.marketRent, { cents: false })} → <span className="text-foreground">{ws.money(p.next, { cents: false })}</span></span></li>
            ))}
            {plan.length > 8 && <li>and {plan.length - 8} more</li>}
          </ul>
        )}
        <button type="button" disabled={!plan.length || busy} onClick={() => void apply()} className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-[14px] font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Saving…' : `Update ${plural(units.length, 'unit')}`}
        </button>
      </PopoverContent>
    </Popover>
  );
}
