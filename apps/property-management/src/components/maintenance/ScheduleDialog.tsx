import { useQueryClient } from '@tanstack/react-query';
import { Building2, Tag, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveSchedule } from 'zitejs/api';
import { SCHEDULE_FREQUENCIES, WORK_ORDER_CATEGORIES, type Role } from '@project/shared/constants';
import { can } from '@project/shared/roles';
import { errorMessage } from '../../lib/errors';
import { addDays, fullDate, todayString } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput, NumberInput, Segmented, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton, MemberPicker, PropertyPicker, UnitPicker, VendorPicker } from '../pickers/pickers';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { OccupancyGlyph, PriorityGlyph, PropertySwatch } from '../primitives/glyphs';
import { tradeFor } from '../workOrders/WorkOrderPicker';
import type { ScheduleRow } from './data';

type Category = (typeof WORK_ORDER_CATEGORIES)[number];
type Frequency = (typeof SCHEDULE_FREQUENCIES)[number];
type Priority = 'High' | 'Normal' | 'Low';
type Draft = {
  title: string; description: string; propertyId: string | null; unitId: string | null; category: Category; priority: Priority; frequency: Frequency;
  nextDueOn: string | null; leadDays: number | null; vendorId: string | null; assigneeId: string | null; estimateAmount: number | null; active: boolean;
};

/**
 * Create or edit a preventive maintenance schedule. The daily automation
 * creates each work order `leadDays` before it's due, then moves the next due
 * date on by the frequency.
 */
export function ScheduleDialog({ open, onOpenChange, schedule, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; schedule?: ScheduleRow | null; onSaved?: (id: string) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const blank = (): Draft => ({
    title: '', description: '', propertyId: ws.orderedProperties.length === 1 ? ws.orderedProperties[0].id : null, unitId: null, category: 'General', priority: 'Normal', frequency: 'Quarterly',
    nextDueOn: addDays(30, todayString()), leadDays: 7, vendorId: null, assigneeId: ws.me.role === 'Maintenance' ? ws.me.id : null, estimateAmount: null, active: true,
  });
  const [draft, setDraft] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setDraft(
      schedule
        ? {
            title: schedule.title, description: schedule.description, propertyId: schedule.propertyId, unitId: schedule.unitId,
            category: (WORK_ORDER_CATEGORIES.includes(schedule.category as Category) ? schedule.category : 'General') as Category,
            priority: (['High', 'Normal', 'Low'].includes(schedule.priority) ? schedule.priority : 'Normal') as Priority,
            frequency: (SCHEDULE_FREQUENCIES.includes(schedule.frequency as Frequency) ? schedule.frequency : 'Annually') as Frequency,
            nextDueOn: schedule.nextDueOn, leadDays: schedule.leadDays, vendorId: schedule.vendorId, assigneeId: schedule.assigneeId, estimateAmount: schedule.estimateAmount, active: schedule.active,
          }
        : blank(),
    );
  }, [open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }));
  };

  const property = draft.propertyId ? ws.propertyById.get(draft.propertyId) : undefined;
  const unit = draft.unitId ? ws.unitById.get(draft.unitId) : undefined;
  const vendor = draft.vendorId ? ws.vendorById.get(draft.vendorId) : undefined;
  const assignee = draft.assigneeId ? ws.memberById.get(draft.assigneeId) : undefined;
  const createsOn = draft.nextDueOn && draft.leadDays != null ? addDays(-draft.leadDays, draft.nextDueOn) : null;

  const submit = async () => {
    const next: typeof errors = {};
    if (!draft.title.trim()) next.title = 'Give the schedule a title.';
    if (!draft.propertyId) next.propertyId = 'Choose where the work happens.';
    if (!draft.nextDueOn) next.nextDueOn = 'Choose when it’s next due.';
    if (draft.leadDays == null || draft.leadDays < 0 || draft.leadDays > 180 || !Number.isInteger(draft.leadDays)) next.leadDays = 'Whole days, 0 to 180.';
    if (Object.keys(next).length) {
      setErrors(next);
      if (next.title) titleRef.current?.focus();
      return;
    }
    const fields = {
      title: draft.title.trim(), description: draft.description.trim(), propertyId: draft.propertyId!, unitId: draft.unitId, category: draft.category, priority: draft.priority, frequency: draft.frequency,
      nextDueOn: draft.nextDueOn!, leadDays: draft.leadDays!, vendorId: draft.vendorId, assigneeId: draft.assigneeId, estimateAmount: draft.estimateAmount, active: draft.active,
    };
    setPending(true);
    try {
      const res = schedule ? await saveSchedule({ action: 'update', id: schedule.id, patch: fields }) : await saveSchedule({ action: 'create', schedule: fields });
      invalidate(qc, 'schedules');
      toast.success(schedule ? 'Schedule updated' : `“${fields.title}” scheduled`, { description: `${draft.frequency} · next due ${fullDate(draft.nextDueOn)}` });
      onSaved?.(res.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, schedule ? 'Couldn’t update the schedule' : 'Couldn’t create the schedule'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={schedule ? 'Edit recurring maintenance' : 'New recurring maintenance'} onSubmit={submit} pending={pending} submitLabel={schedule ? 'Save changes' : 'Create schedule'} size="lg">
      <div className="space-y-4">
        <div className="space-y-2">
          <TextInput ref={titleRef} data-autofocus value={draft.title} onChange={e => set('title', e.target.value)} placeholder="What recurs? e.g. Quarterly pest control — common areas" invalid={Boolean(errors.title)} aria-label="Title" className="h-10 text-[16px] font-medium" maxLength={200} />
          {errors.title && <p role="alert" className="text-sm text-tone-danger">{errors.title}</p>}
          <TextArea rows={2} value={draft.description} onChange={e => set('description', e.target.value)} placeholder="Instructions for whoever does it — this becomes each work order’s description" aria-label="Description" />
        </div>

        <FieldRow>
          <Field label="Property" error={errors.propertyId}>
            <PropertyPicker
              value={draft.propertyId}
              onChange={id => { setDraft(d => ({ ...d, propertyId: id, unitId: id && d.unitId && ws.unitById.get(d.unitId)?.propertyId === id ? d.unitId : null })); setErrors(e => ({ ...e, propertyId: undefined })); }}
              trigger={<FieldButton placeholder="Choose a property" invalid={Boolean(errors.propertyId)} icon={property ? <PropertySwatch color={property.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}>{property?.name}</FieldButton>}
            />
          </Field>
          <Field label="Unit" hint={draft.propertyId && !draft.unitId ? 'The whole property or its common areas' : undefined}>
            <UnitPicker
              value={draft.unitId}
              propertyId={draft.propertyId}
              allowNone={Boolean(draft.propertyId)}
              onChange={(id, propertyId) => setDraft(d => ({ ...d, unitId: id, propertyId: propertyId ?? d.propertyId }))}
              trigger={<FieldButton placeholder={draft.propertyId ? 'Whole property' : 'Find a unit'} icon={unit ? <OccupancyGlyph occupancy={unit.occupancy} /> : undefined}>{unit ? ws.unitLabel(unit.id) : null}</FieldButton>}
            />
          </Field>
        </FieldRow>

        <Field label="How often">
          <Segmented value={draft.frequency} onChange={v => set('frequency', v as Frequency)} options={SCHEDULE_FREQUENCIES.map(f => ({ value: f, label: f === 'Semiannually' ? 'Twice a year' : f === 'Annually' ? 'Yearly' : f }))} className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1" />
        </Field>
        <FieldRow>
          <Field label="Next due" error={errors.nextDueOn}>
            <DateInput value={draft.nextDueOn} onChange={v => set('nextDueOn', v)} invalid={Boolean(errors.nextDueOn)} />
          </Field>
          <Field label="Lead time" error={errors.leadDays} hint="How long before it’s due the work order appears.">
            <NumberInput value={draft.leadDays} onChange={v => set('leadDays', v)} min={0} max={180} suffix="days" invalid={Boolean(errors.leadDays)} />
          </Field>
        </FieldRow>
        {createsOn && (
          <p className="-mt-1 rounded-md bg-subtle px-3 py-2 text-sm text-muted-foreground">
            {draft.active
              ? createsOn <= ws.today
                ? 'The next work order is created on the next daily run (its lead time has already started) — or use Generate now.'
                : `The next work order is created ${fullDate(createsOn)}, due ${fullDate(draft.nextDueOn)}. After that, every ${draft.frequency === 'Monthly' ? 'month' : draft.frequency === 'Quarterly' ? '3 months' : draft.frequency === 'Semiannually' ? '6 months' : 'year'}.`
              : 'Paused — no work orders are created until you resume it.'}
          </p>
        )}

        <FieldRow>
          <Field label="Category">
            <ChoicePicker options={WORK_ORDER_CATEGORIES} value={draft.category} onChange={v => set('category', v as Category)} trigger={<FieldButton icon={<Tag className="h-3.5 w-3.5 text-muted-foreground" />}>{draft.category}</FieldButton>} />
          </Field>
          <Field label="Priority">
            <Segmented value={draft.priority} onChange={v => set('priority', v as Priority)} options={(['High', 'Normal', 'Low'] as const).map(p => ({ value: p, label: <span className="inline-flex items-center gap-1.5"><PriorityGlyph priority={p} size={12} /> {p}</span> }))} className="w-full [&>button]:flex-1 [&>button]:justify-center" />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Vendor" optional>
            <VendorPicker value={draft.vendorId} onChange={id => set('vendorId', id)} trade={tradeFor(draft.category)} trigger={<FieldButton placeholder="In-house" icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />} onClear={draft.vendorId ? () => set('vendorId', null) : undefined}>{vendor?.name}</FieldButton>} />
          </Field>
          <Field label="Assignee" optional>
            <MemberPicker value={draft.assigneeId} onChange={id => set('assigneeId', id)} filter={m => can(m.role as Role, 'maintenance.create') && m.role !== 'Leasing Agent'} trigger={<FieldButton placeholder="Unassigned" icon={assignee ? <MemberAvatar member={assignee} size={16} /> : <UnassignedAvatar size={16} />} onClear={draft.assigneeId ? () => set('assigneeId', null) : undefined}>{assignee?.name}</FieldButton>} />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Estimate" optional hint="Copied to each work order.">
            <MoneyInput value={draft.estimateAmount} onChange={v => set('estimateAmount', v)} />
          </Field>
          <div className="flex items-end pb-1">
            <div className="w-full rounded-lg border px-3 py-1.5">
              <SwitchRow label="Active" description="Creates work orders on schedule." checked={draft.active} onChange={v => set('active', v)} />
            </div>
          </div>
        </FieldRow>
      </div>
    </FormDialog>
  );
}
