import { Hammer, Link2, Mail, MoreHorizontal, PanelRight, Pencil, Phone, Power, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { DetailLayout } from '../components/detail/DetailLayout';
import { useVendor, useVendorActions } from '../components/maintenance/data';
import { availableVendorTabs, VendorMain, VendorRail, type VendorTab } from '../components/maintenance/VendorDetail';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl, telHref } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useWorkspace } from '../lib/workspace';

/** A vendor's record: compliance and billing in the rail; their work, bills, documents, conversation and history in tabs. */
export function VendorPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, isPending, isError, error, refetch } = useVendor(id);
  const { setStatus } = useVendorActions();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  const v = data?.vendor;
  useDocumentTitle(v?.name ?? 'Vendor');
  const allowed = availableVendorTabs(c => ws.can(c), data?.canSeeMoney ?? false);
  const requested = params.get('tab') as VendorTab | null;
  const tab: VendorTab = requested && allowed.includes(requested) ? requested : allowed[0];
  const setTab = (t: VendorTab) => setParams(p => { const next = new URLSearchParams(p); if (t === allowed[0]) next.delete('tab'); else next.set('tab', t); return next; }, { replace: true });

  useHotkeys({ e: () => v && app.openCreate('vendor', { vendorId: v.id }) }, { enabled: Boolean(v) });

  const toggleStatus = async () => {
    if (!v) return;
    if (v.status === 'Inactive') {
      await setStatus(v.id, 'Active').then(() => toast.success(`${v.name} reactivated`)).catch(() => undefined);
      return;
    }
    const extra = [
      v.openWorkOrders > 0 ? `${v.openWorkOrders} open work ${v.openWorkOrders === 1 ? 'order stays' : 'orders stay'} assigned to them — reassign ${v.openWorkOrders === 1 ? 'it' : 'them'} if they won’t finish the work.` : '',
      data?.activeSchedules ? `${data.activeSchedules} recurring ${data.activeSchedules === 1 ? 'schedule still uses' : 'schedules still use'} them.` : '',
    ].filter(Boolean).join(' ');
    const ok = await app.confirm({
      title: `Deactivate ${v.name}?`,
      description: `${extra ? `${extra} ` : ''}They drop out of vendor pickers and lose portal access. Bills, documents and history stay, and you can reactivate them any time.`,
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (ok) await setStatus(v.id, 'Inactive').then(() => toast.success(`${v.name} deactivated`, { action: { label: 'Undo', onClick: () => void setStatus(v.id, 'Active').catch(() => undefined) } })).catch(() => undefined);
  };

  const header = (
    <PageHeader
      breadcrumb={{ to: '/vendors', label: 'Vendors' }}
      icon={<Hammer />}
      title={v?.name ?? 'Vendor'}
      actions={
        v && (
          <>
            {ws.can('maintenance.create') && v.status !== 'Inactive' && (
              <button type="button" onClick={() => app.openCreate('workOrder', { vendorId: v.id })} className="ghost-chip hidden h-8 gap-1.5 text-[13.5px] sm:inline-flex">
                <Wrench className="h-3.5 w-3.5" /> New work order
              </button>
            )}
            <Tip label="Edit vendor" keys={['E']}>
              <button type="button" onClick={() => app.openCreate('vendor', { vendorId: v.id })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
                <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none lg:inline-flex">E</Kbd>
              </button>
            </Tip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More vendor actions"><MoreHorizontal /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/vendors/${v.id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</DropdownMenuItem>
                {ws.can('maintenance.create') && v.status !== 'Inactive' && (
                  <DropdownMenuItem className="h-9 gap-2 text-[14px] sm:hidden" onSelect={() => app.openCreate('workOrder', { vendorId: v.id })}><Wrench className="h-3.5 w-3.5" /> New work order</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className={`h-9 gap-2 text-[14px] ${v.status === 'Inactive' ? '' : 'text-tone-danger focus:text-tone-danger'}`} onSelect={() => void toggleStatus()}>
                  <Power className="h-3.5 w-3.5" /> {v.status === 'Inactive' ? 'Reactivate vendor' : 'Deactivate vendor…'}
                </DropdownMenuItem>
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
        <div className="flex items-center gap-3"><div className="skeleton h-9 w-9 rounded-md" /><div className="space-y-2"><div className="skeleton h-5 w-56" /><div className="skeleton h-3 w-32" /></div></div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[76px] rounded-lg" />)}</div>
        <SkeletonRows rows={6} className="mt-6" />
      </DetailLayout>
    );
  }
  if (isError || !data) {
    const missing = /not found|no longer exists/i.test(errorMessage(error, ''));
    return (
      <DetailLayout header={header}>
        <EmptyState
          icon={<Hammer />}
          title={missing ? 'Vendor not found' : 'This vendor didn’t load'}
          description={errorMessage(error, 'Something went wrong.')}
          action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/vendors')}>Back to vendors</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>}
        />
      </DetailLayout>
    );
  }

  // On a phone the rail would push the vendor's work below a screen of settings, so it opens as a sheet instead.
  return (
    <DetailLayout header={header} wide rail={wide ? <VendorRail detail={data} /> : undefined}>
      <VendorMain
        detail={data}
        tab={tab}
        setTab={setTab}
        quickActions={!wide && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {data.vendor.phone && <a href={telHref(data.vendor.phone)} className="ghost-chip h-9 gap-1.5 border-border bg-background px-3 text-[14px]"><Phone className="h-3.5 w-3.5" /> Call</a>}
          {data.vendor.email && <a href={`mailto:${data.vendor.email}`} className="ghost-chip h-9 gap-1.5 border-border bg-background px-3 text-[14px]"><Mail className="h-3.5 w-3.5" /> Email</a>}
          <button type="button" onClick={() => setSheetOpen(true)} className="ghost-chip h-9 gap-1.5 border-border bg-background px-3 text-[14px]"><PanelRight className="h-3.5 w-3.5" /> Details & compliance</button>
        </div>
        )}
      />
      {!wide && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-[340px] max-w-[92vw] overflow-y-auto p-0">
            <div className="border-b px-4 py-3">
              <SheetTitle className="text-[15px]">{data.vendor.name}</SheetTitle>
              <SheetDescription className="text-sm">Contact, billing, compliance and portal access</SheetDescription>
            </div>
            <VendorRail detail={data} />
          </SheetContent>
        </Sheet>
      )}
    </DetailLayout>
  );
}
