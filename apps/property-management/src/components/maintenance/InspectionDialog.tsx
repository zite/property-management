import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileSignature, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveInspection } from 'zitejs/api';
import { INSPECTION_TYPES } from '@project/shared/constants';
import { defaultAreas } from '@project/shared/inspections';
import { can } from '@project/shared/roles';
import type { Role } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { bedsBaths, shortDateTime } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateTimeInput, Field, FieldRow } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton, MemberPicker, RecordSearchPicker, UnitPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { OccupancyGlyph } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';

/**
 * Schedule an inspection. Defaults it reads: `unitId`, `propertyId` (narrows
 * the unit picker), `leaseId`, `type`, `scheduledFor` (ISO or YYYY-MM-DD),
 * `inspectorId`.
 *
 * The checklist is generated from the unit's bedrooms and bathrooms; a
 * move-out reuses the move-in inspection's checklist so the two line up. For
 * move-ins and move-outs the unit's upcoming or current lease is suggested,
 * because the resident acknowledges the report through that lease.
 */

type Type = (typeof INSPECTION_TYPES)[number];
type LeaseChoice = { id: string; label: string } | null;

const text = (v: unknown) => (typeof v === 'string' && v ? v : null);

function defaultWhen(value: unknown) {
  const s = text(value);
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T10:00:00`).toISOString();
  if (s && !Number.isNaN(Date.parse(s))) return new Date(s).toISOString();
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export default function InspectionDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState<string | null>(null);
  const [type, setType] = useState<Type>('Routine');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [lease, setLease] = useState<LeaseChoice>(null);
  const [leaseTouched, setLeaseTouched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<{ unitId?: string; scheduledFor?: string }>({});
  const [pending, setPending] = useState(false);

  const unit = unitId ? ws.unitById.get(unitId) : undefined;
  const canInspect = (role: string) => can(role as Role, 'maintenance.manage');

  const suggestedLease = (u: typeof unit, t: Type): LeaseChoice => {
    if (!u) return null;
    if (t === 'Move-in') return u.upcomingLeaseId ? { id: u.upcomingLeaseId, label: 'Upcoming lease' } : u.currentLeaseId ? { id: u.currentLeaseId, label: `Current lease${u.residentNames ? ` · ${u.residentNames}` : ''}` } : null;
    if (t === 'Move-out') return u.currentLeaseId ? { id: u.currentLeaseId, label: `Current lease${u.residentNames ? ` · ${u.residentNames}` : ''}` } : null;
    return u.currentLeaseId ? { id: u.currentLeaseId, label: `Current lease${u.residentNames ? ` · ${u.residentNames}` : ''}` } : null;
  };

  useEffect(() => {
    if (!open) return;
    const u = text(defaults.unitId);
    const t = INSPECTION_TYPES.includes(defaults.type as Type) ? (defaults.type as Type) : 'Routine';
    setUnitId(u);
    setType(t);
    setScheduledFor(defaultWhen(defaults.scheduledFor));
    const me = ws.memberById.get(ws.me.id);
    setInspectorId(text(defaults.inspectorId) ?? (me && canInspect(me.role) ? me.id : null));
    const given = text(defaults.leaseId);
    setLease(given ? { id: given, label: given === ws.unitById.get(u ?? '')?.currentLeaseId ? 'Current lease' : given === ws.unitById.get(u ?? '')?.upcomingLeaseId ? 'Upcoming lease' : 'Selected lease' } : suggestedLease(u ? ws.unitById.get(u) : undefined, t));
    setLeaseTouched(Boolean(given));
    setErrors({});
    setSearching(false);
  }, [open]);

  // Follow the unit and type with the suggested lease until someone picks one themselves.
  useEffect(() => {
    if (open && !leaseTouched) setLease(suggestedLease(unit, type));
  }, [unitId, type]);

  const checklist = useMemo(() => (unit ? defaultAreas(unit.beds, unit.baths) : []), [unit]);
  const itemCount = checklist.reduce((n, a) => n + a.items.length, 0);
  const needsLease = type === 'Move-in' || type === 'Move-out';

  const leaseOptions = useMemo(() => {
    const out: Array<{ value: string | null; label: string; hint?: string }> = [];
    if (unit?.currentLeaseId) out.push({ value: unit.currentLeaseId, label: 'Current lease', hint: unit.residentNames.split(',')[0] || undefined });
    if (unit?.upcomingLeaseId) out.push({ value: unit.upcomingLeaseId, label: 'Upcoming lease' });
    if (lease && !out.some(o => o.value === lease.id)) out.push({ value: lease.id, label: lease.label });
    out.push({ value: null, label: 'No lease' });
    return out;
  }, [unit, lease]);

  const submit = async () => {
    const next: typeof errors = {};
    if (!unitId) next.unitId = 'Choose the unit to inspect.';
    if (!scheduledFor) next.scheduledFor = 'Choose when the inspection is.';
    if (Object.keys(next).length) return setErrors(next);
    setPending(true);
    try {
      const res = await saveInspection({ action: 'create', unitId: unitId!, type, scheduledFor: scheduledFor!, inspectorId, leaseId: lease?.id ?? null });
      invalidate(qc, 'inspections', 'units', 'leases', 'dashboard');
      toast.success(`${type} inspection scheduled`, { description: `${ws.unitLabel(unitId)} · ${shortDateTime(scheduledFor)}`, action: { label: 'Open', onClick: () => navigate(`/inspections/${res.id}`) } });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t schedule the inspection'));
    } finally {
      setPending(false);
    }
  };

  const inspector = inspectorId ? ws.memberById.get(inspectorId) : undefined;

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Schedule inspection" onSubmit={submit} pending={pending} submitLabel="Schedule inspection" size="md">
      <div className="space-y-4">
        <Field label="Unit" error={errors.unitId} hint={unit ? `${bedsBaths(unit.beds, unit.baths, unit.squareFeet)} · ${unit.occupancy}${unit.residentNames ? ` · ${unit.residentNames}` : ''}` : undefined}>
          <UnitPicker
            value={unitId}
            propertyId={text(defaults.propertyId)}
            onChange={id => { setUnitId(id); setErrors(e => ({ ...e, unitId: undefined })); }}
            trigger={<FieldButton data-autofocus placeholder="Find a unit" invalid={Boolean(errors.unitId)} icon={unit ? <OccupancyGlyph occupancy={unit.occupancy} /> : undefined}>{unit ? ws.unitLabel(unit.id) : null}</FieldButton>}
          />
        </Field>

        <FieldRow>
          <Field label="Type">
            <ChoicePicker options={INSPECTION_TYPES} value={type} onChange={v => setType(v as Type)} trigger={<FieldButton icon={<ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />}>{type}</FieldButton>} />
          </Field>
          <Field label="When" error={errors.scheduledFor}>
            <DateTimeInput value={scheduledFor} onChange={v => { setScheduledFor(v); setErrors(e => ({ ...e, scheduledFor: undefined })); }} invalid={Boolean(errors.scheduledFor)} />
          </Field>
        </FieldRow>

        <Field label="Inspector">
          <MemberPicker
            value={inspectorId}
            onChange={setInspectorId}
            filter={m => canInspect(m.role)}
            trigger={<FieldButton icon={inspector ? <MemberAvatar member={inspector} size={16} /> : <UnassignedAvatar size={16} />} placeholder="Unassigned" onClear={inspectorId ? () => setInspectorId(null) : undefined}>{inspector?.name}</FieldButton>}
          />
        </Field>

        <Field
          label="Lease"
          optional={!needsLease}
          hint={needsLease ? (lease ? 'Residents on this lease can review and acknowledge the report in their portal.' : 'Without a lease the report can’t be shared with residents.') : undefined}
          action={
            <RecordSearchPicker
              kinds={['leases']}
              value={null}
              open={searching}
              onOpenChange={setSearching}
              onChange={hit => { if (hit) { setLease({ id: hit.id, label: hit.label }); setLeaseTouched(true); } }}
              placeholder="Search leases…"
              align="end"
              trigger={<button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><Search className="h-3 w-3" /> Other lease</button>}
            />
          }
        >
          <OptionPicker
            options={leaseOptions}
            value={lease?.id ?? null}
            onChange={v => { setLease(v ? { id: v, label: leaseOptions.find(o => o.value === v)?.label ?? 'Selected lease' } : null); setLeaseTouched(true); }}
            placeholder="Choose a lease…"
            width={300}
            trigger={<FieldButton icon={<FileSignature className="h-3.5 w-3.5 text-muted-foreground" />} placeholder={unit ? 'No lease' : 'Choose a unit first'} disabled={!unit}>{lease?.label}</FieldButton>}
          />
        </Field>

        {unit && (
          <div className="rounded-lg border bg-subtle/60 px-3 py-2.5 text-sm text-muted-foreground">
            {type === 'Move-out' ? (
              <>Uses the unit’s move-in checklist when there is one, so each item can be compared. Otherwise: {checklist.length} areas and {itemCount} items for a {bedsBaths(unit.beds, unit.baths)}.</>
            ) : (
              <>Checklist: {checklist.map(a => a.name).join(', ')} — {itemCount} items. You can add rooms and items during the walkthrough.</>
            )}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
