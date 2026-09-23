import { useQueryClient } from '@tanstack/react-query';
import { Receipt, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { workOrderMoney } from 'zitejs/api';
import { workOrderRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { addDays, todayString } from '../../lib/format';
import { invalidate, invalidateMoney } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, Segmented, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, FieldButton, VendorPicker } from '../pickers/pickers';
import type { WorkOrder } from './data';

export type MoneyDialogKind = 'requestApproval' | 'recordApproval' | 'bill' | 'chargeResident';

const DECISIONS = [{ value: 'Approved', label: 'Approved' }, { value: 'Declined', label: 'Declined' }] as const;

const CATEGORY_ACCOUNT: Record<string, string> = { Turnover: 'turnover', Landscaping: 'landscaping', 'Pest control': 'pest_control', Cleaning: 'turnover', Painting: 'turnover' };

/**
 * The money actions on a work order, each a small dialog: ask the owner to
 * approve an estimate, record their answer, enter the vendor's bill, or charge
 * the resident for damage. All post through the ledger on the server.
 */
export function WorkOrderMoneyDialog({ kind, workOrder: w, onOpenChange }: { kind: MoneyDialogKind | null; workOrder: WorkOrder; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const open = kind !== null;
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'Approved' | 'Declined'>('Approved');
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(todayString());
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const vendor = w.vendorId ? ws.vendorById.get(w.vendorId) : undefined;
    setAmount(kind === 'bill' ? w.actualCost ?? w.estimateAmount : kind === 'requestApproval' ? w.estimateAmount : null);
    setNote('');
    setDecision('Approved');
    setVendorId(w.vendorId);
    const fallbackKey = CATEGORY_ACCOUNT[w.category] ?? 'repairs';
    setAccountId(kind === 'chargeResident' ? ws.accountByKey.get('damage_income')?.id ?? null : vendor?.defaultAccountId ?? ws.accountByKey.get(fallbackKey)?.id ?? null);
    setDate(todayString());
    setDueDate(kind === 'bill' ? addDays(vendor?.paymentTermsDays ?? 30) : addDays(14));
    setReference('');
    setDescription(kind === 'chargeResident' ? `Repair charge — ${w.title}` : `${workOrderRef(w.number)} ${w.title}`);
    setError(null);
  }, [open, kind]);

  useEffect(() => {
    if (kind !== 'bill' || !vendorId) return;
    const vendor = ws.vendorById.get(vendorId);
    if (vendor?.defaultAccountId) setAccountId(vendor.defaultAccountId);
    setDueDate(addDays(vendor?.paymentTermsDays ?? 30, date));
  }, [vendorId]);

  const ref_ = workOrderRef(w.number);
  const submit = async () => {
    setError(null);
    try {
      setPending(true);
      if (kind === 'requestApproval') {
        if (!amount || amount <= 0) return setError('Enter the estimate the owner is approving.');
        await workOrderMoney({ action: 'requestApproval', workOrderId: w.id, amount, note: note.trim() || undefined });
        toast.success('Approval requested', { description: 'The work order is on hold until the owner answers.' });
      } else if (kind === 'recordApproval') {
        await workOrderMoney({ action: 'recordApproval', workOrderId: w.id, decision, note: note.trim() || undefined });
        toast.success(decision === 'Approved' ? 'Owner approval recorded' : 'Owner decline recorded');
      } else if (kind === 'bill') {
        if (!vendorId) return setError('Choose the vendor who sent the bill.');
        if (!amount || amount <= 0) return setError('Enter the bill amount.');
        if (!accountId) return setError('Choose the expense account.');
        if (!dueDate) return setError('Choose when the bill is due.');
        await workOrderMoney({ action: 'bill', workOrderId: w.id, vendorId, amount, accountId, date, dueDate, reference: reference.trim() || undefined, description: description.trim() || undefined });
        toast.success('Bill entered', { description: `It’s in payables, due ${dueDate}.` });
        invalidateMoney(qc);
      } else if (kind === 'chargeResident') {
        if (!amount || amount <= 0) return setError('Enter the amount to charge.');
        await workOrderMoney({ action: 'chargeResident', workOrderId: w.id, amount, date, dueDate: dueDate ?? undefined, description: description.trim() || undefined, accountId: accountId ?? undefined });
        toast.success('Charge posted to the resident’s ledger');
        invalidateMoney(qc);
      }
      invalidate(qc, 'workOrders', 'bootstrap', 'dashboard');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'Something went wrong'));
    } finally {
      setPending(false);
    }
  };

  const title =
    kind === 'requestApproval' ? `Ask the owner to approve ${ref_}` :
    kind === 'recordApproval' ? 'Record the owner’s decision' :
    kind === 'bill' ? `Enter bill for ${ref_}` :
    'Charge the resident';
  const vendor = vendorId ? ws.vendorById.get(vendorId) : undefined;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        kind === 'requestApproval' ? 'The owner gets an email with the estimate and can approve it in their portal. The work order goes on hold meanwhile.' :
        kind === 'recordApproval' ? 'For answers you got by phone or email. Approving moves the work order off hold.' :
        kind === 'bill' ? 'Posts to accounts payable for this property. Pay it from Accounting → Payables.' :
        kind === 'chargeResident' ? `Adds a charge to ${w.tenantName ?? 'the resident'}’s ledger for damage they’re responsible for.` : undefined
      }
      onSubmit={submit}
      pending={pending}
      submitLabel={kind === 'requestApproval' ? 'Send request' : kind === 'recordApproval' ? 'Record decision' : kind === 'bill' ? 'Enter bill' : 'Post charge'}
      size={kind === 'bill' ? 'lg' : 'md'}
    >
      <div className="space-y-4">
        {kind === 'recordApproval' && (
          <Field label="Decision">
            <Segmented value={decision} onChange={v => setDecision(v as 'Approved' | 'Declined')} options={DECISIONS} />
          </Field>
        )}
        {kind === 'bill' && (
          <FieldRow>
            <Field label="Vendor">
              <VendorPicker value={vendorId} onChange={setVendorId} allowNone={false} trigger={<FieldButton placeholder="Choose a vendor" icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />}>{vendor?.name}</FieldButton>} />
            </Field>
            <Field label="Vendor invoice #" optional>
              <TextInput value={reference} onChange={e => setReference(e.target.value)} placeholder="INV-2041" maxLength={80} />
            </Field>
          </FieldRow>
        )}
        {kind !== 'recordApproval' && (
          <FieldRow>
            <Field label={kind === 'requestApproval' ? 'Estimate' : 'Amount'}>
              <MoneyInput value={amount} onChange={setAmount} autoFocus />
            </Field>
            {(kind === 'bill' || kind === 'chargeResident') && (
              <Field label={kind === 'bill' ? 'Expense account' : 'Income account'}>
                <AccountPicker
                  value={accountId}
                  onChange={setAccountId}
                  kind={kind === 'bill' ? 'expense' : 'charge'}
                  trigger={<FieldButton placeholder="Choose an account" icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />}>{accountId ? ws.accountById.get(accountId)?.name : null}</FieldButton>}
                />
              </Field>
            )}
          </FieldRow>
        )}
        {(kind === 'bill' || kind === 'chargeResident') && (
          <>
            <FieldRow>
              <Field label={kind === 'bill' ? 'Bill date' : 'Charge date'}>
                <DateInput value={date} onChange={v => v && setDate(v)} />
              </Field>
              <Field label="Due">
                <DateInput value={dueDate} onChange={setDueDate} min={date} />
              </Field>
            </FieldRow>
            <Field label="Description">
              <TextInput value={description} onChange={e => setDescription(e.target.value)} maxLength={250} />
            </Field>
          </>
        )}
        {(kind === 'requestApproval' || kind === 'recordApproval') && (
          <Field label={kind === 'requestApproval' ? 'Note to the owner' : 'Note'} optional>
            <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'requestApproval' ? 'What’s wrong, what the vendor recommends, and what happens if it waits.' : 'e.g. Approved by phone, asked for the cheaper part'} maxLength={2000} />
          </Field>
        )}
        {error && <p role="alert" className="text-[14px] text-tone-danger">{error}</p>}
      </div>
    </FormDialog>
  );
}
