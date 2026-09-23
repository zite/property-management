import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DoorOpen, Link2, Search, Tag, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { saveTask, search } from 'zitejs/api';
import { Switch } from '@project/components/ui/switch';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@project/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { TASK_CATEGORIES, TASK_PRIORITIES } from '@project/shared/constants';
import { applicationRef, workOrderRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { addDays } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, Segmented, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ChoicePicker, FieldButton, MemberPicker, PropertyPicker, RecordSearchPicker, UnitPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { SkeletonRows } from '../primitives/bits';
import { OccupancyGlyph, PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { glyphPriority, useTask, type Task, type TaskCategory, type TaskPriority } from './data';
import { RELATED_ICON } from './TaskRow';

/**
 * New task, or edit one. Defaults it reads: `title`, `description`, `dueDate`,
 * `assigneeId`, `priority`, `category`, `propertyId`, `unitId`, `leaseId`,
 * `tenantId`, `workOrderId`, `ownerId`, `vendorId`, `applicationId`, plus
 * `linkLabel` (how to name the linked record when the caller knows it) and
 * `taskId` (edit that task instead of creating one).
 *
 * A task links to one record. When a page passes several ids (a lease page
 * sends the lease, its unit and property), the most specific is shown and the
 * rest ride along until someone picks a different link. The server fills in
 * a linked record's property and unit so the task groups under its building.
 */

type LinkKind = 'property' | 'unit' | 'lease' | 'tenant' | 'owner' | 'vendor' | 'application' | 'workOrder';
const LINK_KEYS = ['propertyId', 'unitId', 'leaseId', 'tenantId', 'ownerId', 'vendorId', 'workOrderId', 'applicationId'] as const;
type LinkKey = (typeof LINK_KEYS)[number];
const KEY_OF: Record<LinkKind, LinkKey> = { property: 'propertyId', unit: 'unitId', lease: 'leaseId', tenant: 'tenantId', owner: 'ownerId', vendor: 'vendorId', application: 'applicationId', workOrder: 'workOrderId' };
const SPECIFIC: LinkKind[] = ['workOrder', 'lease', 'application', 'tenant', 'vendor', 'owner', 'unit', 'property'];
const KIND_LABEL: Record<LinkKind, string> = { property: 'Property', unit: 'Unit', lease: 'Lease', tenant: 'Resident', owner: 'Owner', vendor: 'Vendor', application: 'Application', workOrder: 'Work order' };

type Link = { kind: LinkKind; id: string; label: string | null };
type Draft = {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  category: TaskCategory;
  link: Link | null;
  /** Extra ids from the opener (a lease's unit and property) kept until the link changes. */
  context: Partial<Record<LinkKey, string>>;
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function labelFromTask(t: Task, kind: LinkKind): string | null {
  switch (kind) {
    case 'workOrder': return t.workOrderNumber ? `${workOrderRef(t.workOrderNumber)} ${t.workOrderTitle ?? ''}`.trim() : null;
    case 'lease': return t.leaseName;
    case 'application': return t.applicationNumber ? `${applicationRef(t.applicationNumber)} ${t.applicationName ?? ''}`.trim() : null;
    case 'tenant': return t.tenantName;
    case 'owner': return t.ownerName;
    case 'vendor': return t.vendorName;
    default: return null;
  }
}

export default function TaskDialog({ open, onOpenChange, defaults = {} }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const taskId = str(defaults.taskId);
  const existing = useTask(open ? taskId : null);
  const editing = Boolean(taskId);

  const fromSource = (src: Record<string, unknown>, label: (kind: LinkKind) => string | null): Pick<Draft, 'link' | 'context'> => {
    const kind = SPECIFIC.find(k => str(src[KEY_OF[k]]));
    if (!kind) return { link: null, context: {} };
    const context: Draft['context'] = {};
    for (const k of LINK_KEYS) if (str(src[k]) && k !== KEY_OF[kind]) context[k] = src[k] as string;
    return { link: { kind, id: src[KEY_OF[kind]] as string, label: label(kind) }, context };
  };

  const initial = (): Draft => {
    const t = existing.data?.task;
    if (editing && t) {
      return {
        title: t.title, description: t.description, assigneeId: t.assigneeId, dueDate: t.dueDate,
        priority: (TASK_PRIORITIES as readonly string[]).includes(t.priority) ? (t.priority as TaskPriority) : 'Normal',
        category: (TASK_CATEGORIES as readonly string[]).includes(t.category) ? (t.category as TaskCategory) : 'General',
        ...fromSource(t as unknown as Record<string, unknown>, k => labelFromTask(t, k)),
      };
    }
    return {
      title: str(defaults.title) ?? '',
      description: str(defaults.description) ?? '',
      assigneeId: defaults.assigneeId === null ? null : str(defaults.assigneeId) ?? ws.me.id,
      dueDate: str(defaults.dueDate),
      priority: (TASK_PRIORITIES as readonly string[]).includes(String(defaults.priority)) ? (defaults.priority as TaskPriority) : 'Normal',
      category: (TASK_CATEGORIES as readonly string[]).includes(String(defaults.category)) ? (defaults.category as TaskCategory) : 'General',
      ...fromSource(defaults, () => str(defaults.linkLabel)),
    };
  };

  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<{ title?: string; link?: string }>({});
  const [pending, setPending] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const loaded = !editing || Boolean(existing.data);

  useEffect(() => {
    if (open && loaded) {
      setDraft(initial());
      setErrors({});
    }
  }, [open, loaded]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
  const setLink = (link: Link | null) => {
    setDraft(d => ({ ...d, link, context: {} }));
    setErrors(e => ({ ...e, link: undefined }));
  };

  const submit = async () => {
    if (!draft.title.trim()) {
      setErrors({ title: 'Give the task a title.' });
      titleRef.current?.focus();
      return;
    }
    const links = Object.fromEntries(LINK_KEYS.map(k => [k, draft.link && KEY_OF[draft.link.kind] === k ? draft.link.id : draft.context[k] ?? null])) as Record<LinkKey, string | null>;
    setPending(true);
    try {
      const res = await saveTask({
        id: taskId ?? undefined,
        task: { title: draft.title.trim(), description: draft.description.trim(), assigneeId: draft.assigneeId, dueDate: draft.dueDate, priority: draft.priority, category: draft.category, ...links },
      });
      invalidate(qc, 'tasks', 'bootstrap', 'dashboard', 'activity');
      if (editing) {
        toast.success('Task updated');
        onOpenChange(false);
        return;
      }
      const forSomeoneElse = draft.assigneeId && draft.assigneeId !== ws.me.id;
      toast.success('Task created', {
        description: forSomeoneElse ? `${ws.memberName(draft.assigneeId)} will see it in their inbox.` : draft.title.trim(),
        action: { label: 'Open', onClick: () => navigate(`/tasks?task=${res.id}`) },
      });
      if (createMore) {
        setDraft(d => ({ ...initial(), assigneeId: d.assigneeId, link: d.link, context: d.context, category: d.category }));
        window.setTimeout(() => titleRef.current?.focus(), 0);
      } else {
        onOpenChange(false);
      }
    } catch (e) {
      const message = errorMessage(e, editing ? 'Couldn’t save the task' : 'Couldn’t create the task');
      if (/no longer exists/i.test(message)) setErrors({ link: message });
      else toast.error(message);
    } finally {
      setPending(false);
    }
  };

  const priorityOptions = useMemo(() => TASK_PRIORITIES.map(p => ({ value: p, label: <span className="inline-flex items-center gap-1.5"><PriorityGlyph priority={glyphPriority(p)} size={12} /> {p}</span> })), []);
  const quickDue = [
    { label: 'Today', day: ws.today },
    { label: 'Tomorrow', day: addDays(1, ws.today) },
    { label: 'Next week', day: addDays(7, ws.today) },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit task' : 'New task'}
      onSubmit={submit}
      pending={pending}
      disabled={!loaded}
      submitLabel={editing ? 'Save task' : 'Create task'}
      size="lg"
      footerStart={
        !editing && (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Switch checked={createMore} onCheckedChange={setCreateMore} className="scale-90" /> Create another
          </label>
        )
      }
    >
      {!loaded ? (
        existing.isError ? <p className="text-[14px] text-tone-danger">{errorMessage(existing.error, 'This task didn’t load. It may have been deleted.')}</p> : <SkeletonRows rows={5} />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <TextInput
              ref={titleRef}
              data-autofocus
              value={draft.title}
              onChange={e => {
                set('title', e.target.value);
                if (errors.title) setErrors(x => ({ ...x, title: undefined }));
              }}
              placeholder="What needs doing? e.g. Call Reid about renewing"
              invalid={Boolean(errors.title)}
              aria-label="Title"
              className="h-10 text-[16px] font-medium"
              maxLength={240}
            />
            {errors.title && <p role="alert" className="text-sm text-tone-danger">{errors.title}</p>}
            <TextArea value={draft.description} onChange={e => set('description', e.target.value)} rows={3} maxLength={5000} placeholder="Details — who to call, what done looks like" aria-label="Description" />
          </div>

          <FieldRow>
            <Field label="Assignee">
              <MemberPicker
                value={draft.assigneeId}
                onChange={id => set('assigneeId', id)}
                trigger={
                  <FieldButton placeholder="Unassigned" icon={draft.assigneeId ? <MemberAvatar member={ws.memberById.get(draft.assigneeId)} size={16} /> : <UnassignedAvatar size={16} />} onClear={draft.assigneeId ? () => set('assigneeId', null) : undefined}>
                    {draft.assigneeId ? (draft.assigneeId === ws.me.id ? `${ws.memberName(draft.assigneeId)} (you)` : ws.memberName(draft.assigneeId)) : null}
                  </FieldButton>
                }
              />
            </Field>
            <Field
              label="Due"
              optional
              action={
                <span className="flex items-center gap-0.5">
                  {quickDue.map(q => (
                    <button key={q.label} type="button" onClick={() => set('dueDate', q.day)} className={`rounded px-1.5 py-0.5 text-2xs ${draft.dueDate === q.day ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                      {q.label}
                    </button>
                  ))}
                </span>
              }
            >
              <DateInput value={draft.dueDate} onChange={v => set('dueDate', v)} />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Priority">
              <Segmented value={draft.priority} onChange={v => set('priority', v as TaskPriority)} options={priorityOptions} className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1.5" />
            </Field>
            <Field label="Category">
              <ChoicePicker options={TASK_CATEGORIES} value={draft.category} onChange={v => set('category', v as TaskCategory)} trigger={<FieldButton icon={<Tag className="h-3.5 w-3.5 text-muted-foreground" />}>{draft.category}</FieldButton>} />
            </Field>
          </FieldRow>

          <LinkField link={draft.link} onChange={setLink} error={errors.link} contextUnitId={draft.context.unitId ?? null} />
        </div>
      )}
    </FormDialog>
  );
}

function LinkField({ link, onChange, error, contextUnitId }: { link: Link | null; onChange: (l: Link | null) => void; error?: string; contextUnitId: string | null }) {
  const ws = useWorkspace();
  const [kind, setKind] = useState<LinkKind | null>(link?.kind ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => setKind(link?.kind ?? kind), [link?.kind]);

  const kindOptions = useMemo(
    () => [
      { value: null, label: 'Nothing', icon: <Link2 className="h-3.5 w-3.5 text-muted-foreground" /> },
      ...SPECIFIC.slice().reverse().map(k => ({ value: k, label: KIND_LABEL[k], icon: <span className="flex text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{RELATED_ICON[k]}</span> })),
    ],
    [],
  );

  const labelFor = (l: Link) => {
    if (l.kind === 'property') return ws.propertyName(l.id) || 'Property';
    if (l.kind === 'unit') return ws.unitLabel(l.id) || 'Unit';
    if (l.kind === 'vendor') return l.label ?? ws.vendorById.get(l.id)?.name ?? 'Vendor';
    if (l.kind === 'owner') return l.label ?? ws.ownerById.get(l.id)?.name ?? 'Owner';
    if (l.label) return l.label;
    return contextUnitId ? `${KIND_LABEL[l.kind]} · ${ws.unitLabel(contextUnitId)}` : `Linked ${KIND_LABEL[l.kind].toLowerCase()}`;
  };

  const current = link && link.kind === kind ? link : null;
  const recordTrigger = (placeholder: string, icon?: ReactNode) => (
    <FieldButton placeholder={placeholder} icon={icon} onClear={current ? () => onChange(null) : undefined} invalid={Boolean(error)}>
      {current ? labelFor(current) : null}
    </FieldButton>
  );

  const record = (() => {
    switch (kind) {
      case 'property': {
        const p = current ? ws.propertyById.get(current.id) : undefined;
        return <PropertyPicker value={current?.id} onChange={id => onChange(id ? { kind: 'property', id, label: null } : null)} open={pickerOpen} onOpenChange={setPickerOpen} trigger={recordTrigger('Choose a property', p ? <PropertySwatch color={p.color} /> : <Building2 className="h-3.5 w-3.5 text-muted-foreground" />)} />;
      }
      case 'unit': {
        const u = current ? ws.unitById.get(current.id) : undefined;
        return <UnitPicker value={current?.id} onChange={id => onChange(id ? { kind: 'unit', id, label: null } : null)} open={pickerOpen} onOpenChange={setPickerOpen} trigger={recordTrigger('Find a unit', u ? <OccupancyGlyph occupancy={u.occupancy} /> : <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />)} />;
      }
      case 'lease':
      case 'tenant':
      case 'owner':
      case 'vendor':
      case 'application': {
        const kinds = { lease: 'leases', tenant: 'tenants', owner: 'owners', vendor: 'vendors', application: 'applications' } as const;
        return (
          <RecordSearchPicker
            kinds={[kinds[kind]]}
            value={current?.id}
            valueLabel={current ? labelFor(current) : null}
            onChange={hit => onChange(hit ? { kind, id: hit.id, label: hit.label } : null)}
            placeholder={`Search ${KIND_LABEL[kind].toLowerCase()}s…`}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            trigger={recordTrigger(`Search ${KIND_LABEL[kind].toLowerCase()}s`, <Search className="h-3.5 w-3.5 text-muted-foreground" />)}
          />
        );
      }
      case 'workOrder':
        return <WorkOrderSearchPicker value={current} onChange={onChange} open={pickerOpen} onOpenChange={setPickerOpen} trigger={recordTrigger('Search by number or title', <Wrench className="h-3.5 w-3.5 text-muted-foreground" />)} />;
      default:
        return <FieldButton disabled placeholder="Choose what it’s about first" className="opacity-60" />;
    }
  })();

  return (
    <Field label="Linked to" optional error={error} hint={!error && kind ? 'It shows on that record’s timeline, and the task groups under its property.' : undefined}>
      <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
        <OptionPicker
          options={kindOptions}
          value={kind}
          onChange={v => {
            const next = v as LinkKind | null;
            setKind(next);
            if (!next || next !== link?.kind) onChange(null);
            // Open the record search once the kind menu has handed focus back, so typing lands in the search box.
            if (next) window.setTimeout(() => setPickerOpen(true), 220);
          }}
          placeholder="Link to…"
          width={200}
          trigger={
            <FieldButton icon={kind ? <span className="flex text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{RELATED_ICON[kind]}</span> : <Link2 className="h-3.5 w-3.5 text-muted-foreground" />}>
              {kind ? KIND_LABEL[kind] : 'Nothing'}
            </FieldButton>
          }
        />
        {record}
      </div>
    </Field>
  );
}

/** Work orders by number or title, searched on the server; open work is listed before you type. */
function WorkOrderSearchPicker({ value, onChange, trigger, open, onOpenChange }: { value: Link | null; onChange: (l: Link | null) => void; trigger: ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['search', 'picker', 'workOrders', q],
    queryFn: () => search({ query: q, limit: 12, kinds: ['workOrders'] }),
    enabled: open,
    staleTime: 15_000,
    placeholderData: prev => prev,
  });
  const hits = data?.workOrders ?? [];
  // Results arrive after typing, so keep the first one highlighted: Enter picks it, like every other picker.
  const [active, setActive] = useState('');
  useEffect(() => {
    if (hits.length && !hits.some(h => h.id === active)) setActive(hits[0].id);
  }, [hits, active]);
  return (
    <Popover open={open} onOpenChange={o => { onOpenChange(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] overflow-hidden p-0 shadow-lg" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Command shouldFilter={false} loop value={active} onValueChange={setActive}>
          <CommandInput value={q} onValueChange={setQ} placeholder="WO-1032 or “water heater”…" className="h-9 text-[14px]" />
          <CommandList className="max-h-[320px] p-1">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">{isFetching ? 'Searching…' : 'No work orders match'}</CommandEmpty>
            <CommandGroup className="p-0">
              {hits.map(w => (
                <CommandItem
                  key={w.id}
                  value={w.id}
                  onSelect={() => {
                    onChange({ kind: 'workOrder', id: w.id, label: `${workOrderRef(w.number)} ${w.title}` });
                    onOpenChange(false);
                    setQ('');
                  }}
                  className="flex h-auto min-h-9 items-start gap-2 rounded-[5px] px-2 py-1.5 text-[14px]"
                >
                  <WorkOrderStatusGlyph status={w.status} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{w.title}</span>
                    <span className="block truncate text-sm text-muted-foreground">{w.subtitle}</span>
                  </span>
                  {value?.id === w.id && <span className="text-sm text-muted-foreground">Linked</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
