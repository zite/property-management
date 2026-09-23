import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Building2, CheckCircle2, Download, Percent, Send, UserRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DropdownMenuItem, DropdownMenuSeparator } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { periodLabel } from '@project/shared/dates';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { plural, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { ListToolbar } from '../list/Toolbar';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { useDocumentTitle } from '../shell/PageHeader';
import { useOwnerFunds, type OwnerFundsRow } from './accountingData';
import { DistributionRunDialog, ManagementFeesDialog, OwnerMoneyDialog, type OwnerMoneyTarget } from './OwnerMoneyDialogs';
import { AccountingHeader, HeaderButton, menuItem, Notice, RowMenu, SummaryStrip } from './parts';

const sumOf = (rows: OwnerFundsRow[], pick: (r: OwnerFundsRow) => number) => Math.round(rows.reduce((s, r) => s + Math.round(pick(r) * 100), 0)) / 100;

/**
 * Owner funds: per owner and property, cash on hand less what's held back
 * (deposits, reserve, unpaid bills) is what's available to distribute — the
 * same numbers the owner statement shows.
 */
export function OwnersView() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  useDocumentTitle('Owner funds');
  const { data, isPending, isError, error, refetch, isFetching } = useOwnerFunds();
  const [money, setMoney] = useState<OwnerMoneyTarget | null>(null);
  const [run, setRun] = useState(false);
  const [fees, setFees] = useState(false);
  const [search, setSearch] = useState('');
  const canBank = ws.can('banking.manage');

  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const rows = (data?.properties ?? []).filter(p => !q || `${p.name} ${ws.ownerById.get(p.ownerId ?? '')?.name ?? ''}`.toLowerCase().includes(q));
    const m = new Map<string, OwnerFundsRow[]>();
    for (const r of rows) m.set(r.ownerId ?? '', [...(m.get(r.ownerId ?? '') ?? []), r]);
    return [...m.entries()].map(([ownerId, items]) => ({ ownerId, owner: ws.ownerById.get(ownerId), items })).sort((a, b) => (a.owner?.name ?? 'zzz').localeCompare(b.owner?.name ?? 'zzz'));
  }, [data, ws, search]);
  const all = data?.properties ?? [];
  const unpostedFees = all.filter(p => p.lastPeriodFee == null).length;

  const exportCsv = () => downloadCsv('owner-funds', ['Owner', 'Property', 'Cash', 'Deposits held', 'Reserve', 'Unpaid bills', 'Available', 'Fee %', 'Last distribution', 'Last distribution amount'], all.map(p => [ws.ownerById.get(p.ownerId ?? '')?.name ?? '', p.name, p.cash, p.depositsHeld, p.reserve, p.unpaidBills, p.available, p.feePercent, p.lastDistribution?.date ?? '', p.lastDistribution?.amount ?? '']));

  return (
    <>
      <AccountingHeader
        tab="owners"
        actions={
          canBank && (
            <>
              <HeaderButton icon={<Percent />} label="Management fees" onClick={() => setFees(true)} />
              <HeaderButton icon={<ArrowDownToLine />} label="Contribution" onClick={() => setMoney({ direction: 'contribution' })} />
              <HeaderButton primary icon={<Send />} label="Distribution run" onClick={() => setRun(true)} />
            </>
          )
        }
      />
      {data && (
        <SummaryStrip
          items={[
            { label: 'Cash held for owners', value: <Money value={sumOf(all, p => p.cash)} /> },
            { label: 'Deposits held', value: <Money value={sumOf(all, p => p.depositsHeld)} />, secondary: true },
            { label: 'Reserves', value: <Money value={sumOf(all, p => p.reserve)} />, secondary: true },
            { label: 'Unpaid bills', value: <Money value={sumOf(all, p => p.unpaidBills)} />, tone: sumOf(all, p => p.unpaidBills) > 0 ? undefined : 'muted', secondary: true },
            { label: 'Available to distribute', value: <Money value={sumOf(all, p => Math.max(0, p.available))} />, tone: 'success' },
            { label: `${periodLabel(data.feePeriod, true)} fees`, value: unpostedFees ? `${unpostedFees} not posted` : 'All posted', tone: unpostedFees ? 'warning' : 'muted', onClick: canBank ? () => setFees(true) : undefined },
          ]}
        />
      )}
      <ListToolbar
        start={<span className="px-1 text-sm text-muted-foreground">Figures as of today, the same way owner statements calculate them.</span>}
        count={isPending ? null : all.length}
        countLabel={['property', 'properties']}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search owner or property…"
        fetching={isFetching && !isPending}
        more={<DropdownMenuItem className={menuItem} onSelect={exportCsv} disabled={!all.length}><Download /> Export CSV</DropdownMenuItem>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={10} className="px-3 pt-2" />
        ) : isError || !data ? (
          <EmptyState className="py-20" title="Owner funds didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !all.length ? (
          <EmptyState className="py-20" icon={<Users />} title="No properties yet" description="Owner funds appear once properties have owners and money moving through the books." />
        ) : !groups.length ? (
          <EmptyState className="py-20" icon={<Users />} title="Nothing matches" description="No owners or properties match that search." action={<button type="button" className="ghost-chip h-9" onClick={() => setSearch('')}>Clear search</button>} />
        ) : (
          <div className="overflow-x-auto pb-24">
            {data.warnings.length > 0 && (
              <div className="px-4 pt-3">
                <Notice tone="warning"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-tone-warning" />{data.warnings.join(' ')}</Notice>
              </div>
            )}
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[14px]">
              <thead className="sticky top-0 z-10">
                <tr className="text-sm text-muted-foreground">
                  <th className="h-9 border-b bg-subtle/95 px-4 text-left font-medium backdrop-blur">Property</th>
                  <th className="h-9 w-28 border-b bg-subtle/95 px-3 text-right font-medium backdrop-blur">Cash</th>
                  <th className="h-9 w-28 border-b bg-subtle/95 px-3 text-right font-medium backdrop-blur">Deposits</th>
                  <th className="h-9 w-24 border-b bg-subtle/95 px-3 text-right font-medium backdrop-blur">Reserve</th>
                  <th className="h-9 w-28 border-b bg-subtle/95 px-3 text-right font-medium backdrop-blur">Unpaid bills</th>
                  <th className="h-9 w-32 border-b bg-subtle/95 px-3 text-right font-medium backdrop-blur">Available</th>
                  <th className="h-9 w-40 border-b bg-subtle/95 px-3 text-left font-medium backdrop-blur">Last distribution</th>
                  <th className="h-9 w-28 border-b bg-subtle/95 px-3 text-left font-medium backdrop-blur">{periodLabel(data.feePeriod, true)} fee</th>
                  <th className="h-9 w-11 border-b bg-subtle/95 backdrop-blur" />
                </tr>
              </thead>
              {groups.map(g => (
                <tbody key={g.ownerId || 'none'}>
                  <tr>
                    <td colSpan={9} className="h-9 border-b bg-subtle/40 px-4">
                      <span className="flex items-center gap-2">
                        <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                        {g.owner ? <button type="button" className="font-medium hover:underline" onClick={() => navigate(`/owners/${g.ownerId}`)}>{g.owner.name}</button> : <span className="font-medium text-muted-foreground">No owner</span>}
                        <span className="text-sm text-muted-foreground">{plural(g.items.length, 'property', 'properties')}{g.owner ? ` · paid by ${g.owner.distributionMethod}` : ''}</span>
                        <span className="ml-auto text-sm text-muted-foreground">Available <Money value={sumOf(g.items, p => Math.max(0, p.available))} className="font-medium text-foreground" /></span>
                      </span>
                    </td>
                  </tr>
                  {g.items.map(p => (
                    <tr key={p.propertyId} className="group/row hover:bg-accent/40">
                      <td className="h-10 border-b border-border/60 px-4">
                        <button type="button" onClick={() => navigate(`/properties/${p.propertyId}`)} className="inline-flex max-w-[260px] items-center gap-1.5 hover:underline">
                          <PropertySwatch color={ws.propertyById.get(p.propertyId)?.color} /><span className="truncate">{p.name}</span>
                        </button>
                      </td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right"><Money value={p.cash} className={p.cash < 0 ? 'text-tone-danger' : undefined} /></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right text-muted-foreground"><Money value={p.depositsHeld} muted0 /></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right text-muted-foreground"><Money value={p.reserve} muted0 /></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right text-muted-foreground"><Money value={p.unpaidBills} muted0 /></td>
                      <td className="num h-10 border-b border-border/60 px-3 text-right"><Money value={p.available} className={cn('font-semibold', p.available < -0.004 ? 'text-tone-danger' : p.available > 0.004 ? 'text-tone-success' : 'text-muted-foreground')} /></td>
                      <td className="h-10 border-b border-border/60 px-3 text-muted-foreground">{p.lastDistribution ? <><Money value={p.lastDistribution.amount} className="text-foreground" /> · {shortDate(p.lastDistribution.date)}</> : 'None yet'}</td>
                      <td className="h-10 border-b border-border/60 px-3 text-sm">
                        {p.lastPeriodFee != null ? (
                          <Tip label={`${p.feePercent}% of rent collected`}><span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-tone-success" /><Money value={p.lastPeriodFee} /></span></Tip>
                        ) : (
                          <span className="text-tone-warning">Not posted · {p.feePercent}%</span>
                        )}
                      </td>
                      <td className="h-10 border-b border-border/60 pr-2 text-right">
                        <RowMenu label={`Actions for ${p.name}`}>
                          {canBank && p.ownerId && (
                            <>
                              <DropdownMenuItem className={menuItem} onSelect={() => setMoney({ direction: 'distribution', propertyId: p.propertyId })}><ArrowUpFromLine /> Record distribution</DropdownMenuItem>
                              <DropdownMenuItem className={menuItem} onSelect={() => setMoney({ direction: 'contribution', propertyId: p.propertyId })}><ArrowDownToLine /> Record contribution</DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem className={menuItem} onSelect={() => navigate(`/properties/${p.propertyId}`)}><Building2 /> Open property</DropdownMenuItem>
                          {p.ownerId && <DropdownMenuItem className={menuItem} onSelect={() => navigate(`/owners/${p.ownerId}`)}><UserRound /> Open owner</DropdownMenuItem>}
                        </RowMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </div>
      <OwnerMoneyDialog target={money} onOpenChange={o => !o && setMoney(null)} />
      <DistributionRunDialog open={run} onOpenChange={setRun} />
      <ManagementFeesDialog open={fees} onOpenChange={setFees} />
    </>
  );
}
