import { Ban, ChevronDown, ChevronUp, HandCoins, KeyRound, Link2, LogOut, MessageSquare, MoreHorizontal, Pencil, Repeat } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import type { LeasePhase } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { LeaseLedger } from '../components/accounting/LeaseLedger';
import { DetailLayout, InlineTabs } from '../components/detail/DetailLayout';
import { DocumentsPanel } from '../components/detail/DocumentsPanel';
import { NAV_ORDER_KEY, useLease, useLeaseLifecycle, type LeaseDetail } from '../components/leases/data';
import { SettlementDialog } from '../components/leases/DepositSettlement';
import { LeaseActivity } from '../components/leases/LeaseActivity';
import { ActivateDialog, AddPersonDialog, EditTermsDialog, EndLeaseDialog, NoticeDialog, RecordSignatureDialog, RecurringChargeDialog, type ChargeDialogState } from '../components/leases/LeaseDialogs';
import { LeaseDocumentSection, LifecycleBanner, MoveOutSection, OtherLeasesSection, RecurringChargesSection, RenewalSection, type LeaseControls, type LeaseDialogKind } from '../components/leases/LeaseOverview';
import { LeaseRail } from '../components/leases/LeaseRail';
import { RenewalDialog } from '../components/leases/RenewalDialog';
import { EmptyState, IconButton, Kbd, SkeletonRows, Tip } from '../components/primitives/bits';
import { LeasePhasePill } from '../components/primitives/glyphs';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useWorkspace } from '../lib/workspace';

const TABS = ['overview', 'ledger', 'documents', 'activity'] as const;
type Tab = (typeof TABS)[number];

function useNeighbours(id: string) {
  let order: string[] = [];
  try {
    order = JSON.parse(sessionStorage.getItem(NAV_ORDER_KEY) ?? '[]');
  } catch {
    /* storage unavailable */
  }
  const i = order.indexOf(id);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null, index: i, total: order.length };
}

/**
 * A lease: where it is in its life and the next thing to do, the agreement,
 * what bills monthly, renewal and move-out — plus its ledger, documents and
 * history on their own tabs (`/leases/:id/:tab`).
 */
export function LeasePage() {
  const { id = '', tab: tabParam } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'overview';
  const { data, isPending, isError, error, refetch } = useLease(id);
  const l = data?.lease;
  useDocumentTitle(l ? `${leaseRef(l.number)} ${ws.unitLabel(l.unitId, l.propertyId)}` : 'Lease');
  const { run, pending } = useLeaseLifecycle();

  const [dialog, setDialog] = useState<LeaseDialogKind | null>(null);
  const [signing, setSigning] = useState<LeaseDetail['people'][number] | null>(null);
  const [charge, setCharge] = useState<ChargeDialogState>(null);
  const anyOpen = Boolean(dialog || signing || charge);

  // "Record notice…" from a list row lands here with ?notice=1.
  useEffect(() => {
    if (data && params.get('notice') === '1') {
      if (data.lease.status === 'Active') setDialog('notice');
      params.delete('notice');
      setParams(params, { replace: true });
    }
  }, [data?.lease.id]);

  const { prev, next, index, total } = useNeighbours(id);
  const go = (t: Tab) => navigate(`/leases/${id}${t === 'overview' ? '' : `/${t}`}`, { replace: true });

  const controls: LeaseControls = useMemo(
    () => ({
      open: kind => setDialog(kind),
      recordSignature: p => setSigning(p),
      editCharge: s => setCharge(s),
      sendForSignature: resend => void run({ action: 'sendForSignature', leaseId: id, resend }, { what: 'Signature request', errorFallback: 'Couldn’t send the lease for signature' }),
      cancel: async () => {
        if (!data) return;
        const ok = await app.confirm({
          title: `Cancel ${leaseRef(data.lease.number)}?`,
          description: `${data.lease.status === 'Pending signature' ? 'Residents can no longer sign it. ' : ''}Nothing has posted to the ledger, and the unit stays available.${data.application ? ` ${data.application.ref} goes back to Approved.` : ''}`,
          confirmLabel: 'Cancel lease',
          destructive: true,
        });
        if (ok) await run({ action: 'cancel', leaseId: id }, { errorFallback: 'Couldn’t cancel the lease' });
      },
      lifecycle: async action => {
        if (!data) return;
        if (action === 'acceptRenewal') {
          const ok = await app.confirm({ title: 'Accept the renewal for the residents?', description: `The lease extends ${data.lease.renewalTermMonths ?? 12} months at ${ws.money(data.lease.renewalRent ?? data.lease.rent)}/mo. Use this when they accepted by phone, email or in person.`, confirmLabel: 'Accept renewal' });
          if (!ok) return;
        }
        if (action === 'monthToMonth') {
          const ok = await app.confirm({ title: 'Convert to month-to-month?', description: 'The end date is removed and rent keeps billing monthly until someone gives notice.', confirmLabel: 'Go month-to-month' });
          if (!ok) return;
        }
        if (action === 'rescindNotice') {
          const ok = await app.confirm({ title: 'Withdraw the notice?', description: 'The move-out date is cleared and the lease carries on as if notice was never given.', confirmLabel: 'Withdraw notice' });
          if (!ok) return;
        }
        await run({ action, leaseId: id }, { money: action === 'acceptRenewal' });
      },
      pending,
    }),
    [id, data, run, pending, app, ws],
  );

  const canRenew = Boolean(l && l.status === 'Active' && !l.moveOutDate && l.phase !== 'Upcoming');
  const recipients = (data?.people ?? []).filter(p => p.role === 'Primary' || p.role === 'Co-tenant').map(p => ({ kind: 'tenant' as const, id: p.id, name: p.name, email: p.email || null }));
  const message = () => data && recipients.length && app.openCompose({ recipients, context: { leaseId: id, propertyId: l?.propertyId || undefined } });

  useHotkeys(
    {
      k: () => prev && navigate(`/leases/${prev}`),
      j: () => next && navigate(`/leases/${next}`),
      m: () => ws.can('communications.send') && message(),
      r: () => canRenew && setDialog('renew'),
      n: () => l?.status === 'Active' && !l.moveOutDate && setDialog('notice'),
      esc: () => navigate('/leases'),
    },
    { enabled: !anyOpen },
  );

  const primary = (() => {
    if (!data || !l) return null;
    const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50';
    const signers = data.people.filter(p => p.role === 'Primary' || p.role === 'Co-tenant');
    if (l.status === 'Draft') return <button type="button" className={btn} disabled={pending === 'sendForSignature' || !signers.length} onClick={() => controls.sendForSignature()}>Send for signature</button>;
    if (l.status === 'Pending signature' && signers.length && signers.every(p => p.signedAt)) return <button type="button" className={btn} onClick={() => setDialog('activate')}>Countersign &amp; activate</button>;
    if (l.phase === 'Notice' && l.moveOutDate && l.moveOutDate <= ws.today) return <button type="button" className={btn} onClick={() => setDialog('end')}><LogOut className="h-3.5 w-3.5" /> Complete move-out</button>;
    if (l.status === 'Ended' && !l.depositSettledAt && data.depositHeld > 0 && ws.can('receivables.manage')) return <button type="button" className={btn} onClick={() => setDialog('settle')}>Settle deposit</button>;
    if (canRenew && (l.phase === 'Expiring' || l.phase === 'Month-to-month') && l.renewalStatus !== 'Offered') {
      return (
        <Tip label="Offer renewal" keys={['R']}>
          <button type="button" className={btn} onClick={() => setDialog('renew')}><Repeat className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Offer renewal</span> <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none lg:inline-flex">R</Kbd></button>
        </Tip>
      );
    }
    return null;
  })();

  const header = (
    <PageHeader
      breadcrumb={{ to: '/leases', label: 'Leases' }}
      icon={<KeyRound />}
      title={
        l ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 tabular-nums text-muted-foreground">{leaseRef(l.number)}</span>
            <span className="truncate">{ws.unitLabel(l.unitId, l.propertyId)}</span>
            <LeasePhasePill phase={l.phase as LeasePhase} className="hidden sm:inline-flex" />
          </span>
        ) : (
          'Lease'
        )
      }
      actions={
        <>
          {index >= 0 && total > 1 && <span className="mr-1 hidden text-sm tabular-nums text-muted-foreground md:inline">{index + 1} / {total}</span>}
          <Tip label="Previous" keys={['K']}>
            <IconButton aria-label="Previous lease" disabled={!prev} onClick={() => prev && navigate(`/leases/${prev}`)} className="hidden sm:inline-flex"><ChevronUp /></IconButton>
          </Tip>
          <Tip label="Next" keys={['J']}>
            <IconButton aria-label="Next lease" disabled={!next} onClick={() => next && navigate(`/leases/${next}`)} className="hidden sm:inline-flex"><ChevronDown /></IconButton>
          </Tip>
          {data && ws.can('communications.send') && recipients.length > 0 && (
            <Tip label="Message residents" keys={['M']}>
              <IconButton aria-label="Message residents" onClick={message}><MessageSquare /></IconButton>
            </Tip>
          )}
          {data && ws.can('receivables.manage') && l && l.status !== 'Draft' && l.status !== 'Canceled' && (
            <Tip label="Receive payment" keys={['⇧', 'P']}>
              <IconButton aria-label="Receive payment" onClick={() => app.openCreate('payment', { leaseId: id })}><HandCoins /></IconButton>
            </Tip>
          )}
          {data && l && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More lease actions"><MoreHorizontal /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canRenew && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDialog('renew')}><Repeat className="h-3.5 w-3.5" /> Offer renewal…</DropdownMenuItem>}
                {l.status === 'Active' && !l.moveOutDate && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDialog('notice')}><LogOut className="h-3.5 w-3.5" /> Record notice…</DropdownMenuItem>}
                {l.status === 'Active' && l.moveOutDate && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDialog('notice')}><Pencil className="h-3.5 w-3.5" /> Move-out details…</DropdownMenuItem>}
                {l.status === 'Draft' && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDialog('editTerms')}><Pencil className="h-3.5 w-3.5" /> Edit terms…</DropdownMenuItem>}
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/leases/${id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</DropdownMenuItem>
                {(l.status === 'Draft' || l.status === 'Pending signature') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void controls.cancel()}><Ban className="h-3.5 w-3.5" /> Cancel lease…</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {primary}
        </>
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header} rail={<div className="space-y-3 p-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-6" style={{ width: `${55 + ((i * 17) % 40)}%` }} />)}</div>}>
        <div className="skeleton mb-4 h-20 w-full rounded-lg" />
        <SkeletonRows rows={8} />
      </DetailLayout>
    );
  }
  if (isError || !data || !l) {
    const missing = /not found|no longer exists/i.test(errorMessage(error, ''));
    return (
      <DetailLayout header={header}>
        <EmptyState
          icon={<KeyRound />}
          title={missing ? 'Lease not found' : 'The lease didn’t load'}
          description={errorMessage(error, missing ? 'It may have been deleted, or the link is wrong.' : 'Something went wrong. Try again in a moment.')}
          action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/leases')}>Back to leases</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>}
        />
      </DetailLayout>
    );
  }

  return (
    <DetailLayout header={header} rail={<LeaseRail detail={data} controls={controls} />}>
      <p className="mb-1 truncate text-[14px] text-muted-foreground">{data.people.filter(p => p.role !== 'Guarantor').map(p => p.name).join(', ') || 'No residents yet'}</p>
      <h1 className="mb-4 truncate text-[22px] font-semibold leading-8 tracking-tight">{ws.unitLabel(l.unitId, l.propertyId)}</h1>
      <InlineTabs
        className="mb-6"
        value={tab}
        onChange={t => go(t)}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'ledger', label: 'Ledger' },
          { value: 'documents', label: 'Documents' },
          { value: 'activity', label: 'Activity', count: data.unread || null },
        ]}
      />
      {tab === 'overview' && (
        <div>
          <LifecycleBanner detail={data} controls={controls} />
          <RenewalSection detail={data} controls={controls} />
          <MoveOutSection detail={data} controls={controls} />
          <RecurringChargesSection detail={data} controls={controls} />
          <LeaseDocumentSection detail={data} />
          <OtherLeasesSection detail={data} />
        </div>
      )}
      {tab === 'ledger' && (l.status === 'Draft' || l.status === 'Canceled' ? (
        <EmptyState icon={<HandCoins />} title={l.status === 'Draft' ? 'Nothing posts until the lease is active' : 'This lease was canceled before anything posted'} description={l.status === 'Draft' ? 'Activating it posts the security deposit and the first month’s rent.' : undefined} />
      ) : (
        <LeaseLedger leaseId={id} />
      ))}
      {tab === 'documents' && <DocumentsPanel scope="leaseId" id={id} links={{ leaseId: id, propertyId: l.propertyId, unitId: l.unitId, tenantId: data.people.find(p => p.role === 'Primary')?.id }} defaultCategory="Lease" showSharing={{ tenant: true }} />}
      {tab === 'activity' && <LeaseActivity detail={data} />}

      <ActivateDialog detail={data} open={dialog === 'activate' || dialog === 'activateDraft'} fromDraft={dialog === 'activateDraft'} onOpenChange={o => !o && setDialog(null)} />
      <NoticeDialog detail={data} open={dialog === 'notice'} onOpenChange={o => !o && setDialog(null)} />
      <EndLeaseDialog detail={data} open={dialog === 'end'} onOpenChange={o => !o && setDialog(null)} />
      <SettlementDialog detail={data} open={dialog === 'settle'} onOpenChange={o => !o && setDialog(null)} />
      <AddPersonDialog detail={data} open={dialog === 'addPerson'} onOpenChange={o => !o && setDialog(null)} />
      <EditTermsDialog detail={data} open={dialog === 'editTerms'} onOpenChange={o => !o && setDialog(null)} />
      <RenewalDialog open={dialog === 'renew'} onOpenChange={o => !o && setDialog(null)} leases={[l]} />
      <RecordSignatureDialog detail={data} person={signing} onOpenChange={o => !o && setSigning(null)} />
      <RecurringChargeDialog detail={data} state={charge} onOpenChange={o => !o && setCharge(null)} />
    </DetailLayout>
  );
}
