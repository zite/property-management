import { Download, FileText, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenuItem } from '@project/components/ui/dropdown-menu';
import type { LeasePhase } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { fullDate, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { ListToolbar } from '../list/Toolbar';
import { useListNav } from '../list/useListNav';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { LeasePhasePill } from '../primitives/glyphs';
import { hasCents, usePropertyLeases, type PropertyLease } from './data';

/**
 * Leases at a property — current and upcoming by default, past on request —
 * with residents, phase, rent, term and balance. Rows open the lease.
 */

type Scope = 'live' | 'past' | 'all';
const LIVE: LeasePhase[] = ['Draft', 'Pending signature', 'Upcoming', 'Current', 'Expiring', 'Notice', 'Month-to-month'];

export function PropertyLeases({ propertyId, unitId, embedded }: { propertyId: string; unitId?: string; embedded?: boolean }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch, isFetching } = usePropertyLeases(propertyId);
  const [scope, setScope] = useState<Scope>('live');
  const [search, setSearch] = useState('');
  const money = ws.can('accounting.view');
  const canOpen = ws.can('residents.manage');

  const all = data?.leases ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter(l => (unitId ? l.unitId === unitId : true))
      .filter(l => (scope === 'all' ? true : scope === 'live' ? LIVE.includes(l.phase) : !LIVE.includes(l.phase)))
      .filter(l => !q || [l.name, leaseRef(l.number), ws.unitById.get(l.unitId)?.name ?? '', ...l.residents.map(r => r.name)].some(v => v.toLowerCase().includes(q)));
  }, [all, scope, search, unitId, ws.unitById]);
  const counts = useMemo(() => ({ live: all.filter(l => LIVE.includes(l.phase)).length, past: all.filter(l => !LIVE.includes(l.phase)).length }), [all]);

  const open = useCallback((l: PropertyLease) => canOpen && navigate(`/leases/${l.id}`), [navigate, canOpen]);
  const nav = useListNav({ items: rows, getId: l => l.id, onOpen: open });

  const columns: Column<PropertyLease>[] = [
    { key: 'lease', header: 'Lease', sort: l => l.number ?? 0, width: 86, cell: l => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{leaseRef(l.number)}</span> },
    { key: 'unit', header: 'Unit', sort: l => ws.unitById.get(l.unitId)?.name ?? '', cell: l => <span className="whitespace-nowrap font-medium">{ws.unitById.get(l.unitId)?.name ?? '—'}</span> },
    {
      key: 'residents', header: 'Residents', sort: l => l.residents[0]?.name ?? '', className: 'max-w-[260px]',
      cell: l => {
        const main = l.residents.filter(r => r.role === 'Primary' || r.role === 'Co-tenant');
        return main.length ? <span className="block truncate">{main.map(r => r.name).join(', ')}</span> : <span className="text-muted-foreground">No residents</span>;
      },
    },
    { key: 'phase', header: 'Status', sort: l => LIVE.indexOf(l.phase), cell: l => <LeasePhasePill phase={l.phase} /> },
    ...(money ? [{ key: 'rent', header: 'Rent', align: 'right' as const, sort: (l: PropertyLease) => l.rent ?? 0, hideBelow: 'sm' as const, cell: (l: PropertyLease) => <Money value={l.rent} cents={hasCents(l.rent)} /> }] : []),
    { key: 'start', header: 'Start', sort: l => l.startDate ?? '', hideBelow: 'md', cell: l => <Tip label={fullDate(l.startDate)}><span className="whitespace-nowrap text-muted-foreground">{shortDate(l.startDate) || '—'}</span></Tip> },
    { key: 'end', header: 'End', sort: l => l.moveOutDate ?? l.endDate ?? '9999', hideBelow: 'md', cell: l => (l.moveOutDate && l.phase === 'Notice' ? <span className="whitespace-nowrap text-tone-warning">Out {shortDate(l.moveOutDate)}</span> : <span className="whitespace-nowrap text-muted-foreground">{l.endDate ? shortDate(l.endDate) : l.leaseType === 'Month-to-month' ? 'Month-to-month' : '—'}</span>) },
    ...(money ? [{ key: 'balance', header: 'Balance', align: 'right' as const, sort: (l: PropertyLease) => l.balance ?? 0, cell: (l: PropertyLease) => <Tip label={l.pastDue ? `${ws.money(l.pastDue)} past due` : 'Balance'}><span><Money value={l.balance} tone="balance" muted0 /></span></Tip> }] : []),
  ];

  const exportCsv = () =>
    downloadCsv(
      `${ws.propertyName(propertyId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-leases`,
      ['Lease', 'Name', 'Unit', 'Residents', 'Status', ...(money ? ['Rent', 'Deposit'] : []), 'Start', 'End', 'Move-out', ...(money ? ['Balance', 'Past due'] : [])],
      rows.map(l => [leaseRef(l.number), l.name, ws.unitById.get(l.unitId)?.name ?? '', l.residents.map(r => `${r.name} (${r.role})`).join('; '), l.phase, ...(money ? [l.rent ?? '', l.deposit ?? ''] : []), l.startDate ?? '', l.endDate ?? '', l.moveOutDate ?? '', ...(money ? [l.balance ?? '', l.pastDue ?? ''] : [])]),
    );

  return (
    <div className={embedded ? '' : 'relative flex min-h-0 flex-1 flex-col'}>
      <ListToolbar
        className={embedded ? 'rounded-t-lg border' : undefined}
        start={<Segmented value={scope} onChange={v => setScope(v as Scope)} size="sm" options={[{ value: 'live', label: `Current & upcoming${counts.live ? ` · ${counts.live}` : ''}` }, { value: 'past', label: `Past${counts.past ? ` · ${counts.past}` : ''}` }, { value: 'all', label: 'All' }]} />}
        count={isPending ? null : rows.length}
        countLabel={['lease', 'leases']}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search resident, unit or lease…"
        fetching={isFetching && !isPending}
        display={
          ws.can('residents.manage') && (
            <button type="button" onClick={() => app.openCreate('lease', unitId ? { unitId, propertyId } : { propertyId })} className="ghost-chip h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New lease
            </button>
          )
        }
        more={<DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</DropdownMenuItem>}
      />
      <div ref={nav.scrollRef} className={embedded ? 'overflow-x-auto rounded-b-lg border border-t-0' : 'min-h-0 flex-1 overflow-auto'}>
        {isPending ? (
          <SkeletonRows rows={6} className="px-3 pt-2" />
        ) : isError ? (
          <EmptyState className="py-16" title="Leases didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          <EmptyState
            className="py-16"
            icon={<FileText />}
            title={search ? 'No leases match' : scope === 'past' ? 'No past leases' : all.length ? 'No current or upcoming leases' : 'No leases yet'}
            description={search ? 'Try a different name or unit.' : scope === 'live' && counts.past ? 'Every lease here has ended. Switch to Past to see them.' : 'Leases you create for units here show up in this list.'}
            action={search ? <button type="button" className="ghost-chip h-9" onClick={() => setSearch('')}>Clear search</button> : scope !== 'all' && all.length ? <button type="button" className="ghost-chip h-9" onClick={() => setScope('all')}>Show all leases</button> : undefined}
          />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            getId={l => l.id}
            onRowClick={canOpen ? nav.onRowClick : undefined}
            focusedId={nav.focusedId}
            onHover={nav.onHover}
            rowClassName={l => (l.phase === 'Ended' || l.phase === 'Canceled' ? 'text-muted-foreground' : undefined)}
            className={embedded ? '' : 'pb-16'}
            stickyHeader={!embedded}
            caption="Leases"
          />
        )}
      </div>
    </div>
  );
}
