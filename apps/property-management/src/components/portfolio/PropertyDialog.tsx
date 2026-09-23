import { useQueryClient } from '@tanstack/react-query';
import { Building, Building2, Home, Landmark, Store, Warehouse } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveProperty } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Switch } from '@project/components/ui/switch';
import { PROPERTY_TYPES, type PropertyType } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, NumberInput, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { AccountPicker, FieldButton, MemberPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { Avatar, MemberAvatar } from '../primitives/Avatar';
import { SkeletonRows } from '../primitives/bits';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { ChipsInput, ColorSwatches, PhotoField, PropertyThumb } from './bits';
import { afterPortfolioWrite, isSingleUnitType, useProperty } from './data';
import { defaultGenerator, generateUnits, generatorProblems, UnitGenerator, type GeneratorState } from './UnitGenerator';

/**
 * New or edit property. Defaults it reads:
 *   `propertyId` — edit that property
 *   `ownerId`    — pre-select the owner (e.g. from an owner's page)
 *   `name`       — pre-fill the name
 *   `restoreDraft` — internal: come back to the draft saved before "New owner…"
 *
 * A new multi-unit property can create its units in the same step (a naming
 * pattern with a live preview); a single-family home or condo is created as
 * one unit, so it can be leased straight away.
 */

const DRAFT_KEY = 'property-management:property-draft';

type Draft = {
  name: string;
  code: string;
  codeTouched: boolean;
  propertyType: PropertyType;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  ownerId: string | null;
  managerId: string | null;
  bankAccountId: string | null;
  reserveAmount: number | null;
  managementFeePercent: number | null;
  yearBuilt: number | null;
  acquiredOn: string | null;
  amenities: string[];
  photoUrl: string | null;
  color: string;
  description: string;
  petPolicy: string;
  parking: string;
  notes: string;
  createUnits: boolean;
  generator: GeneratorState;
  single: { beds: number | null; baths: number | null; squareFeet: number | null; marketRent: number | null; depositAmount: number | null };
};

const TYPE_ICON: Record<PropertyType, ReactNode> = {
  'Single-family': <Home />,
  Multifamily: <Building2 />,
  Condo: <Building />,
  Townhome: <Warehouse />,
  Commercial: <Store />,
  'Mixed-use': <Landmark />,
};

const AMENITY_SUGGESTIONS = ['On-site laundry', 'In-unit washer & dryer', 'Parking', 'Garage', 'Elevator', 'Fitness room', 'Package lockers', 'Bike storage', 'Pet friendly', 'Central air', 'Yard'];

const s = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** "The Alder" → ALD, "2217 Elm Street" → ELM, then a digit until it's unique. */
export function suggestCode(name: string, taken: Set<string>) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const word = words.find(w => !/^(THE|A|AN|AT|ON|OF)$/.test(w) && !/^\d+$/.test(w)) ?? words[0] ?? '';
  const base = word.replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!base) return '';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return base;
}

export default function PropertyDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editId = s(defaults.propertyId);
  const detail = useProperty(editId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [more, setMore] = useState(false);
  const seeded = useRef<string | null>(null);

  const takenCodes = useMemo(() => new Set(ws.properties.filter(p => p.id !== editId).map(p => p.code.toUpperCase())), [ws.properties, editId]);

  const blank = (): Draft => ({
    name: s(defaults.name) ?? '',
    code: '',
    codeTouched: false,
    propertyType: 'Multifamily',
    street: '',
    city: '',
    state: '',
    postalCode: '',
    ownerId: s(defaults.ownerId),
    managerId: ['Admin', 'Property Manager'].includes(ws.me.role) ? ws.me.id : null,
    bankAccountId: ws.accountByKey.get('operating_bank')?.id ?? ws.bankAccounts[0]?.id ?? null,
    reserveAmount: null,
    managementFeePercent: null,
    yearBuilt: null,
    acquiredOn: null,
    amenities: [],
    photoUrl: null,
    color: '#0d9488',
    description: '',
    petPolicy: '',
    parking: '',
    notes: '',
    createUnits: true,
    generator: defaultGenerator(),
    single: { beds: 3, baths: 2, squareFeet: null, marketRent: null, depositAmount: null },
  });

  // Reset whenever the dialog opens; for an edit, once the record has loaded.
  useEffect(() => {
    if (!open) {
      seeded.current = null;
      return;
    }
    const key = editId ?? 'new';
    if (seeded.current === key) return;
    let restored: Draft | null = null;
    if (defaults.restoreDraft) {
      try {
        restored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        restored = null;
      }
    }
    if (restored) {
      setDraft({ ...restored, ownerId: s(defaults.ownerId) ?? restored.ownerId });
      setMore(Boolean(restored.description || restored.petPolicy || restored.parking || restored.notes));
    } else if (editId) {
      const p = detail.data?.property;
      if (!p) return;
      setDraft({
        ...blank(),
        name: p.name, code: p.code, codeTouched: true, propertyType: (PROPERTY_TYPES as readonly string[]).includes(p.propertyType) ? (p.propertyType as PropertyType) : 'Multifamily',
        street: p.street, city: p.city, state: p.state, postalCode: p.postalCode, ownerId: p.ownerId, managerId: p.managerId, bankAccountId: p.bankAccountId,
        reserveAmount: p.reserveAmount, managementFeePercent: p.managementFeePercent, yearBuilt: p.yearBuilt, acquiredOn: p.acquiredOn, amenities: p.amenities,
        photoUrl: p.photoUrl, color: p.color, description: p.description, petPolicy: p.petPolicy, parking: p.parking, notes: p.notes, createUnits: false,
      });
      setMore(Boolean(p.description || p.petPolicy || p.parking || p.notes));
    } else {
      setDraft(blank());
      setMore(false);
    }
    setErrors({});
    seeded.current = key;
  }, [open, editId, detail.data]);

  const set = (patch: Partial<Draft>) => {
    setDraft(d => (d ? { ...d, ...patch } : d));
    setErrors(e => (Object.keys(patch).some(k => e[k] || (k === 'generator' && e.units)) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch) && !(k === 'units' && 'generator' in patch))) : e));
  };
  const d = draft;
  const single = d ? isSingleUnitType(d.propertyType) : false;
  const owner = d?.ownerId ? ws.ownerById.get(d.ownerId) : undefined;
  const manager = d?.managerId ? ws.memberById.get(d.managerId) : undefined;
  const bank = d?.bankAccountId ? ws.accountById.get(d.bankAccountId) : undefined;
  const generatorIssues = d && !editId && !single && d.createUnits ? generatorProblems(d.generator) : [];

  const ownerOptions = useMemo(
    () => ws.owners.filter(o => o.status !== 'Archived' || o.id === d?.ownerId).map(o => ({ value: o.id, label: o.name, icon: <Avatar name={o.name} color={o.color} size={16} />, hint: o.ownerType, keywords: [o.contactName, o.email] })),
    [ws.owners, d?.ownerId],
  );

  const newOwner = (name?: string) => {
    if (!d) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* storage unavailable — the owner dialog still works, the draft is lost */
    }
    app.openCreate('owner', { name: name ?? '', returnTo: 'property', returnPropertyId: editId });
  };

  const submit = async () => {
    if (!d) return;
    const next: Record<string, string> = {};
    const code = d.code.trim().toUpperCase();
    if (!d.name.trim()) next.name = 'Give the property a name.';
    if (!code) next.code = 'Add a short code — it appears on lists and statements.';
    else if (!/^[A-Z0-9][A-Z0-9-]{0,9}$/.test(code)) next.code = 'Use 1–10 letters, numbers or dashes.';
    else if (takenCodes.has(code)) next.code = `${ws.properties.find(p => p.code.toUpperCase() === code)?.name ?? 'Another property'} already uses ${code}.`;
    if (d.managementFeePercent != null && (d.managementFeePercent < 0 || d.managementFeePercent > 100)) next.managementFeePercent = 'Use a fee between 0 and 100%.';
    if (d.yearBuilt != null && (d.yearBuilt < 1600 || d.yearBuilt > 2200)) next.yearBuilt = 'Enter a four-digit year.';
    if (generatorIssues.length) next.units = generatorIssues[0];
    setErrors(next);
    if (Object.keys(next).length) return;

    const fields = {
      name: d.name.trim(), code, propertyType: d.propertyType, street: d.street.trim(), city: d.city.trim(), state: d.state.trim(), postalCode: d.postalCode.trim(),
      ownerId: d.ownerId, managerId: d.managerId, bankAccountId: d.bankAccountId, reserveAmount: d.reserveAmount ?? 0, managementFeePercent: d.managementFeePercent,
      yearBuilt: d.yearBuilt, acquiredOn: d.acquiredOn, amenities: d.amenities, photoUrl: d.photoUrl, color: d.color, description: d.description, petPolicy: d.petPolicy, parking: d.parking, notes: d.notes,
    };
    setPending(true);
    try {
      if (editId) {
        const res = await saveProperty({ action: 'update', id: editId, fields });
        afterPortfolioWrite(qc);
        toast.success(res.changed ? `Saved ${fields.name}` : 'No changes to save');
      } else {
        const units = single
          ? [{ name: 'Main', beds: d.single.beds ?? 0, baths: d.single.baths ?? 1, squareFeet: d.single.squareFeet, marketRent: d.single.marketRent ?? 0, depositAmount: d.single.depositAmount ?? d.single.marketRent ?? 0, unitType: '', floor: '' }]
          : d.createUnits ? generateUnits(d.generator).map(u => ({ ...u, floor: '' })) : [];
        const res = await saveProperty({ action: 'create', fields, units });
        afterPortfolioWrite(qc);
        toast.success(`Added ${fields.name}`, {
          description: single ? 'Created as a single unit, ready to lease.' : res.unitsCreated ? `With ${plural(res.unitsCreated, 'unit')}.` : 'Add units from the property’s Units tab.',
          action: { label: 'Open', onClick: () => navigate(`/properties/${res.id}`) },
        });
      }
      onOpenChange(false);
    } catch (e) {
      const msg = errorMessage(e, editId ? 'Couldn’t save the property' : 'Couldn’t add the property');
      if (/code/i.test(msg)) setErrors({ code: msg });
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  const feeHint = owner?.managementFeePercent != null ? `${owner.name}’s rate: ${owner.managementFeePercent}%` : `Default: ${ws.settings.managementFeePercent}%`;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? `Edit ${detail.data?.property.name ?? 'property'}` : 'New property'}
      description={editId ? undefined : 'Add a building or home you manage. You can change any of this later.'}
      onSubmit={submit}
      pending={pending}
      disabled={!d}
      submitLabel={editId ? 'Save changes' : single ? 'Add property' : d?.createUnits && generateUnits(d.generator).length ? `Add property & ${plural(generateUnits(d.generator).length, 'unit')}` : 'Add property'}
      size="lg"
    >
      {!d ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <FieldRow>
              <Field label="Name" error={errors.name} htmlFor="prop-name">
                <TextInput
                  id="prop-name"
                  data-autofocus
                  autoFocus
                  value={d.name}
                  maxLength={120}
                  invalid={Boolean(errors.name)}
                  placeholder="The Alder"
                  onChange={e => set({ name: e.target.value, ...(d.codeTouched ? {} : { code: suggestCode(e.target.value, takenCodes) }) })}
                />
              </Field>
              <Field label="Short code" error={errors.code} hint={errors.code ? undefined : 'Unique. Shown on lists and statements.'} htmlFor="prop-code">
                <TextInput id="prop-code" value={d.code} maxLength={10} invalid={Boolean(errors.code)} placeholder="ALD" className="font-mono uppercase" onChange={e => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''), codeTouched: true })} />
              </Field>
            </FieldRow>
            <Field label="Type">
              <div role="radiogroup" aria-label="Property type" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {PROPERTY_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={d.propertyType === t}
                    onClick={() => set({ propertyType: t })}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-md border px-2.5 text-[14px] transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
                      d.propertyType === t ? 'border-primary/60 bg-primary/[0.06] font-medium text-foreground ring-1 ring-primary/30' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {TYPE_ICON[t]} {t}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="space-y-3">
            <Field label="Street address" htmlFor="prop-street"><TextInput id="prop-street" value={d.street} onChange={e => set({ street: e.target.value })} maxLength={200} placeholder="1450 N Marion St" /></Field>
            <div className="grid grid-cols-6 gap-3">
              <Field label="City" className="col-span-6 sm:col-span-3"><TextInput value={d.city} onChange={e => set({ city: e.target.value })} maxLength={100} placeholder="Denver" /></Field>
              <Field label="State" className="col-span-3 sm:col-span-1"><TextInput value={d.state} onChange={e => set({ state: e.target.value })} maxLength={40} placeholder="CO" /></Field>
              <Field label="ZIP" className="col-span-3 sm:col-span-2"><TextInput value={d.postalCode} onChange={e => set({ postalCode: e.target.value })} maxLength={20} inputMode="numeric" placeholder="80218" /></Field>
            </div>
          </div>

          <FieldRow>
            <Field label="Owner" optional>
              <OptionPicker
                options={ownerOptions}
                value={d.ownerId}
                onChange={v => set({ ownerId: v })}
                placeholder="Find an owner…"
                width={300}
                emptyText="No owners match"
                onCreate={q => newOwner(q)}
                createLabel={q => `New owner “${q}”…`}
                footer={<button type="button" onClick={() => newOwner()} className="flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground">+ New owner…</button>}
                trigger={
                  <FieldButton placeholder="No owner yet" icon={owner ? <Avatar name={owner.name} color={owner.color} size={16} /> : undefined} onClear={d.ownerId ? () => set({ ownerId: null }) : undefined}>
                    {owner?.name}
                  </FieldButton>
                }
              />
            </Field>
            <Field label="Manager" optional>
              <MemberPicker
                value={d.managerId}
                onChange={id => set({ managerId: id })}
                noneLabel="No manager"
                filter={m => m.role === 'Admin' || m.role === 'Property Manager'}
                trigger={<FieldButton placeholder="No manager" icon={manager ? <MemberAvatar member={manager} size={16} /> : undefined}>{manager ? (manager.id === ws.me.id ? `${manager.name} (you)` : manager.name) : null}</FieldButton>}
              />
            </Field>
          </FieldRow>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Operating account" className="sm:col-span-1">
              <AccountPicker kind="bank" value={d.bankAccountId} onChange={id => set({ bankAccountId: id })} trigger={<FieldButton placeholder="Choose a bank account">{bank?.name}</FieldButton>} />
            </Field>
            <Field label="Reserve" hint="Held back from distributions." optional>
              <MoneyInput value={d.reserveAmount} onChange={v => set({ reserveAmount: v })} />
            </Field>
            <Field label="Management fee" hint={errors.managementFeePercent ? undefined : feeHint} error={errors.managementFeePercent} optional>
              <NumberInput value={d.managementFeePercent} onChange={v => set({ managementFeePercent: v })} min={0} max={100} step={0.25} suffix="%" placeholder="Override" invalid={Boolean(errors.managementFeePercent)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <Field label="Photo" optional>
              <PhotoField value={d.photoUrl} onChange={url => set({ photoUrl: url })} fallback={<PropertyThumb color={d.color} code={d.code} name={d.name} size={40} />} />
            </Field>
            <Field label="Colour" hint="Marks the property on lists, boards and charts.">
              <ColorSwatches value={d.color} onChange={c => set({ color: c })} />
            </Field>
          </div>

          <FieldRow>
            <Field label="Year built" error={errors.yearBuilt} optional><NumberInput value={d.yearBuilt} onChange={v => set({ yearBuilt: v })} min={1600} max={2200} placeholder="1962" invalid={Boolean(errors.yearBuilt)} /></Field>
            <Field label="Acquired" optional><DateInput value={d.acquiredOn} onChange={v => set({ acquiredOn: v })} /></Field>
          </FieldRow>

          <Field label="Amenities" optional>
            <ChipsInput value={d.amenities} onChange={v => set({ amenities: v })} placeholder="Type and press Enter" suggestions={d.amenities.length < 6 ? AMENITY_SUGGESTIONS : []} />
          </Field>

          {more ? (
            <div className="space-y-3">
              <Field label="Description" optional hint="Shown on listings for units at this property."><TextArea value={d.description} onChange={e => set({ description: e.target.value })} rows={3} maxLength={5000} /></Field>
              <FieldRow>
                <Field label="Pet policy" optional><TextInput value={d.petPolicy} onChange={e => set({ petPolicy: e.target.value })} maxLength={300} placeholder="Cats and dogs under 40 lb" /></Field>
                <Field label="Parking" optional><TextInput value={d.parking} onChange={e => set({ parking: e.target.value })} maxLength={300} placeholder="Off-street lot, $75/mo" /></Field>
              </FieldRow>
              <Field label="Internal notes" optional hint="Only your team sees these."><TextArea value={d.notes} onChange={e => set({ notes: e.target.value })} rows={2} maxLength={5000} /></Field>
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="text-[14px] text-primary hover:underline">Add description, pet policy, parking and notes</button>
          )}

          {!editId && (
            <div className="space-y-3 border-t pt-4">
              {single ? (
                <>
                  <div>
                    <h3 className="text-[14px] font-medium">The home</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">A {d.propertyType.toLowerCase()} property is created as one unit, so it can be listed and leased straight away.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Field label="Beds"><NumberInput value={d.single.beds} onChange={v => set({ single: { ...d.single, beds: v } })} min={0} max={20} /></Field>
                    <Field label="Baths"><NumberInput value={d.single.baths} onChange={v => set({ single: { ...d.single, baths: v } })} min={0} max={20} step={0.5} /></Field>
                    <Field label="Sq ft" optional><NumberInput value={d.single.squareFeet} onChange={v => set({ single: { ...d.single, squareFeet: v } })} min={0} /></Field>
                    <Field label="Market rent"><MoneyInput value={d.single.marketRent} onChange={v => set({ single: { ...d.single, marketRent: v } })} /></Field>
                    <Field label="Deposit" optional><MoneyInput value={d.single.depositAmount} onChange={v => set({ single: { ...d.single, depositAmount: v } })} placeholder={d.single.marketRent != null ? d.single.marketRent.toFixed(2) : '0.00'} /></Field>
                  </div>
                </>
              ) : (
                <>
                  <label className="flex cursor-pointer items-start justify-between gap-4">
                    <span>
                      <span className="block text-[14px] font-medium">Create units now</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">Name them with a pattern and set what each starts with. You can edit any unit afterwards.</span>
                    </span>
                    <Switch checked={d.createUnits} onCheckedChange={v => set({ createUnits: v })} className="mt-0.5" aria-label="Create units now" />
                  </label>
                  {d.createUnits && <UnitGenerator value={d.generator} onChange={g => set({ generator: g })} />}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </FormDialog>
  );
}
