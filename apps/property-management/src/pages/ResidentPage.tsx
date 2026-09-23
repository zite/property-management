import { ChevronDown, ChevronUp, HandCoins, Link2, MessageSquare, MoreHorizontal, Pencil, Users, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import type { LeasePhase } from '@project/shared/constants';
import { LeaseLedger } from '../components/accounting/LeaseLedger';
import { DetailLayout, InlineTabs } from '../components/detail/DetailLayout';
import { DocumentsPanel } from '../components/detail/DocumentsPanel';
import { Timeline } from '../components/detail/Timeline';
import { Segmented } from '../components/form/fields';
import { NAV_ORDER_KEY, useResident } from '../components/residents/data';
import { ResidentMessages, ResidentOverview, ResidentRail } from '../components/residents/ResidentDetail';
import { Avatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../components/primitives/bits';
import { LeasePhasePill } from '../components/primitives/glyphs';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { WorkOrdersView } from '../components/workOrders/WorkOrdersView';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

const TABS = ['overview', 'ledger', 'work-orders', 'messages', 'documents', 'activity'] as const;
type Tab = (typeof TABS)[number];

function useNeighbours(id: string) {
  let order: string[] = [];
  try {
    order = JSON.parse(sessionStorage.getItem(NAV_ORDER_KEY) ?? '[]');
  } catch {
    /* storage unavailable */
  }
  const i = order.indexOf(id);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null };
}

/** A resident: how to reach them, where they live, what they owe, their requests and their conversation with the office. */
export function ResidentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const { data, isPending, isError, error, refetch } = useResident(id);
  const t = data?.tenant;
  useDocumentTitle(t?.name ?? 'Resident');
  const { prev, next } = useNeighbours(id);
  const setTab = (v: Tab) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true });

  const moneyLeases = useMemo(() => (data?.leases ?? []).filter(l => l.status !== 'Draft' && l.status !== 'Canceled'), [data]);
  const [ledgerLease, setLedgerLease] = useState<string | null>(null);
  const ledgerId = ledgerLease && moneyLeases.some(l => l.id === ledgerLease) ? ledgerLease : data?.currentLeaseId && moneyLeases.some(l => l.id === data.currentLeaseId) ? data.currentLeaseId : moneyLeases[0]?.id ?? null;
  const current = data?.leases.find(l => l.id === data.currentLeaseId);

  const message = () => {
    setTab('messages');
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('main textarea')?.focus(), 80);
  };
  useHotkeys({
    k: () => prev && navigate(`/residents/${prev}`),
    j: () => next && navigate(`/residents/${next}`),
    m: message,
    e: () => ws.can('residents.manage') && app.openCreate('tenant', { tenantId: id }),
    esc: () => navigate('/residents'),
  });

  const header = (
    <PageHeader
      breadcrumb={{ to: '/residents', label: 'Residents' }}
      icon={<Users />}
      title={t ? <span className="flex min-w-0 items-center gap-2"><span className="truncate">{t.name}</span>{current && <LeasePhasePill phase={current.phase as LeasePhase} className="hidden sm:inline-flex" />}</span> : 'Resident'}
      actions={
        <>
          <Tip label="Previous" keys={['K']}><IconButton aria-label="Previous resident" disabled={!prev} onClick={() => prev && navigate(`/residents/${prev}`)} className="hidden sm:inline-flex"><ChevronUp /></IconButton></Tip>
          <Tip label="Next" keys={['J']}><IconButton aria-label="Next resident" disabled={!next} onClick={() => next && navigate(`/residents/${next}`)} className="hidden sm:inline-flex"><ChevronDown /></IconButton></Tip>
          {data && ws.can('maintenance.create') && (
            <Tip label="New work order">
              <IconButton aria-label="New work order" onClick={() => app.openCreate('workOrder', { tenantId: id, propertyId: current?.propertyId ?? undefined, unitId: current?.unitId ?? undefined })}><Wrench /></IconButton>
            </Tip>
          )}
          {data && ws.can('receivables.manage') && current && current.status === 'Active' && (
            <Tip label="Receive payment"><IconButton aria-label="Receive payment" onClick={() => app.openCreate('payment', { leaseId: current.id, tenantId: id })}><HandCoins /></IconButton></Tip>
          )}
          {data && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconButton aria-label="More resident actions"><MoreHorizontal /></IconButton></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {ws.can('residents.manage') && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('tenant', { tenantId: id })}><Pencil className="h-3.5 w-3.5" /> Edit details</DropdownMenuItem>}
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/residents/${id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {data && (
            <Tip label="Message" keys={['M']}>
              <button type="button" onClick={message} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <MessageSquare className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Message</span> <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none lg:inline-flex">M</Kbd>
              </button>
            </Tip>
          )}
        </>
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header} rail={<div className="space-y-3 p-4">{Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-6" style={{ width: `${50 + ((i * 23) % 45)}%` }} />)}</div>}>
        <div className="skeleton mb-6 h-9 w-64" />
        <div className="skeleton mb-4 h-28 w-full rounded-lg" />
        <SkeletonRows rows={5} />
      </DetailLayout>
    );
  }
  if (isError || !data || !t) {
    const missing = /not found|no longer exists/i.test(errorMessage(error, ''));
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<Users />} title={missing ? 'Resident not found' : 'The resident didn’t load'} description={errorMessage(error, missing ? 'They may have been removed, or the link is wrong.' : 'Something went wrong. Try again in a moment.')} action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/residents')}>Back to residents</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      </DetailLayout>
    );
  }

  return (
    <DetailLayout header={header} rail={<ResidentRail detail={data} />}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={t.name} color={t.color || undefined} size={40} />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold leading-8 tracking-tight">{t.name}</h1>
          <p className="truncate text-[14px] text-muted-foreground">{current ? `${current.role} · ${ws.unitLabel(current.unitId, current.propertyId)}` : data.leases.length ? 'Past resident' : 'No lease yet'}{t.company ? ` · ${t.company}` : ''}</p>
        </div>
      </div>
      <InlineTabs
        className="mb-6"
        value={tab}
        onChange={v => setTab(v)}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'ledger', label: 'Ledger' },
          { value: 'work-orders', label: 'Work orders' },
          { value: 'messages', label: 'Messages', count: data.unread || null },
          { value: 'documents', label: 'Documents' },
          { value: 'activity', label: 'Activity' },
        ]}
      />
      {tab === 'overview' && <ResidentOverview detail={data} />}
      {tab === 'ledger' && (ledgerId ? (
        <div>
          {moneyLeases.length > 1 && (
            <div className="mb-4 overflow-x-auto">
              <Segmented size="sm" value={ledgerId} onChange={v => setLedgerLease(v)} options={moneyLeases.map(l => ({ value: l.id, label: `${l.ref} · ${ws.unitById.get(l.unitId ?? '')?.name ?? ws.unitLabel(l.unitId, l.propertyId)}` }))} />
            </div>
          )}
          <LeaseLedger key={ledgerId} leaseId={ledgerId} />
        </div>
      ) : (
        <EmptyState icon={<HandCoins />} title="No ledger yet" description="A ledger starts when one of their leases becomes active." />
      ))}
      {tab === 'work-orders' && (
        <div className="flex h-[min(640px,70vh)] flex-col overflow-hidden rounded-lg border">
          <WorkOrdersView compact keyboard={false} surfaceKey={`resident:${id}:work-orders`} baseFilters={{ tenantId: id, showClosed: true }} createDefaults={{ tenantId: id, propertyId: current?.propertyId ?? undefined, unitId: current?.unitId ?? undefined }} defaults={{ grouping: 'status', layout: 'list' }} emptyTitle="No work orders" emptyDescription={`Requests ${t.name.split(' ')[0]} makes in the portal, or that you log for them, show up here.`} />
        </div>
      )}
      {tab === 'messages' && <ResidentMessages detail={data} />}
      {tab === 'documents' && <DocumentsPanel scope="tenantId" id={id} links={{ tenantId: id, leaseId: current?.id, propertyId: current?.propertyId, unitId: current?.unitId }} showSharing={{ tenant: true }} />}
      {tab === 'activity' && <Timeline activity={data.activity} emptyText="Nothing has happened on this resident yet." />}
    </DetailLayout>
  );
}
