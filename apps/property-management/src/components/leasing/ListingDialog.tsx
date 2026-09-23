import { useQueryClient } from '@tanstack/react-query';
import { DoorOpen, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveListing } from 'zitejs/api';
import { PET_POLICIES } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { addDays, bedsBaths, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton, UnitPicker } from '../pickers/pickers';
import { OccupancyGlyph } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { afterLeasingWrite, useListings } from './data';
import { LEASE_TERM_SUGGESTIONS, listingTitleTemplate } from './rules';

/**
 * New listing from a vacant or on-notice unit. Defaults it reads: `unitId`,
 * `propertyId` (narrows the unit picker).
 *
 * Choosing the unit fills the title, market rent, deposit and the date it's
 * available; a blank description is written from the unit and building
 * details. The listing starts as a draft so photos can be added before it
 * goes live.
 */

type Pet = (typeof PET_POLICIES)[number];
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export default function ListingDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listings = useListings();
  const [unitId, setUnitId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [rent, setRent] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number | null>(null);
  const [availableOn, setAvailableOn] = useState<string | null>(null);
  const [leaseTerm, setLeaseTerm] = useState('12 months');
  const [petPolicy, setPetPolicy] = useState<Pet | null>(null);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState(false);
  const propertyScope = str(defaults.propertyId);

  const applyUnit = (id: string | null, touched = titleTouched) => {
    setUnitId(id);
    setErrors(e => ({ ...e, unitId: undefined }));
    const u = id ? ws.unitById.get(id) : undefined;
    if (!u) return;
    const p = ws.propertyById.get(u.propertyId);
    if (!touched) setTitle(listingTitleTemplate({ propertyName: p?.name ?? '', unitName: (ws.unitsByProperty.get(u.propertyId)?.length ?? 0) > 1 ? u.name : '', beds: u.beds, propertyType: p?.propertyType ?? '' }));
    setRent(u.marketRent || null);
    setDeposit(u.depositAmount || null);
    const after = u.moveOutDate ? addDays(1, u.moveOutDate) : null;
    setAvailableOn(u.availableOn && u.availableOn >= ws.today ? u.availableOn : after && after > ws.today ? after : ws.today);
  };

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTitleTouched(false);
    setLeaseTerm('12 months');
    setPetPolicy(null);
    setDescription('');
    setErrors({});
    setRent(null);
    setDeposit(null);
    setAvailableOn(null);
    applyUnit(str(defaults.unitId), false);
  }, [open]);

  const unit = unitId ? ws.unitById.get(unitId) : undefined;
  const existing = useMemo(() => (unitId ? (listings.data?.listings ?? []).filter(l => l.unitId === unitId && l.status !== 'Leased') : []), [listings.data, unitId]);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!unitId) next.unitId = 'Choose the unit to list.';
    if (title.trim().length < 3) next.title = 'Give the listing a title.';
    if (Object.keys(next).length) return setErrors(next);
    setPending(true);
    try {
      const res = await saveListing({
        action: 'create',
        unitId: unitId!,
        fields: { title: title.trim(), rent, deposit, availableOn, leaseTerm: leaseTerm.trim(), petPolicy, ...(description.trim() ? { description: description.trim() } : {}) },
      });
      afterLeasingWrite(qc);
      toast.success('Draft listing created', { description: 'Add photos, check the description, then publish.', action: { label: 'Open', onClick: () => navigate(`/listings/${res.id}`) } });
      onOpenChange(false);
      navigate(`/listings/${res.id}`);
    } catch (e) {
      setErrors({ form: errorMessage(e, 'The listing wasn’t created. Try again.') });
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New listing" description="Market a vacant home on your portal. It starts as a draft." onSubmit={submit} pending={pending} submitLabel="Create draft" size="lg" footerStart={errors.form ? <span className="text-tone-danger">{errors.form}</span> : undefined}>
      <div className="space-y-4">
        <Field label="Unit" error={errors.unitId} hint={unit ? `${bedsBaths(unit.beds, unit.baths, unit.squareFeet)} · ${unit.occupancy === 'Notice' ? `on notice${unit.moveOutDate ? `, moving out ${shortDate(unit.moveOutDate)}` : ''}` : unit.occupancy.toLowerCase()} · ${unit.readiness}` : 'Vacant units and units on notice.'}>
          <UnitPicker
            value={unitId}
            propertyId={propertyScope}
            onlyVacant
            onChange={id => applyUnit(id)}
            trigger={<FieldButton data-autofocus icon={unit ? <OccupancyGlyph occupancy={unit.occupancy} /> : <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Choose a vacant or on-notice unit" invalid={Boolean(errors.unitId)}>{unitId ? ws.unitLabel(unitId) : null}</FieldButton>}
          />
        </Field>
        {existing.length > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[13.5px]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-warning" />
            <span>This unit already has {existing.length === 1 ? `a ${existing[0].status.toLowerCase()} listing` : `${existing.length} listings`}: “{existing[0].title}”. You can still create another, but only one can be live at a time.</span>
          </p>
        )}
        <Field label="Title" error={errors.title} htmlFor="listing-title">
          <TextInput id="listing-title" value={title} onChange={e => { setTitle(e.target.value); setTitleTouched(true); setErrors(x => ({ ...x, title: undefined })); }} placeholder="e.g. Sunny 2-bed with balcony at The Alder" maxLength={120} invalid={Boolean(errors.title)} />
        </Field>
        <FieldRow cols={3}>
          <Field label="Rent / month" hint={unit?.marketRent ? `Market ${ws.money(unit.marketRent, { cents: false })}` : undefined}>
            <MoneyInput value={rent} onChange={setRent} />
          </Field>
          <Field label="Deposit">
            <MoneyInput value={deposit} onChange={setDeposit} />
          </Field>
          <Field label="Available on">
            <DateInput value={availableOn} onChange={setAvailableOn} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Lease term">
            <TextInput list="ks-new-lease-terms" value={leaseTerm} onChange={e => setLeaseTerm(e.target.value)} maxLength={60} />
            <datalist id="ks-new-lease-terms">{LEASE_TERM_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Pets" optional>
            <ChoicePicker options={PET_POLICIES} value={petPolicy} onChange={v => setPetPolicy(v)} trigger={<FieldButton placeholder="Choose a pet policy" onClear={petPolicy ? () => setPetPolicy(null) : undefined}>{petPolicy}</FieldButton>} />
          </Field>
        </FieldRow>
        <Field label="Description" optional hint="Leave it blank and one is drafted from the unit and building details — you can rewrite it on the listing.">
          <TextArea rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={8000} placeholder="Layout, light, updates, what’s nearby…" />
        </Field>
      </div>
    </FormDialog>
  );
}
