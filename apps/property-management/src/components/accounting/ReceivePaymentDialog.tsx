import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { postLeaseMoney } from 'zitejs/api';
import { PAYMENT_METHODS, type PaymentMethod } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, SwitchRow, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, ChoicePicker, FieldButton } from '../pickers/pickers';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { AllocationEditor, LeaseField } from './LeaseMoneyFields';
import { afterPosting, useLeaseLedger } from './ledgerData';

/**
 * Receive a payment. Defaults: `leaseId`, `amount`, `tenantId`.
 * Applies oldest charges first unless you choose charges; can email a receipt.
 */
export default function ReceivePaymentDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [method, setMethod] = useState<PaymentMethod>('Check');
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [sendReceipt, setSendReceipt] = useState(true);
  const [errors, setErrors] = useState<{ lease?: string; amount?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const amountTouched = useRef(false);
  const { data: ledger } = useLeaseLedger(leaseId);

  useEffect(() => {
    if (!open) return;
    setLeaseId(typeof defaults.leaseId === 'string' ? defaults.leaseId : null);
    setAmount(typeof defaults.amount === 'number' ? defaults.amount : null);
    amountTouched.current = typeof defaults.amount === 'number';
    setDate(todayString());
    setMethod('Check');
    setReference('');
    setBankAccountId(null);
    setManual(false);
    setAllocations({});
    setSendReceipt(true);
    setErrors({});
  }, [open]);

  // Suggest the balance owed once the lease loads.
  useEffect(() => {
    if (ledger && !amountTouched.current) setAmount(ledger.balance > 0 ? ledger.balance : null);
  }, [ledger?.lease?.id, ledger?.balance]);

  const property = ledger?.lease?.propertyId ? ws.propertyById.get(ledger.lease.propertyId) : undefined;
  const defaultBank = property?.bankAccountId ? ws.accountById.get(property.bankAccountId) : ws.accountByKey.get('operating_bank');
  const bank = bankAccountId ? ws.accountById.get(bankAccountId) : defaultBank;
  const hasEmail = Boolean(ledger?.tenants.some(t => t.email && (t.role === 'Primary' || t.role === 'Co-tenant')));

  const submit = async () => {
    const next: typeof errors = {};
    if (!leaseId) next.lease = 'Choose the lease this payment is for.';
    if (!amount || amount <= 0) next.amount = 'Enter the amount received.';
    const applied = Object.values(allocations).reduce((s, n) => s + n, 0);
    if (manual && amount && applied > amount + 0.004) next.form = 'The amounts applied add up to more than the payment.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postLeaseMoney({
        action: 'payment', leaseId: leaseId!, amount: amount!, date, paymentMethod: method, reference: reference.trim() || undefined,
        bankAccountId: bankAccountId ?? undefined, tenantId: typeof defaults.tenantId === 'string' ? defaults.tenantId : undefined,
        allocations: manual ? Object.entries(allocations).filter(([, v]) => v > 0).map(([chargeId, v]) => ({ chargeId, amount: v })) : undefined,
        sendReceipt: hasEmail && sendReceipt,
      });
      afterPosting(qc);
      toast.success(`Payment of ${ws.money(amount!)} received`, {
        description: `Receipt #${res.number} · balance now ${ws.money(res.balance)}${res.receipt === 'Sent' ? ' · receipt emailed' : res.receipt === 'Failed' ? ' · receipt email failed' : ''}`,
        action: ledger?.lease ? { label: 'View ledger', onClick: () => navigate(`/leases/${leaseId}/ledger`) } : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t record the payment') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Receive payment" onSubmit={submit} pending={pending} submitLabel="Record payment" size="lg">
      <div className="space-y-4">
        <LeaseField leaseId={leaseId} onChange={id => { setLeaseId(id); amountTouched.current = false; setAllocations({}); }} error={errors.lease} locked={typeof defaults.leaseId === 'string'} />
        <FieldRow>
          <Field label="Amount" error={errors.amount}>
            <MoneyInput value={amount} onChange={v => { amountTouched.current = true; setAmount(v); }} invalid={Boolean(errors.amount)} />
          </Field>
          <Field label="Date received">
            <DateInput value={date} onChange={v => v && setDate(v)} max={todayString()} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Method">
            <ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} />
          </Field>
          <Field label={method === 'Check' ? 'Check number' : 'Reference'} optional>
            <TextInput value={reference} onChange={e => setReference(e.target.value)} placeholder={method === 'Check' ? '1042' : 'Confirmation #'} maxLength={80} />
          </Field>
        </FieldRow>
        <Field label="Deposit to" hint={!bankAccountId && property ? `${property.name}’s default account` : undefined}>
          <AccountPicker kind="bank" value={bank?.id ?? null} onChange={setBankAccountId} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />}>{bank ? `${bank.name}${bank.accountLast4 ? ` ··${bank.accountLast4}` : ''}` : null}</FieldButton>} />
        </Field>
        {ledger && ledger.openCharges.length > 0 && (
          <div className="space-y-2">
            <SwitchRow label="Apply to specific charges" description="Otherwise the oldest charges are paid first." checked={manual} onChange={setManual} />
            {manual && <AllocationEditor charges={ledger.openCharges} amount={amount ?? 0} value={allocations} onChange={setAllocations} />}
          </div>
        )}
        {hasEmail && <SwitchRow label="Email a receipt" description="Sent to the primary resident using your Payment receipt template." checked={sendReceipt} onChange={setSendReceipt} />}
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
