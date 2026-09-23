import { useMemo, type ReactNode } from 'react';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import { useWorkspace } from '../../lib/workspace';
import { MemberPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { PriorityGlyph, TaskStatusGlyph } from '../primitives/glyphs';
import { DuePicker } from '../workOrders/WorkOrderPicker';
import { glyphPriority, useTaskActions, type Task, type TaskCategory, type TaskPatch, type TaskPriority, type TaskStatus } from './data';

export type TaskPickerKind = 'status' | 'priority' | 'assignee' | 'due' | 'category';

/**
 * One picker for any task property, applied to one task or a selection. Rows,
 * the task sheet, the bulk bar and the keyboard shortcuts all open this.
 */
export function TaskPicker({ kind, targets, trigger, open, onOpenChange, align = 'start' }: {
  kind: TaskPickerKind;
  targets: Task[];
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}) {
  const ws = useWorkspace();
  const { update } = useTaskActions();
  const first = targets[0];
  const many = targets.length > 1;
  const same = <K extends keyof Task>(key: K) => (targets.every(t => t[key] === first?.[key]) ? first?.[key] : undefined);
  const apply = (patch: TaskPatch) => {
    const undo = patch.status === 'Done' || patch.status === 'Canceled' || many;
    void update(targets, patch, { ws, undo, toast: many || undo ? undefined : false }).catch(() => undefined);
  };
  const common = { trigger, open, onOpenChange, align };

  const statusOptions = useMemo(() => TASK_STATUSES.map((s, i) => ({ value: s, label: s, icon: <TaskStatusGlyph status={s} size={14} />, shortcut: String(i + 1) })), []);
  const priorityOptions = useMemo(() => TASK_PRIORITIES.map((p, i) => ({ value: p, label: p, icon: <PriorityGlyph priority={glyphPriority(p)} />, shortcut: String(i + 1) })), []);
  const categoryOptions = useMemo(() => TASK_CATEGORIES.map(c => ({ value: c, label: c })), []);

  switch (kind) {
    case 'status':
      return <OptionPicker {...common} options={statusOptions} value={(same('status') as TaskStatus) ?? null} onChange={v => v && apply({ status: v })} placeholder={many ? `Status for ${targets.length}…` : 'Change status…'} />;
    case 'priority':
      return <OptionPicker {...common} options={priorityOptions} value={(same('priority') as TaskPriority) ?? null} onChange={v => v && apply({ priority: v })} placeholder="Set priority…" />;
    case 'category':
      return <OptionPicker {...common} options={categoryOptions} value={(same('category') as TaskCategory) ?? null} onChange={v => v && apply({ category: v as TaskCategory })} placeholder="Set category…" width={220} />;
    case 'assignee':
      return <MemberPicker {...common} value={(same('assigneeId') as string | null) ?? null} onChange={id => apply({ assigneeId: id })} />;
    case 'due':
      return <DuePicker {...common} value={(same('dueDate') as string | null) ?? null} onChange={d => apply({ dueDate: d })} />;
  }
}
