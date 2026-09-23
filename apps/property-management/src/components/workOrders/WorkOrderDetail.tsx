import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CircleCheck, ExternalLink, Flag, Lock, Mail, MessageSquare, Phone, Receipt, Repeat, ShieldAlert, ShieldCheck, ShieldQuestion, Star, Tag, UserRound, Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { addWorkOrderComment } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { dateTime, shortDate, shortDateTime, telHref, timeAgo } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection, SectionHeading } from '../detail/DetailLayout';
import { Composer, Timeline, type ComposerMode } from '../detail/Timeline';
import { Switch } from '@project/components/ui/switch';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { Pill, PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { useWorkOrderActions, wok, type WorkOrderDetail, type WorkOrderPatch } from './data';
import { Photos } from './Photos';
import { WorkOrderMoneyDialog, type MoneyDialogKind } from './WorkOrderMoneyDialogs';
import { WorkOrderPicker, type WorkOrderPickerKind } from './WorkOrderPicker';
import { DueChip } from './WorkOrderRow';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';

/** Title and description that edit in place, saving on blur or ⌘↵. */
function InlineText({ value, onSave, placeholder, multiline, className, readOnly }: { value: string; onSave: (v: string) => void; placeholder: string; multiline?: boolean; className?: string; readOnly?: boolean }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const commit = () => {
    const next = multiline ? text.replace(/\s+$/, '') : text.trim();
    if (next === value) return;
    if (!multiline && !next) {
      setText(value);
      return;
    }
    onSave(next);
  };
  return (
    <textarea
      ref={ref}
      value={text}
      readOnly={readOnly}
      rows={1}
      onChange={e => setText(multiline ? e.target.value : e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      placeholder={placeholder}
      className={cn('block w-full resize-none overflow-hidden rounded-md bg-transparent outline-none placeholder:text-muted-foreground/70 focus:bg-accent/30', className)}
    />
  );
}

/** Keyboard shortcuts on an open work order (page or peek). */
export function useWorkOrderShortcuts(detail: WorkOrderDetail | undefined, setPicker: (k: WorkOrderPickerKind | null) => void, enabled: boolean, inOverlay = false) {
  const ws = useWorkspace();
  const { update } = useWorkOrderActions();
  const w = detail?.workOrder;
  useHotkeys(
    {
      s: () => setPicker('status'),
      p: () => setPicker('priority'),
      a: () => setPicker('assignee'),
      v: () => ws.can('maintenance.manage') && setPicker('vendor'),
      d: () => setPicker('due'),
      'shift+d': () => setPicker('schedule'),
      i: () => w && w.assigneeId !== ws.me.id && void update([w], { assigneeId: ws.me.id }, { toast: 'Assigned to you' }).catch(() => undefined),
      'mod+shift+enter': () => w && w.status !== 'Completed' && void update([w], { status: 'Completed' }, { toast: `${workOrderRef(w.number)} completed` }).catch(() => undefined),
    },
    { enabled: enabled && Boolean(w), allowInOverlay: inOverlay },
  );
}

export function WorkOrderMain({ detail, compact }: { detail: WorkOrderDetail; compact?: boolean }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { update } = useWorkOrderActions();
  const w = detail.workOrder;
  const [money, setMoney] = useState<MoneyDialogKind | null>(null);
  const manager = ws.can('maintenance.manage');
  const canEdit = manager || w.createdById === ws.me.id;
  const patch = (p: WorkOrderPatch) => void update([w], p).catch(() => undefined);
  const closed = w.status === 'Completed' || w.status === 'Canceled';
  const threshold = ws.settings.ownerApprovalThreshold ?? 0;
  const overThreshold = threshold > 0 && (w.estimateAmount ?? 0) > threshold && w.ownerApproval === 'Not required';

  useEffect(() => {
    if (w.unreadCount > 0) {
      void addWorkOrderComment({ mode: 'read', workOrderId: w.id })
        .then(() => invalidate(qc, 'bootstrap', 'inbox', 'messages'))
        .catch(() => undefined);
    }
  }, [w.id]);

  const modes: ComposerMode[] = [
    { value: 'note', label: 'Internal note', icon: <Lock />, placeholder: 'Add a note for your team…' },
    ...(detail.tenant && ws.can('communications.send') ? [{ value: 'tenant', label: `Message ${detail.tenant.name.split(' ')[0]}`, icon: <UserRound />, placeholder: `Write to ${detail.tenant.name}…`, hint: 'Emailed and shown in their portal.' }] : []),
    ...(w.vendorId && ws.can('communications.send') ? [{ value: 'vendor', label: `Message ${ws.vendorById.get(w.vendorId)?.name ?? 'vendor'}`, icon: <Wrench />, placeholder: 'Write to the vendor…', hint: 'Emailed to the vendor.' }] : []),
  ];

  const send = async ({ mode, body }: { mode: string; body: string }) => {
    try {
      await addWorkOrderComment(mode === 'note' ? { mode: 'note', workOrderId: w.id, body } : { mode: mode as 'tenant' | 'vendor', workOrderId: w.id, body });
      await qc.invalidateQueries({ queryKey: wok.detail(w.number) });
      invalidate(qc, 'messages', 'inbox');
      if (mode !== 'note') toast.success('Message sent');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send'));
      throw e;
    }
  };

  return (
    <div>
      <InlineText value={w.title} onSave={title => patch({ title })} placeholder="Work order title" readOnly={!canEdit} className={cn('-mx-1.5 px-1.5 py-1 font-semibold tracking-tight', compact ? 'text-[18px]' : 'text-[22px] leading-8')} />
      <InlineText value={w.description} onSave={description => patch({ description })} placeholder={canEdit ? 'Add a description…' : 'No description'} multiline readOnly={!canEdit} className="-mx-1.5 mt-1 min-h-[28px] px-1.5 py-1 text-[15px] leading-relaxed text-foreground/90" />

      {(w.photos.length > 0 || canEdit) && (
        <div className="mt-4">
          <Photos photos={w.photos} onChange={canEdit ? photos => patch({ photos }) : undefined} editable={canEdit} size={compact ? 64 : 84} />
        </div>
      )}

      {w.ownerApproval === 'Pending' && (
        <div className="mt-6 flex flex-wrap items-start gap-3 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-4 py-3">
          <ShieldQuestion className="mt-0.5 h-4 w-4 text-tone-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Waiting on owner approval for <Money value={w.estimateAmount} /></p>
            <p className="mt-0.5 text-sm text-muted-foreground">{w.ownerApprovalNote || 'The owner can approve it from their portal.'}</p>
          </div>
          {manager && <button type="button" className="ghost-chip h-8 bg-background" onClick={() => setMoney('recordApproval')}>Record decision</button>}
        </div>
      )}
      {w.ownerApproval === 'Declined' && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-tone-danger/25 bg-tone-danger/[0.05] px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-tone-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">The owner declined this work{w.ownerRespondedAt ? ` · ${timeAgo(w.ownerRespondedAt)}` : ''}</p>
            {w.ownerApprovalNote && <p className="mt-0.5 text-sm text-muted-foreground">“{w.ownerApprovalNote}”</p>}
          </div>
        </div>
      )}
      {overThreshold && manager && !closed && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-[14px]">
          <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">The estimate is above the {ws.money(threshold, { cents: false })} owner approval limit.</span>
          <button type="button" className="ghost-chip h-8" onClick={() => setMoney('requestApproval')}>Request approval</button>
        </div>
      )}

      {(w.status === 'Completed' || w.completionNotes || w.tenantRating) && (
        <>
          <SectionHeading>Resolution</SectionHeading>
          <div className="rounded-lg border bg-card px-4 py-3 shadow-2xs">
            <div className="flex items-center gap-2 text-[14px]">
              <CircleCheck className="h-4 w-4 text-tone-success" />
              <span className="font-medium">{w.status === 'Completed' ? `Completed ${w.completedAt ? shortDateTime(w.completedAt) : ''}` : 'Resolution notes'}</span>
              {w.tenantRating != null && (
                <Tip label={w.tenantFeedback || 'Resident rating'}>
                  <span className="ml-auto inline-flex items-center gap-0.5 text-tone-warning">
                    {Array.from({ length: 5 }, (_, i) => <Star key={i} className={cn('h-3.5 w-3.5', i < (w.tenantRating ?? 0) ? 'fill-current' : 'opacity-30')} />)}
                  </span>
                </Tip>
              )}
            </div>
            <InlineText value={w.completionNotes} onSave={completionNotes => patch({ completionNotes })} placeholder="What was done — parts, findings, follow-ups" multiline readOnly={!canEdit} className="-mx-1.5 mt-2 px-1.5 py-1 text-[14px] leading-relaxed" />
            {w.tenantFeedback && <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">Resident: “{w.tenantFeedback}”</p>}
          </div>
        </>
      )}

      {(manager || ws.can('payables.manage') || ws.can('receivables.manage')) && (
        <>
          <SectionHeading
            action={
              <>
                {manager && w.ownerApproval !== 'Pending' && !closed && <button type="button" className="ghost-chip h-8 text-sm" onClick={() => setMoney('requestApproval')}><ShieldCheck className="h-3.5 w-3.5" /> Owner approval</button>}
                {ws.can('payables.manage') && (!detail.bill || detail.bill.status === 'Void') && <button type="button" className="ghost-chip h-8 text-sm" onClick={() => setMoney('bill')}><Receipt className="h-3.5 w-3.5" /> Enter bill</button>}
                {ws.can('receivables.manage') && w.leaseId && (!detail.tenantCharge || detail.tenantCharge.status === 'Void') && <button type="button" className="ghost-chip h-8 text-sm" onClick={() => setMoney('chargeResident')}><UserRound className="h-3.5 w-3.5" /> Charge resident</button>}
              </>
            }
          >
            Costs
          </SectionHeading>
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
            <CostCell label="Estimate">
              {canEdit ? <EditableMoney value={w.estimateAmount} onSave={v => patch({ estimateAmount: v })} /> : <Money value={w.estimateAmount} muted0 />}
            </CostCell>
            <CostCell label="Vendor bill">
              {detail.bill ? (
                <Link to={`/accounting/payables/${detail.bill.id}`} className="group inline-flex items-center gap-1.5 hover:underline">
                  <Money value={detail.bill.amount} className={cn(detail.bill.status === 'Void' && 'text-muted-foreground line-through')} />
                  <span className="text-sm text-muted-foreground">{detail.bill.status === 'Void' ? 'void' : detail.bill.open > 0.005 ? `unpaid · due ${shortDate(detail.bill.dueDate)}` : 'paid'}</span>
                </Link>
              ) : (
                <span className="text-muted-foreground">None yet</span>
              )}
            </CostCell>
            <CostCell label="Charged to resident">
              {detail.tenantCharge ? (
                <Link to={w.leaseId ? `/leases/${w.leaseId}/ledger` : '#'} className="inline-flex items-center gap-1.5 hover:underline">
                  <Money value={detail.tenantCharge.amount} className={cn(detail.tenantCharge.status === 'Void' && 'text-muted-foreground line-through')} />
                  {detail.tenantCharge.status === 'Void' && <span className="text-sm text-muted-foreground">void</span>}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </CostCell>
          </div>
        </>
      )}

      {detail.related.length > 0 && (
        <>
          <SectionHeading count={detail.related.length}>Other work on this unit</SectionHeading>
          <div className="overflow-hidden rounded-lg border">
            {detail.related.map(r => (
              <Link key={r.number} to={`/work-orders/${r.number}`} className="flex h-9 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">
                <PriorityGlyph priority={r.priority} />
                <span className="w-[64px] shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">{workOrderRef(r.number)}</span>
                <WorkOrderStatusGlyph status={r.status} />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <SectionHeading>Activity</SectionHeading>
      <Timeline activity={detail.activity} messages={detail.messages} />
      <Composer className="mt-4" modes={modes} onSend={send} />

      <WorkOrderMoneyDialog kind={money} workOrder={w} onOpenChange={o => !o && setMoney(null)} />
    </div>
  );
}

function CostCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex min-h-8 items-center text-[15px]">{children}</div>
    </div>
  );
}

function EditableMoney({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (!editing) {
    return (
      <button type="button" onClick={() => { setText(value != null ? String(value) : ''); setEditing(true); }} className="-mx-1.5 rounded px-1.5 py-0.5 text-left hover:bg-accent">
        {value != null ? <Money value={value} /> : <span className="text-muted-foreground">Add estimate</span>}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const n = text.trim() ? Number(text.replace(/[^0-9.]/g, '')) : null;
    if (n !== null && !Number.isFinite(n)) return;
    if (n !== value) onSave(n);
  };
  return (
    <input
      autoFocus
      inputMode="decimal"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
      placeholder={ws.money(0)}
      className="field num h-8 w-32"
    />
  );
}

/** The properties rail: every field editable in place, with the same pickers as the list. */
export function WorkOrderRail({ detail, picker, setPicker }: { detail: WorkOrderDetail; picker: WorkOrderPickerKind | null; setPicker: (k: WorkOrderPickerKind | null) => void }) {
  const ws = useWorkspace();
  const { update } = useWorkOrderActions();
  const w = detail.workOrder;
  const assignee = w.assigneeId ? ws.memberById.get(w.assigneeId) : undefined;
  const vendor = w.vendorId ? ws.vendorById.get(w.vendorId) : undefined;
  const property = w.propertyId ? ws.propertyById.get(w.propertyId) : undefined;
  const unit = w.unitId ? ws.unitById.get(w.unitId) : undefined;
  const manager = ws.can('maintenance.manage');
  const closed = w.status === 'Completed' || w.status === 'Canceled';
  const pick = (kind: WorkOrderPickerKind, children: ReactNode, disabled?: boolean) =>
    disabled ? (
      <span className="flex h-8 items-center gap-1.5 px-1.5 text-[14px]">{children}</span>
    ) : (
      <WorkOrderPicker kind={kind} targets={[w]} open={picker === kind} onOpenChange={o => setPicker(o ? kind : null)} align="end" trigger={<button type="button" className={chip}>{children}</button>} />
    );
  const creator = w.createdById ? ws.memberById.get(w.createdById) : undefined;

  return (
    <>
      <RailSection>
        <RailRow label="Status">{pick('status', <><WorkOrderStatusGlyph status={w.status} /> {w.status}</>)}</RailRow>
        <RailRow label="Priority">{pick('priority', <><PriorityGlyph priority={w.priority} /> {w.priority}</>)}</RailRow>
        <RailRow label="Assignee">{pick('assignee', assignee ? <><MemberAvatar member={assignee} size={18} /> <span className="truncate">{assignee.name}</span></> : <><UnassignedAvatar size={18} /> <span className="text-muted-foreground">Unassigned</span></>)}</RailRow>
        <RailRow label="Vendor">{pick('vendor', vendor ? <><Wrench className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{vendor.name}</span></> : <span className="text-muted-foreground">In-house</span>, !manager)}</RailRow>
        <RailRow label="Category">{pick('category', <><Tag className="h-3.5 w-3.5 text-muted-foreground" /> {w.category}</>)}</RailRow>
        <RailRow label="Scheduled">{pick('schedule', w.scheduledFor ? <><CalendarClock className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{shortDateTime(w.scheduledFor).replace(/^\w+, /, '')}</span></> : <span className="text-muted-foreground">Not scheduled</span>)}</RailRow>
        <RailRow label="Due">{pick('due', w.dueDate ? <><Flag className="h-3.5 w-3.5 text-muted-foreground" /> <DueChip day={w.dueDate} closed={closed} className="text-[14px]" /></> : <span className="text-muted-foreground">No due date</span>)}</RailRow>
        {vendor?.insuranceExpiresOn && vendor.insuranceExpiresOn < ws.today && !closed && (
          <p className="mt-1 rounded-md bg-tone-danger/[0.07] px-2 py-1.5 text-sm text-tone-danger">{vendor.name}’s insurance certificate expired {shortDate(vendor.insuranceExpiresOn)}.</p>
        )}
      </RailSection>

      <RailSection title="Location">
        <RailRow label="Property">
          {property ? (
            <Link to={`/properties/${property.id}`} className={chip}>
              <PropertySwatch color={property.color} /> <span className="truncate">{property.name}</span>
            </Link>
          ) : <span className="text-muted-foreground">—</span>}
        </RailRow>
        <RailRow label="Unit">
          {unit ? <Link to={`/units/${unit.id}`} className={chip}><span className="truncate">{unit.name}</span></Link> : <span className="px-1.5 text-[14px] text-muted-foreground">Common area</span>}
        </RailRow>
        <RailRow label="Entry">
          <label className="flex h-8 cursor-pointer items-center gap-2 px-1.5 text-[14px]">
            <Switch checked={w.permissionToEnter} onCheckedChange={v => void update([w], { permissionToEnter: v }).catch(() => undefined)} className="scale-90" />
            <span className="whitespace-nowrap">{w.permissionToEnter ? 'OK to enter' : 'Call first'}</span>
          </label>
        </RailRow>
        {w.entryNotes && <p className="px-1.5 pt-0.5 text-sm text-muted-foreground">{w.entryNotes}</p>}
      </RailSection>

      {(detail.tenant || detail.lease) && (
        <RailSection title="Resident">
          {detail.tenant && (
            <>
              <Link to={`/residents/${detail.tenant.id}`} className={cn(chip, 'font-medium')}>
                <UserRound className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{detail.tenant.name}</span>
              </Link>
              {detail.tenant.phone && (
                <a href={telHref(detail.tenant.phone)} className={cn(chip, 'text-muted-foreground')}>
                  <Phone className="h-3.5 w-3.5" /> {detail.tenant.phone}
                </a>
              )}
              {detail.tenant.email && (
                <a href={`mailto:${detail.tenant.email}`} className={cn(chip, 'text-muted-foreground')}>
                  <Mail className="h-3.5 w-3.5" /> <span className="truncate">{detail.tenant.email}</span>
                </a>
              )}
              {detail.tenant.pets && <p className="px-1.5 text-sm text-muted-foreground">Pets: {detail.tenant.pets}</p>}
            </>
          )}
          {detail.lease && (
            <Link to={`/leases/${detail.lease.id}`} className={cn(chip, 'text-muted-foreground')}>
              <ExternalLink className="h-3.5 w-3.5" /> <span className="truncate">Lease · {detail.lease.name}</span>
            </Link>
          )}
        </RailSection>
      )}

      <RailSection title="Details">
        <RailRow label="Reported"><Tip label={dateTime(w.reportedAt)}><span className="px-1.5 text-[14px]">{timeAgo(w.reportedAt)} · {w.source}</span></Tip></RailRow>
        {creator && <RailRow label="Logged by"><span className="flex items-center gap-1.5 px-1.5 text-[14px]"><MemberAvatar member={creator} size={16} /> {creator.name}</span></RailRow>}
        {w.startedAt && <RailRow label="Started"><span className="px-1.5 text-[14px]">{shortDateTime(w.startedAt)}</span></RailRow>}
        {w.completedAt && <RailRow label="Completed"><span className="px-1.5 text-[14px]">{shortDateTime(w.completedAt)}</span></RailRow>}
        {w.messageCount > 0 && <RailRow label="Messages"><span className="flex items-center gap-1.5 px-1.5 text-[14px]"><MessageSquare className="h-3.5 w-3.5 text-muted-foreground" /> {w.messageCount}</span></RailRow>}
        {detail.schedule && (
          <RailRow label="Recurring">
            <Link to={`/work-orders/schedules?schedule=${detail.schedule.id}`} className={chip}><Repeat className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{detail.schedule.title}</span></Link>
          </RailRow>
        )}
        {w.inspectionId && (
          <RailRow label="Inspection">
            <Link to={`/inspections/${w.inspectionId}`} className={chip}>From inspection</Link>
          </RailRow>
        )}
        {w.ownerApproval !== 'Not required' && (
          <RailRow label="Owner">
            <Pill tone={w.ownerApproval === 'Approved' ? 'success' : w.ownerApproval === 'Declined' ? 'danger' : 'warning'}>{w.ownerApproval}</Pill>
          </RailRow>
        )}
      </RailSection>
    </>
  );
}
