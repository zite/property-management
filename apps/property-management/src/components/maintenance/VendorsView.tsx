import { FileSpreadsheet, FileText, Hammer, MessageSquare, Pencil, Plus, Power, ShieldAlert, SquareArrowOutUpRight, UserRoundCheck, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { VENDOR_TRADES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { timeAgo } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type ListOptions } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, RowShell, type ListGroup } from '../list/GroupedList';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill } from '../primitives/glyphs';
import { ComplianceChips, InsurancePill, Rating, VendorGlyph } from './bits';
import { INSURANCE_LABEL, useVendorActions, type VendorRow } from './data';

export type VendorScope = 'active' | 'attention' | '1099' | 'inactive';
type Grouping = 'none' | 'trade' | 'compliance';
type Ordering = 'name' | 'open' | 'spend' | 'insurance' | 'rating' | 'recent';

const GROUPINGS: ReadonlyArray<{ value: Grouping; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'trade', label: 'Trade' },
  { value: 'compliance', label: 'Insurance' },
];
const ORDERINGS: ReadonlyArray<{ value: Ordering; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'open', label: 'Open work orders' },
  { value: 'spend', label: 'Paid this year' },
  { value: 'insurance', label: 'Insurance expiry' },
  { value: 'rating', label: 'Rating' },
  { value: 'recent', label: 'Most recent work' },
];
const PROPERTIES = [
  { key: 'trade', label: 'Trade' },
  { key: 'contact', label: 'Contact' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'work', label: 'Open work' },
  { key: 'spend', label: 'Paid this year' },
  { key: 'rating', label: 'Rating' },
];

const DEFAULTS: ListOptions<Grouping, Ordering> = { layout: 'list', grouping: 'none', ordering: 'name', properties: PROPERTIES.map(p => p.key), showEmptyGroups: false, showClosed: false };

const COMPLIANCE_FILTERS: Record<string, (v: VendorRow) => boolean> = {
  expired: v => v.compliance.insurance === 'Expired',
  expiring: v => v.compliance.insurance === 'Expiring',
  missing: v => v.compliance.insurance === 'Missing',
  w9: v => v.compliance.w9Missing,
  review: v => v.compliance.coiPendingReview || v.compliance.w9PendingReview,
  ok: v => !v.compliance.problem,
};

const INSURANCE_ORDER = ['Expired', 'Missing', 'Expiring', 'Valid', 'Not required'];

export const inScope = (v: VendorRow, scope: VendorScope) =>
  scope === 'inactive' ? v.status === 'Inactive' : v.status !== 'Inactive' && (scope === 'attention' ? v.compliance.problem || v.compliance.coiPendingReview || v.compliance.w9PendingReview : scope === '1099' ? v.is1099 : true);

/**
 * The vendors list: a scope (all active, needing attention, 1099 vendors,
 * inactive), filters, search, a grouped list or a table, keyboard navigation
 * and CSV exports — including the year's 1099 prep sheet.
 */
export function VendorsView({ scope, vendors, isPending, isError, errorText, onRetry, fetching, canSeeMoney, year }: {
  scope: VendorScope;
  vendors: VendorRow[];
  isPending: boolean;
  isError: boolean;
  errorText: string;
  onRetry: () => void;
  fetching: boolean;
  canSeeMoney: boolean;
  year: number;
}) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { update, setStatus } = useVendorActions();
  const list = useListState<Grouping, Ordering>(`vendors:${scope}`, { ...DEFAULTS, grouping: scope === 'attention' ? 'compliance' : 'none', ordering: scope === 'attention' ? 'insurance' : 'name' });
  const { options, setOptions, filters, setFilters } = list;
  const layout = options.layout === 'board' ? 'list' : options.layout;
  const search = typeof filters.search === 'string' ? filters.search.toLowerCase() : '';
  const props = useMemo(() => new Set(options.properties), [options.properties]);

  const rows = useMemo(() => {
    const arr = (k: string) => (Array.isArray(filters[k]) ? (filters[k] as string[]) : []);
    const trades = arr('trades');
    const compliance = arr('compliance');
    return vendors.filter(v => {
      if (!inScope(v, scope)) return false;
      if (trades.length && !trades.includes(v.trade)) return false;
      if (compliance.length && !compliance.some(c => COMPLIANCE_FILTERS[c]?.(v))) return false;
      if (filters.is1099 === 'yes' && !v.is1099) return false;
      if (filters.is1099 === 'no' && v.is1099) return false;
      if (filters.portal === 'on' && !v.portalEnabled) return false;
      if (filters.portal === 'off' && v.portalEnabled) return false;
      if (search && ![v.name, v.contactName, v.email, v.phone, v.trade, v.notes].some(s => s.toLowerCase().includes(search))) return false;
      return true;
    });
  }, [vendors, scope, filters, search]);

  const sorted = useMemo(() => {
    const byName = (a: VendorRow, b: VendorRow) => a.name.localeCompare(b.name);
    const cmp: Record<Ordering, (a: VendorRow, b: VendorRow) => number> = {
      name: byName,
      open: (a, b) => b.openWorkOrders - a.openWorkOrders || byName(a, b),
      spend: (a, b) => (b.paidThisYear ?? 0) - (a.paidThisYear ?? 0) || byName(a, b),
      insurance: (a, b) => INSURANCE_ORDER.indexOf(a.compliance.insurance) - INSURANCE_ORDER.indexOf(b.compliance.insurance) || (a.insuranceExpiresOn ?? '9').localeCompare(b.insuranceExpiresOn ?? '9') || byName(a, b),
      rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byName(a, b),
      recent: (a, b) => (b.lastWorkAt ?? '').localeCompare(a.lastWorkAt ?? '') || byName(a, b),
    };
    return [...rows].sort(cmp[options.ordering] ?? byName);
  }, [rows, options.ordering]);

  const groups: ListGroup<VendorRow>[] = useMemo(() => {
    if (options.grouping === 'trade') {
      return VENDOR_TRADES.map(t => ({ key: t, label: t, items: sorted.filter(v => v.trade === t) })).filter(g => g.items.length || options.showEmptyGroups);
    }
    if (options.grouping === 'compliance') {
      return INSURANCE_ORDER.map(s => ({ key: s, label: s === 'Not required' ? 'Insurance not required' : `Insurance ${INSURANCE_LABEL[s as VendorRow['compliance']['insurance']].toLowerCase()}`, items: sorted.filter(v => v.compliance.insurance === s) })).filter(g => g.items.length || options.showEmptyGroups);
    }
    return [{ key: 'all', label: 'Vendors', items: sorted }];
  }, [sorted, options.grouping, options.showEmptyGroups]);

  const [collapsed, toggleCollapsed] = useCollapsedGroups(`vendors:${scope}`);
  const visible = useMemo(() => (layout === 'table' ? sorted : groups.flatMap(g => (collapsed.has(g.key) && options.grouping !== 'none' ? [] : g.items))), [layout, sorted, groups, collapsed, options.grouping]);

  const open = useCallback((v: VendorRow) => navigate(`/vendors/${v.id}`), [navigate]);
  const nav = useListNav({ items: visible, getId: v => v.id, onOpen: open });
  const { selection, focusedId, focused, onRowClick, onHover, toggleSelect, setSelection, clearSelection, scrollRef, selecting } = nav;
  useEffect(() => clearSelection(), [scope]);

  useHotkeys({ e: () => focused && app.openCreate('vendor', { vendorId: focused.id }) });

  const filterDefs = useMemo<FilterDef[]>(() => [
    listFilter('trades', 'Trade', <Hammer />, () => VENDOR_TRADES.map(t => ({ value: t, label: t }))),
    listFilter('compliance', 'Compliance', <ShieldAlert />, () => [
      { value: 'expired', label: 'Insurance expired' },
      { value: 'expiring', label: 'Insurance expires within 30 days' },
      { value: 'missing', label: 'No insurance on file' },
      { value: 'w9', label: '1099 vendor without a W-9' },
      { value: 'review', label: 'Paperwork waiting for review' },
      { value: 'ok', label: 'In good standing' },
    ]),
    singleFilter('is1099', '1099', <FileText />, () => [{ value: 'yes', label: 'Gets a 1099' }, { value: 'no', label: 'No 1099' }]),
    singleFilter('portal', 'Portal access', <UserRoundCheck />, () => [{ value: 'on', label: 'Has portal access' }, { value: 'off', label: 'No portal access' }]),
  ], []);
  const hasFilters = countFilters(filters) > 0 || Boolean(search);

  const exportCsv = () =>
    downloadCsv(
      'vendors',
      ['Vendor', 'Trade', 'Status', 'Contact', 'Email', 'Phone', 'Address', 'Insurance', 'Insurance expires', 'W-9 on file', '1099 vendor', 'Tax ID (last 4)', 'License', 'Payment terms (days)', 'Default expense account', 'Rating', 'Open work orders', ...(canSeeMoney ? [`Paid in ${year}`, 'Open bills'] : []), 'Portal access'],
      sorted.map(v => [v.name, v.trade, v.status, v.contactName, v.email, v.phone, v.address, INSURANCE_LABEL[v.compliance.insurance], v.insuranceExpiresOn ?? '', v.w9OnFile ? 'Yes' : 'No', v.is1099 ? 'Yes' : 'No', v.taxIdLast4, v.licenseNumber, v.paymentTermsDays ?? '', v.defaultAccountId ? ws.accountById.get(v.defaultAccountId)?.name ?? '' : '', v.rating ?? '', v.openWorkOrders, ...(canSeeMoney ? [v.paidThisYear ?? 0, v.openBills ?? 0] : []), v.portalEnabled ? 'Yes' : 'No']),
    );

  const export1099 = () => {
    // Everyone flagged for a 1099, plus anyone paid this year who isn't flagged, so nobody is missed.
    const people = vendors.filter(v => v.is1099 || (v.paidThisYear ?? 0) > 0).sort((a, b) => Number(b.is1099) - Number(a.is1099) || (b.paidThisYear ?? 0) - (a.paidThisYear ?? 0));
    downloadCsv(
      `1099-prep-${year}`,
      ['Vendor', 'Contact', 'Email', 'Address', 'Tax ID (last 4)', '1099 vendor', 'W-9 on file', `Paid ${year} (payments and expenses)`, 'Needs attention'],
      people.map(v => [v.name, v.contactName, v.email, v.address, v.taxIdLast4, v.is1099 ? 'Yes' : 'No', v.w9OnFile ? 'Yes' : 'No', (v.paidThisYear ?? 0).toFixed(2), [v.is1099 && !v.w9OnFile ? 'W-9 missing' : '', v.is1099 && !v.taxIdLast4 ? 'No tax ID' : '', v.is1099 && !v.address ? 'No address' : ''].filter(Boolean).join('; ')]),
    );
    toast.success(`1099 prep sheet for ${year} downloaded`, { description: `${people.length} ${people.length === 1 ? 'vendor' : 'vendors'}, ${people.filter(p => p.is1099).length} marked for a 1099. Tax classification isn’t stored here — confirm it on each W-9.` });
  };

  const menu = (v: VendorRow) => (
    <div onClick={e => e.stopPropagation()}>
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => open(v)}><SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('vendor', { vendorId: v.id })}><Pencil className="h-3.5 w-3.5" /> Edit <ContextMenuShortcut>E</ContextMenuShortcut></ContextMenuItem>
      {ws.can('maintenance.create') && v.status !== 'Inactive' && (
        <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('workOrder', { vendorId: v.id })}><Wrench className="h-3.5 w-3.5" /> New work order</ContextMenuItem>
      )}
      <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => navigate(`/vendors/${v.id}?tab=messages`)}><MessageSquare className="h-3.5 w-3.5" /> Message</ContextMenuItem>
      {v.is1099 && !v.w9OnFile && (
        <ContextMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void update(v.id, { w9OnFile: true }, { toast: `W-9 marked on file for ${v.name}` }).catch(() => undefined)}><FileText className="h-3.5 w-3.5" /> Mark W-9 on file</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        className="h-9 gap-2 text-[14px]"
        onSelect={async () => {
          if (v.status === 'Inactive') {
            await setStatus(v.id, 'Active').then(() => toast.success(`${v.name} reactivated`)).catch(() => undefined);
            return;
          }
          const ok = await app.confirm({
            title: `Deactivate ${v.name}?`,
            description: v.openWorkOrders > 0 ? `They have ${v.openWorkOrders} open work ${v.openWorkOrders === 1 ? 'order' : 'orders'}, which stay assigned to them. They drop out of vendor pickers and lose portal access. You can reactivate them any time.` : 'They drop out of vendor pickers and lose portal access. Their history and bills stay. You can reactivate them any time.',
            confirmLabel: 'Deactivate',
            destructive: true,
          });
          if (ok) await setStatus(v.id, 'Inactive').then(() => toast.success(`${v.name} deactivated`, { action: { label: 'Undo', onClick: () => void setStatus(v.id, 'Active').catch(() => undefined) } })).catch(() => undefined);
        }}
      >
        <Power className="h-3.5 w-3.5" /> {v.status === 'Inactive' ? 'Reactivate' : 'Deactivate…'}
      </ContextMenuItem>
    </div>
  );

  const renderRow = (v: VendorRow) => (
    <RowShell
      id={v.id}
      selected={selection.has(v.id)}
      focused={focusedId === v.id}
      selecting={selecting}
      onClick={(e: MouseEvent) => onRowClick(v, e)}
      onHover={() => onHover(v)}
      onToggleSelect={(e: MouseEvent) => toggleSelect(v, e)}
      menu={menu(v)}
      muted={v.status === 'Inactive'}
    >
      <VendorGlyph name={v.name} color={v.color} />
      <span className="min-w-0 truncate font-medium">{v.name}</span>
      {props.has('contact') && v.contactName && <span className="hidden min-w-0 truncate text-muted-foreground lg:inline">{v.contactName}</span>}
      {v.unreadMessages > 0 && (
        <Tip label={`${v.unreadMessages} unread ${v.unreadMessages === 1 ? 'message' : 'messages'}`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        </Tip>
      )}
      <span className="min-w-4 flex-1" />
      {props.has('compliance') && <span className="flex shrink-0 items-center sm:hidden"><InsurancePill status={v.compliance.insurance} expiresOn={v.insuranceExpiresOn} compact /></span>}
      <span className="hidden min-w-0 items-center gap-3 sm:flex">
        {props.has('trade') && options.grouping !== 'trade' && <span className="chip hidden max-w-[120px] truncate md:inline-flex">{v.trade}</span>}
        {props.has('compliance') && <ComplianceChips vendor={v} compact />}
        {props.has('work') && (
          <Tip label={`${v.openWorkOrders} open · ${v.totalWorkOrders} total${v.lastWorkAt ? ` · last ${timeAgo(v.lastWorkAt)}` : ''}`}>
            <span className={`hidden w-14 items-center justify-end gap-1 text-sm tabular-nums md:inline-flex ${v.openWorkOrders ? 'text-foreground' : 'text-muted-foreground/70'}`}>
              <Wrench className="h-3 w-3 text-muted-foreground" /> {v.openWorkOrders}
            </span>
          </Tip>
        )}
        {props.has('spend') && canSeeMoney && (
          <Tip label={`Paid in ${year}`}>
            <span className="hidden w-24 justify-end text-sm lg:inline-flex"><Money value={v.paidThisYear} muted0 cents={false} /></span>
          </Tip>
        )}
        {props.has('rating') && <Rating value={v.rating} className="hidden w-9 justify-end xl:inline-flex" />}
      </span>
    </RowShell>
  );

  const columns: Column<VendorRow>[] = useMemo(() => [
    { key: 'name', header: 'Vendor', cell: v => <span className="flex min-w-0 items-center gap-2"><VendorGlyph name={v.name} color={v.color} size={18} /><span className="truncate font-medium">{v.name}</span>{v.status === 'Inactive' && <Pill>Inactive</Pill>}</span>, sort: v => v.name, className: 'max-w-[300px]' },
    { key: 'trade', header: 'Trade', cell: v => v.trade, sort: v => v.trade, hideBelow: 'md' },
    { key: 'contact', header: 'Contact', cell: v => <span className="block max-w-[220px] truncate">{v.contactName || v.email || <span className="text-muted-foreground">—</span>}{v.phone && <span className="ml-1.5 text-muted-foreground">{v.phone}</span>}</span>, sort: v => v.contactName, hideBelow: 'lg' },
    { key: 'insurance', header: 'Insurance', cell: v => <InsurancePill status={v.compliance.insurance} expiresOn={v.insuranceExpiresOn} />, sort: v => `${INSURANCE_ORDER.indexOf(v.compliance.insurance)}${v.insuranceExpiresOn ?? ''}` },
    { key: 'w9', header: 'W-9', cell: v => (v.w9OnFile ? 'On file' : v.is1099 ? <span className="text-tone-warning">Missing</span> : <span className="text-muted-foreground">—</span>), sort: v => Number(v.w9OnFile), hideBelow: 'md' },
    { key: '1099', header: '1099', cell: v => (v.is1099 ? 'Yes' : <span className="text-muted-foreground">No</span>), sort: v => Number(v.is1099), hideBelow: 'lg' },
    { key: 'open', header: 'Open work', align: 'right', cell: v => (v.openWorkOrders ? v.openWorkOrders : <span className="text-muted-foreground/70">—</span>), sort: v => v.openWorkOrders },
    ...(canSeeMoney
      ? [
          { key: 'spend', header: `Paid ${year}`, align: 'right' as const, cell: (v: VendorRow) => <Money value={v.paidThisYear} muted0 />, sort: (v: VendorRow) => v.paidThisYear ?? 0, hideBelow: 'sm' as const, footer: <Money value={sorted.reduce((s, v) => s + (v.paidThisYear ?? 0), 0)} /> },
          { key: 'bills', header: 'Open bills', align: 'right' as const, cell: (v: VendorRow) => <Money value={v.openBills} muted0 />, sort: (v: VendorRow) => v.openBills ?? 0, hideBelow: 'lg' as const, footer: <Money value={sorted.reduce((s, v) => s + (v.openBills ?? 0), 0)} /> },
        ]
      : []),
    { key: 'rating', header: 'Rating', align: 'right', cell: v => <Rating value={v.rating} className="justify-end" />, sort: v => v.rating ?? -1, hideBelow: 'xl' },
  ], [canSeeMoney, year, sorted]);

  const content: ReactNode = (() => {
    if (isPending) return <SkeletonRows rows={10} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Vendors didn’t load" description={errorText} action={<button type="button" className="ghost-chip h-9" onClick={onRetry}>Try again</button>} />;
    if (!rows.length) {
      if (hasFilters) return <EmptyState className="py-20" icon={<Hammer />} title="No vendors match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />;
      const copy: Record<VendorScope, [string, string]> = {
        active: ['No vendors yet', 'Add the plumbers, electricians and cleaners you call, and assign them work orders.'],
        attention: ['Everyone’s paperwork is in order', 'Vendors with expired or expiring insurance, or a missing W-9, show up here.'],
        '1099': ['No 1099 vendors', 'Turn on “Issue a 1099” for contractors whose payments you report at year-end.'],
        inactive: ['No inactive vendors', 'Vendors you deactivate move here, with their history intact.'],
      };
      return (
        <EmptyState
          className="py-20"
          icon={<Hammer />}
          title={copy[scope][0]}
          description={copy[scope][1]}
          action={scope === 'active' ? <button type="button" onClick={() => app.openCreate('vendor')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New vendor</button> : undefined}
        />
      );
    }
    if (layout === 'table') {
      return (
        <DataTable
          rows={sorted}
          columns={columns}
          getId={v => v.id}
          onRowClick={onRowClick}
          selection={selection}
          onToggleSelect={(v, e) => toggleSelect(v, e)}
          onSelectAll={all => setSelection(all ? new Set(sorted.map(v => v.id)) : new Set())}
          focusedId={focusedId}
          onHover={onHover}
          rowClassName={v => (v.status === 'Inactive' ? 'text-muted-foreground' : undefined)}
          className="h-full pb-24"
          caption="Vendors"
        />
      );
    }
    return <GroupedList label="Vendors" groups={groups} single={options.grouping === 'none'} getId={v => v.id} collapsed={collapsed} onToggleCollapse={toggleCollapsed} renderRow={renderRow} />;
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={
          <>
            <FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} />
            <FilterChips defs={filterDefs} filters={filters} onChange={setFilters} />
          </>
        }
        count={isPending ? null : rows.length}
        countLabel={['vendor', 'vendors']}
        search={typeof filters.search === 'string' ? filters.search : ''}
        onSearch={q => setFilters(f => ({ ...f, search: q || undefined }))}
        searchPlaceholder="Search name, contact, email…"
        layout={layout}
        layouts={['list', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={fetching}
        display={<DisplayMenu options={{ ...options, layout }} onChange={setOptions} groupings={GROUPINGS} orderings={ORDERINGS} properties={PROPERTIES.filter(p => p.key !== 'spend' || canSeeMoney)} onReset={list.reset} isDirty={list.isDirty} />}
        more={
          <>
            <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>
            {canSeeMoney && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={export1099}><FileText className="h-3.5 w-3.5" /> Export 1099 prep ({year})</DropdownMenuItem>}
          </>
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      <BulkBar count={selection.size} noun={['vendor', 'vendors']} onClear={clearSelection}>
        <button
          type="button"
          className={bulkButton}
          onClick={() => {
            const chosen = sorted.filter(v => selection.has(v.id));
            downloadCsv('vendors-selected', ['Vendor', 'Trade', 'Contact', 'Email', 'Phone', 'Insurance expires', 'W-9 on file'], chosen.map(v => [v.name, v.trade, v.contactName, v.email, v.phone, v.insuranceExpiresOn ?? '', v.w9OnFile ? 'Yes' : 'No']));
          }}
        >
          <FileSpreadsheet /> Export
        </button>
        {sorted.some(v => selection.has(v.id) && v.is1099 && !v.w9OnFile) && (
          <button
            type="button"
            className={bulkButton}
            onClick={async () => {
              const chosen = sorted.filter(v => selection.has(v.id) && v.is1099 && !v.w9OnFile);
              for (const v of chosen) await update(v.id, { w9OnFile: true }).catch(() => undefined);
              toast.success(`W-9 marked on file for ${chosen.length} ${chosen.length === 1 ? 'vendor' : 'vendors'}`);
              clearSelection();
            }}
          >
            <FileText /> Mark W-9 on file
          </button>
        )}
      </BulkBar>
    </div>
  );
}
