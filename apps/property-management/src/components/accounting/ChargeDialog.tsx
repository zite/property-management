import { useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { postLeaseMoney } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, FieldButton } from '../pickers/pickers';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { LeaseField } from './LeaseMoneyFields';
import { afterPosting } from './ledgerData';

/** Post a one-off charge to a lease. Defaults: `leaseId`, `accountId`, `amount`, `description`. */
export default function ChargeDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [dueDate, setDueDate] = useState<string | null>(todayString());
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ lease?: string; account?: string; amount?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLeaseId(typeof defaults.leaseId === 'string' ? defaults.leaseId : null);
    setAccountId(typeof defaults.accountId === 'string' ? defaults.accountId : ws.accountByKey.get('other_income')?.id ?? ws.chargeAccounts[0]?.id ?? null);
    setAmount(typeof defaults.amount === 'number' ? defaults.amount : null);
    setDate(todayString());
    setDueDate(todayString());
    setDescription(typeof defaults.description === 'string' ? defaults.description : '');
    setErrors({});
  }, [open]);

  const account = accountId ? ws.accountById.get(accountId) : undefined;

  const submit = async () => {
    const next: typeof errors = {};
    if (!leaseId) next.lease = 'Choose the lease to charge.';
    if (!accountId) next.account = 'Choose what the charge is for.';
    if (!amount || amount <= 0) next.amount = 'Enter the amount.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postLeaseMoney({ action: 'charge', leaseId: leaseId!, accountId: accountId!, amount: amount!, date, dueDate: dueDate ?? date, description: description.trim() || account?.name });
      afterPosting(qc);
      toast.success(`Charged ${ws.money(amount!)}`, { description: `${description.trim() || account?.name} · balance now ${ws.money(res.balance)}` });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t post the charge') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New charge" description="Bill a resident for something one-off — a fee, a repair, a utility." onSubmit={submit} pending={pending} submitLabel="Post charge">
      <div className="space-y-4">
        <LeaseField leaseId={leaseId} onChange={setLeaseId} error={errors.lease} locked={typeof defaults.leaseId === 'string'} />
        <FieldRow>
          <Field label="Charge for" error={errors.account}>
            <AccountPicker
              kind="charge"
              value={accountId}
              onChange={id => {
                setAccountId(id);
                if (!description.trim() || ws.chargeAccounts.some(a => a.name === description.trim())) setDescription(ws.accountById.get(id)?.name ?? '');
              }}
              trigger={<FieldButton icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />} invalid={Boolean(errors.account)}>{account?.name}</FieldButton>}
            />
          </Field>
          <Field label="Amount" error={errors.amount}>
            <MoneyInput value={amount} onChange={setAmount} invalid={Boolean(errors.amount)} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
          <Field label="Due" hint="Late fees only apply to rent.">
            <DateInput value={dueDate} onChange={setDueDate} min={date} />
          </Field>
        </FieldRow>
        <Field label="Description">
          <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="Shown on the resident’s ledger and portal" maxLength={250} />
        </Field>
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
