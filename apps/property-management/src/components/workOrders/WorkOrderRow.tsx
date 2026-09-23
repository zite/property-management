import { CalendarClock, DoorOpen, MessageSquare, ShieldQuestion, Wrench } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { workOrderRef } from '@project/shared/leases';
import { dueLabel, shortDate, shortDateTime } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { BoardCard } from '../list/Board';
import { RowShell, Slot } from '../list/GroupedList';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { Pill, PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import type { WorkOrder } from './data';
import { WorkOrderMenu } from './WorkOrderMenu';
import { WorkOrderPicker, type WorkOrderPickerKind } from './WorkOrderPicker';

export type RowPicker = { id: string; kind: WorkOrderPickerKind } | null;

type RowProps = {
  workOrder: WorkOrder;
  properties: Set<string>;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  picker: WorkOrderPickerKind | null;
  onPicker: (id: string, kind: WorkOrderPickerKind | null) => void;
  onClick: (w: WorkOrder, e: MouseEvent) => void;
  onHover: (w: WorkOrder) => void;
  onToggleSelect: (w: WorkOrder, e: MouseEvent) => void;
  targetsFor: (w: WorkOrder) => WorkOrder[];
  /** Hide the location when the list is already scoped to one unit. */
  hideLocation?: boolean;
};

export function DueChip({ day, closed, className }: { day: string | null; closed?: boolean; className?: string }) {
  const due = dueLabel(day);
  if (!due) return null;
  const tone = closed ? 'text-muted-foreground' : due.tone === 'overdue' ? 'text-tone-danger' : due.tone === 'soon' ? 'text-tone-warning' : 'text-muted-foreground';
  return (
    <Tip label={`Due ${shortDate(day)}`}>
      <span className={cn('inline-flex h-5 items-center whitespace-nowrap text-sm tabular-nums', tone, className)}>{due.tone === 'overdue' && !closed ? `Overdue · ${due.label}` : due.label}</span>
    </Tip>
  );
}

function WorkOrderRowInner({ workOrder: w, properties, selected, focused, selecting, picker, onPicker, onClick, onHover, onToggleSelect, targetsFor, hideLocation }: RowProps) {
  const ws = useWorkspace();
  const has = (k: string) => properties.has(k);
  const closed = w.status === 'Completed' || w.status === 'Canceled';
  const assignee = w.assigneeId ? ws.memberById.get(w.assigneeId) : undefined;
  const vendor = w.vendorId ? ws.vendorById.get(w.vendorId) : undefined;
  const property = w.propertyId ? ws.propertyById.get(w.propertyId) : undefined;
  const slot = (kind: WorkOrderPickerKind, label: string, children: ReactNode, className?: string) => (
    <Slot
      label={label}
      active={picker === kind}
      onActivate={() => onPicker(w.id, kind)}
      className={className}
      picker={trigger => <WorkOrderPicker kind={kind} targets={targetsFor(w)} open onOpenChange={o => !o && onPicker(w.id, null)} trigger={trigger} />}
    >
      {children}
    </Slot>
  );

  return (
    <RowShell
      id={w.id}
      selected={selected}
      focused={focused}
      selecting={selecting}
      onClick={e => onClick(w, e)}
      onHover={() => onHover(w)}
      onToggleSelect={e => onToggleSelect(w, e)}
      menu={<WorkOrderMenu targets={targetsFor(w)} />}
      muted={w.status === 'Canceled'}
    >
      {has('priority') && slot('priority', `Priority: ${w.priority}`, <span className="flex h-6 w-6 items-center justify-center"><PriorityGlyph priority={w.priority} /></span>)}
      {has('number') && <span className="w-[68px] shrink-0 whitespace-nowrap text-[13.5px] tabular-nums text-muted-foreground">{workOrderRef(w.number)}</span>}
      {slot('status', `Status: ${w.status}`, <span className="flex h-6 w-6 items-center justify-center"><WorkOrderStatusGlyph status={w.status} /></span>)}
      <span className={cn('min-w-0 truncate font-medium', w.status === 'Canceled' && 'line-through decoration-muted-foreground/50')}>{w.title}</span>
      {w.unreadCount > 0 && (
        <Tip label={`${w.unreadCount} unread ${w.unreadCount === 1 ? 'reply' : 'replies'}`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        </Tip>
      )}
      {w.permissionToEnter && has('location') && (
        <Tip label="Permission to enter">
          <DoorOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        </Tip>
      )}
      <span className="min-w-4 flex-1" />
      <span className="hidden min-w-0 shrink items-center gap-2 overflow-hidden md:flex">
        {has('approval') && w.ownerApproval === 'Pending' && (
          <Pill tone="warning"><ShieldQuestion className="h-3 w-3" /> Owner approval</Pill>
        )}
        {has('approval') && w.ownerApproval === 'Declined' && <Pill tone="danger">Owner declined</Pill>}
        {has('messages') && w.messageCount > 0 && (
          <span className="inline-flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
            <MessageSquare className="h-3 w-3" /> {w.messageCount}
          </span>
        )}
        {has('category') && <span className="chip hidden max-w-[120px] truncate lg:inline-flex">{w.category}</span>}
        {has('location') && !hideLocation && property && (
          <span className="chip max-w-[200px]">
            <PropertySwatch color={property.color} />
            <span className="truncate">{ws.unitLabel(w.unitId, w.propertyId)}</span>
          </span>
        )}
        {has('resident') && w.tenantName && <span className="hidden max-w-[140px] truncate text-sm text-muted-foreground xl:inline">{w.tenantName}</span>}
        {has('vendor') && vendor && slot('vendor', `Vendor: ${vendor.name}`, <span className="chip max-w-[150px]"><Wrench className="h-3 w-3 text-muted-foreground" /><span className="truncate">{vendor.name}</span></span>)}
        {has('scheduled') && w.scheduledFor && !closed && slot('schedule', 'Scheduled time', (
          <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap px-1 text-sm text-muted-foreground">
            <CalendarClock className="h-3 w-3" /> {shortDateTime(w.scheduledFor).replace(/^\w+, /, '')}
          </span>
        ))}
        {has('due') && w.dueDate && !closed && slot('due', 'Due date', <DueChip day={w.dueDate} className="px-1" />)}
        {has('created') && <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{shortDate(w.reportedAt.slice(0, 10))}</span>}
      </span>
      {has('assignee') && slot('assignee', assignee ? `Assigned to ${assignee.name}` : 'Unassigned', <span className="flex h-6 w-6 items-center justify-center">{assignee ? <MemberAvatar member={assignee} size={20} /> : <UnassignedAvatar size={20} />}</span>)}
    </RowShell>
  );
}

export const WorkOrderRow = memo(WorkOrderRowInner);

export function WorkOrderCard({ workOrder: w, selected, focused, overlay, hideStatus, hideAssignee }: { workOrder: WorkOrder; selected: boolean; focused: boolean; overlay: boolean; hideStatus?: boolean; hideAssignee?: boolean }) {
  const ws = useWorkspace();
  const assignee = w.assigneeId ? ws.memberById.get(w.assigneeId) : undefined;
  const vendor = w.vendorId ? ws.vendorById.get(w.vendorId) : undefined;
  const property = w.propertyId ? ws.propertyById.get(w.propertyId) : undefined;
  const closed = w.status === 'Completed' || w.status === 'Canceled';
  return (
    <BoardCard selected={selected} focused={focused} overlay={overlay}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="shrink-0 whitespace-nowrap tabular-nums">{workOrderRef(w.number)}</span>
        {property && (
          <>
            <span aria-hidden>·</span>
            <PropertySwatch color={property.color} size={7} />
            <span className="min-w-0 truncate">{ws.unitLabel(w.unitId, w.propertyId)}</span>
          </>
        )}
        {!hideAssignee && <span className="ml-auto shrink-0">{assignee ? <MemberAvatar member={assignee} size={18} /> : <UnassignedAvatar size={18} />}</span>}
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        {!hideStatus && <WorkOrderStatusGlyph status={w.status} className="mt-[3px]" />}
        <p className={cn('line-clamp-2 min-w-0 text-[14px] font-medium leading-snug', w.status === 'Canceled' && 'text-muted-foreground line-through')}>{w.title}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-5 items-center rounded border px-1"><PriorityGlyph priority={w.priority} size={12} /></span>
        {w.ownerApproval === 'Pending' && <Pill tone="warning">Approval</Pill>}
        {vendor && <span className="chip h-5 max-w-[130px] text-[12.5px]"><span className="truncate">{vendor.name}</span></span>}
        {w.scheduledFor && !closed && (
          <span className="inline-flex h-5 items-center gap-1 text-[12.5px] text-muted-foreground">
            <CalendarClock className="h-3 w-3" /> {shortDateTime(w.scheduledFor).replace(/^\w+, /, '')}
          </span>
        )}
        {!w.scheduledFor && w.dueDate && !closed && <DueChip day={w.dueDate} className="text-[12.5px]" />}
        {w.messageCount > 0 && (
          <span className={cn('ml-auto inline-flex items-center gap-1 text-[12.5px] tabular-nums', w.unreadCount ? 'font-medium text-primary' : 'text-muted-foreground')}>
            <MessageSquare className="h-3 w-3" /> {w.messageCount}
          </span>
        )}
      </div>
    </BoardCard>
  );
}
