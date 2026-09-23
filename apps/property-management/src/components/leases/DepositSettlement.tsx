import { useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Printer, Receipt, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { settleDeposit } from 'zitejs/api';
import { PAYMENT_METHODS, type PaymentMethod } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { subMoney, sumMoney } from '@project/shared/money';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, ChoicePicker, FieldButton } from '../pickers/pickers';
import { IconButton, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { afterLeaseChange, type LeaseDetail } from './data';
import { printElement } from './print';

type Row = { key: number; description: string; accountId: string | null; amount: number | null };

const PRESETS = [
  { description: 'Move-out cleaning', key: 'damage_income', amount: 175 },
  { description: 'Carpet cleaning', key: 'damage_income', amount: 150 },
  { description: 'Patch and paint walls', key: 'damage_income', amount: 120 },
  { description: 'Lock and key replacement', key: 'other_income', amount: 85 },
  { description: 'Unpaid utilities', key: 'utility_income', amount: 65 },
] as const;

/**
 * Settle the security deposit: itemized deductions, the deposit applied to
 * what's owed, and the rest refunded — with the result shown before anything
 * posts. The statement is filed on the lease and sent to the residents.
 */
export function SettlementDialog({ detail, open, onOpenChange }: { detail: LeaseDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const l = detail.lease;
  const nextKey = useRef(1);
  const [date, setDate] = useState<string | null>(ws.today);
  const [rows, setRows] = useState<Row[]>([]);
  const [apply, setApply] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('Check');
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [send, setSend] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(ws.today);
    setRows([]);
    setApply(true);
    setMethod('Check');
    setReference('');
    setBankAccountId(null);
    setSend(true);
    setNote('');
    setError(null);
  }, [open]);

  const addRow = (preset?: (typeof PRESETS)[number]) => {
    const key = nextKey.current++;
    setRows(r => [...r, { key, description: preset?.description ?? '', accountId: ws.accountByKey.get(preset?.key ?? 'damage_income')?.id ?? null, amount: preset?.amount ?? null }]);
    window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-deduction="${key}"]`)?.focus(), 0);
  };
  const setRow = (key: number, patch: Partial<Row>) => setRows(r => r.map(x => (x.key === key ? { ...x, ...patch } : x)));

  const newDeductions = sumMoney(rows.map(r => r.amount ?? 0));
  const held = detail.depositHeld;
  const owed = sumMoney([detail.balance, newDeductions]);
  const applied = apply ? Math.max(0, Math.min(owed, held)) : 0;
  const refund = subMoney(held, applied);
  const stillOwed = subMoney(owed, applied);
  const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
  const bank = bankAccountId ? ws.accountById.get(bankAccountId) : property?.bankAccountId ? ws.accountById.get(property.bankAccountId) : ws.accountByKey.get('operating_bank');

  const submit = async () => {
    setError(null);
    if (!date) return setError('Choose the settlement date.');
    const bad = rows.find(r => !r.description.trim() || !r.accountId || !r.amount || r.amount <= 0);
    if (bad) return setError('Each deduction needs a description, an account and an amount.');
    setPending(true);
    try {
      const res = await settleDeposit({
        leaseId: l.id,
        date,
        deductions: rows.map(r => ({ description: r.description.trim(), accountId: r.accountId!, amount: r.amount! })),
        applyToBalance: apply,
        refund: refund > 0.004 ? { paymentMethod: method, reference: reference.trim() || undefined, bankAccountId: bankAccountId ?? undefined } : null,
        sendStatement: send,
        note: note.trim() || undefined,
      });
      afterLeaseChange(qc, { money: true });
      toast.success('Deposit settled', {
        description: [res.refunded > 0 ? `Refunded ${ws.money(res.refunded)}` : 'Nothing to refund', res.balance > 0.004 ? `${ws.money(res.balance)} still owed` : null, send ? `statement sent to ${res.sent} ${res.sent === 1 ? 'resident' : 'residents'}` : null].filter(Boolean).join(' · '),
        action: res.documentUrl ? { label: 'Open statement', onClick: () => window.open(res.documentUrl!, '_blank', 'noopener') } : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t settle the deposit'));
      afterLeaseChange(qc, { money: true });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Settle the security deposit" description={`${ws.unitLabel(l.unitId, l.propertyId)} · ${l.moveOutDate ? `moved out ${fullDate(l.moveOutDate)}` : 'moving out'}`} onSubmit={submit} pending={pending} submitLabel={refund > 0.004 ? `Settle and refund ${ws.money(refund)}` : 'Settle deposit'} size="lg">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-[14px] sm:grid-cols-3">
          <Stat label="Deposit held"><Money value={held} /></Stat>
          <Stat label="Balance now"><Money value={detail.balance} tone="balance" /></Stat>
          <Stat label="Required by the lease" className="hidden sm:block"><Money value={l.deposit} /></Stat>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[14px] font-medium">Deductions</h3>
            <button type="button" className="ghost-chip h-8 text-sm" onClick={() => addRow()}><Plus className="h-3.5 w-3.5" /> Add deduction</button>
          </div>
          {detail.moveOut.deductions.length > 0 && (
            <ul className="mb-2 divide-y rounded-lg border bg-subtle/40 text-[14px]">
              {detail.moveOut.deductions.map(d => (
                <li key={d.id} className="flex h-9 items-center gap-3 px-3">
                  <Receipt className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{d.description}</span>
                  <span className="text-sm text-muted-foreground">already charged {fullDate(d.date)}</span>
                  <Money value={d.amount} />
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map(r => {
                const account = r.accountId ? ws.accountById.get(r.accountId) : undefined;
                return (
                  <div key={r.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_180px_120px_auto]">
                    <TextInput data-deduction={r.key} value={r.description} onChange={e => setRow(r.key, { description: e.target.value })} placeholder="What it’s for — e.g. Replace broken blinds" maxLength={200} aria-label="Deduction description" className="col-span-2 sm:col-span-1" />
                    <AccountPicker kind="charge" value={r.accountId} onChange={id => setRow(r.key, { accountId: id })} trigger={<FieldButton className="text-[13.5px]">{account?.name}</FieldButton>} />
                    <MoneyInput value={r.amount} onChange={v => setRow(r.key, { amount: v })} />
                    <IconButton aria-label="Remove deduction" onClick={() => setRows(x => x.filter(y => y.key !== r.key))} className="self-center"><X /></IconButton>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button key={p.description} type="button" className="chip hover:bg-accent" onClick={() => addRow(p)}>
                <Plus className="h-3 w-3" /> {p.description}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border px-3 py-1.5">
          <SwitchRow label="Apply the deposit to what’s owed" description={owed > 0.004 ? `Covers ${ws.money(applied)} of the ${ws.money(owed)} owed after deductions.` : 'Nothing is owed after deductions.'} checked={apply} onChange={setApply} />
        </section>

        {refund > 0.004 && (
          <section className="space-y-3">
            <h3 className="text-[14px] font-medium">Refund {ws.money(refund)}</h3>
            <FieldRow cols={3}>
              <Field label="Method">
                <ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} />
              </Field>
              <Field label={method === 'Check' ? 'Check number' : 'Reference'} optional>
                <TextInput value={reference} onChange={e => setReference(e.target.value)} maxLength={80} />
              </Field>
              <Field label="Paid from">
                <AccountPicker kind="bank" value={bank?.id ?? null} onChange={setBankAccountId} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />}>{bank?.name}</FieldButton>} />
              </Field>
            </FieldRow>
            {l.forwardingAddress && <p className="text-sm text-muted-foreground">Forwarding address: {l.forwardingAddress}</p>}
          </section>
        )}

        <div className="overflow-hidden rounded-lg border text-[14px]">
          <SummaryLine label="Deposit held" value={<Money value={held} />} />
          {newDeductions > 0 && <SummaryLine label="New deductions" value={<Money value={newDeductions} />} muted />}
          <SummaryLine label="Applied to the balance" value={<Money value={applied ? -applied : 0} />} muted />
          <SummaryLine label={refund > 0.004 ? 'Refund to residents' : stillOwed > 0.004 ? 'Residents still owe' : 'Result'} value={refund > 0.004 ? <Money value={refund} className="font-semibold text-tone-success" /> : stillOwed > 0.004 ? <Money value={stillOwed} className="font-semibold text-tone-danger" /> : <span className="font-medium">All square</span>} strong />
        </div>

        <FieldRow>
          <Field label="Settlement date">
            <DateInput value={date} onChange={setDate} max={ws.today} />
          </Field>
          <div className="pt-5">
            <SwitchRow label="Send the statement" description="Emailed and in their portal, with a PDF." checked={send} onChange={setSend} />
          </div>
        </FieldRow>
        <Field label="Note to residents" optional>
          <TextArea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="e.g. Thanks for leaving the place in great shape." />
        </Field>
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-card px-3 py-2', className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[16px] font-semibold">{children}</div>
    </div>
  );
}

function SummaryLine({ label, value, muted, strong }: { label: string; value: React.ReactNode; muted?: boolean; strong?: boolean }) {
  return (
    <div className={cn('flex h-9 items-center justify-between border-b px-3 last:border-b-0', strong && 'bg-subtle/60', muted && 'text-muted-foreground')}>
      <span>{label}</span>
      {value}
    </div>
  );
}

/** The settled deposit as a statement: printable, and linked to the PDF filed on the lease. */
export function SettlementStatement({ detail }: { detail: LeaseDetail }) {
  const ws = useWorkspace();
  const ref = useRef<HTMLDivElement>(null);
  const l = detail.lease;
  const deductions = detail.moveOut.deductions;
  const applied = sumMoney(detail.moveOut.applied.map(a => a.amount));
  const refunded = sumMoney(detail.moveOut.refunds.map(r => r.amount));
  const heldAtMoveOut = sumMoney([detail.depositHeld, applied, refunded]);
  const refund = detail.moveOut.refunds[0];
  const names = detail.people.filter(p => p.role !== 'Guarantor').map(p => p.name).join(', ');
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h3 className="text-[14px] font-medium">Deposit statement</h3>
        <div className="flex items-center gap-1">
          <Tip label="Print the statement">
            <IconButton aria-label="Print the statement" onClick={() => printElement(ref.current, `Deposit statement ${leaseRef(l.number)}`, `${ws.settings.organizationName} · ${ws.unitLabel(l.unitId, l.propertyId)} · ${leaseRef(l.number)}`)}><Printer /></IconButton>
          </Tip>
        </div>
      </div>
      <div ref={ref} className="px-4 py-3 text-[14px]">
        <h1 className="sr-only">Security deposit statement</h1>
        <p className="mb-2 text-sm text-muted-foreground">
          {names} · moved out {fullDate(l.moveOutDate)}{l.depositSettledAt ? ` · settled ${fullDate(l.depositSettledAt.slice(0, 10))}` : ''}
        </p>
        <table className="w-full">
          <tbody>
            <tr className="total border-b"><td className="py-1.5 font-medium">Security deposit held</td><td className="amt py-1.5 text-right"><Money value={heldAtMoveOut} className="font-medium" /></td></tr>
            {deductions.map(d => (
              <tr key={d.id} className="border-b border-border/60"><td className="py-1.5 text-muted-foreground">Deduction — {d.description}</td><td className="amt py-1.5 text-right"><Money value={d.amount} /></td></tr>
            ))}
            <tr className="border-b border-border/60"><td className="py-1.5 text-muted-foreground">Applied to balance owed</td><td className="amt py-1.5 text-right"><Money value={applied} /></td></tr>
            <tr className="total border-b"><td className="py-1.5 font-medium">Refunded{refund?.paymentMethod ? ` by ${refund.paymentMethod.toLowerCase()}` : ''}{refund?.reference ? ` #${refund.reference}` : ''}</td><td className="amt py-1.5 text-right"><Money value={refunded} className="font-medium" /></td></tr>
            <tr className="total"><td className="py-1.5 font-medium">{detail.balance > 0.004 ? 'Balance still owed' : detail.balance < -0.004 ? 'Credit remaining' : 'Balance'}</td><td className="amt py-1.5 text-right"><Money value={Math.abs(detail.balance)} tone={detail.balance > 0.004 ? 'balance' : 'plain'} className="font-medium" /></td></tr>
          </tbody>
        </table>
        {l.forwardingAddress && <p className="mt-2 text-sm text-muted-foreground">Forwarding address: {l.forwardingAddress}</p>}
      </div>
    </div>
  );
}
