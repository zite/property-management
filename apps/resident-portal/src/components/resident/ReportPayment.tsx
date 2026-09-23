import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { notifyOfficePaid } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { formatMoney, longDate } from '../../lib/format';
import { useRefreshResident } from '../../lib/residentQueries';
import { Button, FieldRow, inputClass, LinkButton, textareaClass } from '../ui';

/**
 * "Tell us you've paid": for a check in the drop box or a transfer from the
 * resident's bank. It messages the office; it doesn't mark anything paid —
 * the payment shows up once staff record it.
 */

const METHODS = [
  { value: 'Check', label: 'Check' },
  { value: 'Money order', label: 'Money order' },
  { value: 'ACH', label: 'Bank transfer' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Card', label: 'Card (by phone or in person)' },
  { value: 'Other', label: 'Something else' },
] as const;

type Method = (typeof METHODS)[number]['value'];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ReportPayment({ leaseId, currency, suggested, onCancel }: { leaseId: string; currency: string; suggested: number; onCancel?: () => void }) {
  const id = useId();
  const refresh = useRefreshResident();
  const [amount, setAmount] = useState(suggested > 0 ? suggested.toFixed(2) : '');
  const [method, setMethod] = useState<Method>('Check');
  const [date, setDate] = useState(localToday());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const send = useMutation({
    mutationFn: () => notifyOfficePaid({ leaseId, amount: Number(amount.replace(/[^\d.]/g, '')), method, date, reference: reference.trim(), note: note.trim() }),
    onSuccess: () => void refresh(),
  });

  if (send.isSuccess) {
    return (
      <div className="rounded-xl border border-tone-success/25 bg-tone-success/[0.05] p-5" role="status">
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-tone-success" aria-hidden />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Thanks — we’ve let the office know</p>
            <p className="mt-1 text-[15px] text-foreground/80">
              You told us you paid {formatMoney(send.data.amount, currency)} by {METHODS.find(x => x.value === method)?.label.toLowerCase()} on {longDate(date)}. It will show in your payments once the office records it, usually within two business days.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton to="/resident/messages" variant="secondary" size="sm">
                View in messages
              </LinkButton>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  send.reset();
                  setReference('');
                  setNote('');
                }}
              >
                Report another payment
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const submit = () => {
    const next: Record<string, string> = {};
    const value = Number(amount.replace(/[^\d.]/g, ''));
    if (!(value >= 1)) next.amount = 'Enter the amount you paid.';
    if (!date) next.date = 'Choose the date you paid.';
    else if (date > localToday()) next.date = "The date can't be in the future.";
    setErrors(next);
    if (Object.keys(next).length) return;
    send.mutate();
  };

  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow id={`${id}-amount`} label="Amount" error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              aria-invalid={Boolean(errors.amount) || undefined}
              className={inputClass('pl-7 tabular-nums')}
              placeholder="0.00"
            />
          </div>
        </FieldRow>
        <FieldRow id={`${id}-method`} label="How you paid">
          <select id={`${id}-method`} value={method} onChange={e => setMethod(e.target.value as Method)} className={inputClass()}>
            {METHODS.map(x => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow id={`${id}-date`} label="Date paid" error={errors.date}>
          <input id={`${id}-date`} type="date" value={date} max={localToday()} onChange={e => setDate(e.target.value)} aria-invalid={Boolean(errors.date) || undefined} className={inputClass()} />
        </FieldRow>
        <FieldRow id={`${id}-ref`} label={method === 'Check' ? 'Check number' : 'Confirmation number'} optional>
          <input id={`${id}-ref`} value={reference} onChange={e => setReference(e.target.value)} maxLength={80} className={inputClass()} placeholder={method === 'Check' ? 'e.g. 1042' : ''} />
        </FieldRow>
      </div>
      <FieldRow id={`${id}-note`} label="Anything the office should know" optional>
        <textarea id={`${id}-note`} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className={textareaClass('min-h-[80px]')} placeholder="For example, it's in the drop box, or it covers two months." />
      </FieldRow>
      {send.isError && (
        <p role="alert" className="rounded-lg bg-tone-danger/[0.07] px-3 py-2 text-sm text-tone-danger">
          {errorMessage(send.error, "That didn't send. Try again.")}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={send.isPending}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="ink" loading={send.isPending}>
          {!send.isPending && <Send aria-hidden />} Tell the office
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">This sends the office a message. It doesn’t mark anything as paid until they receive your payment.</p>
    </form>
  );
}
