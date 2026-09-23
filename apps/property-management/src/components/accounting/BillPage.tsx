import { Ban, Banknote, FileText, Link2, Lock, Receipt, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, dueLabel, fullDate } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { DetailLayout, RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { PageHeader, useDocumentTitle } from '../shell/PageHeader';
import { TXN_LABEL, useTransaction, voidCapability } from './accountingData';
import { VoidDialog, type VoidTarget } from './LedgerDialogs';
import { fileNameFromUrl, HeaderButton } from './parts';
import { PayBillsDialog } from './PayBillsDialog';
import { TransactionDetailContent, TransactionSheet } from './TransactionSheet';

/** A vendor bill: its lines by account and property, the payments against it, the invoice, and void. */
export function BillPage({ id }: { id: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useTransaction(id);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [pay, setPay] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const t = data?.transaction;
  const isBill = !t || t.kind === 'Bill';
  const kindLabel = t ? TXN_LABEL[t.kind] ?? t.kind : 'Bill';
  useDocumentTitle(t ? `${kindLabel} #${t.number}${t.vendorName ? ` · ${t.vendorName}` : ''}` : 'Bill');
  useHotkeys({ esc: () => navigate('/accounting/payables') }, { enabled: !voidTarget && !pay && !sheet });

  const payments = (data?.allocations ?? []).filter(a => a.direction === 'paidBy');
  const paid = fromCents(payments.filter(a => !a.void && a.other.status === 'Posted').reduce((s, a) => s + toCents(a.amount), 0));
  const open = t && t.status === 'Posted' ? fromCents(Math.max(0, toCents(t.amount) - toCents(paid))) : 0;
  const expenseLines = (data?.lines ?? []).filter(l => l.debit > 0);
  const canManage = ws.can('payables.manage');
  const due = dueLabel(t?.dueDate);
  const state = !t ? null : t.status === 'Void' ? { label: 'Void', tone: 'neutral' as const } : open <= 0.004 ? { label: 'Paid', tone: 'success' as const } : t.dueDate && t.dueDate < ws.today ? { label: paid > 0 ? 'Part paid · overdue' : 'Overdue', tone: 'danger' as const } : paid > 0 ? { label: 'Part paid', tone: 'info' as const } : { label: 'Open', tone: 'warning' as const };
  const propertyIds = [...new Set(expenseLines.map(l => l.propertyId).filter(Boolean))] as string[];

  const header = (
    <PageHeader
      breadcrumb={{ to: '/accounting/payables', label: 'Payables' }}
      icon={<Receipt />}
      title={t ? `${kindLabel} #${t.number}` : 'Bill'}
      actions={
        <>
          <Tip label="Copy link">
            <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/accounting/payables/${id}`), 'Link copied')}><Link2 /></IconButton>
          </Tip>
          {t && ws.can(voidCapability(t.kind)) && t.status === 'Posted' && (
            <HeaderButton icon={<Ban />} label="Void" onClick={() => setVoidTarget({ id: t.id, number: t.number, kind: kindLabel, amount: t.amount, description: `${t.vendorName ?? t.leaseName ?? t.ownerName ?? kindLabel} · ${t.description}` })} />
          )}
          {t && isBill && canManage && open > 0.004 && <HeaderButton primary icon={<Banknote />} label="Pay bill" onClick={() => setPay([t.id])} />}
        </>
      }
    />
  );

  if (isPending) return <DetailLayout header={header}><SkeletonRows rows={10} /></DetailLayout>;
  if (isError || !data || !t) {
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<Receipt />} title="Not found" description={errorMessage(error, 'It may have been removed, or the link is wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      </DetailLayout>
    );
  }
  if (t.kind !== 'Bill') {
    // Vendor pages link bill payments and expenses here too: show the transaction itself, with the bills it paid.
    return (
      <DetailLayout header={header}>
        <TransactionDetailContent
          data={data}
          onOpenOther={other => navigate(`/accounting/payables/${other}`)}
          go={to => navigate(to)}
          onVoid={() => setVoidTarget({ id: t.id, number: t.number, kind: kindLabel, amount: t.amount, description: `${t.vendorName ?? t.leaseName ?? t.ownerName ?? kindLabel} · ${t.description}` })}
        />
        <VoidDialog target={voidTarget} onOpenChange={o => !o && setVoidTarget(null)} onVoided={() => void refetch()} />
      </DetailLayout>
    );
  }

  const rail = (
    <>
      <RailSection title="Bill">
        <RailRow label="Status">{state && <Pill tone={state.tone}>{state.label}</Pill>}</RailRow>
        <RailRow label="Vendor">{t.vendorId ? <button type="button" className="ghost-chip h-8 max-w-full truncate" onClick={() => navigate(`/vendors/${t.vendorId}`)}>{t.vendorName}</button> : <span className="text-muted-foreground">—</span>}</RailRow>
        <RailRow label="Bill date"><span className="px-1 tabular-nums">{fullDate(t.date)}</span></RailRow>
        <RailRow label="Due">
          <span className={cn('px-1 tabular-nums', t.status === 'Posted' && open > 0.004 && due?.tone === 'overdue' && 'text-tone-danger', t.status === 'Posted' && open > 0.004 && due?.tone === 'soon' && 'text-tone-warning')}>{t.dueDate ? fullDate(t.dueDate) : '—'}</span>
        </RailRow>
        <RailRow label="Invoice #"><span className="truncate px-1">{t.reference ?? <span className="text-muted-foreground">—</span>}</span></RailRow>
      </RailSection>
      <RailSection title="Linked">
        <RailRow label={propertyIds.length > 1 ? 'Properties' : 'Property'}>
          <span className="flex min-w-0 flex-col gap-0.5 px-1">
            {(propertyIds.length ? propertyIds : [t.propertyId]).filter(Boolean).map(pid => (
              <span key={pid} className="inline-flex min-w-0 items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(pid!)?.color} /><span className="truncate">{ws.unitLabel(propertyIds.length > 1 ? null : t.unitId, pid)}</span></span>
            ))}
          </span>
        </RailRow>
        <RailRow label="Work order">
          {t.workOrderNumber != null ? <button type="button" className="ghost-chip h-8 max-w-full gap-1.5 truncate" onClick={() => navigate(`/work-orders/${t.workOrderNumber}`)}><Wrench className="h-3 w-3" />{workOrderRef(t.workOrderNumber)}</button> : <span className="px-1 text-muted-foreground">None</span>}
        </RailRow>
      </RailSection>
      <RailSection title="Record">
        <RailRow label="Transaction"><button type="button" className="ghost-chip h-8 tabular-nums" onClick={() => setSheet(t.id)}>#{t.number}</button></RailRow>
        <RailRow label="Entered"><span className="truncate px-1 text-[13.5px]">{t.createdByName ? `${t.createdByName}, ` : ''}{t.createdAt ? dateTime(t.createdAt) : '—'}</span></RailRow>
      </RailSection>
    </>
  );

  return (
    <DetailLayout header={header} rail={rail}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] text-muted-foreground">{t.vendorName ?? 'No vendor'}</p>
          <h1 className={cn('mt-0.5 break-words text-[20px] font-semibold leading-tight tracking-tight', t.status === 'Void' && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{t.description || `Bill #${t.number}`}</h1>
        </div>
        <div className="text-right">
          <Money value={t.amount} className="block text-[22px] font-semibold tracking-tight" />
          {t.status === 'Posted' && (open > 0.004 ? <span className="text-[14px] text-muted-foreground"><Money value={open} className="font-medium text-foreground" /> left to pay</span> : <span className="text-[14px] text-tone-success">Paid in full</span>)}
        </div>
      </div>

      {t.status === 'Void' && (
        <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-[14px]">
          Voided{t.voidedByName ? ` by ${t.voidedByName}` : ''}{t.voidedAt ? ` on ${dateTime(t.voidedAt)}` : ''} — <span className="text-muted-foreground">{t.voidReason}</span>
        </div>
      )}

      <SectionHeading className="mt-8" count={expenseLines.length}>Lines</SectionHeading>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[14px]">
          <thead>
            <tr className="text-sm text-muted-foreground">
              <th className="h-9 border-b bg-subtle/80 px-3 text-left font-medium">Account</th>
              <th className="h-9 border-b bg-subtle/80 px-3 text-left font-medium">Property</th>
              <th className="h-9 border-b bg-subtle/80 px-3 text-left font-medium">Memo</th>
              <th className="h-9 w-32 border-b bg-subtle/80 px-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenseLines.map(l => (
              <tr key={l.id}>
                <td className="h-10 border-b border-border/60 px-3"><span className="num mr-1.5 text-sm text-muted-foreground">{l.accountNumber}</span>{l.accountName}</td>
                <td className="h-10 border-b border-border/60 px-3"><span className="inline-flex max-w-[200px] items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} /><span className="truncate">{ws.unitLabel(l.unitId, l.propertyId) || '—'}</span></span></td>
                <td className="h-10 border-b border-border/60 px-3 text-muted-foreground"><span className="block max-w-[240px] truncate">{l.memo && l.memo !== t.description ? l.memo : ''}</span></td>
                <td className="num h-10 border-b border-border/60 px-3 text-right"><Money value={l.debit} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td colSpan={3} className="h-9 bg-subtle/60 px-3">Total</td>
              <td className="num h-9 bg-subtle/60 px-3 text-right"><Money value={t.amount} /></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <SectionHeading className="mt-8" count={payments.length} action={canManage && open > 0.004 ? <button type="button" className="ghost-chip h-8 gap-1.5 text-sm" onClick={() => setPay([t.id])}><Banknote className="h-3.5 w-3.5" /> Pay</button> : undefined}>Payments</SectionHeading>
      {payments.length ? (
        <div className="overflow-hidden rounded-lg border">
          {payments.map(a => {
            const voided = a.void || a.other.status === 'Void';
            return (
              <button key={a.id} type="button" onClick={() => setSheet(a.other.id)} className="flex min-h-10 w-full items-center gap-3 border-b px-3 py-1.5 text-left text-[14px] last:border-b-0 hover:bg-accent/50">
                <span className="w-24 shrink-0 tabular-nums">{a.other.date ? fullDate(a.other.date) : ''}</span>
                <span className={cn('min-w-0 flex-1 truncate', voided && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
                  Payment #{a.other.number}{a.other.paymentMethod ? ` · ${a.other.paymentMethod}` : ''}{a.other.reference ? ` ${a.other.paymentMethod === 'Check' ? '#' : ''}${a.other.reference}` : ''}
                </span>
                {voided && <Pill tone="neutral">Void</Pill>}
                <Money value={a.amount} className={cn('shrink-0 font-medium', voided && 'text-muted-foreground line-through')} />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">{t.status === 'Void' ? 'This bill was voided before it was paid.' : 'No payments yet.'}</p>
      )}

      <SectionHeading className="mt-8">Invoice</SectionHeading>
      {t.attachmentUrl ? (
        <a href={t.attachmentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[14px] hover:bg-accent/50">
          <FileText className="h-4 w-4 text-muted-foreground" /> <span className="truncate">{fileNameFromUrl(t.attachmentUrl)}</span>
        </a>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">No invoice attached.</p>
      )}

      {t.notes && (
        <>
          <SectionHeading className="mt-8">Note</SectionHeading>
          <p className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-[14px]">{t.notes}</p>
        </>
      )}
      {data.reconciled && <p className="mt-6 flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="h-3 w-3" /> Part of a completed bank reconciliation.</p>}

      <VoidDialog target={voidTarget} onOpenChange={o => !o && setVoidTarget(null)} onVoided={() => void refetch()} />
      <PayBillsDialog billIds={pay} onOpenChange={o => !o && setPay(null)} />
      <TransactionSheet id={sheet} onClose={() => setSheet(null)} />
    </DetailLayout>
  );
}
