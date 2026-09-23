import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveUnit } from 'zitejs/api';
import { UNIT_READINESS, type UnitReadiness } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, NumberInput, Segmented, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { FieldButton, PropertyPicker } from '../pickers/pickers';
import { SkeletonRows } from '../primitives/bits';
import { PropertySwatch } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { Photos, type Photo } from '../workOrders/Photos';
import { ChipsInput, ReadinessGlyph } from './bits';
import { afterPortfolioWrite, useUnitDetail } from './data';
import { defaultGenerator, generateUnits, generatorProblems, UnitGenerator, type GeneratorState } from './UnitGenerator';

/**
 * New or edit unit. Defaults it reads:
 *   `propertyId` — the property to add to (required to add; locked when given)
 *   `unitId`     — edit that unit
 *   `many`       — open in "several units" mode
 *
 * Adding can create one unit with every field, or several from a naming
 * pattern. Editing includes archiving, which the server refuses while the
 * unit has an active or pending lease.
 */

type Draft = {
  propertyId: string | null;
  name: string;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  floor: string;
  unitType: string;
  marketRent: number | null;
  depositAmount: number | null;
  readiness: UnitReadiness;
  availableOn: string | null;
  features: string[];
  photos: Photo[];
  description: string;
  notes: string;
  many: boolean;
  generator: GeneratorState;
};

const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
const FEATURE_SUGGESTIONS = ['Dishwasher', 'Hardwood floors', 'Balcony', 'Washer & dryer', 'Walk-in closet', 'Central air', 'Updated kitchen'];

export default function UnitDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editId = s(defaults.unitId);
  const detail = useUnitDetail(editId);
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
      const u = detail.data?.unit;
      if (!u) return;
      setDraft({
        propertyId: u.propertyId, name: u.name, beds: u.beds, baths: u.baths, squareFeet: u.squareFeet, floor: u.floor, unitType: u.unitType, marketRent: u.marketRent, depositAmount: u.depositAmount,
        readiness: (UNIT_READINESS as readonly string[]).includes(u.readiness) ? (u.readiness as UnitReadiness) : 'Ready', availableOn: u.availableOn, features: u.features,
        photos: u.photoUrls.map((url, i) => ({ url, name: `Photo ${i + 1}` })), description: u.description, notes: u.notes, many: false, generator: defaultGenerator(),
      });
    } else {
      const propertyId = s(defaults.propertyId);
      const siblings = propertyId ? ws.unitsByProperty.get(propertyId) ?? [] : [];
      const last = siblings[siblings.length - 1];
      const gen = defaultGenerator();
      const lastNumber = siblings.map(u => Number(u.name)).filter(n => Number.isFinite(n)).sort((a, b) => b - a)[0];
      setDraft({
        propertyId, name: '', beds: last?.beds ?? 1, baths: last?.baths ?? 1, squareFeet: last?.squareFeet ?? null, floor: '', unitType: last?.unitType ?? '', marketRent: last?.marketRent ?? null, depositAmount: null,
        readiness: 'Ready', availableOn: null, features: [], photos: [], description: '', notes: '', many: Boolean(defaults.many),
        generator: { ...gen, start: lastNumber != null ? lastNumber + 1 : gen.start, count: 4, beds: last?.beds ?? gen.beds, baths: last?.baths ?? gen.baths, marketRent: last?.marketRent ?? null },
      });
    }
    setErrors({});
    seeded.current = key;
  }, [open, editId, detail.data]);

  const set = (patch: Partial<Draft>) => {
    setDraft(d => (d ? { ...d, ...patch } : d));
    setErrors(e => (Object.keys(patch).some(k => e[k]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))) : e));
  };
  const d = draft;
  const property = d?.propertyId ? ws.propertyById.get(d.propertyId) : undefined;
  const existingNames = useMemo(() => (d?.propertyId ? (ws.unitsByProperty.get(d.propertyId) ?? []).filter(u => u.id !== editId).map(u => u.name) : []), [ws.unitsByProperty, d?.propertyId, editId]);
  const unit = editId ? ws.unitById.get(editId) : undefined;

  const submit = async () => {
    if (!d) return;
    const next: Record<string, string> = {};
    if (!d.propertyId) next.propertyId = 'Choose the property this unit belongs to.';
    if (d.many && !editId) {
      const problems = generatorProblems(d.generator, existingNames);
      if (!generateUnits(d.generator).length) next.generator = 'Set how many units to add.';
      else if (problems.length) next.generator = problems[0];
    } else {
      if (!d.name.trim()) next.name = 'Give the unit a name, like 204 or Upper.';
      else if (existingNames.some(n => n.toLowerCase() === d.name.trim().toLowerCase())) next.name = `There’s already a unit named ${d.name.trim()} here.`;
    }
    setErrors(next);
    if (Object.keys(next).length || !d.propertyId) return;

    const fields = {
      name: d.name.trim(), beds: Math.max(0, Math.floor(d.beds ?? 0)), baths: d.baths ?? 1, squareFeet: d.squareFeet ? Math.floor(d.squareFeet) : null, floor: d.floor.trim(), unitType: d.unitType.trim(),
      marketRent: d.marketRent ?? 0, depositAmount: d.depositAmount ?? 0, readiness: d.readiness, availableOn: d.availableOn, features: d.features, photoUrls: d.photos.map(p => p.url), description: d.description, notes: d.notes,
    };
    setPending(true);
    try {
      if (editId) {
        await saveUnit({ action: 'update', id: editId, fields });
        afterPortfolioWrite(qc);
        toast.success(`Saved ${fields.name}`);
      } else if (d.many) {
        const units = generateUnits(d.generator).map(u => ({ ...u, readiness: 'Ready' as const, floor: '', features: [], photoUrls: [], description: '', notes: '', availableOn: null }));
        const res = await saveUnit({ action: 'create', propertyId: d.propertyId, units });
        afterPortfolioWrite(qc);
        toast.success(`Added ${plural(res.created, 'unit')} to ${property?.name ?? 'the property'}`);
      } else {
        const res = await saveUnit({ action: 'create', propertyId: d.propertyId, units: [{ ...fields, depositAmount: d.depositAmount ?? d.marketRent ?? 0 }] });
        afterPortfolioWrite(qc);
        toast.success(`Added ${fields.name} to ${property?.name ?? 'the property'}`, { action: res.ids[0] ? { label: 'Open', onClick: () => navigate(`/units/${res.ids[0]}`) } : undefined });
      }
      onOpenChange(false);
    } catch (e) {
      const msg = errorMessage(e, editId ? 'Couldn’t save the unit' : 'Couldn’t add the unit');
      if (/named|name/i.test(msg) && !d.many) setErrors({ name: msg });
      else toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  const toggleArchive = async () => {
    if (!editId || !d) return;
    const archived = detail.data?.unit.archived;
    if (!archived) {
      const ok = await app.confirm({ title: `Archive ${d.name}?`, description: 'It leaves the rent roll, unit pickers and occupancy figures. Its leases, work orders and history stay. You can restore it any time.', confirmLabel: 'Archive unit', destructive: true });
      if (!ok) return;
    }
    setPending(true);
    try {
      await saveUnit({ action: archived ? 'unarchive' : 'archive', id: editId });
      afterPortfolioWrite(qc);
      toast.success(archived ? `Restored ${d.name}` : `Archived ${d.name}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, archived ? 'Couldn’t restore the unit' : 'Couldn’t archive the unit'));
    } finally {
      setPending(false);
    }
  };

  const many = Boolean(d?.many && !editId);
  const count = many && d ? generateUnits(d.generator).length : 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? `Edit ${unit ? ws.unitLabel(unit.id) : 'unit'}` : many ? 'Add units' : 'New unit'}
      description={!editId && property ? `At ${property.name}` : undefined}
      onSubmit={submit}
      pending={pending}
      disabled={!d}
      submitLabel={editId ? 'Save changes' : many ? (count ? `Add ${plural(count, 'unit')}` : 'Add units') : 'Add unit'}
      size="lg"
      footerStart={
        editId && ws.can('portfolio.manage') && detail.data ? (
          <button type="button" onClick={() => void toggleArchive()} disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            {detail.data.unit.archived ? <><ArchiveRestore className="h-3.5 w-3.5" /> Restore unit</> : <><Archive className="h-3.5 w-3.5" /> Archive unit</>}
          </button>
        ) : undefined
      }
    >
      {!d ? (
        <SkeletonRows rows={7} />
      ) : (
        <div className="space-y-5">
          {!s(defaults.propertyId) && !editId && (
            <Field label="Property" error={errors.propertyId}>
              <PropertyPicker value={d.propertyId} onChange={id => set({ propertyId: id })} trigger={<FieldButton data-autofocus autoFocus invalid={Boolean(errors.propertyId)} placeholder="Choose a property…" icon={property ? <PropertySwatch color={property.color} /> : undefined}>{property?.name}</FieldButton>} />
            </Field>
          )}
          {!editId && (
            <Segmented value={many ? 'many' : 'one'} onChange={v => set({ many: v === 'many' })} options={[{ value: 'one', label: 'One unit' }, { value: 'many', label: 'Several units' }]} size="sm" />
          )}

          {many ? (
            <>
              <UnitGenerator value={d.generator} onChange={g => set({ generator: g })} existingNames={existingNames} />
              {errors.generator && <p role="alert" className="text-sm text-tone-danger">{errors.generator}</p>}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Name" error={errors.name} className="col-span-2 sm:col-span-1" htmlFor="unit-name">
                  <TextInput id="unit-name" data-autofocus autoFocus={Boolean(s(defaults.propertyId)) || Boolean(editId)} value={d.name} onChange={e => set({ name: e.target.value })} maxLength={40} invalid={Boolean(errors.name)} placeholder="204" />
                </Field>
                <Field label="Beds"><NumberInput value={d.beds} onChange={v => set({ beds: v })} min={0} max={20} /></Field>
                <Field label="Baths"><NumberInput value={d.baths} onChange={v => set({ baths: v })} min={0} max={20} step={0.5} /></Field>
                <Field label="Sq ft" optional><NumberInput value={d.squareFeet} onChange={v => set({ squareFeet: v })} min={0} /></Field>
              </div>
              <FieldRow cols={3}>
                <Field label="Market rent"><MoneyInput value={d.marketRent} onChange={v => set({ marketRent: v })} /></Field>
                <Field label="Deposit" optional><MoneyInput value={d.depositAmount} onChange={v => set({ depositAmount: v })} placeholder={d.marketRent != null ? d.marketRent.toFixed(2) : '0.00'} /></Field>
                <Field label="Available on" optional><DateInput value={d.availableOn} onChange={v => set({ availableOn: v })} /></Field>
              </FieldRow>
              <FieldRow>
                <Field label="Unit type" optional><TextInput value={d.unitType} onChange={e => set({ unitType: e.target.value })} maxLength={60} placeholder="2 bd / 1 ba" /></Field>
                <Field label="Floor" optional><TextInput value={d.floor} onChange={e => set({ floor: e.target.value })} maxLength={20} placeholder="2" /></Field>
              </FieldRow>
              <Field label="Readiness">
                <div role="radiogroup" aria-label="Readiness" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {UNIT_READINESS.map(r => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={d.readiness === r}
                      onClick={() => set({ readiness: r })}
                      className={d.readiness === r ? 'flex h-9 items-center gap-2 rounded-md border border-primary/60 bg-primary/[0.06] px-2.5 text-[14px] font-medium ring-1 ring-primary/30' : 'flex h-9 items-center gap-2 rounded-md border px-2.5 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground'}
                    >
                      <ReadinessGlyph readiness={r} /> {r}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Features" optional>
                <ChipsInput value={d.features} onChange={v => set({ features: v })} placeholder="Type and press Enter" suggestions={d.features.length < 5 ? FEATURE_SUGGESTIONS : []} />
              </Field>
              <Field label="Photos" optional>
                <Photos photos={d.photos} onChange={photos => set({ photos })} size={64} />
              </Field>
              <Field label="Description" optional hint="Used when you create a listing for this unit."><TextArea value={d.description} onChange={e => set({ description: e.target.value })} rows={3} maxLength={5000} /></Field>
              <Field label="Internal notes" optional><TextArea value={d.notes} onChange={e => set({ notes: e.target.value })} rows={2} maxLength={5000} placeholder="Keys, quirks, appliance model numbers…" /></Field>
            </>
          )}
        </div>
      )}
    </FormDialog>
  );
}
