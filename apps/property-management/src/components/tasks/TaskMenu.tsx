import { CalendarDays, CalendarX2, CircleCheck, Copy, Link2, PanelRight, RotateCcw, Trash2, UserRoundCheck } from 'lucide-react';
import {
  ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger,
} from '@project/components/ui/context-menu';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { addDays, appUrl } from '../../lib/format';
import { MOD } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { PriorityGlyph, TaskStatusGlyph } from '../primitives/glyphs';
import { canManageTasks, glyphPriority, isClosed, useTaskActions, type Task, type TaskPatch } from './data';

const item = 'h-9 gap-2 text-[14px]';
const sub = 'max-h-[360px] min-w-[200px] overflow-y-auto';

/** Right-click on a task row. Acts on the whole selection when the row is part of it. */
export function TaskMenu({ targets, onOpen }: { targets: Task[]; onOpen: (t: Task) => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { update, remove } = useTaskActions();
  if (!targets.length) return null;
  const single = targets.length === 1 ? targets[0] : null;
  const apply = (patch: TaskPatch, undo = false) => void update(targets, patch, { ws, undo, toast: targets.length > 1 || undo ? undefined : false }).catch(() => undefined);
  const allClosed = targets.every(isClosed);
  const deletable = targets.every(t => !t.systemKey && (canManageTasks(ws) || t.createdById === ws.me.id));

  return (
    <div onClick={e => e.stopPropagation()}>
      {!single && <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{targets.length} tasks selected</div>}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => onOpen(single)}>
            <PanelRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      {allClosed ? (
        <ContextMenuItem className={item} onSelect={() => apply({ status: 'To do' }, true)}>
          <RotateCcw className="h-3.5 w-3.5" /> Reopen <ContextMenuShortcut>{MOD}⇧↵</ContextMenuShortcut>
        </ContextMenuItem>
      ) : (
        <ContextMenuItem className={item} onSelect={() => apply({ status: 'Done' }, true)}>
          <CircleCheck className="h-3.5 w-3.5" /> Mark done <ContextMenuShortcut>{MOD}⇧↵</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <TaskStatusGlyph status={single?.status ?? 'In progress'} size={14} /> Status
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {TASK_STATUSES.map((s, i) => (
            <ContextMenuItem key={s} className={item} onSelect={() => apply({ status: s }, s === 'Done' || s === 'Canceled')}>
              <TaskStatusGlyph status={s} size={14} /> {s} <ContextMenuShortcut>{i + 1}</ContextMenuShortcut>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <PriorityGlyph priority={glyphPriority(single?.priority ?? 'High')} /> Priority
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {TASK_PRIORITIES.map(p => (
            <ContextMenuItem key={p} className={item} onSelect={() => apply({ priority: p })}>
              <PriorityGlyph priority={glyphPriority(p)} /> {p}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <UserRoundCheck className="h-3.5 w-3.5" /> Assignee
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          <ContextMenuItem className={item} onSelect={() => apply({ assigneeId: null })}>
            <UnassignedAvatar size={16} /> Unassigned
          </ContextMenuItem>
          {ws.activeMembers.map(m => (
            <ContextMenuItem key={m.id} className={item} onSelect={() => apply({ assigneeId: m.id })}>
              <MemberAvatar member={m} size={16} /> {m.id === ws.me.id ? `${m.name} (you)` : m.name}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <CalendarDays className="h-3.5 w-3.5" /> Due date
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {[{ label: 'Today', day: ws.today }, { label: 'Tomorrow', day: addDays(1, ws.today) }, { label: 'In a week', day: addDays(7, ws.today) }].map(o => (
            <ContextMenuItem key={o.label} className={item} onSelect={() => apply({ dueDate: o.day })}>
              {o.label}
            </ContextMenuItem>
          ))}
          {targets.some(t => t.dueDate) && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem className={item} onSelect={() => apply({ dueDate: null })}>
                <CalendarX2 className="h-3.5 w-3.5" /> Remove due date
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}>
          <span className="w-3.5" /> Category
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={sub}>
          {TASK_CATEGORIES.map(c => (
            <ContextMenuItem key={c} className={item} onSelect={() => apply({ category: c })}>
              {c}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      {!targets.every(t => t.assigneeId === ws.me.id) && (
        <ContextMenuItem className={item} onSelect={() => apply({ assigneeId: ws.me.id })}>
          <UserRoundCheck className="h-3.5 w-3.5" /> Assign to me <ContextMenuShortcut>I</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuItem
        className={item}
        onSelect={() => void copyText(targets.map(t => appUrl(`/tasks?task=${t.id}`)).join('\n'), single ? 'Copied link to the task' : `Copied ${targets.length} links`)}
      >
        <Link2 className="h-3.5 w-3.5" /> Copy link
      </ContextMenuItem>
      <ContextMenuItem className={item} onSelect={() => void copyText(targets.map(t => t.title).join('\n'))}>
        <Copy className="h-3.5 w-3.5" /> Copy title
      </ContextMenuItem>
      {deletable && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            className={`${item} text-tone-danger focus:text-tone-danger`}
            onSelect={async () => {
              const ok = await app.confirm({
                title: single ? `Delete “${single.title.slice(0, 60)}”?` : `Delete ${targets.length} tasks?`,
                description: 'It’s removed for everyone and can’t be restored. Mark it done instead if you want to keep a record.',
                confirmLabel: single ? 'Delete task' : `Delete ${targets.length} tasks`,
                destructive: true,
              });
              if (ok) void remove(targets).catch(() => undefined);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete…
          </ContextMenuItem>
        </>
      )}
    </div>
  );
}
