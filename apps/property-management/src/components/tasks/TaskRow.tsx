import { Building2, Check, ClipboardList, DoorOpen, FileSignature, KeyRound, UserRound, Wrench, X, Zap } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { COLORS } from '@project/shared/constants';
import { shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { RowShell, Slot } from '../list/GroupedList';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { PriorityGlyph, TaskStatusGlyph } from '../primitives/glyphs';
import { DueChip } from '../workOrders/WorkOrderRow';
import { glyphPriority, isClosed, primaryRelated, type Related, type RelatedKind, type Task } from './data';
import { TaskMenu } from './TaskMenu';
import { TaskPicker, type TaskPickerKind } from './TaskPicker';

export type TaskRowPicker = { id: string; kind: TaskPickerKind } | null;

export const RELATED_ICON: Record<RelatedKind, ReactNode> = {
  workOrder: <Wrench />,
  lease: <FileSignature />,
  application: <ClipboardList />,
  tenant: <UserRound />,
  vendor: <Wrench />,
  owner: <KeyRound />,
  unit: <DoorOpen />,
  property: <Building2 />,
};

/**
 * The completion circle: empty to do, half-filled in progress, a filled check
 * when done. Hovering an open task previews the check.
 */
export function CompletionCircle({ status, onToggle, size = 16, disabled }: { status: string; onToggle: () => void; size?: number; disabled?: boolean }) {
  const done = status === 'Done';
  const canceled = status === 'Canceled';
  const progress = status === 'In progress';
  return (
    <Tip label={done || canceled ? 'Reopen' : 'Mark done'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done || canceled ? 'Reopen task' : 'Mark task done'}
        disabled={disabled}
        onClick={e => {
          e.stopPropagation();
          onToggle();
        }}
        className="group/check relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
      >
        <span
          className={cn(
            'flex items-center justify-center rounded-full border-[1.5px] transition-colors duration-150',
            done || canceled ? 'border-transparent text-white animate-in zoom-in-75' : progress ? 'border-transparent text-transparent group-hover/check:border-tone-success group-hover/check:text-tone-success' : 'border-muted-foreground/60 text-transparent group-hover/check:border-tone-success group-hover/check:text-tone-success',
          )}
          style={{ width: size, height: size, background: done ? COLORS.green : canceled ? COLORS.gray : undefined }}
        >
          {canceled ? <X style={{ width: size * 0.62, height: size * 0.62 }} strokeWidth={3} /> : <Check style={{ width: size * 0.66, height: size * 0.66 }} strokeWidth={3} className={cn(!done && 'opacity-0 group-hover/check:opacity-100')} />}
        </span>
        {progress && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center group-hover/check:opacity-0" aria-hidden>
            <TaskStatusGlyph status="In progress" size={size} />
          </span>
        )}
      </button>
    </Tip>
  );
}

export function RelatedChip({ related, className }: { related: Related; className?: string }) {
  const navigate = useNavigate();
  const body = (
    <>
      <span className="flex shrink-0 text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">{RELATED_ICON[related.kind]}</span>
      <span className="truncate">{related.label}</span>
    </>
  );
  if (!related.to) {
    return (
      <Tip label={related.noun}>
        <span className={cn('chip max-w-[220px]', className)}>{body}</span>
      </Tip>
    );
  }
  return (
    <Tip label={`Open ${related.noun.toLowerCase()}`}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          navigate(related.to!);
        }}
        className={cn('chip max-w-[220px] hover:bg-accent', className)}
      >
        {body}
      </button>
    </Tip>
  );
}

type RowProps = {
  task: Task;
  properties: Set<string>;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  picker: TaskPickerKind | null;
  onPicker: (id: string, kind: TaskPickerKind | null) => void;
  onClick: (t: Task, e: MouseEvent) => void;
  onHover: (t: Task) => void;
  onToggleSelect: (t: Task, e: MouseEvent) => void;
  onToggleDone: (t: Task) => void;
  targetsFor: (t: Task) => Task[];
  onOpen: (t: Task) => void;
};

function TaskRowInner({ task: t, properties, selected, focused, selecting, picker, onPicker, onClick, onHover, onToggleSelect, onToggleDone, targetsFor, onOpen }: RowProps) {
  const ws = useWorkspace();
  const has = (k: string) => properties.has(k);
  const closed = isClosed(t);
  const assignee = t.assigneeId ? ws.memberById.get(t.assigneeId) : undefined;
  const related = has('related') ? primaryRelated(t, ws) : null;
  const slot = (kind: TaskPickerKind, label: string, children: ReactNode, className?: string) => (
    <Slot
      label={label}
      active={picker === kind}
      onActivate={() => onPicker(t.id, kind)}
      className={className}
      picker={trigger => <TaskPicker kind={kind} targets={targetsFor(t)} open onOpenChange={o => !o && onPicker(t.id, null)} trigger={trigger} />}
    >
      {children}
    </Slot>
  );

  return (
    <RowShell
      id={t.id}
      selected={selected}
      focused={focused}
      selecting={selecting}
      onClick={e => onClick(t, e)}
      onHover={() => onHover(t)}
      onToggleSelect={e => onToggleSelect(t, e)}
      menu={<TaskMenu targets={targetsFor(t)} onOpen={onOpen} />}
      muted={closed}
    >
      <CompletionCircle status={t.status} onToggle={() => onToggleDone(t)} />
      {has('priority') && slot('priority', `Priority: ${t.priority}`, <span className="flex h-6 w-6 items-center justify-center"><PriorityGlyph priority={glyphPriority(t.priority)} /></span>)}
      <span className={cn('min-w-0 truncate font-medium', closed && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{t.title}</span>
      {t.systemKey && (
        <Tip label="Created automatically">
          <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
            <Zap className="h-3 w-3" /> <span className="hidden xl:inline">Automatic</span>
          </span>
        </Tip>
      )}
      {t.status === 'In progress' && <span className="hidden shrink-0 text-2xs text-tone-warning sm:inline">In progress</span>}
      <span className="min-w-4 flex-1" />
      <span className="hidden shrink-0 items-center gap-2 md:flex">
        {related && <RelatedChip related={related} />}
        {has('category') && <span className="chip hidden max-w-[120px] truncate text-muted-foreground lg:inline-flex">{t.category}</span>}
        {has('created') && <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{shortDate(t.openedAt?.slice(0, 10))}</span>}
      </span>
      {has('due') && (t.dueDate || !closed) && slot('due', t.dueDate ? `Due ${shortDate(t.dueDate)}` : 'Set due date', t.dueDate ? <DueChip day={t.dueDate} closed={closed} className="px-1" /> : <span className="hidden h-5 items-center px-1 text-sm text-muted-foreground/0 group-hover/row:text-muted-foreground sm:inline-flex">Due…</span>)}
      {has('assignee') && slot('assignee', assignee ? `Assigned to ${assignee.name}` : 'Unassigned', <span className="flex h-6 w-6 items-center justify-center">{assignee ? <MemberAvatar member={assignee} size={20} /> : <UnassignedAvatar size={20} />}</span>)}
    </RowShell>
  );
}

export const TaskRow = memo(TaskRowInner);
