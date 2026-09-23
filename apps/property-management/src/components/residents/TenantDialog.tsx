import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveTenant } from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { Field, FieldRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { useResident } from './data';

/**
 * Add or edit a resident. Defaults it reads: `tenantId` (edit that resident),
 * and for a new one `name`, `email`, `phone`.
 *
 * Email is how a resident signs in to the portal, so an address another
 * resident already uses is flagged as you type.
 */

type Draft = { name: string; email: string; phone: string; altPhone: string; company: string; emergencyContact: string; emergencyPhone: string; pets: string; vehicles: string; notes: string };
const EMPTY: Draft = { name: '', email: '', phone: '', altPhone: '', company: '', emergencyContact: '', emergencyPhone: '', pets: '', vehicles: '', notes: '' };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export default function TenantDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tenantId = typeof defaults.tenantId === 'string' && defaults.tenantId ? defaults.tenantId : null;
  const { data, isPending: loading } = useResident(open ? tenantId : null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [duplicates, setDuplicates] = useState<Array<{ id: string; name: string }>>([]);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!open) {
      loaded.current = false;
      return;
    }
    setErrors({});
    setDuplicates([]);
    if (!tenantId) setDraft({ ...EMPTY, name: str(defaults.name), email: str(defaults.email), phone: str(defaults.phone) });
  }, [open]);

  useEffect(() => {
    if (!open || !tenantId || !data || loaded.current) return;
    loaded.current = true;
    const t = data.tenant;
    setDraft({ name: t.name, email: t.email, phone: t.phone, altPhone: t.altPhone, company: t.company, emergencyContact: t.emergencyContact, emergencyPhone: t.emergencyPhone, pets: t.pets, vehicles: t.vehicles, notes: t.notes });
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }, [open, data]);

  // Duplicate email check, as they type.
  useEffect(() => {
    if (!open) return;
    const email = draft.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || (tenantId && data && email.toLowerCase() === data.tenant.email.toLowerCase())) {
      setDuplicates([]);
      return;
    }
    const t = window.setTimeout(() => {
      saveTenant({ action: 'checkEmail', email, excludeId: tenantId ?? undefined })
        .then(res => setDuplicates(res.duplicates ?? []))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(t);
  }, [open, draft.email]);

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft(d => ({ ...d, [k]: e.target.value }));
    if (k === 'name' || k === 'email') setErrors(x => ({ ...x, [k]: undefined }));
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = 'Enter the resident’s name.';
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) next.email = 'That email address doesn’t look right.';
    setErrors(next);
    if (Object.keys(next).length) {
      if (next.name) nameRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const record = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim()])) as Draft;
      const res = tenantId ? await saveTenant({ action: 'update', id: tenantId, record }) : await saveTenant({ action: 'create', record });
      invalidate(qc, 'residents', 'leases', 'search', 'activity');
      const id = res.id!;
      if (tenantId) toast.success(`${record.name} updated`);
      else toast.success(`${record.name} added`, { description: 'Add them to a lease from their record, or when you create one.', action: { label: 'Open', onClick: () => navigate(`/residents/${id}`) } });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, tenantId ? 'Couldn’t save the changes' : 'Couldn’t add the resident') });
    } finally {
      setPending(false);
    }
  };

  const editingNotLoaded = Boolean(tenantId) && (loading || !data);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={tenantId ? `Edit ${data?.tenant.name ?? 'resident'}` : 'New resident'} onSubmit={submit} pending={pending} disabled={editingNotLoaded} submitLabel={tenantId ? 'Save changes' : 'Add resident'} size="lg">
      {editingNotLoaded ? (
        <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-9 w-full" />)}</div>
      ) : (
        <div className="space-y-4">
          <Field label="Name" error={errors.name} htmlFor="tenant-name">
            <TextInput ref={nameRef} id="tenant-name" data-autofocus value={draft.name} onChange={set('name')} maxLength={120} invalid={Boolean(errors.name)} placeholder="Full legal name" />
          </Field>
          <FieldRow>
            <Field label="Email" optional error={errors.email} hint={!duplicates.length ? 'How they sign in to the resident portal.' : undefined}>
              <TextInput type="email" value={draft.email} onChange={set('email')} maxLength={200} invalid={Boolean(errors.email)} />
            </Field>
            <Field label="Phone" optional>
              <TextInput type="tel" value={draft.phone} onChange={set('phone')} maxLength={40} />
            </Field>
          </FieldRow>
          {duplicates.length > 0 && (
            <div role="status" className="flex gap-2 rounded-md border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[14px]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-warning" />
              <p>
                {duplicates.map((d, i) => (
                  <span key={d.id}>{i > 0 && ', '}<Link to={`/residents/${d.id}`} onClick={() => onOpenChange(false)} className="font-medium underline-offset-2 hover:underline">{d.name}</Link></span>
                ))}{' '}
                already {duplicates.length === 1 ? 'uses' : 'use'} this email. Two residents with one email share a portal sign-in — if it’s the same person, open their record instead.
              </p>
            </div>
          )}
          <FieldRow>
            <Field label="Alternate phone" optional>
              <TextInput type="tel" value={draft.altPhone} onChange={set('altPhone')} maxLength={40} />
            </Field>
            <Field label="Company" optional hint="For commercial tenants.">
              <TextInput value={draft.company} onChange={set('company')} maxLength={120} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Emergency contact" optional>
              <TextInput value={draft.emergencyContact} onChange={set('emergencyContact')} maxLength={120} placeholder="Name and relationship" />
            </Field>
            <Field label="Emergency phone" optional>
              <TextInput type="tel" value={draft.emergencyPhone} onChange={set('emergencyPhone')} maxLength={40} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Pets" optional>
              <TextArea rows={2} value={draft.pets} onChange={set('pets')} maxLength={500} placeholder="e.g. Cat (Miso)" />
            </Field>
            <Field label="Vehicles" optional>
              <TextArea rows={2} value={draft.vehicles} onChange={set('vehicles')} maxLength={500} placeholder="e.g. Blue Subaru Outback · ABC-1234" />
            </Field>
          </FieldRow>
          <Field label="Notes" optional hint="Only your team sees these.">
            <TextArea rows={3} value={draft.notes} onChange={set('notes')} maxLength={5000} />
          </Field>
          {errors.form && <p role="alert" className="text-[14px] text-tone-danger">{errors.form}</p>}
        </div>
      )}
    </FormDialog>
  );
}
