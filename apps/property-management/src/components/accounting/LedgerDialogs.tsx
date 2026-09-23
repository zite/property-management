import { useQueryClient } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { postLeaseMoney, voidLedgerTransaction } from 'zitejs/api';
import { PAYMENT_METHODS, type PaymentMethod } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, ChoicePicker, FieldButton } from '../pickers/pickers';
import { Money } from '../primitives/data';
import { afterPosting, useLeaseLedger } from './ledgerData';

export type DepositAction = 'applyDeposit' | 'refundDeposit' | 'refundCredit';

const COPY: Record<DepositAction, { title: string; description: string; submit: string; done: string }> = {
  applyDeposit: { title: 'Apply deposit to balance', description: 'Moves held deposit onto the ledger to pay what the resident owes — usually at move-out.', submit: 'Apply deposit', done: 'Deposit applied' },
  refundDeposit: { title: 'Return deposit', description: 'Pays held deposit back to the resident from the property’s bank account.', submit: 'Record refund', done: 'Deposit refund recorded' },
  refundCredit: { title: 'Refund credit balance', description: 'Pays back money the resident overpaid.', submit: 'Record refund', done: 'Refund recorded' },
};

/** Deposit and credit-balance movements on a lease. */
export function DepositDialog({ action, leaseId, onOpenChange }: { action: DepositAction | null; leaseId: string; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { data: ledger } = useLeaseLedger(leaseId);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [method, setMethod] = useState<PaymentMethod>('Check');
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const open = action !== null;

  const available = !ledger ? 0 : action === 'refundCredit' ? ledger.unappliedCredit : ledger.depositHeld;
  const suggested = !ledger ? 0 : action === 'applyDeposit' ? Math.min(ledger.depositHeld, Math.max(0, ledger.balance)) : available;

  useEffect(() => {
    if (!open) return;
    setAmount(suggested > 0 ? suggested : null);
    setDate(todayString());
    setMethod('Check');
    setReference('');
    setBankAccountId(null);
    setError(null);
  }, [open, action]);

  if (!action) return null;
  const copy = COPY[action];
  const property = ledger?.lease?.propertyId ? ws.propertyById.get(ledger.lease.propertyId) : undefined;
  const bank = bankAccountId ? ws.accountById.get(bankAccountId) : property?.bankAccountId ? ws.accountById.get(property.bankAccountId) : ws.accountByKey.get('operating_bank');

  const submit = async () => {
    if (!amount || amount <= 0) return setError('Enter the amount.');
    if (amount > available + 0.004) return setError(`Only ${ws.money(available)} is available.`);
    setPending(true);
    setError(null);
    try {
      const res = action === 'applyDeposit'
        ? await postLeaseMoney({ action, leaseId, amount, date })
        : await postLeaseMoney({ action, leaseId, amount, date, paymentMethod: method, reference: reference.trim() || undefined, bankAccountId: bankAccountId ?? undefined });
      afterPosting(qc);
      toast.success(copy.done, { description: `Balance now ${ws.money(res.balance)}` });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t record that'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={copy.title} description={copy.description} onSubmit={submit} pending={pending} submitLabel={copy.submit}>
      <div className="space-y-4">
        <p className="rounded-md bg-muted/60 px-3 py-2 text-[14px]">
          {action === 'refundCredit' ? 'Credit available' : 'Deposit held'}: <Money value={available} className="font-medium" />
          {action === 'applyDeposit' && ledger && <> · Balance owed: <Money value={ledger.balance} tone="balance" /></>}
        </p>
        <FieldRow>
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
        </FieldRow>
        {action !== 'applyDeposit' && (
          <>
            <FieldRow>
              <Field label="Method">
                <ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} />
              </Field>
              <Field label={method === 'Check' ? 'Check number' : 'Reference'} optional>
                <TextInput value={reference} onChange={e => setReference(e.target.value)} maxLength={80} />
              </Field>
            </FieldRow>
            <Field label="Paid from">
              <AccountPicker kind="bank" value={bank?.id ?? null} onChange={setBankAccountId} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />}>{bank?.name}</FieldButton>} />
            </Field>
          </>
        )}
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}

export type VoidTarget = { id: string; number: number; kind: string; amount: number; description: string };

/** Void any transaction with a reason. Used by ledgers, bills, payments and journal entries alike. */
export function VoidDialog({ target, onOpenChange, onVoided }: { target: VoidTarget | null; onOpenChange: (open: boolean) => void; onVoided?: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (target) {
      setReason('');
      setError(null);
    }
  }, [target?.id]);

  const submit = async () => {
    if (!target) return;
    if (reason.trim().length < 3) return setError('Say why it’s being voided — it stays on the record.');
    setPending(true);
    try {
      await voidLedgerTransaction({ id: target.id, reason: reason.trim() });
      afterPosting(qc);
      toast.success(`${target.kind} #${target.number} voided`);
      onVoided?.();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t void it'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={Boolean(target)}
      onOpenChange={onOpenChange}
      title={target ? `Void ${target.kind.toLowerCase()} #${target.number}?` : 'Void'}
      description={target ? `${target.description} · ${ws.money(target.amount)}. The entry stays on the ledger, struck through, and stops affecting balances.` : undefined}
      onSubmit={submit}
      pending={pending}
      submitLabel="Void"
      destructive
      size="sm"
    >
      <Field label="Reason" error={error}>
        <TextArea autoFocus rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Check returned NSF, posted to the wrong lease" maxLength={250} />
      </Field>
    </FormDialog>
  );
}
