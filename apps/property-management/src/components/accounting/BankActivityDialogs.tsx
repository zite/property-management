import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, Landmark, Plus, Receipt, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { postBankActivity } from 'zitejs/api';
import { PAYMENT_METHODS, type PaymentMethod } from '@project/shared/constants';
import { fromCents, toCents } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, ChoicePicker, FieldButton, PropertyPicker, UnitPicker, VendorPicker } from '../pickers/pickers';
import { IconButton, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import { useBanking } from './accountingData';
import { afterPosting } from './ledgerData';
import { AttachmentField, bankLabel, Notice } from './parts';

/** Move one property's cash between two bank accounts. Defaults: `fromBankId`, `propertyId`. */
export function TransferDialog({ open, onOpenChange, defaults = {} }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { fromBankId?: string; propertyId?: string } }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { data: banking } = useBanking();
  const [fromBankId, setFrom] = useState<string | null>(null);
  const [toBankId, setTo] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<{ from?: string; to?: string; property?: string; amount?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const from = defaults.fromBankId ?? ws.bankAccounts[0]?.id ?? null;
    setFrom(from);
    setTo(ws.bankAccounts.find(b => b.id !== from)?.id ?? null);
    setPropertyId(defaults.propertyId ?? null);
    setAmount(null);
    setDate(todayString());
    setDescription('');
    setReference('');
    setErrors({});
  }, [open]);

  const fromAccount = banking?.accounts.find(a => a.id === fromBankId);
  const available = propertyId ? fromAccount?.byProperty.find(p => p.propertyId === propertyId)?.balance ?? 0 : null;

  const submit = async () => {
    const next: typeof errors = {};
    if (!fromBankId) next.from = 'Choose where the money comes from.';
    if (!toBankId) next.to = 'Choose where it goes.';
    else if (toBankId === fromBankId) next.to = 'Choose a different account.';
    if (!propertyId) next.property = 'Choose whose cash is moving.';
    if (!amount || amount <= 0) next.amount = 'Enter the amount.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postBankActivity({ action: 'transfer', fromBankId: fromBankId!, toBankId: toBankId!, propertyId: propertyId!, amount: amount!, date, description: description.trim() || undefined, reference: reference.trim() || undefined });
      afterPosting(qc);
      toast.success(`Transferred ${ws.money(amount!)}`, { description: `#${res.number} · ${ws.accountById.get(fromBankId!)?.name} → ${ws.accountById.get(toBankId!)?.name}` });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t record the transfer') });
    } finally {
      setPending(false);
    }
  };

  const bankTrigger = (id: string | null, invalid: boolean, placeholder: string) => (
    <FieldButton invalid={invalid} placeholder={placeholder} icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />}>{id ? bankLabel(ws.accountById.get(id)) : null}</FieldButton>
  );

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Transfer between accounts" description="Moves a property’s cash from one bank account to another — for example into the deposit trust account." onSubmit={submit} pending={pending} submitLabel="Record transfer">
      <div className="space-y-4">
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)]">
          <Field label="From" error={errors.from}>
            <AccountPicker kind="bank" value={fromBankId} onChange={setFrom} trigger={bankTrigger(fromBankId, Boolean(errors.from), 'From account')} />
          </Field>
          <ArrowRight className="mb-2 hidden h-4 w-4 text-muted-foreground sm:block" />
          <Field label="To" error={errors.to}>
            <AccountPicker kind="bank" value={toBankId} onChange={setTo} trigger={bankTrigger(toBankId, Boolean(errors.to), 'To account')} />
          </Field>
        </div>
        <FieldRow>
          <Field label="Property" error={errors.property} hint={available != null ? <>Holds <Money value={available} /> in {fromAccount?.name ?? 'that account'}</> : 'Whose cash is moving'}>
            <PropertyPicker value={propertyId} onChange={setPropertyId} trigger={<FieldButton invalid={Boolean(errors.property)} placeholder="Choose a property" icon={propertyId ? <PropertySwatch color={ws.propertyById.get(propertyId)?.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}>{ws.propertyName(propertyId)}</FieldButton>} />
          </Field>
          <Field label="Amount" error={errors.amount}>
            <MoneyInput value={amount} onChange={setAmount} invalid={Boolean(errors.amount)} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
          <Field label="Reference" optional>
            <TextInput value={reference} onChange={e => setReference(e.target.value)} placeholder="Confirmation #" maxLength={80} />
          </Field>
        </FieldRow>
        <Field label="Memo" optional>
          <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Move Juniper Court deposits to trust" maxLength={250} />
        </Field>
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}

type Line = { key: number; accountId: string | null; memo: string; amount: number | null };

/** Record money spent straight from the bank — a check written on the spot, a card purchase. Defaults: `propertyId`, `bankAccountId`, `vendorId`. */
export function ExpenseDialog({ open, onOpenChange, defaults = {} }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { propertyId?: string; bankAccountId?: string; vendorId?: string } }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { data: banking } = useBanking();
  const seq = useRef(1);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('Check');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayString());
  const [description, setDescription] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<{ property?: string; lines?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  const defaultAccount = (vid: string | null) => {
    const v = vid ? ws.vendorById.get(vid) : undefined;
    return v?.defaultAccountId ?? ws.accountByKey.get('repairs')?.id ?? ws.expenseAccounts[0]?.id ?? null;
  };

  useEffect(() => {
    if (!open) return;
    setVendorId(defaults.vendorId ?? null);
    setPropertyId(defaults.propertyId ?? null);
    setUnitId(null);
    setBankAccountId(defaults.bankAccountId ?? null);
    setMethod('Check');
    setReference('');
    setDate(todayString());
    setDescription('');
    setAttachmentUrl(null);
    seq.current = 1;
    setLines([{ key: seq.current++, accountId: defaultAccount(defaults.vendorId ?? null), memo: '', amount: null }]);
    setErrors({});
  }, [open]);

  const property = propertyId ? ws.propertyById.get(propertyId) : undefined;
  const bank = bankAccountId ? ws.accountById.get(bankAccountId) : property?.bankAccountId ? ws.accountById.get(property.bankAccountId) : ws.accountByKey.get('operating_bank');
  const total = fromCents(lines.reduce((s, l) => s + toCents(l.amount ?? 0), 0));
  const patch = (key: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));

  const submit = async () => {
    const next: typeof errors = {};
    if (!propertyId) next.property = 'Choose the property this was for.';
    const filled = lines.filter(l => l.amount != null || l.memo.trim());
    if (!filled.length) next.lines = 'Enter what was spent.';
    else if (filled.some(l => !l.accountId)) next.lines = 'Choose an expense account for every line.';
    else if (filled.some(l => !(l.amount && l.amount > 0))) next.lines = 'Every line needs an amount greater than zero.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await postBankActivity({
        action: 'expense', propertyId: propertyId!, unitId: unitId ?? undefined, vendorId: vendorId ?? undefined, bankAccountId: bankAccountId ?? undefined, paymentMethod: method, date,
        reference: reference.trim() || undefined, description: description.trim() || undefined, attachmentUrl: attachmentUrl ?? undefined,
        lines: filled.map(l => ({ accountId: l.accountId!, amount: l.amount!, memo: l.memo.trim() || undefined })),
      });
      afterPosting(qc);
      toast.success(`Expense of ${ws.money(res.amount)} recorded`, { description: `#${res.number}${vendorId ? ` · ${ws.vendorById.get(vendorId)?.name}` : ''} · ${property?.name}` });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t record the expense') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Record expense" description="Money paid straight from the bank without a bill — a check written on the spot or a card purchase." onSubmit={submit} pending={pending} submitLabel="Record expense" size="lg" footerStart={<>Total <Money value={total} className="font-medium text-foreground" /></>}>
      <div className="space-y-4">
        <FieldRow>
          <Field label="Payee" optional>
            <VendorPicker value={vendorId} onChange={id => { setVendorId(id); setLines(ls => ls.map(l => (l.amount == null ? { ...l, accountId: defaultAccount(id) } : l))); }} allowNone trigger={<FieldButton placeholder="No vendor" icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />} onClear={vendorId ? () => setVendorId(null) : undefined}>{vendorId ? ws.vendorById.get(vendorId)?.name : null}</FieldButton>} />
          </Field>
          <Field label="Property" error={errors.property}>
            <PropertyPicker value={propertyId} onChange={id => { setPropertyId(id); setUnitId(null); }} trigger={<FieldButton invalid={Boolean(errors.property)} placeholder="Choose a property" icon={property ? <PropertySwatch color={property.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}>{property?.name}</FieldButton>} />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Paid from">
            <AccountPicker kind="bank" value={bank?.id ?? null} onChange={setBankAccountId} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />}>{bankLabel(bank)}</FieldButton>} />
          </Field>
          <Field label="Method">
            <ChoicePicker options={PAYMENT_METHODS} value={method} onChange={v => setMethod(v as PaymentMethod)} trigger={<FieldButton>{method}</FieldButton>} />
          </Field>
          <Field label={method === 'Check' ? 'Check #' : 'Reference'} optional>
            <TextInput value={reference} onChange={e => setReference(e.target.value)} maxLength={80} />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Date">
            <DateInput value={date} onChange={v => v && setDate(v)} />
          </Field>
          <Field label="Unit" optional>
            <UnitPicker propertyId={propertyId} allowNone value={unitId} onChange={id => setUnitId(id)} trigger={<FieldButton placeholder={propertyId ? 'Whole property' : 'Choose a property first'} disabled={!propertyId}>{unitId ? ws.unitLabel(unitId) : null}</FieldButton>} />
          </Field>
          <Field label="Description" optional>
            <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="What it was for" maxLength={250} />
          </Field>
        </FieldRow>
        <div>
          <div className="mb-1.5 text-[13.5px] font-medium text-foreground/90">Lines</div>
          <div className="overflow-hidden rounded-lg border">
            {lines.map((l, i) => {
              const account = l.accountId ? ws.accountById.get(l.accountId) : undefined;
              return (
                <div key={l.key} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_112px_28px] items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
                  <AccountPicker kind="expense" value={l.accountId} onChange={id => patch(l.key, { accountId: id })} trigger={<FieldButton placeholder="Expense account" icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />} aria-label={`Account for line ${i + 1}`}>{account ? `${account.number} ${account.name}` : null}</FieldButton>} />
                  <TextInput value={l.memo} onChange={e => patch(l.key, { memo: e.target.value })} placeholder="Memo" maxLength={250} aria-label={`Memo for line ${i + 1}`} />
                  <MoneyInput value={l.amount} onChange={v => patch(l.key, { amount: v })} />
                  {lines.length > 1 ? <Tip label="Remove line"><IconButton size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><X /></IconButton></Tip> : <span />}
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-subtle/40 px-2 py-1.5">
              <button type="button" onClick={() => setLines(ls => [...ls, { key: seq.current++, accountId: ls[ls.length - 1]?.accountId ?? defaultAccount(vendorId), memo: '', amount: null }])} className="ghost-chip h-8 gap-1.5 text-sm"><Plus className="h-3.5 w-3.5" /> Split</button>
              <span className="pr-10 text-[14px]">Total <Money value={total} className="font-semibold" /></span>
            </div>
          </div>
          {errors.lines && <p role="alert" className="mt-1.5 text-sm text-tone-danger">{errors.lines}</p>}
          {propertyId && banking && total > 0 && total > (banking.cashByProperty[propertyId] ?? 0) + 0.004 && (
            <Notice tone="warning" className="mt-2">
              {property?.name} only has <Money value={banking.cashByProperty[propertyId] ?? 0} className="font-medium" /> in cash. Recording this spends other owners’ money — ask for an owner contribution first.
            </Notice>
          )}
        </div>
        <Field label="Receipt" optional>
          <AttachmentField value={attachmentUrl} onChange={setAttachmentUrl} placeholder="Attach the receipt (PDF or photo)" />
        </Field>
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
