import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, PauseCircle, Play } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { submitVendorInvoice } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { errorMessage } from '../../lib/errors';
import { qk } from '../../lib/queries';
import { ConfirmDialog } from '../ConfirmDialog';
import { Button, FieldRow, inputClass, textareaClass, type ButtonSize } from '../ui';
import { vendorKeys, useVendorUpdate, type VendorRow, type VendorWorkOrderDetail } from './data';
import { FilePickerField, useFilePicks } from './files';
import { useReturnFocus } from '../owner/useReturnFocus';

/**
 * What a vendor can do to a job, as buttons and the dialogs behind them.
 * The list rows and the job page use the same component, so the rules
 * (what's allowed in which status) live in one place on the client — and the
 * server enforces them again.
 */

type Job = Pick<VendorRow, 'number' | 'ref' | 'title' | 'status' | 'open' | 'scheduledFor' | 'awaitingApproval' | 'address'>;

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function canDo(job: Job) {
  const blocked = job.awaitingApproval;
  return {
    schedule: job.open && !blocked,
    start: !blocked && (job.status === 'New' || job.status === 'Scheduled' || job.status === 'On hold'),
    complete: job.open && !blocked,
    hold: job.status === 'New' || job.status === 'Scheduled' || job.status === 'In progress',
  };
}

export function JobActions({ job, size = 'md', layout = 'row', only }: { job: Job; size?: ButtonSize; layout?: 'row' | 'stack'; only?: Array<'schedule' | 'start' | 'complete' | 'hold'> }) {
  const update = useVendorUpdate();
  const [dialog, setDialog] = useState<'schedule' | 'complete' | 'hold' | null>(null);
  const can = canDo(job);
  const show = (k: 'schedule' | 'start' | 'complete' | 'hold') => can[k] && (!only || only.includes(k));
  const pending = update.isPending;
  const buttons: ReactNode[] = [];

  if (show('start')) {
    buttons.push(
      <Button key="start" size={size} variant={job.status === 'Scheduled' ? 'primary' : 'secondary'} disabled={pending} onClick={() => update.mutate({ action: 'start', number: job.number })}>
        <Play aria-hidden /> Start work
      </Button>,
    );
  }
  if (show('complete')) {
    buttons.push(
      <Button key="complete" size={size} variant={job.status === 'In progress' ? 'primary' : 'secondary'} disabled={pending} onClick={() => setDialog('complete')}>
        <CheckCircle2 aria-hidden /> Complete
      </Button>,
    );
  }
  if (show('schedule')) {
    buttons.push(
      <Button key="schedule" size={size} variant={job.status === 'New' && !job.scheduledFor ? 'primary' : 'secondary'} disabled={pending} onClick={() => setDialog('schedule')}>
        <CalendarClock aria-hidden /> {job.scheduledFor ? 'Reschedule' : 'Schedule'}
      </Button>,
    );
  }
  if (show('hold')) {
    buttons.push(
      <Button key="hold" size={size} variant="ghost" disabled={pending} onClick={() => setDialog('hold')}>
        <PauseCircle aria-hidden /> Put on hold
      </Button>,
    );
  }

  return (
    <>
      {buttons.length > 0 && <div className={cn('flex gap-2', layout === 'stack' ? 'flex-col [&>button]:w-full' : 'flex-wrap')}>{buttons}</div>}
      <ScheduleDialog job={job} open={dialog === 'schedule'} onOpenChange={o => !o && setDialog(null)} update={update} />
      <CompleteDialog job={job} open={dialog === 'complete'} onOpenChange={o => !o && setDialog(null)} update={update} />
      <ConfirmDialog
        open={dialog === 'hold'}
        onOpenChange={o => !o && setDialog(null)}
        title={`Put ${job.ref} on hold?`}
        description="The office will see your reason right away and can reply in the job’s messages. You can pick the job back up by scheduling or starting it."
        confirmLabel="Put on hold"
        pending={pending}
        note={{ label: 'Why is the job on hold?', placeholder: 'For example: waiting on a part, arriving Thursday', required: true, requiredMessage: 'Say why the job is on hold so the office can plan around it.' }}
        onConfirm={reason => update.mutate({ action: 'hold', number: job.number, reason }, { onSuccess: () => setDialog(null) })}
      />
    </>
  );
}

type Update = ReturnType<typeof useVendorUpdate>;

function ScheduleDialog({ job, open, onOpenChange, update }: { job: Job; open: boolean; onOpenChange: (o: boolean) => void; update: Update }) {
  const dateId = useId();
  const timeId = useId();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [problem, setProblem] = useState<string | null>(null);
  const returnFocus = useReturnFocus(open);

  useEffect(() => {
    if (!open) return;
    const existing = job.scheduledFor ? new Date(job.scheduledFor) : null;
    const base = existing && existing.getTime() > Date.now() ? existing : new Date(Date.now() + 86400_000);
    setDate(localDate(base));
    setTime(existing && existing.getTime() > Date.now() ? `${pad(existing.getHours())}:${pad(existing.getMinutes())}` : '09:00');
    setProblem(null);
  }, [open, job.scheduledFor]);

  const submit = () => {
    if (!date || !time) {
      setProblem('Choose a date and a time.');
      return;
    }
    const when = new Date(`${date}T${time}`);
    if (Number.isNaN(when.getTime())) {
      setProblem('Choose a valid date and time.');
      return;
    }
    if (when.getTime() < Date.now() - 60 * 60_000) {
      setProblem('That time has already passed.');
      return;
    }
    update.mutate({ action: 'schedule', number: job.number, scheduledFor: when.toISOString() }, { onSuccess: () => onOpenChange(false), onError: e => setProblem(errorMessage(e, 'That time didn’t save. Try again.')) });
  };
  const tz = (() => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  })();

  return (
    <Dialog open={open} onOpenChange={o => !update.isPending && onOpenChange(o)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md gap-0 rounded-xl p-6" onCloseAutoFocus={returnFocus}>
        <DialogTitle className="pr-6 text-lg font-semibold">{job.scheduledFor ? `Reschedule ${job.ref}` : `Schedule ${job.ref}`}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[15px] text-muted-foreground">
          {job.title}. If there’s a resident, they’ll get an email with the time.
        </DialogDescription>
        <form
          className="mt-5 space-y-4"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-3">
            <FieldRow id={dateId} label="Date">
              <input id={dateId} type="date" required value={date} min={localDate(new Date())} onChange={e => setDate(e.target.value)} className={inputClass()} />
            </FieldRow>
            <FieldRow id={timeId} label={`Time${tz ? ` (${tz})` : ''}`}>
              <input id={timeId} type="time" required step={900} value={time} onChange={e => setTime(e.target.value)} className={inputClass()} />
            </FieldRow>
          </div>
          {problem && (
            <p role="alert" className="rounded-lg bg-tone-danger/[0.07] px-3 py-2 text-sm text-tone-danger">
              {problem}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              {job.scheduledFor ? 'Save new time' : 'Schedule visit'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ job, open, onOpenChange, update }: { job: Job; open: boolean; onOpenChange: (o: boolean) => void; update: Update }) {
  const notesId = useId();
  const costId = useId();
  const photosId = useId();
  const [notes, setNotes] = useState('');
  const [cost, setCost] = useState('');
  const [errors, setErrors] = useState<{ notes?: string; cost?: string; form?: string }>({});
  const photos = useFilePicks(8);
  const returnFocus = useReturnFocus(open);

  useEffect(() => {
    if (open) {
      setNotes('');
      setCost('');
      setErrors({});
      photos.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    const amount = Number(cost.replace(/[$,\s]/g, ''));
    const next: typeof errors = {};
    if (!notes.trim()) next.notes = 'Describe the work you did.';
    if (cost.trim() === '' || !Number.isFinite(amount) || amount < 0) next.cost = 'Enter the total cost, or 0 if there’s no charge.';
    else if (amount > 1_000_000) next.cost = 'That cost looks too large. Check the amount.';
    if (photos.uploading) next.form = 'Wait for the photos to finish uploading.';
    setErrors(next);
    if (Object.keys(next).length) return;
    update.mutate(
      { action: 'complete', number: job.number, notes: notes.trim(), actualCost: Math.round(amount * 100) / 100, photos: photos.done.map(p => ({ url: p.url!, name: p.name })) },
      { onSuccess: () => onOpenChange(false), onError: e => setErrors({ form: errorMessage(e, 'That didn’t save. Try again.') }) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={o => !update.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-lg gap-0 overflow-y-auto rounded-xl p-6" onCloseAutoFocus={returnFocus}>
        <DialogTitle className="pr-6 text-lg font-semibold">Complete {job.ref}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[15px] text-muted-foreground">{job.title}. The office and the resident will be told the work is done.</DialogDescription>
        <form
          className="mt-5 space-y-4"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <FieldRow id={notesId} label="What did you do?" error={errors.notes}>
            <textarea
              id={notesId}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={4000}
              placeholder="For example: replaced the wax ring and supply line, tested for leaks, dried the ceiling"
              aria-invalid={Boolean(errors.notes) || undefined}
              className={textareaClass('min-h-[104px]')}
            />
          </FieldRow>
          <FieldRow id={costId} label="Total cost" hint="Parts and labor, as you’ll invoice it." error={errors.cost}>
            <div className="relative max-w-[200px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <input id={costId} inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.cost) || undefined} className={inputClass('pl-7 tabular-nums')} />
            </div>
          </FieldRow>
          <FieldRow id={photosId} label="Photos of the finished work" optional>
            <FilePickerField picks={photos} id={photosId} accept="image/*" max={8} label="Add photos" hint="Up to 8 · JPG, PNG or HEIC" />
          </FieldRow>
          {errors.form && (
            <p role="alert" className="rounded-lg bg-tone-danger/[0.07] px-3 py-2 text-sm text-tone-danger">
              {errors.form}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending} disabled={photos.uploading}>
              Mark complete
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Send an invoice for a job: the file, invoice number and amount. It goes to the office for payment. */
export function InvoiceDialog({ job, open, onOpenChange }: { job: Pick<VendorRow, 'number' | 'ref' | 'title' | 'actualCost'>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const numberId = useId();
  const amountId = useId();
  const notesId = useId();
  const fileId = useId();
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<{ number?: string; amount?: string; file?: string; form?: string }>({});
  const file = useFilePicks(1);
  const returnFocus = useReturnFocus(open);

  useEffect(() => {
    if (open) {
      setInvoiceNumber('');
      setAmount(job.actualCost != null ? job.actualCost.toFixed(2) : '');
      setNotes('');
      setErrors({});
      file.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = useMutation({
    mutationFn: submitVendorInvoice,
    onSuccess: doc => {
      qc.setQueryData<VendorWorkOrderDetail>(vendorKeys.workOrder(job.number), old => (old ? { ...old, invoices: [doc, ...old.invoices] } : old));
      qc.invalidateQueries({ queryKey: vendorKeys.workOrder(job.number) });
      qc.invalidateQueries({ queryKey: qk.vendor });
      toast.success(`Invoice sent for ${job.ref}. The office will enter it for payment.`);
      onOpenChange(false);
    },
    onError: e => setErrors({ form: errorMessage(e, 'Your invoice didn’t send. Try again.') }),
  });

  const submit = () => {
    const value = Number(amount.replace(/[$,\s]/g, ''));
    const next: typeof errors = {};
    if (!invoiceNumber.trim()) next.number = 'Enter your invoice number.';
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) next.amount = 'Enter the invoice total.';
    const f = file.items[0];
    if (!f) next.file = 'Attach the invoice as a PDF or photo.';
    else if (f.status === 'uploading') next.file = 'Wait for the file to finish uploading.';
    else if (f.status === 'error') next.file = 'The file didn’t upload. Retry or choose it again.';
    setErrors(next);
    if (Object.keys(next).length || !f?.url) return;
    send.mutate({ number: job.number, invoiceNumber: invoiceNumber.trim(), amount: Math.round(value * 100) / 100, notes: notes.trim() || null, file: { url: f.url, name: f.name, size: f.size, type: f.type || null } });
  };

  return (
    <Dialog open={open} onOpenChange={o => !send.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] max-w-lg gap-0 overflow-y-auto rounded-xl p-6" onCloseAutoFocus={returnFocus}>
        <DialogTitle className="pr-6 text-lg font-semibold">Send an invoice for {job.ref}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[15px] text-muted-foreground">It goes to the office’s accounts payable team, who enter it for payment.</DialogDescription>
        <form
          className="mt-5 space-y-4"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <FieldRow id={fileId} label="Invoice" error={errors.file}>
            <FilePickerField picks={file} id={fileId} accept="application/pdf,image/*" max={1} label="Choose a PDF or photo" hint="Up to 20 MB" invalid={Boolean(errors.file)} />
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id={numberId} label="Invoice number" error={errors.number}>
              <input id={numberId} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} maxLength={60} placeholder="INV-2291" aria-invalid={Boolean(errors.number) || undefined} className={inputClass()} />
            </FieldRow>
            <FieldRow id={amountId} label="Total" error={errors.amount}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input id={amountId} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.amount) || undefined} className={inputClass('pl-7 tabular-nums')} />
              </div>
            </FieldRow>
          </div>
          <FieldRow id={notesId} label="Notes for the office" optional>
            <textarea id={notesId} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} placeholder="Payment terms, parts on order, anything they should know" className={textareaClass('min-h-[80px]')} />
          </FieldRow>
          {errors.form && (
            <p role="alert" className="rounded-lg bg-tone-danger/[0.07] px-3 py-2 text-sm text-tone-danger">
              {errors.form}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={send.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={send.isPending} disabled={file.uploading}>
              Send invoice
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
