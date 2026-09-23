import { useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Receipt, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createBill } from 'zitejs/api';
import { workOrderRef } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { errorMessage } from '../../lib/errors';
import { addDays, shortDate, todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, FieldButton, PropertyPicker, VendorPicker } from '../pickers/pickers';
import { IconButton, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PropertySwatch } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { afterPosting } from './ledgerData';
import { AttachmentField } from './parts';

type Line = { key: number; accountId: string | null; propertyId: string | null; memo: string; amount: number | null };

/**
 * Enter a vendor bill into payables.
 *
 * Defaults: `vendorId`, `propertyId`, `unitId`, `workOrderId`, `workOrderNumber`,
 * `workOrderTitle`, `amount`, `description`, `accountId`.
 *
 * The due date follows the vendor's payment terms; lines default to the
 * vendor's usual expense account. A bill can be split across accounts and
 * properties — each line is booked to its own building.
 */
export default function BillDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const seq = useRef(1);
  const str = (k: string) => (typeof defaults[k] === 'string' && defaults[k] ? (defaults[k] as string) : null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [date, setDate] = useState(todayString());
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTouched, setDueTouched] = useState(false);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<{ vendor?: string; due?: string; lines?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  const vendorDefaultAccount = (id: string | null) => {
    const v = id ? ws.vendorById.get(id) : undefined;
    return v?.defaultAccountId && ws.accountById.get(v.defaultAccountId)?.active ? v.defaultAccountId : ws.accountByKey.get('repairs')?.id ?? ws.expenseAccounts[0]?.id ?? null;
  };
  const termsDue = (id: string | null, from: string) => addDays(ws.vendorById.get(id ?? '')?.paymentTermsDays ?? 30, from);

  useEffect(() => {
    if (!open) return;
    const v = str('vendorId');
    setVendorId(v);
    const today = todayString();
    setDate(today);
    setDueDate(termsDue(v, today));
    setDueTouched(false);
    setReference('');
    const woNumber = typeof defaults.workOrderNumber === 'number' ? defaults.workOrderNumber : null;
    setDescription(str('description') ?? (woNumber ? `${workOrderRef(woNumber)}${str('workOrderTitle') ? ` ${str('workOrderTitle')}` : ''}` : ''));
    setNotes('');
    setAttachmentUrl(null);
    seq.current = 1;
    setLines([{ key: seq.current++, accountId: str('accountId') ?? vendorDefaultAccount(v), propertyId: str('propertyId') ?? (ws.orderedProperties.length === 1 ? ws.orderedProperties[0].id : null), memo: '', amount: typeof defaults.amount === 'number' ? defaults.amount : null }]);
    setErrors({});
  }, [open]);

  const onVendor = (id: string | null) => {
    setVendorId(id);
    if (!dueTouched) setDueDate(termsDue(id, date));
    const account = vendorDefaultAccount(id);
    setLines(ls => ls.map(l => (l.amount == null && l.memo === '' ? { ...l, accountId: account } : l)));
  };
  const patch = (key: number, p: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));
  const addLine = () => setLines(ls => [...ls, { key: seq.current++, accountId: ls[ls.length - 1]?.accountId ?? vendorDefaultAccount(vendorId), propertyId: ls[ls.length - 1]?.propertyId ?? null, memo: '', amount: null }]);
  const total = fromCents(lines.reduce((s, l) => s + toCents(l.amount ?? 0), 0));
  const vendor = vendorId ? ws.vendorById.get(vendorId) : undefined;
  const workOrderId = str('workOrderId');
  const properties = new Set(lines.map(l => l.propertyId).filter(Boolean));

  const submit = async () => {
    const next: typeof errors = {};
    if (!vendorId) next.vendor = 'Choose the vendor who sent the bill.';
    if (!dueDate) next.due = 'Choose when the bill is due.';
    else if (dueDate < date) next.due = 'The due date can’t be before the bill date.';
    const filled = lines.filter(l => l.amount != null || l.memo.trim());
    if (!filled.length) next.lines = 'Add a line with an amount.';
    else if (filled.some(l => !l.accountId)) next.lines = 'Choose an expense account for every line.';
    else if (filled.some(l => !l.propertyId)) next.lines = 'Choose a property for every line.';
    else if (filled.some(l => !(l.amount && l.amount > 0))) next.lines = 'Every line needs an amount greater than zero.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setPending(true);
    try {
      const res = await createBill({
        vendorId: vendorId!, date, dueDate: dueDate!, reference: reference.trim() || undefined, description: description.trim() || undefined, notes: notes.trim() || undefined,
        attachmentUrl: attachmentUrl ?? undefined, workOrderId: workOrderId ?? undefined, unitId: str('unitId') ?? undefined,
        lines: filled.map(l => ({ accountId: l.accountId!, propertyId: l.propertyId!, amount: l.amount!, memo: l.memo.trim() || undefined })),
      });
      afterPosting(qc);
      toast.success(`Bill #${res.number} entered`, { description: `${vendor?.name ?? 'Vendor'} · ${ws.money(res.total)} due ${shortDate(dueDate)}`, action: { label: 'Open', onClick: () => navigate(`/accounting/payables/${res.id}`) } });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Couldn’t enter the bill') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New bill"
      description="Posts to accounts payable. Pay it from Accounting → Payables."
      onSubmit={submit}
      pending={pending}
      submitLabel="Enter bill"
      size="xl"
      footerStart={<>Total <Money value={total} className="font-medium text-foreground" />{properties.size > 1 ? ` across ${properties.size} properties` : ''}</>}
    >
      <div className="space-y-4">
        {workOrderId && (
          <div className="field items-center gap-2 bg-muted/40">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">
              Linked to {typeof defaults.workOrderNumber === 'number' ? workOrderRef(defaults.workOrderNumber) : 'its work order'}{str('workOrderTitle') ? ` · ${str('workOrderTitle')}` : ''}
              <span className="text-muted-foreground"> — the bill shows on the work order too</span>
            </span>
          </div>
        )}
        <FieldRow>
          <Field label="Vendor" error={errors.vendor}>
            <VendorPicker value={vendorId} onChange={onVendor} allowNone={false} trigger={<FieldButton placeholder="Choose a vendor" invalid={Boolean(errors.vendor)} icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />}>{vendor?.name}</FieldButton>} />
          </Field>
          <Field label="Invoice #" optional hint={vendor?.paymentTermsDays ? `${vendor.name} is paid net ${vendor.paymentTermsDays}.` : undefined}>
            <TextInput value={reference} onChange={e => setReference(e.target.value)} placeholder="INV-2041" maxLength={80} />
          </Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Bill date">
            <DateInput value={date} onChange={v => { if (!v) return; setDate(v); if (!dueTouched) setDueDate(termsDue(vendorId, v)); }} />
          </Field>
          <Field label="Due" error={errors.due}>
            <DateInput value={dueDate} onChange={v => { setDueTouched(true); setDueDate(v); }} min={date} invalid={Boolean(errors.due)} />
          </Field>
          <Field label="Description" optional>
            <TextInput value={description} onChange={e => setDescription(e.target.value)} placeholder="What it’s for" maxLength={250} />
          </Field>
        </FieldRow>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13.5px] font-medium text-foreground/90">Lines</span>
            <span className="text-sm text-muted-foreground">Split by account or property</span>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_120px_32px] gap-2 border-b bg-subtle/60 px-2 py-1.5 text-sm text-muted-foreground">
                <span className="pl-1">Expense account</span>
                <span>Property</span>
                <span>Memo</span>
                <span className="pr-2 text-right">Amount</span>
                <span />
              </div>
              {lines.map((l, i) => {
                const account = l.accountId ? ws.accountById.get(l.accountId) : undefined;
                const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
                return (
                  <div key={l.key} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_120px_32px] items-center gap-2 border-b px-2 py-1.5 last:border-b-0">
                    <AccountPicker kind="expense" value={l.accountId} onChange={id => patch(l.key, { accountId: id })} trigger={<FieldButton placeholder="Account" icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />} aria-label={`Account for line ${i + 1}`}>{account ? `${account.number} ${account.name}` : null}</FieldButton>} />
                    <PropertyPicker value={l.propertyId} onChange={id => patch(l.key, { propertyId: id })} trigger={<FieldButton placeholder="Property" icon={property ? <PropertySwatch color={property.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />} aria-label={`Property for line ${i + 1}`}>{property?.name}</FieldButton>} />
                    <TextInput value={l.memo} onChange={e => patch(l.key, { memo: e.target.value })} placeholder="Optional" maxLength={250} aria-label={`Memo for line ${i + 1}`} />
                    <MoneyInput value={l.amount} onChange={v => patch(l.key, { amount: v })} />
                    {lines.length > 1 ? (
                      <Tip label="Remove line">
                        <IconButton size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><X /></IconButton>
                      </Tip>
                    ) : <span />}
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t bg-subtle/40 px-2 py-1.5">
                <button type="button" onClick={addLine} className="ghost-chip h-8 gap-1.5 text-sm"><Plus className="h-3.5 w-3.5" /> Add line</button>
                <span className="pr-12 text-[14px]">Total <Money value={total} className="font-semibold" /></span>
              </div>
            </div>
          </div>
          {errors.lines && <p role="alert" className="mt-1.5 text-sm text-tone-danger">{errors.lines}</p>}
        </div>

        <FieldRow>
          <Field label="Invoice" optional>
            <AttachmentField value={attachmentUrl} onChange={setAttachmentUrl} />
          </Field>
          <Field label="Internal note" optional>
            <TextArea rows={1} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Only your team sees this" maxLength={2000} className="min-h-9" />
          </Field>
        </FieldRow>
        {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
