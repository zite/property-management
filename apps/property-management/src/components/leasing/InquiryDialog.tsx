import { useQueryClient } from '@tanstack/react-query';
import { DoorOpen, FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveInquiry } from 'zitejs/api';
import { INQUIRY_SOURCES } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { todayString } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, Segmented, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { FieldButton, MemberPicker, UnitPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { OccupancyGlyph, PropertySwatch } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { afterLeasingWrite, useListings } from './data';

/**
 * New lead, logged by hand — a phone call, a walk-in, an email to the office.
 * Defaults it reads: `listingId`, `unitId`, `propertyId`, `name`, `email`,
 * `phone`, `source`, `message`.
 *
 * Picking a listing fills the unit; a unit without a live listing can be
 * chosen directly.
 */

type Source = (typeof INQUIRY_SOURCES)[number];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const s = (v: unknown) => (typeof v === 'string' && v ? v : null);

export default function InquiryDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listings = useListings();
  const initial = () => ({
    name: s(defaults.name) ?? '',
    email: s(defaults.email) ?? '',
    phone: s(defaults.phone) ?? '',
    message: s(defaults.message) ?? '',
    listingId: s(defaults.listingId),
    unitId: s(defaults.unitId),
    propertyId: s(defaults.propertyId),
    source: (INQUIRY_SOURCES.includes(defaults.source as Source) ? defaults.source : 'Phone') as Source,
    desiredMoveIn: null as string | null,
    assigneeId: ws.me.role === 'Leasing Agent' ? ws.me.id : (null as string | null),
  });
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(initial());
      setErrors({});
    }
  }, [open]);

  // A unit passed in without a listing picks up that unit's live listing.
  useEffect(() => {
    if (!open || draft.listingId || !draft.unitId || !listings.data) return;
    const live = listings.data.listings.find(l => l.unitId === draft.unitId && l.status === 'Published');
    if (live) setDraft(d => ({ ...d, listingId: live.id }));
  }, [open, listings.data]);

  const set = <K extends keyof ReturnType<typeof initial>>(k: K, v: ReturnType<typeof initial>[K]) => {
    setDraft(d => ({ ...d, [k]: v }));
    setErrors(e => ({ ...e, [k]: undefined, contact: k === 'email' || k === 'phone' ? undefined : e.contact }));
  };

  const listingOptions = useMemo(
    () => [
      { value: '__none__', label: 'No listing — choose a unit', icon: <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" /> },
      ...(listings.data?.listings ?? []).filter(l => l.status !== 'Leased').map(l => ({ value: l.id, label: l.title, hint: l.status === 'Published' ? ws.unitLabel(l.unitId, l.propertyId) : l.status, keywords: [l.propertyName, l.unitName], icon: <PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} />, group: l.status === 'Published' ? 'Live listings' : 'Not live' })),
    ],
    [listings.data, ws],
  );
  const listing = listings.data?.listings.find(l => l.id === draft.listingId);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (draft.name.trim().length < 2) next.name = 'Enter their name.';
    if (!draft.email.trim() && !draft.phone.trim()) next.contact = 'Add an email or a phone number so you can follow up.';
    if (draft.email.trim() && !EMAIL_RE.test(draft.email.trim())) next.email = 'That email address doesn’t look right.';
    if (Object.keys(next).length) return setErrors(next);
    setPending(true);
    try {
      const res = await saveInquiry({
        action: 'create',
        fields: {
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          message: draft.message.trim(),
          listingId: draft.listingId,
          unitId: draft.listingId ? null : draft.unitId,
          propertyId: draft.listingId || draft.unitId ? null : draft.propertyId,
          source: draft.source,
          desiredMoveIn: draft.desiredMoveIn,
          assigneeId: draft.assigneeId,
        },
      });
      afterLeasingWrite(qc);
      toast.success(`Lead added: ${draft.name.trim()}`, { action: res.id ? { label: 'Open', onClick: () => navigate(`/leasing/leads?lead=${res.id}`) } : undefined });
      onOpenChange(false);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'The lead wasn’t saved. Try again.') });
    } finally {
      setPending(false);
    }
  };

  const assignee = draft.assigneeId ? ws.memberById.get(draft.assigneeId) : undefined;
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New lead" description="Someone who called, walked in or emailed about a home." onSubmit={submit} pending={pending} submitLabel="Add lead" footerStart={errors.form ? <span className="text-tone-danger">{errors.form}</span> : undefined}>
      <div className="space-y-4">
        <Field label="Name" error={errors.name} htmlFor="lead-name">
          <TextInput id="lead-name" autoFocus value={draft.name} onChange={e => set('name', e.target.value)} placeholder="Full name" maxLength={120} invalid={Boolean(errors.name)} />
        </Field>
        <FieldRow>
          <Field label="Email" error={errors.email ?? errors.contact} htmlFor="lead-email">
            <TextInput id="lead-email" type="email" value={draft.email} onChange={e => set('email', e.target.value)} placeholder="name@example.com" maxLength={254} invalid={Boolean(errors.email ?? errors.contact)} />
          </Field>
          <Field label="Phone" htmlFor="lead-phone">
            <TextInput id="lead-phone" type="tel" value={draft.phone} onChange={e => set('phone', e.target.value)} placeholder="(303) 555-0100" maxLength={40} invalid={Boolean(errors.contact)} />
          </Field>
        </FieldRow>
        <Field label="How they reached you">
          <Segmented options={INQUIRY_SOURCES.filter(x => x !== 'Portal').map(x => ({ value: x, label: x }))} value={draft.source} onChange={v => set('source', v as Source)} className="flex-wrap" size="sm" />
        </Field>
        <Field label="Interested in" optional>
          <OptionPicker
            options={listingOptions}
            value={draft.listingId ?? '__none__'}
            onChange={v => setDraft(d => ({ ...d, listingId: v === '__none__' ? null : v, unitId: v === '__none__' ? d.unitId : null }))}
            width={380}
            placeholder="Find a listing…"
            trigger={<FieldButton icon={listing ? <PropertySwatch color={ws.propertyById.get(listing.propertyId ?? '')?.color} /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Choose a listing" onClear={draft.listingId ? () => set('listingId', null) : undefined}>{listing?.title ?? null}</FieldButton>}
          />
        </Field>
        {!draft.listingId && (
          <Field label="Unit" optional>
            <UnitPicker value={draft.unitId} onChange={(unitId, propertyId) => setDraft(d => ({ ...d, unitId, propertyId }))} onlyVacant trigger={<FieldButton icon={draft.unitId ? <OccupancyGlyph occupancy={ws.unitById.get(draft.unitId)?.occupancy ?? 'Vacant'} /> : <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Vacant or on-notice unit" onClear={draft.unitId ? () => setDraft(d => ({ ...d, unitId: null })) : undefined}>{draft.unitId ? ws.unitLabel(draft.unitId) : null}</FieldButton>} />
          </Field>
        )}
        <FieldRow>
          <Field label="Desired move-in" optional>
            <DateInput value={draft.desiredMoveIn} onChange={d => set('desiredMoveIn', d)} min={todayString()} />
          </Field>
          <Field label="Assignee" optional>
            <MemberPicker value={draft.assigneeId} onChange={id => set('assigneeId', id)} filter={m => ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)} trigger={<FieldButton icon={assignee ? <MemberAvatar member={assignee} size={16} /> : <UnassignedAvatar size={16} />} placeholder="Unassigned">{assignee?.name ?? null}</FieldButton>} />
          </Field>
        </FieldRow>
        <Field label="What they asked" optional>
          <TextArea rows={3} value={draft.message} onChange={e => set('message', e.target.value)} placeholder="e.g. Wants to see it Saturday morning. Has a small dog. Moving from Boulder for work." maxLength={5000} />
        </Field>
      </div>
    </FormDialog>
  );
}
