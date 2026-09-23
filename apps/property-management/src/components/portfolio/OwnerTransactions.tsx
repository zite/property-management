import { Download, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { periodLabel } from '@project/shared/dates';
import { sumMoney } from '@project/shared/money';
import { downloadCsv } from '../../lib/csv';
import { errorMessage } from '../../lib/errors';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Segmented } from '../form/fields';
import { DataTable, type Column } from '../list/DataTable';
import { EmptyState, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { useOwnerTransactions, type OwnerTransaction } from './data';

/**
 * Owner money on one owner's properties, newest first: what they put in,
 * what was paid out to them, and the management fees taken. Void entries stay
 * visible, struck through, so the history is complete.
 */

const periodLabelSafe = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? periodLabel(p) : p);

type Kind = 'all' | 'Owner distribution' | 'Owner contribution' | 'Management fee';
const LABEL: Record<string, string> = { 'Owner distribution': 'Distribution', 'Owner contribution': 'Contribution', 'Management fee': 'Management fee' };
const TONE: Record<string, 'info' | 'success' | 'neutral'> = { 'Owner distribution': 'info', 'Owner contribution': 'success', 'Management fee': 'neutral' };

export function OwnerTransactions({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const ws = useWorkspace();
  const { data, isPending, isError, error, refetch } = useOwnerTransactions(ownerId);
  const [kind, setKind] = useState<Kind>('all');
  const all = data?.transactions ?? [];
  const rows = useMemo(() => all.filter(t => kind === 'all' || t.kind === kind), [all, kind]);
  const posted = rows.filter(t => t.status !== 'Void');

  const columns: Column<OwnerTransaction>[] = [
    { key: 'date', header: 'Date', sort: t => t.date, width: 110, cell: t => <span className="whitespace-nowrap tabular-nums">{fullDate(t.date)}</span> },
    { key: 'kind', header: 'Type', sort: t => t.kind, cell: t => <Pill tone={TONE[t.kind] ?? 'neutral'}>{LABEL[t.kind] ?? t.kind}</Pill> },
    { key: 'property', header: 'Property', sort: t => ws.propertyName(t.propertyId), hideBelow: 'sm', cell: t => (t.propertyId ? <span className="inline-flex max-w-[200px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(t.propertyId)?.color} /><span className="truncate">{ws.propertyName(t.propertyId) || 'Former property'}</span></span> : <span className="text-muted-foreground">—</span>) },
    { key: 'memo', header: 'Description', className: 'max-w-[280px]', hideBelow: 'md', cell: t => <span className="block truncate text-muted-foreground">{t.description}{t.period ? ` · ${periodLabelSafe(t.period)}` : ''}</span> },
    { key: 'method', header: 'Method', hideBelow: 'lg', cell: t => <span className="text-muted-foreground">{[t.paymentMethod, t.reference].filter(Boolean).join(' · ') || '—'}</span> },
    {
      key: 'amount', header: 'Amount', align: 'right', sort: t => t.amount,
      cell: t => (
        <Tip label={t.status === 'Void' ? `Void${t.voidReason ? ` — ${t.voidReason}` : ''}` : `#${t.number}`}>
          <span><Money value={t.kind === 'Owner contribution' ? t.amount : -t.amount} signed className={cn(t.status === 'Void' && 'text-muted-foreground line-through')} /></span>
        </Tip>
      ),
      footer: <Money value={sumMoney(posted.map(t => (t.kind === 'Owner contribution' ? t.amount : -t.amount)))} signed />,
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      `owner-money-${ownerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      ['Date', 'Number', 'Type', 'Property', 'Description', 'Method', 'Reference', 'Amount', 'Status'],
      rows.map(t => [t.date, t.number, LABEL[t.kind] ?? t.kind, ws.propertyName(t.propertyId), t.description, t.paymentMethod, t.reference, t.kind === 'Owner contribution' ? t.amount : -t.amount, t.status]),
    );

  const totals = useMemo(() => {
    const live = all.filter(t => t.status !== 'Void');
    const year = ws.today.slice(0, 4);
    const ytd = live.filter(t => t.date.startsWith(year));
    return {
      distributions: sumMoney(ytd.filter(t => t.kind === 'Owner distribution').map(t => t.amount)),
      contributions: sumMoney(ytd.filter(t => t.kind === 'Owner contribution').map(t => t.amount)),
      fees: sumMoney(ytd.filter(t => t.kind === 'Management fee').map(t => t.amount)),
    };
  }, [all, ws.today]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={kind} onChange={v => setKind(v as Kind)} size="sm" options={[{ value: 'all', label: 'All' }, { value: 'Owner distribution', label: 'Distributions' }, { value: 'Owner contribution', label: 'Contributions' }, { value: 'Management fee', label: 'Fees' }]} />
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="ghost-chip h-9 gap-1.5"><Download className="h-3.5 w-3.5" /> Export CSV</button>
        </div>
      </div>
      {!isPending && !isError && all.length > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          This year: <Money value={totals.distributions} cents={false} /> distributed · <Money value={totals.contributions} cents={false} /> contributed · <Money value={totals.fees} /> in management fees
        </p>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        {isPending ? (
          <SkeletonRows rows={6} className="px-1 py-2" />
        ) : isError ? (
          <EmptyState className="py-12" title="Transactions didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
        ) : !rows.length ? (
          <EmptyState className="py-12" icon={<Receipt />} title={all.length ? 'Nothing of this type' : 'No owner money yet'} description={all.length ? 'Try another type.' : `Distributions to ${ownerName}, their contributions and management fees show up here once they’re recorded.`} action={all.length ? <button type="button" className="ghost-chip h-9" onClick={() => setKind('all')}>Show all</button> : undefined} />
        ) : (
          <DataTable rows={rows} columns={columns} getId={t => t.id} stickyHeader={false} rowClassName={t => (t.status === 'Void' ? 'text-muted-foreground' : undefined)} caption="Owner transactions" />
        )}
      </div>
      {data?.truncated && <p className="mt-2 text-sm text-muted-foreground">Showing the most recent 1,000. Export from Reports for the full history.</p>}
    </div>
  );
}
