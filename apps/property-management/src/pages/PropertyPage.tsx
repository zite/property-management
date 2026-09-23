import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Building2, FileText, Link2, MoreHorizontal, Pencil, Plus, UserRoundCog, Wrench } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveProperty } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { DetailLayout, InlineTabs } from '../components/detail/DetailLayout';
import { DocumentsPanel } from '../components/detail/DocumentsPanel';
import { Timeline } from '../components/detail/Timeline';
import { MemberPicker } from '../components/pickers/pickers';
import { Avatar, MemberAvatar, UnassignedAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { Pill, PropertySwatch } from '../components/primitives/glyphs';
import { OccupancyBar, PropertyThumb } from '../components/portfolio/bits';
import { afterPortfolioWrite, occupancyOf, propertyAddress, useProperty, type PropertyDetail } from '../components/portfolio/data';
import { PropertyFinancials } from '../components/portfolio/PropertyFinancials';
import { PropertyLeases } from '../components/portfolio/PropertyLeases';
import { PropertyOverview } from '../components/portfolio/PropertyOverview';
import { PropertyUnits } from '../components/portfolio/PropertyUnits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { WorkOrdersView } from '../components/workOrders/WorkOrdersView';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl, plural } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { retryUnlessNotFound } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';

/**
 * A property: the hub for its units, leases, work, money, documents and
 * history. Tabs live in the URL (`/properties/:id/:tab`) so every view is a
 * link. List tabs (units, leases, work orders) fill the page and scroll
 * themselves; the rest read in a centred column.
 */

type Tab = 'overview' | 'units' | 'leases' | 'work-orders' | 'financials' | 'documents' | 'activity';
const LIST_TABS: Tab[] = ['units', 'leases', 'work-orders'];

export function PropertyPage() {
  const params = useParams();
  const id = params.id ?? '';
  const navigate = useNavigate();
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const { data, isPending, isError, error, refetch } = useProperty(id);
  const known = ws.propertyById.get(id);
  const name = data?.property.name ?? known?.name;
  useDocumentTitle(name ?? 'Property');

  const seeLeases = ws.can('residents.manage') || ws.can('portfolio.manage') || ws.can('accounting.view');
  const tabs = useMemo(
    () =>
      [
        { value: 'overview' as Tab, label: 'Overview' },
        { value: 'units' as Tab, label: 'Units', count: (ws.unitsByProperty.get(id) ?? []).filter(u => !u.archived).length },
        ...(seeLeases ? [{ value: 'leases' as Tab, label: 'Leases', count: data ? data.leases.active + data.leases.pending : null }] : []),
        ...(ws.can('maintenance.create') ? [{ value: 'work-orders' as Tab, label: 'Work orders', count: data?.workOrders.open ?? null }] : []),
        ...(ws.can('accounting.view') ? [{ value: 'financials' as Tab, label: 'Financials' }] : []),
        { value: 'documents' as Tab, label: 'Documents', count: data?.documentCount ?? null },
        { value: 'activity' as Tab, label: 'Activity' },
      ],
    [ws, id, data, seeLeases],
  );
  const tab: Tab = tabs.some(t => t.value === params.tab) ? (params.tab as Tab) : 'overview';
  const go = (t: string) => navigate(t === 'overview' ? `/properties/${id}` : `/properties/${id}/${t}`, { replace: true });
  useEffect(() => {
    if (params.tab && !tabs.some(t => t.value === params.tab)) navigate(`/properties/${id}`, { replace: true });
  }, [params.tab, tabs]);

  const manage = ws.can('portfolio.manage');
  const p = data?.property;
  const archived = (p?.status ?? known?.status) === 'Archived';

  const archive = async () => {
    if (!data || !p) return;
    if (archived) {
      try {
        await saveProperty({ action: 'unarchive', id });
        afterPortfolioWrite(qc);
        toast.success(`Restored ${p.name}`);
      } catch (e) {
        toast.error(errorMessage(e, 'Couldn’t restore the property'));
      }
      return;
    }
    const { active, pending } = data.leases;
    if (active || pending) {
      const parts = [active ? plural(active, 'active lease') : '', pending ? `${plural(pending, 'lease')} waiting for signature` : ''].filter(Boolean).join(' and ');
      const view = await app.confirm({ title: `${p.name} can’t be archived yet`, description: `It has ${parts}. End or cancel ${active + pending === 1 ? 'it' : 'them'} first — archiving would take occupied units off the rent roll and owner statements.`, confirmLabel: seeLeases ? 'View leases' : 'OK' });
      if (view && seeLeases) go('leases');
      return;
    }
    const ok = await app.confirm({ title: `Archive ${p.name}?`, description: 'It leaves property lists, pickers and reports. Its units, past leases, documents and books are kept, and you can restore it any time.', confirmLabel: 'Archive property', destructive: true });
    if (!ok) return;
    try {
      await saveProperty({ action: 'archive', id });
      afterPortfolioWrite(qc);
      toast.success(`Archived ${p.name}`, { action: { label: 'Undo', onClick: () => void saveProperty({ action: 'unarchive', id }).then(() => afterPortfolioWrite(qc)) } });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t archive the property'));
    }
  };

  useHotkeys({ e: () => manage && p && app.openCreate('property', { propertyId: id }) }, { enabled: Boolean(p) });

  const header = (
    <PageHeader
      breadcrumb={{ to: '/properties', label: 'Properties' }}
      icon={known ? <PropertySwatch color={known.color} size={10} /> : <Building2 />}
      title={name ?? 'Property'}
      actions={
        p && (
          <>
            {manage && (
              <Tip label="Edit property" keys={['E']}>
                <button type="button" onClick={() => app.openCreate('property', { propertyId: id })} className="ghost-chip hidden h-8 gap-1.5 sm:inline-flex"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              </Tip>
            )}
            {ws.can('residents.manage') && !archived && (
              <button type="button" onClick={() => app.openCreate('lease', { propertyId: id })} className="ghost-chip hidden h-8 gap-1.5 md:inline-flex"><FileText className="h-3.5 w-3.5" /> New lease</button>
            )}
            {ws.can('maintenance.create') && !archived && (
              <Tip label="New work order" keys={['C']}>
                <button type="button" onClick={() => app.openCreate('workOrder', { propertyId: id })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                  <Wrench className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New work order</span>
                </button>
              </Tip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More actions"><MoreHorizontal /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {manage && <DropdownMenuItem className="h-9 gap-2 text-[14px] sm:hidden" onSelect={() => app.openCreate('property', { propertyId: id })}><Pencil className="h-3.5 w-3.5" /> Edit property</DropdownMenuItem>}
                {ws.can('residents.manage') && !archived && <DropdownMenuItem className="h-9 gap-2 text-[14px] md:hidden" onSelect={() => app.openCreate('lease', { propertyId: id })}><FileText className="h-3.5 w-3.5" /> New lease</DropdownMenuItem>}
                {manage && !archived && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => app.openCreate('unit', { propertyId: id })}><Plus className="h-3.5 w-3.5" /> Add unit</DropdownMenuItem>}
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/properties/${id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</DropdownMenuItem>
                {manage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className={cn('h-9 gap-2 text-[14px]', !archived && 'text-tone-danger focus:text-tone-danger')} onSelect={() => void archive()}>
                      {archived ? <><ArchiveRestore className="h-3.5 w-3.5" /> Restore property</> : <><Archive className="h-3.5 w-3.5" /> Archive property…</>}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header} wide>
        <div className="flex items-center gap-4"><div className="skeleton h-14 w-14 rounded-md" /><div className="flex-1 space-y-2"><div className="skeleton h-5 w-56" /><div className="skeleton h-3 w-80 max-w-full" /></div></div>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[86px] rounded-lg" />)}</div>
        <SkeletonRows rows={6} className="mt-6" />
      </DetailLayout>
    );
  }
  if (isError || !data || !p) {
    const missing = !retryUnlessNotFound(0, error);
    return (
      <DetailLayout header={header}>
        <EmptyState
          icon={<Building2 />}
          title={missing ? 'Property not found' : 'This property didn’t load'}
          description={errorMessage(error, missing ? 'It may have been deleted, or the link is wrong.' : 'Something went wrong.')}
          action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/properties')}>Back to properties</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>}
        />
      </DetailLayout>
    );
  }

  const list = LIST_TABS.includes(tab);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <PropertyHero detail={data} />
      <div className="shrink-0 border-b px-3 sm:px-5">
        <InlineTabs value={tab} onChange={v => go(v)} tabs={tabs} className="-mb-px border-b-0" />
      </div>
      {list ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'units' && <PropertyUnits propertyId={id} archived={archived} />}
          {tab === 'leases' && <PropertyLeases propertyId={id} />}
          {tab === 'work-orders' && (
            <WorkOrdersView
              surfaceKey={`property:${id}:work-orders`}
              baseFilters={{ propertyIds: [id] }}
              lockedFilters={['propertyIds']}
              createDefaults={{ propertyId: id }}
              defaults={{ properties: ['priority', 'number', 'location', 'vendor', 'scheduled', 'due', 'approval', 'messages', 'assignee'] }}
              emptyDescription={`Nothing open at ${p.name}. Log a request with C.`}
            />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('mx-auto w-full px-4 pb-24 pt-5 sm:px-8', tab === 'overview' || tab === 'financials' ? 'max-w-6xl' : 'max-w-[860px]')}>
            {tab === 'overview' && <PropertyOverview detail={data} onTab={go} />}
            {tab === 'financials' && <PropertyFinancials propertyId={id} />}
            {tab === 'documents' && (
              <>
                <p className="mb-3 text-[14px] text-muted-foreground">Insurance, tax bills, HOA documents and anything else about the property. Share a document to put it in {p.ownerId ? `${ws.ownerById.get(p.ownerId)?.name ?? 'the owner'}’s` : 'the owner'} portal.</p>
                <DocumentsPanel scope="propertyId" id={id} links={{ propertyId: id }} showSharing={{ owner: true }} defaultCategory="Other" />
              </>
            )}
            {tab === 'activity' && <Timeline activity={data.activity} newestFirst emptyText="Nothing has happened at this property yet." />}
          </div>
        </div>
      )}
    </div>
  );
}

function PropertyHero({ detail }: { detail: PropertyDetail }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const p = detail.property;
  const owner = p.ownerId ? ws.ownerById.get(p.ownerId) : undefined;
  const manager = p.managerId ? ws.memberById.get(p.managerId) : undefined;
  const counts = occupancyOf(ws.unitsByProperty.get(p.id) ?? []);
  const chip = 'ghost-chip h-8 max-w-full gap-1.5 px-2 text-[13.5px]';

  const setManager = async (managerId: string | null) => {
    if (managerId === p.managerId) return;
    try {
      await saveProperty({ action: 'update', id: p.id, fields: { managerId } });
      afterPortfolioWrite(qc);
      toast.success(managerId ? `${ws.memberName(managerId)} now manages ${p.name}` : `${p.name} has no manager`);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t change the manager'));
    }
  };

  const ownerChip: ReactNode = owner ? (
    ws.can('owners.manage') ? (
      <Link to={`/owners/${owner.id}`} className={chip}><Avatar name={owner.name} color={owner.color} size={16} /><span className="truncate">{owner.name}</span></Link>
    ) : (
      <span className={cn(chip, 'hover:bg-transparent')}><Avatar name={owner.name} color={owner.color} size={16} /><span className="truncate">{owner.name}</span></span>
    )
  ) : (
    <span className={cn(chip, 'text-muted-foreground hover:bg-transparent')}><UnassignedAvatar size={16} /> No owner</span>
  );

  const managerContent = manager ? <><MemberAvatar member={manager} size={16} /><span className="truncate">{manager.name}</span></> : <><UnassignedAvatar size={16} /><span className="text-muted-foreground">No manager</span></>;

  return (
    <div className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
      <div className="flex items-start gap-3 sm:gap-4">
        <PropertyThumb photoUrl={p.photoUrl} color={p.color} code={p.code} name={p.name} size={52} className={cn('hidden sm:inline-flex', p.status === 'Archived' && 'opacity-60 grayscale')} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="min-w-0 truncate text-[19px] font-semibold leading-7 tracking-tight">{p.name}</h1>
            <Tip label="Short code"><span className="rounded border bg-subtle px-1.5 font-mono text-[12px] leading-5 text-muted-foreground">{p.code}</span></Tip>
            {p.status !== 'Active' && <Pill tone={p.status === 'Archived' ? 'neutral' : 'warning'}>{p.status}</Pill>}
          </div>
          <p className="mt-0.5 truncate text-[14px] text-muted-foreground">{[propertyAddress(p) || 'No address', p.propertyType, plural(counts.total, 'unit')].join(' · ')}</p>
          <div className="-ml-2 mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
            <Tip label="Owner">{ownerChip}</Tip>
            {ws.can('portfolio.manage') ? (
              <MemberPicker value={p.managerId} onChange={id => void setManager(id)} noneLabel="No manager" filter={m => m.role === 'Admin' || m.role === 'Property Manager'} trigger={<button type="button" className={chip} aria-label="Change manager"><UserRoundCog className="h-3.5 w-3.5 text-muted-foreground" />{managerContent}</button>} />
            ) : (
              <span className={cn(chip, 'hover:bg-transparent')}><UserRoundCog className="h-3.5 w-3.5 text-muted-foreground" />{managerContent}</span>
            )}
            {counts.total > 0 && <OccupancyBar counts={counts} className="ml-2 w-32" />}
          </div>
        </div>
      </div>
    </div>
  );
}
