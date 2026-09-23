import { useQueryClient } from '@tanstack/react-query';
import { Hammer, Landmark } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveVendor } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { SWATCHES, VENDOR_TRADES } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, NumberInput, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, ChoicePicker, FieldButton } from '../pickers/pickers';
import { SkeletonRows } from '../primitives/bits';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { useVendor, type VendorPatch } from './data';

/**
 * New vendor, or edit one. Defaults it reads: `vendorId` (edit that vendor),
 * `name`, `trade`.
 *
 * Every field on the Vendors table: company and contact, trade, payment terms
 * and the default expense account bills use, compliance (insurance expiry,
 * W-9, 1099, tax ID last four, license), rating, portal access, colour, notes.
 */

type Trade = (typeof VENDOR_TRADES)[number];
type Draft = {
  name: string;
  trade: Trade;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  paymentTermsDays: number | null;
  defaultAccountId: string | null;
  hourlyRate: number | null;
  insuranceExpiresOn: string | null;
  w9OnFile: boolean;
  is1099: boolean;
  taxIdLast4: string;
  licenseNumber: string;
  rating: number | null;
  portalEnabled: boolean;
  color: string;
  notes: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (v: unknown) => (typeof v === 'string' && v ? v : null);

export default function VendorDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const vendorId = text(defaults.vendorId);
  const editing = Boolean(vendorId);
  const { data: detail, isPending: loading, isError } = useVendor(vendorId ?? undefined);

  const blank = (): Draft => {
    const trade = VENDOR_TRADES.includes(defaults.trade as Trade) ? (defaults.trade as Trade) : 'General';
    const account = ws.accountByKey.get('repairs') ?? ws.expenseAccounts[0];
    return {
      name: text(defaults.name) ?? '', trade, contactName: '', email: '', phone: '', address: '', paymentTermsDays: 30, defaultAccountId: account?.id ?? null, hourlyRate: null,
      insuranceExpiresOn: null, w9OnFile: false, is1099: !['Utilities', 'Insurance'].includes(trade), taxIdLast4: '', licenseNumber: '', rating: null, portalEnabled: false,
      color: SWATCHES[Math.floor(Math.random() * SWATCHES.length)], notes: '',
    };
  };
  const [draft, setDraft] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      loadedFor.current = null;
      return;
    }
    setErrors({});
    if (!editing) setDraft(blank());
  }, [open]);

  // Fill the form once the vendor arrives, and never again while it's open (a refetch mustn't wipe edits).
  useEffect(() => {
    if (!open || !detail || loadedFor.current === detail.vendor.id) return;
    const v = detail.vendor;
    loadedFor.current = v.id;
    setDraft({
      name: v.name, trade: (VENDOR_TRADES.includes(v.trade as Trade) ? v.trade : 'Other') as Trade, contactName: v.contactName, email: v.email, phone: v.phone, address: v.address,
      paymentTermsDays: v.paymentTermsDays, defaultAccountId: v.defaultAccountId, hourlyRate: v.hourlyRate, insuranceExpiresOn: v.insuranceExpiresOn, w9OnFile: v.w9OnFile, is1099: v.is1099,
      taxIdLast4: v.taxIdLast4, licenseNumber: v.licenseNumber, rating: v.rating, portalEnabled: v.portalEnabled, color: v.color, notes: v.notes,
    });
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }, [open, detail]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }));
  };

  const account = draft.defaultAccountId ? ws.accountById.get(draft.defaultAccountId) : undefined;

  const submit = async () => {
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = 'Give the vendor a name.';
    if (draft.email.trim() && !EMAIL_RE.test(draft.email.trim())) next.email = 'Enter a valid email address.';
    if (draft.portalEnabled && !draft.email.trim()) next.email = 'Vendors sign in to the portal with their email — add one.';
    if (draft.taxIdLast4 && !/^\d{4}$/.test(draft.taxIdLast4)) next.taxIdLast4 = 'Four digits.';
    if (draft.rating != null && (draft.rating < 0 || draft.rating > 5)) next.rating = 'Between 0 and 5.';
    if (draft.paymentTermsDays != null && (draft.paymentTermsDays < 0 || draft.paymentTermsDays > 365 || !Number.isInteger(draft.paymentTermsDays))) next.paymentTermsDays = 'Whole days, up to 365.';
    if (Object.keys(next).length) {
      setErrors(next);
      if (next.name) nameRef.current?.focus();
      return;
    }
    const fields: VendorPatch = {
      name: draft.name.trim(), trade: draft.trade, contactName: draft.contactName.trim(), email: draft.email.trim(), phone: draft.phone.trim(), address: draft.address.trim(),
      paymentTermsDays: draft.paymentTermsDays, defaultAccountId: draft.defaultAccountId, hourlyRate: draft.hourlyRate, insuranceExpiresOn: draft.insuranceExpiresOn,
      w9OnFile: draft.w9OnFile, is1099: draft.is1099, taxIdLast4: draft.taxIdLast4.trim(), licenseNumber: draft.licenseNumber.trim(), rating: draft.rating == null ? null : Math.round(draft.rating * 10) / 10,
      portalEnabled: draft.portalEnabled, color: draft.color, notes: draft.notes,
    };
    setPending(true);
    try {
      if (editing && vendorId) {
        await saveVendor({ action: 'update', id: vendorId, patch: fields });
        toast.success('Vendor updated');
      } else {
        const res = await saveVendor({ action: 'create', vendor: { ...fields, name: draft.name.trim(), trade: draft.trade } });
        toast.success(`${draft.name.trim()} added`, { action: { label: 'Open', onClick: () => navigate(`/vendors/${res.id}`) } });
      }
      invalidate(qc, 'vendors', 'bootstrap');
      onOpenChange(false);
    } catch (e) {
      const msg = errorMessage(e, editing ? 'Couldn’t save the vendor' : 'Couldn’t add the vendor');
      if (/already a vendor called/i.test(msg)) setErrors({ name: msg });
      else if (/email/i.test(msg)) setErrors({ email: msg });
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={editing ? 'Edit vendor' : 'New vendor'} onSubmit={submit} pending={pending} disabled={editing && loading} submitLabel={editing ? 'Save changes' : 'Add vendor'} size="lg">
      {editing && loading ? (
        <SkeletonRows rows={8} />
      ) : editing && isError ? (
        <p className="text-[14px] text-tone-danger">This vendor couldn’t be loaded. Close the dialog and try again.</p>
      ) : (
        <div className="space-y-5">
          <section className="space-y-3">
            <FieldRow>
              <Field label="Company" error={errors.name}>
                <TextInput ref={nameRef} data-autofocus value={draft.name} onChange={e => set('name', e.target.value)} placeholder="Front Range Plumbing & Drain" invalid={Boolean(errors.name)} maxLength={200} />
              </Field>
              <Field label="Trade">
                <ChoicePicker options={VENDOR_TRADES} value={draft.trade} onChange={v => set('trade', v)} trigger={<FieldButton icon={<Hammer className="h-3.5 w-3.5 text-muted-foreground" />}>{draft.trade}</FieldButton>} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Contact" optional>
                <TextInput value={draft.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Who you call" maxLength={200} />
              </Field>
              <Field label="Phone" optional>
                <TextInput type="tel" value={draft.phone} onChange={e => set('phone', e.target.value)} placeholder="(303) 555-0100" maxLength={40} />
              </Field>
            </FieldRow>
            <Field label="Email" optional={!draft.portalEnabled} error={errors.email} hint="Work order assignments and messages are sent here.">
              <TextInput type="email" value={draft.email} onChange={e => set('email', e.target.value)} placeholder="dispatch@example.com" invalid={Boolean(errors.email)} maxLength={200} />
            </Field>
            <Field label="Address" optional>
              <TextArea rows={2} value={draft.address} onChange={e => set('address', e.target.value)} placeholder="Mailing address for checks and 1099s" className="min-h-[56px]" />
            </Field>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium text-muted-foreground">Billing</h3>
            <FieldRow cols={3}>
              <Field label="Payment terms" error={errors.paymentTermsDays}>
                <NumberInput value={draft.paymentTermsDays} onChange={v => set('paymentTermsDays', v)} min={0} max={365} suffix="days" invalid={Boolean(errors.paymentTermsDays)} />
              </Field>
              <Field label="Hourly rate" optional>
                <MoneyInput value={draft.hourlyRate} onChange={v => set('hourlyRate', v)} />
              </Field>
              <Field label="Rating" optional error={errors.rating}>
                <NumberInput value={draft.rating} onChange={v => set('rating', v)} min={0} max={5} step={0.1} suffix="/ 5" placeholder="—" invalid={Boolean(errors.rating)} />
              </Field>
            </FieldRow>
            <Field label="Default expense account" hint="Bills from this vendor start with this account.">
              <AccountPicker kind="expense" value={draft.defaultAccountId} onChange={id => set('defaultAccountId', id)} trigger={<FieldButton icon={<Landmark className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Choose an account" onClear={draft.defaultAccountId ? () => set('defaultAccountId', null) : undefined}>{account ? `${account.number} · ${account.name}` : null}</FieldButton>} />
            </Field>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium text-muted-foreground">Compliance</h3>
            <FieldRow cols={3}>
              <Field label="Insurance expires" optional>
                <DateInput value={draft.insuranceExpiresOn} onChange={v => set('insuranceExpiresOn', v)} />
              </Field>
              <Field label="Tax ID (last 4)" optional error={errors.taxIdLast4}>
                <TextInput inputMode="numeric" value={draft.taxIdLast4} onChange={e => set('taxIdLast4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" invalid={Boolean(errors.taxIdLast4)} className="num" />
              </Field>
              <Field label="License" optional>
                <TextInput value={draft.licenseNumber} onChange={e => set('licenseNumber', e.target.value)} placeholder="License number" maxLength={80} />
              </Field>
            </FieldRow>
            <div className="divide-y rounded-lg border px-3">
              <div className="py-1.5"><SwitchRow label="Issue a 1099" description="Payments this year go on the vendor’s 1099-NEC, so a W-9 is needed." checked={draft.is1099} onChange={v => set('is1099', v)} /></div>
              <div className="py-1.5"><SwitchRow label="W-9 on file" description={draft.is1099 && !draft.w9OnFile ? 'Missing — request one before year-end.' : 'You’ve received and checked their W-9.'} checked={draft.w9OnFile} onChange={v => set('w9OnFile', v)} /></div>
              <div className="py-1.5"><SwitchRow label="Vendor portal access" description="They can sign in with their email to see assigned work, message you and send invoices." checked={draft.portalEnabled} onChange={v => set('portalEnabled', v)} /></div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <Field label="Colour">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
                {SWATCHES.map(c => (
                  <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={c} onClick={() => set('color', c)} className={cn('h-6 w-6 rounded-md border-2 transition-transform', draft.color === c ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105')} style={{ background: c }} />
                ))}
              </div>
            </Field>
            <Field label="Notes" optional>
              <TextArea rows={3} value={draft.notes} onChange={e => set('notes', e.target.value)} placeholder="Service area, after-hours number, who to ask for…" />
            </Field>
          </section>
        </div>
      )}
    </FormDialog>
  );
}
