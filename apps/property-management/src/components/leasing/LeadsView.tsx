import { Building2, CalendarClock, CalendarRange, CircleDashed, Download, FileText, Inbox, Plus, Radio, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import { INQUIRY_SOURCES, INQUIRY_STATUSES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { shortDateTime } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { countFilters, useCollapsedGroups, useListState, type Filters, type ListOptions } from '../../lib/listState';
import { useWorkspace } from '../../lib/workspace';
import { Board, type BoardColumn } from '../list/Board';
import { BulkBar, bulkButton } from '../list/BulkBar';
import { DataTable, type Column } from '../list/DataTable';
import { FilterChips, FilterMenu, listFilter, singleFilter, type FilterDef } from '../list/Filters';
import { GroupedList, type ListGroup } from '../list/GroupedList';
import { DisplayMenu, ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { PropertySwatch } from '../primitives/glyphs';
import { InquiryStatusGlyph } from './bits';
import { compareInquiries, groupInquiries, INQUIRY_GROUPINGS, INQUIRY_ORDERINGS, INQUIRY_PROPERTIES, useInquiries, useInquiryActions, type Inquiry, type InquiryFilters, type InquiryGrouping, type InquiryOrdering } from './data';
import { ContactedLabel, LeadCard, LeadMenu, LeadPicker, LeadRow, LostDialog, ShowingChip, ShowingDialog, type LeadDialog, type LeadPickerKind } from './LeadParts';
import { LeadSheet } from './LeadSheet';

type Options = ListOptions<InquiryGrouping, InquiryOrdering>;

const DEFAULT_OPTIONS: Options = {
  layout: 'list',
  grouping: 'status',
  ordering: 'newest',
  properties: ['source', 'message', 'interest', 'showing', 'lastContact', 'received', 'assignee'],
  showEmptyGroups: false,
  showClosed: false,
};

const SEARCH_KEY = 'search';

function toQuery(base: InquiryFilters, f: Filters, showClosed: boolean): InquiryFilters {
  const arr = (k: string) => (Array.isArray(f[k]) && (f[k] as string[]).length ? (f[k] as string[]) : undefined);
  const q: InquiryFilters = {
    ...base,
    statuses: (arr('statuses') as InquiryFilters['statuses']) ?? base.statuses,
    sources: (arr('sources') as InquiryFilters['sources']) ?? base.sources,
    propertyIds: arr('propertyIds') ?? base.propertyIds,
    listingIds: arr('listingIds') ?? base.listingIds,
    assigneeIds: arr('assigneeIds') ?? base.assigneeIds,
    received: (typeof f.received === 'string' ? (f.received as InquiryFilters['received']) : undefined) ?? base.received,
    showing: (typeof f.showing === 'string' ? (f.showing as InquiryFilters['showing']) : undefined) ?? base.showing,
    search: typeof f[SEARCH_KEY] === 'string' ? (f[SEARCH_KEY] as string) : undefined,
    showClosed: showClosed || undefined,
  };
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as InquiryFilters;
}

/**
 * Leads: everyone who asked about a home. Click a lead to open it in a sheet
 * (the URL keeps `?lead=` so it can be shared); the board moves leads through
 * the pipeline, and dropping on Showing scheduled books the showing.
 */
export function LeadsView({ surfaceKey, baseFilters = {}, lockedFilters = [] }: { surfaceKey: string; baseFilters?: InquiryFilters; lockedFilters?: string[] }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { update } = useInquiryActions();
  const [params, setParams] = useSearchParams();
  const openId = params.get('lead');
  const list = useListState<InquiryGrouping, InquiryOrdering>(surfaceKey, DEFAULT_OPTIONS, {});
  const { options, setOptions, filters, setFilters } = list;
  const layout = options.layout;
  const query = useMemo(() => toQuery(baseFilters, filters, options.showClosed), [baseFilters, filters, options.showClosed]);
  const { data, isPending, isFetching, isError, error, refetch } = useInquiries(query);
  const rows = data?.inquiries ?? [];
  const grouping: InquiryGrouping = layout === 'board' ? 'status' : options.grouping;
  const groups = useMemo(() => groupInquiries(rows, grouping, options.ordering, ws, { showEmpty: options.showEmptyGroups, showClosed: options.showClosed || Boolean(query.statuses?.length), board: layout === 'board' }), [rows, grouping, options.ordering, options.showEmptyGroups, options.showClosed, query.statuses, ws, layout]);
  const [collapsed, toggleCollapsed] = useCollapsedGroups(surfaceKey);
  const visible = useMemo(() => (layout === 'table' ? [...rows].sort(compareInquiries(options.ordering)) : groups.flatMap(g => (layout === 'list' && collapsed.has(g.key) ? [] : g.items))), [groups, collapsed, layout, rows, options.ordering]);

  const [rowPicker, setRowPicker] = useState<{ id: string; kind: LeadPickerKind } | null>(null);
  const [bulkPicker, setBulkPicker] = useState<LeadPickerKind | null>(null);
  const [floatingPicker, setFloatingPicker] = useState<{ kind: LeadPickerKind; targets: Inquiry[] } | null>(null);
  const [dialog, setDialog] = useState<LeadDialog>(null);
  const overlayOpen = Boolean(rowPicker || bulkPicker || floatingPicker || dialog || openId);

  const openLead = useCallback((q: Inquiry) => setParams(p => { const n = new URLSearchParams(p); n.set('lead', q.id); return n; }), [setParams]);
  const closeLead = useCallback(() => setParams(p => { const n = new URLSearchParams(p); n.delete('lead'); return n; }, { replace: true }), [setParams]);
  const nav = useListNav({ items: visible, getId: q => q.id, onOpen: openLead, enabled: !overlayOpen });
  const { selection, selected, focusedId, focused, selecting, targets, targetsFor, onRowClick, onHover, toggleSelect, clearSelection, setSelection, scrollRef } = nav;

  useEffect(() => clearSelection(), [surfaceKey]);

  const openPicker = (kind: LeadPickerKind) => {
    if (selection.size > 0) return setBulkPicker(kind);
    if (!focused) return;
    if (layout === 'list') setRowPicker({ id: focused.id, kind });
    else setFloatingPicker({ kind, targets: [focused] });
  };
  useHotkeys(
    {
      s: () => openPicker('status'),
      a: () => openPicker('assignee'),
      i: () => {
        const t = targets().filter(q => q.assigneeId !== ws.me.id);
        if (t.length) void update(t, { assigneeId: ws.me.id }, { toast: t.length === 1 ? `${t[0].name} assigned to you` : undefined }).catch(() => undefined);
      },
      'shift+s': () => focused && setDialog({ kind: 'showing', lead: focused }),
    },
    { enabled: !overlayOpen },
  );

  const onPicker = useCallback((id: string, kind: LeadPickerKind | null) => setRowPicker(kind ? { id, kind } : null), []);
  const properties = useMemo(() => new Set(options.properties.filter(p => !(p === 'assignee' && grouping === 'assignee' && layout === 'list'))), [options.properties, grouping, layout]);

  const listingOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of rows) if (q.listingId && q.listingTitle) seen.set(q.listingId, q.listingTitle);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filterDefs = useMemo<FilterDef[]>(() => [
    listFilter('statuses', 'Status', <CircleDashed />, () => INQUIRY_STATUSES.map(s => ({ value: s, label: s, icon: <InquiryStatusGlyph status={s} /> }))),
    listFilter('sources', 'Source', <Radio />, () => INQUIRY_SOURCES.map(s => ({ value: s, label: s }))),
    listFilter('listingIds', 'Listing', <FileText />, () => listingOptions),
    listFilter('propertyIds', 'Property', <Building2 />, () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code] }))),
    listFilter('assigneeIds', 'Assignee', <UserRound />, () => [
      { value: '__me__', label: 'Me', icon: <MemberAvatar member={ws.memberById.get(ws.me.id)} size={16} /> },
      { value: '__none__', label: 'Unassigned', icon: <UnassignedAvatar size={16} /> },
      ...ws.activeMembers.filter(m => m.id !== ws.me.id && ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)).map(m => ({ value: m.id, label: m.name, icon: <MemberAvatar member={m} size={16} /> })),
    ]),
    singleFilter('received', 'Received', <CalendarRange />, () => [{ value: 'today', label: 'Today' }, { value: 'week', label: 'In the last 7 days' }, { value: 'month', label: 'In the last 30 days' }]),
    singleFilter('showing', 'Showing', <CalendarClock />, () => [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Already happened' }]),
  ].filter(d => !lockedFilters.includes(d.key)), [ws, listingOptions, lockedFilters]);

  const exportCsv = () => {
    downloadCsv(
      'leads',
      ['Name', 'Email', 'Phone', 'Status', 'Source', 'Listing', 'Property', 'Unit', 'Desired move-in', 'Showing', 'Received', 'Last contacted', 'Assignee', 'Message', 'Notes'],
      [...rows].sort(compareInquiries(options.ordering)).map(q => [q.name, q.email, q.phone, q.status, q.source, q.listingTitle ?? '', ws.propertyName(q.propertyId), q.unitId ? ws.unitById.get(q.unitId)?.name ?? '' : '', q.desiredMoveIn ?? '', q.showingAt ? shortDateTime(q.showingAt) : '', q.receivedAt.slice(0, 10), q.lastContactedAt?.slice(0, 10) ?? '', ws.memberName(q.assigneeId), q.message, q.notes]),
    );
  };

  const listGroups: ListGroup<Inquiry>[] = useMemo(() => groups.map(g => ({ key: g.key, label: g.label, items: g.items, icon: g.kind === 'status' ? <InquiryStatusGlyph status={g.key} /> : g.kind === 'assignee' ? (g.key === '__none__' ? <UnassignedAvatar size={16} /> : <MemberAvatar member={ws.memberById.get(g.key)} size={16} />) : undefined })), [groups, ws]);
  const columns: BoardColumn<Inquiry>[] = useMemo(() => listGroups.map(g => ({ ...g, droppable: g.key !== 'Closed', emptyText: g.key === 'Showing scheduled' ? 'Drop here to book a showing' : 'Drop leads here' })), [listGroups]);

  const tableColumns: Column<Inquiry>[] = useMemo(() => [
    { key: 'name', header: 'Name', cell: q => <span className="flex min-w-0 items-center gap-2"><InquiryStatusGlyph status={q.status} /><span className="truncate font-medium">{q.name}</span></span>, sort: q => q.name, className: 'max-w-[240px]' },
    { key: 'status', header: 'Status', cell: q => q.status, sort: q => INQUIRY_STATUSES.indexOf(q.status as never), hideBelow: 'md' },
    { key: 'source', header: 'Source', cell: q => q.source, sort: q => q.source, hideBelow: 'lg' },
    { key: 'contact', header: 'Contact', cell: q => <span className="block max-w-[220px] truncate text-muted-foreground">{q.email || q.phone}</span>, sort: q => q.email, hideBelow: 'xl' },
    { key: 'interest', header: 'Interested in', cell: q => (q.propertyId ? <span className="inline-flex max-w-[220px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(q.propertyId)?.color} /><span className="truncate">{ws.unitLabel(q.unitId, q.propertyId)}</span></span> : <span className="text-muted-foreground">—</span>), sort: q => ws.unitLabel(q.unitId, q.propertyId), hideBelow: 'md' },
    { key: 'showing', header: 'Showing', cell: q => <ShowingChip at={q.showingAt} className="px-0" />, sort: q => q.showingAt, hideBelow: 'lg' },
    { key: 'lastContact', header: 'Last contact', cell: q => <ContactedLabel lead={q} />, sort: q => q.lastContactedAt, hideBelow: 'lg' },
    { key: 'received', header: 'Received', cell: q => shortDateTime(q.receivedAt), sort: q => q.receivedAt },
    { key: 'assignee', header: 'Assignee', cell: q => (q.assigneeId ? <span className="inline-flex items-center gap-1.5"><MemberAvatar member={ws.memberById.get(q.assigneeId)} size={16} />{ws.memberName(q.assigneeId)}</span> : <span className="text-muted-foreground">—</span>), sort: q => ws.memberName(q.assigneeId), hideBelow: 'lg' },
  ], [ws]);

  const hasAnyFilter = countFilters(filters) > 0 || Boolean(filters[SEARCH_KEY]);
  const content = (() => {
    if (isPending) return <SkeletonRows rows={8} className="px-3 pt-2" />;
    if (isError) return <EmptyState className="py-20" title="Leads didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
    if (!rows.length && layout !== 'board') {
      return hasAnyFilter ? (
        <EmptyState className="py-20" icon={<Inbox />} title="No leads match" description="Try removing a filter or searching for something else." action={<button type="button" className="ghost-chip h-9" onClick={() => setFilters({})}>Clear filters</button>} />
      ) : (
        <EmptyState className="py-20" icon={<Inbox />} title={options.showClosed ? 'No leads yet' : 'No open leads'} description="Questions and showing requests from your published listings arrive here. Log a call or walk-in with New lead." action={<button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('inquiry')}><Plus className="h-3.5 w-3.5" /> New lead</button>} />
      );
    }
    if (layout === 'board') {
      return (
        <Board
          columns={columns}
          getId={q => q.id}
          selection={selection}
          focusedId={focusedId}
          onCardClick={onRowClick}
          menuFor={q => <LeadMenu targets={targetsFor(q)} onDialog={setDialog} onOpen={openLead} />}
          renderCard={(q, s) => <LeadCard lead={q} {...s} />}
          onMove={(q, _from, to) => {
            if (to === 'Showing scheduled') return setDialog({ kind: 'showing', lead: q });
            const moving = selection.has(q.id) && selection.size > 1 ? selected : [q];
            void update(moving, { status: to as Inquiry['status'] as never }, { toast: moving.length === 1 ? `${q.name} → ${to}` : undefined }).catch(() => undefined);
          }}
        />
      );
    }
    if (layout === 'table') {
      return <DataTable rows={visible} columns={tableColumns.filter(c => ['name', 'status', 'contact'].includes(c.key) || options.properties.includes(c.key))} getId={q => q.id} onRowClick={onRowClick} selection={selection} onToggleSelect={(q, e) => toggleSelect(q, e)} onSelectAll={all => setSelection(all ? new Set(visible.map(q => q.id)) : new Set())} focusedId={focusedId} onHover={onHover} className="h-full pb-24" caption="Leads" />;
    }
    return (
      <GroupedList
        label="Leads"
        groups={listGroups}
        single={grouping === 'none'}
        getId={q => q.id}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSelectGroup={g => setSelection(prev => new Set([...prev, ...g.items.map(q => q.id)]))}
        renderRow={q => <LeadRow lead={q} properties={properties} selected={selection.has(q.id)} focused={focusedId === q.id} selecting={selecting} picker={rowPicker?.id === q.id ? rowPicker.kind : null} onPicker={onPicker} onClick={onRowClick} onHover={onHover} onToggleSelect={toggleSelect} targetsFor={targetsFor} onDialog={setDialog} onOpen={openLead} />}
      />
    );
  })();

  const bulkTrigger = (kind: LeadPickerKind, icon: ReactNode, label: string) => (
    <LeadPicker kind={kind} targets={selected} open={bulkPicker === kind} onOpenChange={o => setBulkPicker(o ? kind : null)} align="center" onDialog={setDialog} trigger={<button type="button" className={bulkButton}>{icon} {label}</button>} />
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ListToolbar
        start={<><FilterMenu defs={filterDefs} filters={filters} onChange={setFilters} /><FilterChips defs={filterDefs} filters={filters} onChange={setFilters} /></>}
        count={isPending ? null : rows.length}
        countLabel={['lead', 'leads']}
        search={typeof filters[SEARCH_KEY] === 'string' ? (filters[SEARCH_KEY] as string) : ''}
        onSearch={s => setFilters(f => ({ ...f, [SEARCH_KEY]: s || undefined }))}
        searchPlaceholder="Search name, email, message…"
        layout={layout}
        layouts={['list', 'board', 'table']}
        onLayout={l => setOptions({ layout: l })}
        fetching={isFetching && !isPending}
        display={<DisplayMenu options={options} onChange={setOptions} groupings={INQUIRY_GROUPINGS} orderings={INQUIRY_ORDERINGS} properties={INQUIRY_PROPERTIES} closedLabel="Show applied & closed" onReset={list.reset} isDirty={list.isDirty} />}
        more={<DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>}
      />
      {floatingPicker && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-40">
          <LeadPicker kind={floatingPicker.kind} targets={floatingPicker.targets} open onOpenChange={o => !o && setFloatingPicker(null)} align="center" onDialog={setDialog} trigger={<span className="block h-0 w-0" />} />
        </div>
      )}
      <div ref={scrollRef} className={layout === 'board' ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'}>{content}</div>
      <BulkBar count={selected.length} noun={['lead', 'leads']} onClear={clearSelection}>
        {bulkTrigger('status', <CircleDashed />, 'Status')}
        {bulkTrigger('assignee', <UserRound />, 'Assign')}
      </BulkBar>
      {openId && <LeadSheet id={openId} onClose={closeLead} />}
      <ShowingDialog lead={dialog?.kind === 'showing' ? dialog.lead : null} open={dialog?.kind === 'showing'} onOpenChange={o => !o && setDialog(null)} />
      <LostDialog lead={dialog?.kind === 'lost' ? dialog.lead : null} open={dialog?.kind === 'lost'} onOpenChange={o => !o && setDialog(null)} />
    </div>
  );
}
