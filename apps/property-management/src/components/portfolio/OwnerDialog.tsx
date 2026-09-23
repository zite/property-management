import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveOwner } from 'zitejs/api';
import { DISTRIBUTION_METHODS, OWNER_TYPES, SWATCHES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { Field, FieldRow, NumberInput, Segmented, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { SkeletonRows } from '../primitives/bits';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { ColorSwatches } from './bits';
import { afterPortfolioWrite, useOwner } from './data';

/**
 * New or edit owner. Defaults it reads:
 *   `ownerId`  — edit that owner
 *   `name`     — pre-fill the name (e.g. typed into an owner picker)
 *   `returnTo` — `'property'`: when this closes, reopen the property dialog's
 *                saved draft with the new owner selected
 *   `returnPropertyId` — with `returnTo`, the property being edited (none for a new one)
 */

type Draft = {
  name: string;
  ownerType: (typeof OWNER_TYPES)[number];
  contactName: string;
  email: string;
  phone: string;
  mailingAddress: string;
  taxIdLast4: string;
  managementFeePercent: number | null;
  distributionMethod: (typeof DISTRIBUTION_METHODS)[number];
  portalEnabled: boolean;
  color: string;
  notes: string;
};

const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function OwnerDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editId = s(defaults.ownerId);
  const returnTo = defaults.returnTo === 'property' ? 'property' : null;
  const detail = useOwner(editId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const seeded = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seeded.current = null;
      return;
    }
    const key = editId ?? 'new';
    if (seeded.current === key) return;
    if (editId) {
      const o = detail.data?.owner;
      if (!o) return;
      setDraft({
        name: o.name, ownerType: (OWNER_TYPES as readonly string[]).includes(o.ownerType) ? (o.ownerType as Draft['ownerType']) : 'Individual', contactName: o.contactName, email: o.email, phone: o.phone,
        mailingAddress: o.mailingAddress, taxIdLast4: o.taxIdLast4, managementFeePercent: o.managementFeePercent,
        distributionMethod: (DISTRIBUTION_METHODS as readonly string[]).includes(o.distributionMethod) ? (o.distributionMethod as Draft['distributionMethod']) : 'ACH', portalEnabled: o.portalEnabled, color: o.color, notes: o.notes,
      });
    } else {
      setDraft({
        name: s(defaults.name) ?? '', ownerType: 'Individual', contactName: '', email: '', phone: '', mailingAddress: '', taxIdLast4: '', managementFeePercent: null,
        distributionMethod: 'ACH', portalEnabled: false, color: SWATCHES[ws.owners.length % SWATCHES.length], notes: '',
      });
    }
    setErrors({});
    seeded.current = key;
  }, [open, editId, detail.data]);

  const set = (patch: Partial<Draft>) => {
    setDraft(d => (d ? { ...d, ...patch } : d));
    setErrors(e => (Object.keys(patch).some(k => e[k] || (k === 'portalEnabled' && e.email)) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch) && !(k === 'email' && 'portalEnabled' in patch))) : e));
  };

  /** Closing always hands back to the property draft when that's where we came from. */
  const close = (createdId?: string) => {
    onOpenChange(false);
    if (returnTo === 'property') app.openCreate('property', { restoreDraft: true, propertyId: s(defaults.returnPropertyId), ...(createdId ? { ownerId: createdId } : {}) });
  };

  const submit = async () => {
    const d = draft;
    if (!d) return;
    const next: Record<string, string> = {};
    if (!d.name.trim()) next.name = 'Give the owner a name.';
    if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) next.email = 'Enter a valid email address, or leave it blank.';
    if (d.portalEnabled && !d.email.trim()) next.email = 'Portal access needs an email — it’s how they sign in.';
    if (d.taxIdLast4 && !/^\d{4}$/.test(d.taxIdLast4)) next.taxIdLast4 = 'Just the last four digits.';
    if (d.managementFeePercent != null && (d.managementFeePercent < 0 || d.managementFeePercent > 100)) next.managementFeePercent = 'Use a fee between 0 and 100%.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const fields = { ...d, name: d.name.trim(), email: d.email.trim(), contactName: d.contactName.trim(), phone: d.phone.trim() };
    setPending(true);
    try {
      if (editId) {
        const res = await saveOwner({ action: 'update', id: editId, fields });
        afterPortfolioWrite(qc);
        toast.success(res.changed ? `Saved ${fields.name}` : 'No changes to save');
        close();
      } else {
        const res = await saveOwner({ action: 'create', fields });
        afterPortfolioWrite(qc);
        toast.success(`Added ${fields.name}`, returnTo ? { description: 'Selected as the owner of your new property.' } : { action: { label: 'Open', onClick: () => navigate(`/owners/${res.id}`) } });
        close(res.id);
      }
    } catch (e) {
      const msg = errorMessage(e, editId ? 'Couldn’t save the owner' : 'Couldn’t add the owner');
      if (/email/i.test(msg)) setErrors({ email: msg });
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  const d = draft;
  return (
    <FormDialog
      open={open}
      onOpenChange={o => (o ? onOpenChange(true) : close())}
      title={editId ? `Edit ${detail.data?.owner.name ?? 'owner'}` : 'New owner'}
      description={returnTo ? 'Add the owner, then you’ll be back on the property.' : editId ? undefined : 'The person or company that owns a property. Their statements and distributions follow from their properties.'}
      onSubmit={submit}
      pending={pending}
      disabled={!d}
      submitLabel={editId ? 'Save changes' : 'Add owner'}
      size="lg"
    >
      {!d ? (
        <SkeletonRows rows={7} />
      ) : (
        <div className="space-y-5">
          <FieldRow>
            <Field label="Name" error={errors.name} htmlFor="owner-name">
              <TextInput id="owner-name" data-autofocus autoFocus value={d.name} onChange={e => set({ name: e.target.value })} maxLength={120} invalid={Boolean(errors.name)} placeholder="Ridgeview Holdings LLC" />
            </Field>
            <Field label="Type">
              <Segmented value={d.ownerType} onChange={v => set({ ownerType: v as Draft['ownerType'] })} options={OWNER_TYPES.map(t => ({ value: t, label: t }))} className="w-full flex-wrap [&>button]:flex-1 [&>button]:justify-center" size="md" />
            </Field>
          </FieldRow>

          <div className="space-y-3">
            <FieldRow>
              <Field label={d.ownerType === 'Individual' ? 'Preferred name' : 'Contact person'} optional><TextInput value={d.contactName} onChange={e => set({ contactName: e.target.value })} maxLength={120} placeholder={d.ownerType === 'Individual' ? 'Anika' : 'Alan Whitfield'} /></Field>
              <Field label="Phone" optional><TextInput value={d.phone} onChange={e => set({ phone: e.target.value })} maxLength={40} type="tel" placeholder="(303) 555-0142" /></Field>
            </FieldRow>
            <Field label="Email" error={errors.email} optional hint={errors.email ? undefined : 'Statements and approvals go here. It’s also how they sign in to the owner portal.'}>
              <TextInput value={d.email} onChange={e => set({ email: e.target.value })} maxLength={200} type="email" invalid={Boolean(errors.email)} placeholder="owner@example.com" />
            </Field>
            <Field label="Mailing address" optional><TextArea value={d.mailingAddress} onChange={e => set({ mailingAddress: e.target.value })} rows={2} maxLength={500} placeholder={'1801 California St, Floor 22\nDenver, CO 80202'} /></Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Distributions" className="sm:col-span-1">
              <Segmented value={d.distributionMethod} onChange={v => set({ distributionMethod: v as Draft['distributionMethod'] })} options={DISTRIBUTION_METHODS.map(m => ({ value: m, label: m }))} className="w-full [&>button]:flex-1 [&>button]:justify-center" />
            </Field>
            <Field label="Management fee" optional error={errors.managementFeePercent} hint={errors.managementFeePercent ? undefined : `Blank uses the default, ${ws.settings.managementFeePercent}%.`}>
              <NumberInput value={d.managementFeePercent} onChange={v => set({ managementFeePercent: v })} min={0} max={100} step={0.25} suffix="%" placeholder={String(ws.settings.managementFeePercent)} invalid={Boolean(errors.managementFeePercent)} />
            </Field>
            <Field label="Tax ID (last 4)" optional error={errors.taxIdLast4} hint={errors.taxIdLast4 ? undefined : 'For 1099s. Never the full number.'}>
              <TextInput value={d.taxIdLast4} onChange={e => set({ taxIdLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" maxLength={4} placeholder="4471" invalid={Boolean(errors.taxIdLast4)} className="num" />
            </Field>
          </div>

          <div className="rounded-lg border px-3 py-2">
            <SwitchRow
              label="Owner portal access"
              description={d.email.trim() ? `${d.email.trim()} can sign in to see statements, distributions, approvals and shared documents.` : 'Add an email first — it’s how they sign in.'}
              checked={d.portalEnabled}
              onChange={v => set({ portalEnabled: v })}
              disabled={!d.email.trim() && !d.portalEnabled}
            />
          </div>

          <Field label="Colour"><ColorSwatches value={d.color} onChange={c => set({ color: c })} /></Field>
          <Field label="Internal notes" optional hint="Only your team sees these."><TextArea value={d.notes} onChange={e => set({ notes: e.target.value })} rows={3} maxLength={5000} placeholder="Preferences, approval limits, who to call…" /></Field>
        </div>
      )}
    </FormDialog>
  );
}
