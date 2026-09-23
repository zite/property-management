import { Ban, CalendarDays, CircleCheck, Copy, KeyRound, Link2, MessageSquare, RotateCcw, SquareArrowOutUpRight, Undo2, UserRoundCheck, Users } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@project/components/ui/context-menu';
import { applicationRef, leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { appUrl, shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { BoardCard } from '../list/Board';
import { RowShell, Slot } from '../list/GroupedList';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { ApplicationStatusGlyph, PropertySwatch } from '../primitives/glyphs';
import { ApplicationPicker, type ApplicationPickerKind } from './ApplicationPicker';
import { FeeChip, IncomeRatio, ScreeningMeter } from './bits';
import { useApplicationActions, type Application } from './data';
import { leaseDefaultsFor, type DecisionKind } from './DecisionDialog';

export type AppRowPicker = { id: string; kind: ApplicationPickerKind } | null;

type RowProps = {
  application: Application;
  properties: Set<string>;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  picker: ApplicationPickerKind | null;
  onPicker: (id: string, kind: ApplicationPickerKind | null) => void;
  onClick: (a: Application, e: MouseEvent) => void;
  onHover: (a: Application) => void;
  onToggleSelect: (a: Application, e: MouseEvent) => void;
  targetsFor: (a: Application) => Application[];
  onDecide: (kind: DecisionKind, a: Application) => void;
  hideUnit?: boolean;
};

function ApplicationRowInner({ application: a, properties, selected, focused, selecting, picker, onPicker, onClick, onHover, onToggleSelect, targetsFor, onDecide, hideUnit }: RowProps) {
  const ws = useWorkspace();
  const has = (k: string) => properties.has(k);
  const property = a.propertyId ? ws.propertyById.get(a.propertyId) : undefined;
  const assignee = a.assigneeId ? ws.memberById.get(a.assigneeId) : undefined;
  const closed = a.status === 'Denied' || a.status === 'Withdrawn';
  const slot = (kind: ApplicationPickerKind, label: string, children: ReactNode, className?: string) => (
    <Slot label={label} active={picker === kind} onActivate={() => onPicker(a.id, kind)} className={className} picker={trigger => <ApplicationPicker kind={kind} targets={targetsFor(a)} open onOpenChange={o => !o && onPicker(a.id, null)} trigger={trigger} onDecide={(k, t) => onDecide(k, t as Application)} />}>
      {children}
    </Slot>
  );

  return (
    <RowShell id={a.id} selected={selected} focused={focused} selecting={selecting} onClick={e => onClick(a, e)} onHover={() => onHover(a)} onToggleSelect={e => onToggleSelect(a, e)} menu={<ApplicationMenu targets={targetsFor(a)} onDecide={onDecide} />} muted={closed}>
      {has('number') && <span className="w-[62px] shrink-0 whitespace-nowrap text-[13.5px] tabular-nums text-muted-foreground">{applicationRef(a.number)}</span>}
      {slot('status', `Status: ${a.status}`, <span className="flex h-6 w-6 items-center justify-center"><ApplicationStatusGlyph status={a.status} /></span>)}
      <span className={cn('min-w-0 truncate font-medium', closed && 'text-muted-foreground')}>{a.applicantName}</span>
      {a.coApplicantNames.length > 0 && (
        <Tip label={`With ${a.coApplicantNames.join(', ')}`}>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground"><Users className="h-3 w-3" />+{a.coApplicantNames.length}</span>
        </Tip>
      )}
      {a.unreadCount > 0 && (
        <Tip label={`${a.unreadCount} unread ${a.unreadCount === 1 ? 'message' : 'messages'}`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        </Tip>
      )}
      {a.status === 'Leased' && a.leaseNumber && <span className="chip hidden shrink-0 text-muted-foreground sm:inline-flex"><KeyRound className="h-3 w-3" />{leaseRef(a.leaseNumber)}</span>}
      <span className="min-w-4 flex-1" />
      <span className="hidden min-w-0 items-center gap-3 md:flex">
        {has('unit') && !hideUnit && property && (
          <Tip label={a.listingTitle ?? ws.unitLabel(a.unitId, a.propertyId)}>
            <span className="chip max-w-[190px]"><PropertySwatch color={property.color} /><span className="truncate">{ws.unitLabel(a.unitId, a.propertyId)}</span></span>
          </Tip>
        )}
        {has('moveIn') && a.desiredMoveIn && slot('moveIn', 'Desired move-in', <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap px-1 text-sm text-muted-foreground"><CalendarDays className="h-3 w-3" />{shortDate(a.desiredMoveIn)}</span>)}
        {has('income') && <span className="hidden w-[46px] justify-end lg:flex"><IncomeRatio income={a.householdIncome} rent={a.rent} /></span>}
        {has('screening') && <span className="hidden lg:inline-flex"><ScreeningMeter done={a.screeningDone} flags={a.screeningFlags} total={a.screeningTotal} /></span>}
        {has('fee') && !a.feePaidAt && <FeeChip amount={a.feeAmount} paidAt={a.feePaidAt} className="hidden xl:inline-flex" />}
        {has('submitted') && a.submittedAt && <Tip label={`Submitted ${shortDate(a.submittedAt)}`}><span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{timeAgo(a.submittedAt)}</span></Tip>}
      </span>
      {has('assignee') && slot('assignee', assignee ? `Assigned to ${assignee.name}` : 'Unassigned', <span className="flex h-6 w-6 items-center justify-center">{assignee ? <MemberAvatar member={assignee} size={20} /> : <UnassignedAvatar size={20} />}</span>)}
    </RowShell>
  );
}

export const ApplicationRow = memo(ApplicationRowInner);

export function ApplicationCard({ application: a, selected, focused, overlay, hideStatus }: { application: Application; selected: boolean; focused: boolean; overlay: boolean; hideStatus?: boolean }) {
  const ws = useWorkspace();
  const property = a.propertyId ? ws.propertyById.get(a.propertyId) : undefined;
  const assignee = a.assigneeId ? ws.memberById.get(a.assigneeId) : undefined;
  return (
    <BoardCard selected={selected} focused={focused} overlay={overlay}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="shrink-0 tabular-nums">{applicationRef(a.number)}</span>
        {property && (
          <>
            <span aria-hidden>·</span>
            <PropertySwatch color={property.color} size={7} />
            <span className="min-w-0 truncate">{ws.unitLabel(a.unitId, a.propertyId)}</span>
          </>
        )}
        <span className="ml-auto shrink-0">{assignee ? <MemberAvatar member={assignee} size={18} /> : <UnassignedAvatar size={18} />}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {!hideStatus && <ApplicationStatusGlyph status={a.status} />}
        <p className="min-w-0 truncate text-[14px] font-medium">{a.applicantName}</p>
        {a.coApplicantNames.length > 0 && <span className="shrink-0 text-sm text-muted-foreground">+{a.coApplicantNames.length}</span>}
        {a.unreadCount > 0 && <MessageSquare className="h-3 w-3 shrink-0 text-primary" />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <IncomeRatio income={a.householdIncome} rent={a.rent} showIncome />
        <ScreeningMeter done={a.screeningDone} flags={a.screeningFlags} total={a.screeningTotal} />
        {a.desiredMoveIn && <span className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground"><CalendarDays className="h-3 w-3" />{shortDate(a.desiredMoveIn)}</span>}
        {!a.feePaidAt && <FeeChip amount={a.feeAmount} paidAt={a.feePaidAt} />}
      </div>
    </BoardCard>
  );
}

const item = 'h-9 gap-2 text-[14px]';

/** Right-click on an application. Status and assignment apply to the selection; decisions are one at a time. */
export function ApplicationMenu({ targets, onDecide }: { targets: Application[]; onDecide: (kind: DecisionKind, a: Application) => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { update } = useApplicationActions();
  if (!targets.length) return null;
  const single = targets.length === 1 ? targets[0] : null;
  const undecided = targets.filter(t => t.status === 'Submitted' || t.status === 'Screening');
  return (
    <div onClick={e => e.stopPropagation()}>
      {!single && <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{targets.length} applications selected</div>}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => navigate(`/applications/${single.number}`)}>
            <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      {undecided.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className={item}><ApplicationStatusGlyph status={single?.status ?? 'Screening'} /> Status</ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[180px]">
            {(['Submitted', 'Screening'] as const).map(s => (
              <ContextMenuItem key={s} className={item} onSelect={() => void update(undecided.filter(t => t.status !== s), { status: s }).catch(() => undefined)}>
                <ApplicationStatusGlyph status={s} /> {s}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {!targets.every(t => t.assigneeId === ws.me.id) && (
        <ContextMenuItem className={item} onSelect={() => void update(targets, { assigneeId: ws.me.id }, { toast: single ? `${applicationRef(single.number)} assigned to you` : undefined }).catch(() => undefined)}>
          <UserRoundCheck className="h-3.5 w-3.5" /> Assign to me <ContextMenuShortcut>I</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {single && (
        <>
          <ContextMenuSeparator />
          {(single.status === 'Submitted' || single.status === 'Screening') && (
            <>
              <ContextMenuItem className={item} onSelect={() => onDecide('approve', single)}><CircleCheck className="h-3.5 w-3.5 text-tone-success" /> Approve…</ContextMenuItem>
              <ContextMenuItem className={item} onSelect={() => onDecide('deny', single)}><Ban className="h-3.5 w-3.5 text-tone-danger" /> Deny…</ContextMenuItem>
            </>
          )}
          {single.status === 'Approved' && !single.leaseId && ws.can('residents.manage') && (
            <ContextMenuItem className={item} onSelect={() => app.openCreate('lease', leaseDefaultsFor(single))}><KeyRound className="h-3.5 w-3.5" /> Create lease…</ContextMenuItem>
          )}
          {['Submitted', 'Screening', 'Approved'].includes(single.status) && (
            <ContextMenuItem className={item} onSelect={() => onDecide('withdraw', single)}><Undo2 className="h-3.5 w-3.5" /> Withdraw…</ContextMenuItem>
          )}
          {['Approved', 'Denied', 'Withdrawn'].includes(single.status) && (
            <ContextMenuItem className={item} onSelect={() => onDecide('reopen', single)}><RotateCcw className="h-3.5 w-3.5" /> Reopen…</ContextMenuItem>
          )}
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem className={item} onSelect={() => void copyText(targets.map(t => appUrl(`/applications/${t.number}`)).join('\n'), single ? `Copied link to ${applicationRef(single.number)}` : `Copied ${targets.length} links`)}>
        <Link2 className="h-3.5 w-3.5" /> Copy link
      </ContextMenuItem>
      {single?.email && (
        <ContextMenuItem className={item} onSelect={() => void copyText(single.email, 'Email copied')}>
          <Copy className="h-3.5 w-3.5" /> Copy email
        </ContextMenuItem>
      )}
    </div>
  );
}
