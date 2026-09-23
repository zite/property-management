import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { saveAccount } from 'zitejs/api';
import { ACCOUNT_TYPES, type AccountSubtype, type AccountType } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { Field, FieldRow, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton } from '../pickers/pickers';
import type { ChartAccount } from './accountingData';
import { Notice } from './parts';

const SUBTYPES: Record<AccountType, AccountSubtype[]> = {
  Asset: ['Bank', 'Receivable', 'Other asset'],
  Liability: ['Payable', 'Deposits held', 'Prepaid', 'Other liability'],
  Equity: ['Owner equity', 'Contributions', 'Distributions'],
  Income: ['Operating income', 'Other income'],
  Expense: ['Operating expense', 'Other expense'],
};

/** Add or edit an account. `account: null` adds one; `undefined` closes. */
export function AccountDialog({ account, onOpenChange, suggestedNumber }: { account: ChartAccount | null | undefined; onOpenChange: (o: boolean) => void; suggestedNumber?: (type: AccountType) => string }) {
  const qc = useQueryClient();
  const open = account !== undefined;
  const system = Boolean(account?.systemKey);
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('Expense');
  const [subtype, setSubtype] = useState<AccountSubtype>('Operating expense');
  const [description, setDescription] = useState('');
  const [tenantCharge, setTenantCharge] = useState(false);
  const [billExpense, setBillExpense] = useState(true);
  const [bankName, setBankName] = useState('');
  const [last4, setLast4] = useState('');
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<{ number?: string; name?: string; last4?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const type = (account?.accountType as AccountType) ?? 'Expense';
    setNumber(account?.number ?? suggestedNumber?.('Expense') ?? '');
    setName(account?.name ?? '');
    setAccountType(type);
    setSubtype((account?.subtype as AccountSubtype) || SUBTYPES[type][0]);
    setDescription(account?.description ?? '');
    setTenantCharge(account?.tenantCharge ?? false);
    setBillExpense(account ? account.billExpense : true);
    setBankName(account?.bankName ?? '');
    setLast4(account?.accountLast4 ?? '');
    setActive(account?.active ?? true);
    setErrors({});
  }, [open, account?.id]);

  const changeType = (t: AccountType) => {
    setAccountType(t);
    setSubtype(SUBTYPES[t][0]);
    if (!account && suggestedNumber) setNumber(suggestedNumber(t));
    setTenantCharge(t === 'Income');
    setBillExpense(t === 'Expense');
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (!number.trim()) next.number = 'Give the account a number.';
    else if (!/^[A-Za-z0-9.-]+$/.test(number.trim())) next.number = 'Use digits, letters, dots or dashes.';
    if (!name.trim()) next.name = 'Give the account a name.';
    if (subtype === 'Bank' && last4 && !/^\d{4}$/.test(last4)) next.last4 = 'Enter four digits.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      await saveAccount({ id: account?.id, number: number.trim(), name: name.trim(), accountType, subtype, description: description.trim(), tenantCharge, billExpense, bankName: bankName.trim(), accountLast4: last4.trim(), active });
      invalidate(qc, 'bootstrap', 'accounting');
      toast.success(account ? 'Account saved' : `Account ${number.trim()} added`);
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t save the account') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={account ? `Edit ${account.number} ${account.name}` : 'New account'} onSubmit={submit} pending={pending} submitLabel={account ? 'Save account' : 'Add account'}>
      <div className="space-y-4">
        {system && (
          <Notice tone="info">
            <Lock className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
            This account is posted to automatically. You can rename or renumber it, but not change its type or deactivate it.
          </Notice>
        )}
        <FieldRow>
          <Field label="Number" error={errors.number}>
            <TextInput value={number} onChange={e => setNumber(e.target.value)} placeholder="5150" maxLength={12} invalid={Boolean(errors.number)} className="num" />
          </Field>
          <Field label="Name" error={errors.name}>
            <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Elevator Maintenance" maxLength={120} invalid={Boolean(errors.name)} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Type">
            <ChoicePicker options={ACCOUNT_TYPES} value={accountType} onChange={v => changeType(v as AccountType)} disabled={system} trigger={<FieldButton disabled={system}>{accountType}</FieldButton>} />
          </Field>
          <Field label="Subtype">
            <ChoicePicker options={SUBTYPES[accountType]} value={subtype} onChange={v => setSubtype(v as AccountSubtype)} disabled={system} trigger={<FieldButton disabled={system}>{subtype}</FieldButton>} />
          </Field>
        </FieldRow>
        {subtype === 'Bank' && (
          <FieldRow>
            <Field label="Bank" optional>
              <TextInput value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Front Range Community Bank" maxLength={80} />
            </Field>
            <Field label="Last 4 digits" optional error={errors.last4}>
              <TextInput value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="4821" invalid={Boolean(errors.last4)} className="num" />
            </Field>
          </FieldRow>
        )}
        <Field label="Description" optional>
          <TextArea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What belongs in this account" maxLength={500} />
        </Field>
        <div className="space-y-1 rounded-md border px-3 py-2">
          {(accountType === 'Income' || subtype === 'Deposits held' || subtype === 'Other liability') && <SwitchRow label="Use for resident charges" description="Offered when posting a charge to a lease." checked={tenantCharge} onChange={setTenantCharge} />}
          {accountType === 'Expense' && <SwitchRow label="Use for bills" description="Suggested when entering vendor bills." checked={billExpense} onChange={setBillExpense} />}
          <SwitchRow label="Active" description={system ? 'Always active — the books rely on it.' : 'Inactive accounts keep their history but can’t be posted to.'} checked={active} onChange={setActive} disabled={system} />
        </div>
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
