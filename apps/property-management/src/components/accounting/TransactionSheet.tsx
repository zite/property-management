import { ArrowLeft, Ban, CheckCircle2, ExternalLink, FileText, Link2, Lock, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PropertySwatch } from '../primitives/glyphs';
import { TXN_LABEL, useTransaction, voidCapability, type TransactionDetail } from './accountingData';
import { VoidDialog, type VoidTarget } from './LedgerDialogs';
import { fileNameFromUrl } from './parts';

/**
 * Any transaction in a side sheet: what it was, its journal lines (debits
 * equal credits, always), what it paid or what paid it, and void. Links in the
 * allocations open the other transaction in the same sheet, with a back step.
 */
export function TransactionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [stack, setStack] = useState<string[]>([]);
  const current = stack[stack.length - 1] ?? id;
  const open = Boolean(id);
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) { setStack([]); onClose(); } }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px] [&>button:first-of-type]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
        {current && (
          <SheetBody
            key={current}
            id={current}
            canGoBack={stack.length > 0}
            onBack={() => setStack(s => s.slice(0, -1))}
            onOpenOther={other => setStack(s => [...s, other])}
            onClose={() => { setStack([]); onClose(); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ id, canGoBack, onBack, onOpenOther, onClose }: { id: string; canGoBack: boolean; onBack: () => void; onOpenOther: (id: string) => void; onClose: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useTransaction(id);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const t = data?.transaction;
  const label = t ? TXN_LABEL[t.kind] ?? t.kind : 'Transaction';
  const go = (to: string) => { onClose(); navigate(to); };

  return (
    <>
      <SheetTitle className="sr-only">{t ? `${label} #${t.number}` : 'Transaction'}</SheetTitle>
      <SheetDescription className="sr-only">Transaction details and journal lines</SheetDescription>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {canGoBack && (
          <Tip label="Back">
            <IconButton aria-label="Back" onClick={onBack}><ArrowLeft /></IconButton>
          </Tip>
        )}
        {t && (
          <>
            <span className="text-[14px] font-medium">{label}</span>
            <span className="text-[14px] tabular-nums text-muted-foreground">#{t.number}</span>
            {t.status === 'Void' && <Pill tone="neutral">Void</Pill>}
            {data?.reconciled && <Pill tone="success"><Lock className="h-3 w-3" /> Reconciled</Pill>}
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {t?.kind === 'Bill' && (
            <Tip label="Open bill page">
              <IconButton aria-label="Open bill page" onClick={() => go(`/accounting/payables/${t.id}`)}><ExternalLink /></IconButton>
            </Tip>
          )}
          <Tip label="Copy link">
            <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(t?.kind === 'Bill' ? `/accounting/payables/${id}` : `/accounting/transactions/${id}`), 'Link copied')}><Link2 /></IconButton>
          </Tip>
          <Tip label="Close" keys={['Esc']}>
            <IconButton aria-label="Close" onClick={onClose}><X /></IconButton>
          </Tip>
        </div>
      </div>

      {isPending ? (
        <SkeletonRows rows={9} className="p-4" />
      ) : isError || !data || !t ? (
        <EmptyState className="flex-1" title="This transaction didn’t load" description={errorMessage(error, 'It may have been removed.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-16 pt-5">
          <TransactionDetailContent data={data} onOpenOther={onOpenOther} go={go} onVoid={() => setVoidTarget({ id: t.id, number: t.number, kind: label, amount: t.amount, description: t.description })} />
        </div>
      )}
      <VoidDialog target={voidTarget} onOpenChange={o => !o && setVoidTarget(null)} onVoided={() => void refetch()} />
    </>
  );
}

/** The body of a transaction's detail — shared by the side sheet and the payables page for payments and expenses. */
export function TransactionDetailContent({ data, onOpenOther, go, onVoid }: { data: TransactionDetail; onOpenOther: (id: string) => void; go: (to: string) => void; onVoid: () => void }) {
  const ws = useWorkspace();
  const t = data.transaction;
  const label = TXN_LABEL[t.kind] ?? t.kind;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={cn('break-words text-[16px] font-semibold leading-snug', t.status === 'Void' && 'text-muted-foreground line-through decoration-muted-foreground/60')}>{t.description || label}</h2>
          <p className="mt-0.5 text-[14px] text-muted-foreground">{fullDate(t.date)}{t.dueDate && t.dueDate !== t.date ? ` · due ${fullDate(t.dueDate)}` : ''}</p>
        </div>
        <Money value={t.amount} className="text-[20px] font-semibold tracking-tight" />
      </div>

      {t.status === 'Void' && (
        <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-[14px]">
          Voided{t.voidedByName ? ` by ${t.voidedByName}` : ''}{t.voidedAt ? ` on ${dateTime(t.voidedAt)}` : ''}. <span className="text-muted-foreground">{t.voidReason}</span>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[14px] sm:grid-cols-3">
        {t.propertyId && <Fact label="Property"><span className="inline-flex min-w-0 items-center gap-1.5"><PropertySwatch color={ws.propertyById.get(t.propertyId)?.color} /><span className="truncate">{ws.unitLabel(t.unitId, t.propertyId)}</span></span></Fact>}
        {t.leaseId && <Fact label="Lease"><button type="button" className="truncate text-left hover:underline" onClick={() => go(`/leases/${t.leaseId}/ledger`)}>{t.leaseName ?? 'Lease'}</button></Fact>}
        {t.tenantName && <Fact label="Resident">{t.tenantName}</Fact>}
        {t.vendorId && <Fact label="Vendor"><button type="button" className="truncate text-left hover:underline" onClick={() => go(`/vendors/${t.vendorId}`)}>{t.vendorName ?? 'Vendor'}</button></Fact>}
        {t.ownerId && <Fact label="Owner"><button type="button" className="truncate text-left hover:underline" onClick={() => go(`/owners/${t.ownerId}`)}>{t.ownerName ?? 'Owner'}</button></Fact>}
        {t.workOrderNumber != null && <Fact label="Work order"><button type="button" className="truncate text-left hover:underline" onClick={() => go(`/work-orders/${t.workOrderNumber}`)}>{workOrderRef(t.workOrderNumber)}{t.workOrderTitle ? ` · ${t.workOrderTitle}` : ''}</button></Fact>}
        {t.paymentMethod && <Fact label="Method">{t.paymentMethod}</Fact>}
        {t.reference && <Fact label={t.paymentMethod === 'Check' ? 'Check #' : 'Reference'}>{t.reference}</Fact>}
        {t.bankAccountId && <Fact label="Bank">{ws.accountById.get(t.bankAccountId)?.name ?? '—'}</Fact>}
        {t.period && <Fact label="Period">{t.period}</Fact>}
        {t.source && t.source !== 'Manual' && <Fact label="Source">{t.source}</Fact>}
        <Fact label="Entered" wide>{t.createdByName ? `${t.createdByName} · ` : ''}{t.createdAt ? dateTime(t.createdAt) : '—'}</Fact>
      </dl>

      {t.attachmentUrl && (
        <a href={t.attachmentUrl} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-[14px] hover:bg-accent/50">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{fileNameFromUrl(t.attachmentUrl)}</span>
        </a>
      )}
      {t.notes && <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-[14px]">{t.notes}</p>}

      <h3 className="mb-2 mt-6 text-[14px] font-medium">Journal lines</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-0 text-[14px]">
          <thead>
            <tr className="text-sm text-muted-foreground">
              <th className="h-9 border-b bg-subtle/80 px-3 text-left font-medium">Account</th>
              <th className="h-9 w-[30%] border-b bg-subtle/80 px-3 text-left font-medium">For</th>
              <th className="h-9 w-28 border-b bg-subtle/80 px-3 text-right font-medium">Debit</th>
              <th className="h-9 w-28 border-b bg-subtle/80 px-3 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map(l => (
              <tr key={l.id} className={cn(l.void && 'text-muted-foreground')}>
                <td className="border-b border-border/60 px-3 py-2 align-top">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="num shrink-0 text-sm text-muted-foreground">{l.accountNumber}</span>
                    <span className="min-w-0 truncate" title={l.accountName}>{l.accountName}</span>
                    {l.reconciled && <Tip label={`Cleared ${l.clearedAt ? fullDate(l.clearedAt) : ''}`}><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-tone-success" /></Tip>}
                  </span>
                  {l.memo && l.memo !== t.description && <span className="block truncate text-sm text-muted-foreground">{l.memo}</span>}
                </td>
                <td className="border-b border-border/60 px-3 py-2 align-top text-muted-foreground">
                  <span className="block truncate">{[l.leaseName, l.propertyId && !l.leaseName ? ws.unitLabel(l.unitId, l.propertyId) : null, l.vendorId !== t.vendorId ? l.vendorName : null, l.ownerId !== t.ownerId ? l.ownerName : null].filter(Boolean).join(' · ') || '—'}</span>
                </td>
                <td className="num border-b border-border/60 px-3 py-2 text-right align-top">{l.debit ? <Money value={l.debit} /> : null}</td>
                <td className="num border-b border-border/60 px-3 py-2 text-right align-top">{l.credit ? <Money value={l.credit} /> : null}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="h-9 bg-subtle/60 px-3" colSpan={2}>
                {Math.round(data.totals.debit * 100) === Math.round(data.totals.credit * 100) ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-tone-success"><CheckCircle2 className="h-3.5 w-3.5" /> Debits equal credits</span>
                ) : (
                  <span className="text-sm text-tone-danger">Out of balance — the ledger needs a review</span>
                )}
              </td>
              <td className="num h-9 bg-subtle/60 px-3 text-right"><Money value={data.totals.debit} /></td>
              <td className="num h-9 bg-subtle/60 px-3 text-right"><Money value={data.totals.credit} /></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.allocations.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-[14px] font-medium">{data.allocations[0].direction === 'paid' ? 'Applied to' : 'Paid by'}</h3>
          <div className="overflow-hidden rounded-lg border">
            {data.allocations.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpenOther(a.other.id)}
                className={cn('flex w-full items-center gap-3 border-b px-3 py-2 text-left text-[14px] last:border-b-0 hover:bg-accent/50', (a.void || a.other.status === 'Void') && 'text-muted-foreground line-through decoration-muted-foreground/50')}
              >
                <span className="w-24 shrink-0 text-sm text-muted-foreground">{TXN_LABEL[a.other.kind] ?? a.other.kind} #{a.other.number}</span>
                <span className="min-w-0 flex-1 truncate">{a.other.description}{a.other.reference ? ` · ${a.other.reference}` : ''}</span>
                <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{a.date ? fullDate(a.date) : ''}</span>
                <Money value={a.amount} className="shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}

      {t.status === 'Posted' && ws.can(voidCapability(t.kind)) && (
        <div className="mt-8 flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">{data.reconciled ? 'Part of a completed bank reconciliation — undo it before voiding.' : 'Voiding keeps the entry on every ledger, struck through, and removes it from balances.'}</p>
          <button type="button" onClick={onVoid} className="ghost-chip h-9 shrink-0 gap-1.5 text-tone-danger">
            <Ban className="h-3.5 w-3.5" /> Void…
          </button>
        </div>
      )}
    </>
  );
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 truncate">{children}</dd>
    </div>
  );
}
