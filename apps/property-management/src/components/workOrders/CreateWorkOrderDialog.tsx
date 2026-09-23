import { useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, Sparkles, Tag, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { aiTriageWorkOrder, createWorkOrder } from 'zitejs/api';
import { Switch } from '@project/components/ui/switch';
import { PRIORITY_DUE_DAYS, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, type WorkOrderCategory, type WorkOrderPriority } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { addDays, shortDate } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { Field, FieldRow, MoneyInput, DateInput, DateTimeInput, Segmented, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton, MemberPicker, PropertyPicker, UnitPicker, VendorPicker } from '../pickers/pickers';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { OccupancyGlyph, PriorityGlyph, PropertySwatch } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { Photos, type Photo } from './Photos';
import { tradeFor } from './WorkOrderPicker';

/**
 * New work order. Defaults it reads: `propertyId`, `unitId`, `tenantId`,
 * `vendorId`, `assigneeId`, `title`, `description`, `priority`, `category`, `source`.
 *
 * Choosing a unit fills the property; an occupied unit attaches its resident
 * (they can follow it in the portal) and offers to email them. "Suggest"
 * reads the description and proposes a title, category and priority.
 */

type Draft = {
  title: string;
  description: string;
  propertyId: string | null;
  unitId: string | null;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  assigneeId: string | null;
  vendorId: string | null;
  scheduledFor: string | null;
  dueDate: string | null;
  permissionToEnter: boolean;
  entryNotes: string;
  estimateAmount: number | null;
  source: 'Staff' | 'Phone' | 'Email' | 'Inspection';
  notifyResident: boolean;
  photos: Photo[];
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export default function CreateWorkOrderDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initial = (): Draft => {
    const unitId = str(defaults.unitId);
    const unitPropertyId = unitId ? ws.unitById.get(unitId)?.propertyId : undefined;
    const onlyPropertyId = ws.orderedProperties.length === 1 ? ws.orderedProperties[0].id : undefined;
    const propertyId = str(defaults.propertyId) || unitPropertyId || onlyPropertyId || null;
    const category = WORK_ORDER_CATEGORIES.includes(defaults.category as WorkOrderCategory) ? (defaults.category as WorkOrderCategory) : 'General';
    const priority = WORK_ORDER_PRIORITIES.includes(defaults.priority as WorkOrderPriority) ? (defaults.priority as WorkOrderPriority) : 'Normal';
    return {
      title: str(defaults.title) ?? '',
      description: str(defaults.description) ?? '',
      propertyId,
      unitId,
      category,
      priority,
      assigneeId: str(defaults.assigneeId) ?? (ws.me.role === 'Maintenance' ? ws.me.id : null),
      vendorId: str(defaults.vendorId),
      scheduledFor: null,
      dueDate: null,
      permissionToEnter: false,
      entryNotes: '',
      estimateAmount: null,
      source: defaults.source === 'Phone' || defaults.source === 'Email' || defaults.source === 'Inspection' ? defaults.source : 'Staff',
      notifyResident: true,
      photos: [],
    };
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [pending, setPending] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [triage, setTriage] = useState<{ loading: boolean; reason?: string; ai?: boolean } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dueTouched = useRef(false);

  useEffect(() => {
    if (open) {
      setDraft(initial());
      setErrors({});
      setTriage(null);
      dueTouched.current = false;
    }
  }, [open]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }));
  };

  const unit = draft.unitId ? ws.unitById.get(draft.unitId) : undefined;
  const property = draft.propertyId ? ws.propertyById.get(draft.propertyId) : undefined;
  const units = draft.propertyId ? ws.unitsByProperty.get(draft.propertyId) ?? [] : [];
  const resident = unit && unit.occupancy !== 'Vacant' ? unit.residentNames : '';
  const autoDue = addDays(PRIORITY_DUE_DAYS[draft.priority]);
  const vendor = draft.vendorId ? ws.vendorById.get(draft.vendorId) : undefined;
  const vendorCoiExpired = vendor?.insuranceExpiresOn && vendor.insuranceExpiresOn < ws.today;

  const suggest = async () => {
    const text = [draft.title, draft.description].filter(Boolean).join('\n\n');
    if (text.trim().length < 3) {
      titleRef.current?.focus();
      return;
    }
    setTriage({ loading: true });
    try {
      const res = await aiTriageWorkOrder({ text });
      setDraft(d => ({ ...d, category: res.category, priority: res.priority, title: d.title.trim() ? d.title : res.title }));
      setTriage({ loading: false, reason: res.reason, ai: res.ai });
    } catch (e) {
      setTriage(null);
      toast.error(errorMessage(e, 'Couldn’t suggest details'));
    }
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (!draft.title.trim()) next.title = 'Give the work order a title.';
    if (!draft.propertyId) next.propertyId = 'Choose where the work is.';
    if (Object.keys(next).length) {
      setErrors(next);
      if (next.title) titleRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const res = await createWorkOrder({
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        propertyId: draft.propertyId!,
        unitId: draft.unitId,
        tenantId: str(defaults.tenantId),
        category: draft.category,
        priority: draft.priority,
        source: draft.source,
        assigneeId: draft.assigneeId,
        vendorId: draft.vendorId,
        scheduledFor: draft.scheduledFor,
        dueDate: dueTouched.current ? draft.dueDate : null,
        permissionToEnter: draft.permissionToEnter,
        entryNotes: draft.entryNotes.trim() || undefined,
        estimateAmount: draft.estimateAmount,
        photos: draft.photos,
        notifyResident: Boolean(resident) && draft.notifyResident,
        inspectionId: str(defaults.inspectionId),
      });
      invalidate(qc, 'workOrders', 'bootstrap', 'dashboard', 'units', 'properties', 'vendors', 'leases');
      toast.success(`${workOrderRef(res.number)} created`, { description: draft.title.trim(), action: { label: 'Open', onClick: () => navigate(`/work-orders/${res.number}`) } });
      if (createMore) {
        setDraft(d => ({ ...initial(), propertyId: d.propertyId, unitId: d.unitId, assigneeId: d.assigneeId }));
        setTriage(null);
        window.setTimeout(() => titleRef.current?.focus(), 0);
      } else {
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t create the work order'));
    } finally {
      setPending(false);
    }
  };

  const priorityOptions = useMemo(() => WORK_ORDER_PRIORITIES.map(p => ({ value: p, label: <span className="inline-flex items-center gap-1.5"><PriorityGlyph priority={p} size={12} /> {p}</span> })), []);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New work order"
      onSubmit={submit}
      pending={pending}
      submitLabel="Create work order"
      size="lg"
      footerStart={
        <label className="inline-flex cursor-pointer items-center gap-2">
          <Switch checked={createMore} onCheckedChange={setCreateMore} className="scale-90" /> Create another
        </label>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <TextInput
            ref={titleRef}
            data-autofocus
            value={draft.title}
            onChange={e => set('title', e.target.value)}
            placeholder="What needs fixing? e.g. Kitchen sink leaking under cabinet"
            invalid={Boolean(errors.title)}
            aria-label="Title"
            className="h-10 text-[16px] font-medium"
            maxLength={200}
          />
          {errors.title && <p role="alert" className="text-sm text-tone-danger">{errors.title}</p>}
          <TextArea value={draft.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="Details — what the resident reported, where exactly, anything the technician should know" aria-label="Description" />
          <div className="flex flex-wrap items-center gap-2">
            <Tip label={ws.integrations.ai ? 'Suggest a title, category and priority from what you wrote' : 'Suggest a category and priority from keywords'}>
              <button type="button" onClick={() => void suggest()} disabled={triage?.loading} className="ghost-chip h-8 gap-1.5 text-[13.5px]">
                {triage?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-tone-accent" />}
                Suggest details
              </button>
            </Tip>
            {triage?.reason && <span className="text-sm text-muted-foreground">{draft.priority}: {triage.reason}</span>}
          </div>
        </div>

        <FieldRow>
          <Field label="Property" error={errors.propertyId}>
            <PropertyPicker
              value={draft.propertyId}
              onChange={id => setDraft(d => ({ ...d, propertyId: id, unitId: id && d.unitId && ws.unitById.get(d.unitId)?.propertyId === id ? d.unitId : null }))}
              trigger={
                <FieldButton placeholder="Choose a property" invalid={Boolean(errors.propertyId)} icon={property ? <PropertySwatch color={property.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />}>
                  {property?.name}
                </FieldButton>
              }
            />
          </Field>
          <Field label="Unit" hint={resident ? `Resident: ${resident}` : draft.propertyId && units.length > 1 && !draft.unitId ? 'Leave empty for common areas' : undefined}>
            <UnitPicker
              value={draft.unitId}
              propertyId={draft.propertyId}
              allowNone={Boolean(draft.propertyId)}
              onChange={(id, propertyId) => setDraft(d => ({ ...d, unitId: id, propertyId: propertyId ?? d.propertyId }))}
              trigger={
                <FieldButton placeholder={draft.propertyId ? 'Whole property' : 'Find a unit'} icon={unit ? <OccupancyGlyph occupancy={unit.occupancy} /> : undefined}>
                  {unit ? (units.length <= 1 && draft.propertyId ? unit.name : ws.unitLabel(unit.id)) : null}
                </FieldButton>
              }
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Category">
            <ChoicePicker options={WORK_ORDER_CATEGORIES} value={draft.category} onChange={v => set('category', v)} trigger={<FieldButton icon={<Tag className="h-3.5 w-3.5 text-muted-foreground" />}>{draft.category}</FieldButton>} />
          </Field>
          <Field label="Priority">
            <Segmented value={draft.priority} onChange={v => set('priority', v)} options={priorityOptions} className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1.5" />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Assignee">
            <MemberPicker
              value={draft.assigneeId}
              onChange={id => set('assigneeId', id)}
              filter={m => m.role !== 'Accountant'}
              trigger={
                <FieldButton placeholder="Unassigned" icon={draft.assigneeId ? <MemberAvatar member={ws.memberById.get(draft.assigneeId)} size={16} /> : <UnassignedAvatar size={16} />} onClear={draft.assigneeId ? () => set('assigneeId', null) : undefined}>
                  {draft.assigneeId ? ws.memberName(draft.assigneeId) : null}
                </FieldButton>
              }
            />
          </Field>
          <Field label="Vendor" optional error={vendorCoiExpired ? `${vendor?.name}’s insurance certificate expired ${shortDate(vendor?.insuranceExpiresOn)}.` : undefined}>
            <VendorPicker
              value={draft.vendorId}
              onChange={id => set('vendorId', id)}
              trade={tradeFor(draft.category)}
              trigger={
                <FieldButton placeholder="In-house" icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />} onClear={draft.vendorId ? () => set('vendorId', null) : undefined}>
                  {vendor?.name}
                </FieldButton>
              }
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Scheduled for" optional hint={draft.scheduledFor ? 'The resident is told when it’s scheduled.' : undefined}>
            <DateTimeInput value={draft.scheduledFor} onChange={v => set('scheduledFor', v)} />
          </Field>
          <Field label="Due" hint={!dueTouched.current ? `Defaults to ${shortDate(autoDue)} for ${draft.priority.toLowerCase()} priority` : undefined}>
            <DateInput
              value={dueTouched.current ? draft.dueDate : autoDue}
              onChange={v => {
                dueTouched.current = true;
                set('dueDate', v);
              }}
            />
          </Field>
        </FieldRow>

        <div className="rounded-lg border px-3 py-2">
          <SwitchRow label="Permission to enter" description="The resident is fine with entry when they’re not home." checked={draft.permissionToEnter} onChange={v => set('permissionToEnter', v)} />
          {draft.permissionToEnter && (
            <TextInput className="mb-1 mt-2" value={draft.entryNotes} onChange={e => set('entryNotes', e.target.value)} placeholder="Entry notes — pets, alarm code, lockbox…" maxLength={500} />
          )}
          {resident && (
            <div className="mt-1 border-t pt-1">
              <SwitchRow label={`Email ${resident.split(',')[0]}`} description="Confirms we received the request and links to it in their portal." checked={draft.notifyResident} onChange={v => set('notifyResident', v)} />
            </div>
          )}
        </div>

        <FieldRow>
          <Field label="Estimate" optional hint={property && (ws.settings.ownerApprovalThreshold ?? 0) > 0 && (draft.estimateAmount ?? 0) > (ws.settings.ownerApprovalThreshold ?? 0) ? `Above the ${ws.money(ws.settings.ownerApprovalThreshold, { cents: false })} owner approval limit — request approval from the work order.` : undefined}>
            <MoneyInput value={draft.estimateAmount} onChange={v => set('estimateAmount', v)} />
          </Field>
          <Field label="Reported by">
            {draft.source === 'Inspection' ? <p className="flex h-9 items-center text-[14px] text-muted-foreground">From an inspection</p> : <Segmented value={draft.source} onChange={v => set('source', v)} options={[{ value: 'Staff', label: 'Staff' }, { value: 'Phone', label: 'Phone' }, { value: 'Email', label: 'Email' }]} />}
          </Field>
        </FieldRow>

        <Field label="Photos" optional>
          <Photos photos={draft.photos} onChange={p => set('photos', p)} size={64} />
        </Field>
      </div>
    </FormDialog>
  );
}
