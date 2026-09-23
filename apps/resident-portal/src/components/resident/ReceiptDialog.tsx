import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Download, Undo2 } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { getPaymentReceipt } from 'zitejs/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { errorMessage } from '../../lib/errors';
import { formatMoney, longDate } from '../../lib/format';
import { useReturnFocus } from '../../lib/residentFocus';
import { useReceipt } from '../../lib/residentQueries';
import { Button, Skeleton } from '../ui';

/** A payment receipt: the amount, how it was paid, what it paid for — and a PDF to keep. */
export function ReceiptDialog({ leaseId, transactionId, onOpenChange }: { leaseId: string | null; transactionId: string | null; onOpenChange: (open: boolean) => void }) {
  const q = useReceipt(leaseId, transactionId);
  useReturnFocus(Boolean(transactionId));
  // The tab opens on the click itself, so a popup blocker doesn't eat it while the PDF renders.
  const pdfWindow = useRef<Window | null>(null);
  const pdf = useMutation({
    mutationFn: () => getPaymentReceipt({ leaseId, transactionId: transactionId!, pdf: true }),
    onSuccess: res => {
      const win = pdfWindow.current;
      pdfWindow.current = null;
      if (!res.pdfUrl) {
        win?.close();
        toast.error("The PDF didn't generate. Try again.");
        return;
      }
      if (win && !win.closed) win.location.href = res.pdfUrl;
      else window.location.assign(res.pdfUrl);
    },
    onError: e => {
      pdfWindow.current?.close();
      pdfWindow.current = null;
      toast.error(errorMessage(e, "The PDF didn't generate. Try again."));
    },
  });
  const downloadPdf = () => {
    const win = window.open('', '_blank');
    if (win) {
      win.opener = null;
      win.document.title = 'Preparing your receipt…';
      win.document.body.innerHTML = '<p style="font:15px system-ui;padding:24px;color:#555">Preparing your receipt…</p>';
    }
    pdfWindow.current = win;
    pdf.mutate();
  };
  const r = q.data?.receipt;
  const m = (n: number) => formatMoney(n, r?.currency ?? 'USD');

  return (
    <Dialog open={Boolean(transactionId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-lg gap-0 overflow-y-auto rounded-2xl p-0">
        <div className="border-b px-5 pb-5 pt-6 sm:px-6">
          <DialogTitle className="text-sm font-medium text-muted-foreground">{r ? `Receipt #${r.number}` : 'Receipt'}</DialogTitle>
          <DialogDescription className="sr-only">Details of your payment and what it paid for</DialogDescription>
          {q.isPending ? (
            <>
              <Skeleton className="mt-2 h-10 w-40" />
              <Skeleton className="mt-2 h-5 w-56" />
            </>
          ) : q.isError || !r ? (
            <div className="mt-2">
              <p className="text-[15px]">{errorMessage(q.error, "This receipt didn't load.")}</p>
              <Button variant="secondary" className="mt-3" onClick={() => q.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{m(r.amount)}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[15px] text-muted-foreground">
                {r.reversed ? (
                  <>
                    <Undo2 className="h-4 w-4 text-tone-danger" aria-hidden /> Reversed{r.reversedOn ? ` on ${longDate(r.reversedOn)}` : ''} — this payment no longer counts toward your balance
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-tone-success" aria-hidden /> Received {longDate(r.date)}
                  </>
                )}
              </p>
            </>
          )}
        </div>
        {r && (
          <div className="px-5 py-5 sm:px-6">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
              <div>
                <dt className="text-sm text-muted-foreground">Paid by</dt>
                <dd className="font-medium">{r.payerName}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Method</dt>
                <dd className="font-medium">{r.method}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-sm text-muted-foreground">Home</dt>
                <dd className="font-medium">{r.address || r.home}</dd>
              </div>
            </dl>
            <h3 className="mt-6 text-sm font-medium text-muted-foreground">What this payment paid</h3>
            <ul className="mt-2 divide-y rounded-lg border">
              {r.applied.map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[15px]">
                  <span className="min-w-0 break-words">{a.description}</span>
                  <span className="shrink-0 tabular-nums">{m(a.amount)}</span>
                </li>
              ))}
              {r.unapplied > 0 && (
                <li className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[15px]">
                  <span className="min-w-0">
                    Credit on your account
                    <span className="block text-sm text-muted-foreground">Goes toward your next charges</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{m(r.unapplied)}</span>
                </li>
              )}
              {r.applied.length === 0 && r.unapplied === 0 && <li className="px-3.5 py-2.5 text-[15px] text-muted-foreground">Nothing — this payment was reversed.</li>}
            </ul>
            {r.balanceAfter != null && !r.reversed && (
              <p className="mt-3 text-sm text-muted-foreground">
                Balance after this payment: <span className="font-medium text-foreground tabular-nums">{r.balanceAfter < 0 ? `${m(-r.balanceAfter)} credit` : m(r.balanceAfter)}</span>
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ink" onClick={downloadPdf} loading={pdf.isPending}>
                {!pdf.isPending && <Download aria-hidden />} Download PDF
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
