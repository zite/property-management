import { useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, CircleDashed, Download, FileSignature, KeyRound, MessageSquare, Pencil, Plus, Repeat, RotateCcw, Save, Trash2, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveView } from 'zitejs/api';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { LEASE_PHASE_COLOR, LEASE_PHASES, LEASE_TYPES, RENEWAL_STATUSES, type LeasePhase } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { useHotkeys } from '../../lib/hotkeys';
import { cleanFilters, countFilters, useCollapsedGroups, useListState, type Filters, type ListOptions } from '../../lib/listState';
import { invalidate } from '../../lib/queries';
import type { SavedView } from '../../lib/types';
import { useWorkspace } from '../../lib/workspace';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, type ListGroup } from '../list/GroupedList';
import { parseViewConfig, SaveViewDialog } from '../list/SaveViewDialog';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { LeasePhasePill, PropertySwatch } from '../primitives/glyphs';
import {
  compareLeases, composeRecipients, DISPLAY_PROPERTIES, GROUPINGS, groupLeases, NAV_ORDER_KEY, ORDERINGS, residentNames, useLeases,
  type LeaseFilters, type LeaseGrouping, type LeaseOrdering, type LeaseRow,
} from './data';
import { ExpiryChip, LeaseListRow, RenewalPill, termText } from './LeaseRow';
import { RenewalDialog } from './RenewalDialog';

type Options = ListOptions<LeaseGrouping, LeaseOrdering>;

export const DEFAULT_OPTIONS: Options = {
  layout: 'list',
  grouping: 'phase',
  ordering: 'end',
  properties: ['number', 'residents', 'term', 'expiry', 'renewal', 'rent', 'balance', 'deposit'],
  showEmptyGroups: false,
  showClosed: false,
};

const SEARCH_KEY = 'search';

export type LeasesViewProps = {
  surfaceKey: string;
  baseFilters?: LeaseFilters;
  defaults?: Partial<Options>;
  savedView?: SavedView | null;
  lockedFilters?: string[];
  emptyTitle?: string;
  emptyDescription?: string;
  createDefaults?: Record<string, string | number | boolean | null | undefined>;
};

function toQuery(base: LeaseFilters, f: Filters, showClosed: boolean): LeaseFilters {
  const arr = (k: string) => (Array.isArray(f[k]) && (f[k] as string[]).length ? (f[k] as string[]) : undefined);
  const q: LeaseFilters = {
    ...base,
    phases: (arr('phases') as LeaseFilters['phases']) ?? base.phases,
    propertyIds: arr('propertyIds') ?? base.propertyIds,
    leaseTypes: (arr('leaseTypes') as LeaseFilters['leaseTypes']) ?? base.leaseTypes,
    renewalStatuses: (arr('renewalStatuses') as LeaseFilters['renewalStatuses']) ?? base.renewalStatuses,
    expiringWithin: (typeof f.expiringWithin === 'string' ? (f.expiringWithin as LeaseFilters['expiringWithin']) : undefined) ?? base.expiringWithin,
    hasBalance: f.hasBalance === 'true' || f.hasBalance === true || base.hasBalance || undefined,
    search: typeof f[SEARCH_KEY] === 'string' ? (f[SEARCH_KEY] as string) : undefined,
    showClosed: showClosed || base.showClosed || undefined,
  };
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as LeaseFilters;
}

/**
 * Every lease list in the app: the leases page and its tabs, and saved views.
 * Grouped by phase or property, a table for reconciling, filters, keyboard
 * navigation, bulk messages and renewal offers, CSV, and saving the view.
 */
export function LeasesView({ surfaceKey, baseFilters = {}, defaults, savedView, lockedFilters = [], emptyTitle, emptyDescription, createDefaults }: LeasesViewProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const viewConfig = useMemo(() => (savedView ? parseViewConfig(savedView.config) : null), [savedView]);
  const list = useListState<LeaseGrouping, LeaseOrdering>(surfaceKey, { ...DEFAULT_OPTIONS, ...defaults, ...(viewConfig?.options as Partial<Options>) }, viewConfig?.filters ?? {});
  const { options, setOptions, filters, setFilters } = list;
  const layout = options.layout === 'board' ? 'list' : options.layout;

  const query = useMemo(() => toQuery(baseFilters, filters, options.showClosed), [baseFilters, filters, options.showClosed]);
  const { data, isPending, isFetching, isError, error, refetch } = useLeases(query);
  const rows = data?.leases ?? [];

  const grouping = options.grouping;
  const groups = useMemo(() => groupLeases(rows, grouping, options.ordering, ws, { showEmpty: options.showEmptyGroups }), [rows, grouping, options.ordering, options.showEmptyGroups, ws]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups(surfaceKey);
  const visible = useMemo(() => (layout === 'table' ? [...rows].sort(compareLeases(options.ordering, ws)) : groups.flatMap(g => (collapsed.has(g.key) ? [] : g.items))), [groups, collapsed, layout, rows, options.ordering, ws]);

  useEffect(() => {
    try {
      sessionStorage.setItem(NAV_ORDER_KEY, JSON.stringify(visible.slice(0, 2000).map(l => l.id)));
    } catch {
      /* storage unavailable */
    }
  }, [visible]);

  const [renewing, setRenewing] = useState<LeaseRow[] | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const open = useCallback((l: LeaseRow) => navigate(`/leases/${l.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: l => l.id, onOpen: open, enabled: !renewing && !saveOpen });
  const { selection, selected, focusedId, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  useEffect(() => clearSelection(), [surfaceKey]);

  const messageTargets = (ls: LeaseRow[]) => {
    const recipients = composeRecipients(ls);
    if (!recipients.length) return toast.error('None of those leases has a resident to write to.');
    app.openCompose({ recipients, context: ls.length === 1 ? { leaseId: ls[0].id, propertyId: ls[0].propertyId ?? undefined } : undefined });
  };
  const renewTargets = (ls: LeaseRow[]) => {
    const ok = ls.filter(l => l.status === 'Active' && !l.moveOutDate);
    if (!ok.length) return toast.error(ls.length === 1 ? 'Only an active lease without notice can be offered a renewal.' : 'None of those leases can be offered a renewal.');
    setRenewing(ok);
  };
  useHotkeys(
    {
      m: () => ws.can('communications.send') && targets().length > 0 && messageTargets(targets()),
      r: () => targets().length > 0 && renewTargets(targets()),
    },
    { enabled: !renewing && !saveOpen },
  );

  const properties = useMemo(() => new Set(options.properties), [options.properties]);

  // ── Filters ──
  const filterDefs = useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      listFilter('phases', 'Phase', <CircleDashed />, () => LEASE_PHASES.map(p => ({ value: p, label: p, icon: <PhaseDot phase={p} /> }))),
      listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
      singleFilter('expiringWithin', 'Expiring within', <CalendarClock />, () => [
        { value: '30', label: '30 days' },
        { value: '60', label: '60 days' },
        { value: '90', label: '90 days' },
      ]),
      singleFilter('hasBalance', 'Balance', <Wallet />, () => [{ value: 'true', label: 'Owes money' }]),
      listFilter('renewalStatuses', 'Renewal', <Repeat />, () => RENEWAL_STATUSES.map(s => ({ value: s, label: s === 'None' ? 'Not offered' : s === 'Accepted' ? 'Renewed' : s }))),
      listFilter('leaseTypes', 'Lease type', <FileSignature />, () => LEASE_TYPES.map(t => ({ value: t, label: t }))),
    ];
    return defs.filter(d => !lockedFilters.includes(d.key));
  }, [ws, lockedFilters]);

  const viewDirty = Boolean(savedView) && list.isDirty;
  const canEditView = savedView && (savedView.ownerId === ws.me.id || ws.can('settings.manage'));
  const saveCurrentView = async () => {
    if (!savedView) return;
    try {
      await saveView({ action: 'update', id: savedView.id, config: { filters: cleanFilters(filters), options: options as unknown as Record<string, unknown> } });
      invalidate(qc, 'bootstrap');
      toast.success('View updated');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t update the view'));
    }
  };

  const exportCsv = (subset?: LeaseRow[]) => {
    const sorted = [...(subset ?? rows)].sort(compareLeases(options.ordering, ws));
    downloadCsv(
      'leases',
      ['Lease', 'Phase', 'Status', 'Property', 'Unit', 'Residents', 'Lease type', 'Start', 'End', 'Move-out', 'Days left', 'Rent', 'Deposit required', 'Deposit held', 'Balance', 'Renewal', 'Renewal rent', 'Offer expires'],
      sorted.map(l => [leaseRef(l.number), l.phase, l.status, ws.propertyName(l.propertyId), l.unitId ? ws.unitById.get(l.unitId)?.name ?? '' : '', residentNames(l), l.leaseType, l.startDate ?? '', l.endDate ?? '', l.moveOutDate ?? '', l.daysToEnd ?? '', l.rent, l.deposit, l.depositHeld, l.balance, l.renewalStatus, l.renewalRent ?? '', l.renewalExpiresOn ?? '']),
    );
  };

  const listGroups: ListGroup<LeaseRow>[] = useMemo(
    () =>
      groups.map(g => ({
        key: g.key,
        label: g.label,
        items: g.items,
        icon: g.kind === 'phase' ? <PhaseDot phase={g.key as LeasePhase} /> : g.kind === 'property' ? <PropertySwatch color={g.color} /> : g.kind === 'renewal' ? <Repeat className="h-3.5 w-3.5 text-muted-foreground" /> : undefined,
        hint: g.items.length ? <>{ws.money(g.items.reduce((s, l) => s + l.rent, 0), { cents: false })}/mo{g.items.some(l => l.balance > 0.004) ? ` · ${ws.money(g.items.reduce((s, l) => s + Math.max(0, l.balance), 0))} owed` : ''}</> : undefined,
      })),
    [groups, ws],
  );

  const tableColumns: Column<LeaseRow>[] = useMemo(
    () => [
      { key: 'number', header: 'Lease', width: 76, cell: l => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{leaseRef(l.number)}</span>, sort: l => l.number ?? 0 },
      { key: 'unit', header: 'Unit', cell: l => <span className="flex min-w-0 items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} /><span className="truncate font-medium">{ws.unitLabel(l.unitId, l.propertyId)}</span></span>, sort: l => ws.unitLabel(l.unitId, l.propertyId), className: 'max-w-[220px]' },
      { key: 'phase', header: 'Phase', cell: l => <LeasePhasePill phase={l.phase as LeasePhase} />, sort: l => LEASE_PHASES.indexOf(l.phase as LeasePhase) },
      { key: 'residents', header: 'Residents', cell: l => <span className="block max-w-[180px] truncate">{residentNames(l) || <span className="text-muted-foreground">—</span>}</span>, sort: l => residentNames(l), hideBelow: 'md' },
      { key: 'term', header: 'Term', cell: l => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{termText(l)}</span>, sort: l => l.startDate, hideBelow: 'xl' },
      { key: 'expiry', header: 'Days left', cell: l => <ExpiryChip lease={l} />, sort: l => l.daysToEnd ?? 99999, hideBelow: 'md' },
      { key: 'renewal', header: 'Renewal', cell: l => <RenewalPill lease={l} />, sort: l => l.renewalStatus, hideBelow: 'lg' },
      { key: 'rent', header: 'Rent', align: 'right', cell: l => <Money value={l.rent} />, sort: l => l.rent, footer: <Money value={rows.reduce((s, l) => s + l.rent, 0)} /> },
      { key: 'deposit', header: 'Deposit held', align: 'right', cell: l => <Money value={l.depositHeld} muted0 />, sort: l => l.depositHeld, hideBelow: 'lg', footer: <Money value={rows.reduce((s, l) => s + l.depositHeld, 0)} /> },
      { key: 'balance', header: 'Balance', align: 'right', cell: l => <Money value={l.balance} tone="balance" muted0 />, sort: l => l.balance, footer: <Money value={rows.reduce((s, l) => s + l.balance, 0)} tone="balance" /> },
    ],
    [ws, rows],
  );

  const hasAnyFilter = countFilters(filters) > 0 || Boolean(filters[SEARCH_KEY]);
  const content = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Leases didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length) {
      return hasAnyFilter ? (
        <EmptyState className="py-20" icon={<KeyRound />} title="No leases match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState
          className="py-20"
          icon={<KeyRound />}
          title={emptyTitle ?? 'No leases yet'}
          description={emptyDescription ?? 'A lease is created when someone moves in — from an approved application or straight from a vacant unit.'}
          action={<button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('lease', createDefaults)}><Plus className="h-3.5 w-3.5" /> New lease</button>}
        />
      );
    }
    if (layout === 'table') {
      return (
        <DataTable
          rows={visible}
          columns={tableColumns}
          getId={l => l.id}
          onRowClick={onRowClick}
          selection={selection}
          onToggleSelect={(l, e) => toggleSelect(l, e)}
          onSelectAll={all => setSelection(all ? new Set(visible.map(l => l.id)) : new Set())}
          focusedId={focusedId}
          onHover={onHover}
          className="h-full"
          caption="Leases"
        />
      );
    }
    return (
      <GroupedList
        label="Leases"
        groups={listGroups}
        single={grouping === 'none'}
        getId={l => l.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(l => l.id)]))}
        renderRow={l => (
          <LeaseListRow
            lease={l}
            properties={properties}
            hidePhase={grouping === 'phase'}
            hideProperty={grouping === 'property'}
            selected={selection.has(l.id)}
            focused={focusedId === l.id}
            selecting={selecting}
            onClick={onRowClick}
            onHover={onHover}
            onToggleSelect={toggleSelect}
            targetsFor={targetsFor}
            onRenew={renewTargets}
          />
        )}
      />
    );
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
            {viewDirty && canEditView && (
              <span className="ml-1 flex items-center gap-1">
                <button type="button" onClick={() => void saveCurrentView()} className="ghost-chip h-8 gap-1.5 text-primary"><Save className="h-3.5 w-3.5" /> Save view</button>
                <button type="button" onClick={list.reset} className="ghost-chip h-8 gap-1.5 text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
              </span>
            )}
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['lease', 'leases']}
        search={typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : ''}
        onSearch={q => setFilters(f => ({ ...f, [SEARCH_KEY]: q || undefined }))}
        searchPlaceholder="Search resident, unit, L-number…"
        layout={layout}
        layouts={['list', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={isFetching && !isPending}
        display={
          <DisplayMenu
            options={{ ...options, layout }}
            onChange={setOptions}
            groupings={GROUPINGS}
            orderings={ORDERINGS}
            properties={layout === 'list' ? DISPLAY_PROPERTIES : undefined}
            closedLabel="Show ended & canceled"
            onReset={list.reset}
            isDirty={list.isDirty && !savedView}
          />
        }
        more={
          <>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => exportCsv()} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </DropdownMenuItem>
            {!savedView && (
              <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setSaveOpen(true)}>
                <Save className="h-3.5 w-3.5" /> Save as view…
              </DropdownMenuItem>
            )}
            {savedView && canEditView && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setSaveOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Rename or share view…
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger"
                  onSelect={async () => {
                    if (!(await app.confirm({ title: `Delete “${savedView.name}”?`, description: 'The view is removed for everyone it’s shared with. Leases aren’t affected.', confirmLabel: 'Delete view', destructive: true }))) return;
                    try {
                      await saveView({ action: 'delete', id: savedView.id });
                      invalidate(qc, 'bootstrap');
                      navigate('/leases');
                      toast.success('View deleted');
                    } catch (e) {
                      toast.error(errorMessage(e, 'Couldn’t delete the view'));
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete view
                </DropdownMenuItem>
              </>
            )}
          </>
        }
      />
      {data?.truncated && <p className="border-b bg-tone-warning/[0.06] px-4 py-1.5 text-sm text-tone-warning">Showing the first 2,000 leases. Filter by property to see the rest.</p>}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {content}
      </div>
      <BulkBar count={selected.length} noun={['lease', 'leases']} onClear={clearSelection}>
        {ws.can('communications.send') && <BulkAction icon={<MessageSquare />} label="Message" onClick={() => messageTargets(selected)} />}
        <BulkAction icon={<Repeat />} label="Offer renewals" onClick={() => renewTargets(selected)} />
        <BulkAction icon={<Download />} label="Export" onClick={() => exportCsv(selected)} />
      </BulkBar>
      <RenewalDialog open={Boolean(renewing)} onOpenChange={o => !o && setRenewing(null)} leases={renewing ?? []} onDone={clearSelection} />
      <SaveViewDialog open={saveOpen} onOpenChange={setSaveOpen} scope="leases" config={{ filters: cleanFilters(filters), options }} existing={savedView ? { id: savedView.id, name: savedView.name, shared: savedView.shared } : null} />
    </div>
  );
}

function BulkAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className={bulkButton} onClick={onClick}>
      {icon} {label}
    </button>
  );
}

/** The phase colour as a small dot, for group headers and filter options. */
export function PhaseDot({ phase }: { phase: LeasePhase | string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: LEASE_PHASE_COLOR[phase as LeasePhase] ?? '#8b8d98' }} aria-hidden />;
}
