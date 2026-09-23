import { useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { postLeaseMoney } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, SwitchRow, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { FieldButton } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { AllocationEditor, LeaseField } from './LeaseMoneyFields';
import { afterPosting, useLeaseLedger } from './ledgerData';

/**
 * Credit a lease — a concession, a waived fee, a goodwill credit. Defaults:
 * `leaseId`, `amount`, `description`, `chargeId` (credit a specific charge,
 * e.g. waiving a late fee).
 */
export default function CreditDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [description, setDescription] = useState('');
  const [manual, setManual] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<{ lease?: string; amount?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const { data: ledger } = useLeaseLedger(leaseId);

  useEffect(() => {
    if (!open) return;
    setLeaseId(typeof defaults.leaseId === 'string' ? defaults.leaseId : null);
    setAccountId(ws.accountByKey.get('concessions')?.id ?? null);
    setAmount(typeof defaults.amount === 'number' ? defaults.amount : null);
    setDate(todayString());
    setDescription(typeof defaults.description === 'string' ? defaults.description : '');
    setManual(typeof defaults.chargeId === 'string');
    setAllocations(typeof defaults.chargeId === 'string' && typeof defaults.amount === 'number' ? { [defaults.chargeId]: defaults.amount } : {});
    setErrors({});
  }, [open]);

  // A waived charge is credited back to the income account it was charged to.
  useEffect(() => {
    if (!ledger || typeof defaults.chargeId !== 'string') return;
    const charge = ledger.openCharges.find(c => c.id === defaults.chargeId);
    if (charge?.accountId) setAccountId(charge.accountId);
  }, [ledger?.lease?.id]);

  const accounts = ws.accounts.filter(a => a.active && (a.accountType === 'Income' || a.accountType === 'Expense'));
  const account = accountId ? ws.accountById.get(accountId) : undefined;

  const submit = async () => {
    const next: typeof errors = {};
    if (!leaseId) next.lease = 'Choose the lease to credit.';
    if (!amount || amount <= 0) next.amount = 'Enter the amount.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postLeaseMoney({
        action: 'credit', leaseId: leaseId!, amount: amount!, date, accountId: accountId ?? undefined, description: description.trim() || account?.name,
        allocations: manual ? Object.entries(allocations).filter(([, v]) => v > 0).map(([chargeId, v]) => ({ chargeId, amount: v })) : undefined,
      });
      afterPosting(qc);
      toast.success(`Credited ${ws.money(amount!)}`, { description: `Balance now ${ws.money(res.balance)}` });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t post the credit') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New credit" description="Reduce what a resident owes — a concession, a waived fee or a goodwill credit." onSubmit={submit} pending={pending} submitLabel="Post credit" size="lg">
      <div className="space-y-4">
        <LeaseField leaseId={leaseId} onChange={id => { setLeaseId(id); setAllocations({}); }} error={errors.lease} locked={typeof defaults.leaseId === 'string'} />
        <FieldRow>
          <Field label="Amount" error={errors.amount}>
            <MoneyInput value={amount} onChange={setAmount} invalid={Boolean(errors.amount)} />
          </Field>
          <Field label="Date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Account" hint="Concessions, or the income account of the fee you’re waiving.">
            <OptionPicker
              options={accounts.map(a => ({ value: a.id, label: a.name, hint: <span className="num">{a.number}</span>, group: a.accountType, keywords: [a.number] }))}
              value={accountId}
              onChange={v => v && setAccountId(v)}
              width={300}
              trigger={<FieldButton icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />}>{account?.name}</FieldButton>}
            />
          </Field>
          <Field label="Description">
            <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Waived September late fee" maxLength={250} />
          </Field>
        </FieldRow>
        {ledger && ledger.openCharges.length > 0 && (
          <div className="space-y-2">
            <SwitchRow label="Apply to specific charges" description="Otherwise the oldest charges are credited first." checked={manual} onChange={setManual} />
            {manual && <AllocationEditor charges={ledger.openCharges} amount={amount ?? 0} value={allocations} onChange={setAllocations} />}
          </div>
        )}
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
