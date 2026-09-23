import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import type { ActivityInput } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import {
  activityTags, applyTaskPatch, assertCanSeeTask, canManageAllTasks, loadTasks, logActivity, memberNames, notifyAssigned, type TaskRow,
} from '../server/tasks';

/**
 * Change one or many tasks — complete, reopen, reassign, reschedule — or
 * delete ones people made by hand. Every row goes through the same patch
 * logic as the task sheet. Writes run one at a time: the platform rate-limits
 * bursts of parallel writes.
 */

const Patch = z.object({
  title: z.string().trim().min(1, 'A task needs a title.').max(240).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid due date.').nullable().optional(),
  assigneeId: z.string().nullable().optional(),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), ids: z.array(z.string().min(1)).min(1).max(200), patch: Patch }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().min(1)).min(1).max(200) }),
]);

export default createEndpoint({
  description: 'Update or delete one or more tasks',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    const tasks = await loadTasks(data.ids);
    for (const t of tasks) assertCanSeeTask(actor, t);

    if (data.action === 'delete') {
      if (tasks.some(t => t.systemKey)) throw new ZiteError('Automatic tasks can’t be deleted — they’d be opened again on the next daily run. Mark them done or canceled instead.', 'BAD_REQUEST');
      if (!canManageAllTasks(actor) && tasks.some(t => t.createdById !== actor.id)) throw new ZiteError('You can only delete tasks you created.', 'FORBIDDEN');
      for (const t of tasks) await withRetry(() => zite.tasks.delete({ id: t.id }));
      await logActivity(tasks.map(t => ({ entityType: 'task' as const, entityId: t.id, action: 'deleted', summary: `deleted the task “${t.title.slice(0, 80)}”`, actorId: actor.id, actorName: actor.name, ...activityTags(t) })));
      return { updated: tasks.length };
    }

    const patch = { ...data.patch, assigneeId: data.patch.assigneeId === '' ? null : data.patch.assigneeId };
    const names = await memberNames();
    const entries: ActivityInput[] = [];
    const assigned = new Map<string, TaskRow[]>();
    let updated = 0;
    for (const before of tasks) {
      const res = await applyTaskPatch(actor, before, patch, names);
      if (!res.changed) continue;
      updated++;
      entries.push(...res.entries);
      if (res.notifyAssignee) assigned.set(res.notifyAssignee, [...(assigned.get(res.notifyAssignee) ?? []), { ...before, ...patch, title: patch.title ?? before.title } as TaskRow]);
    }
    await logActivity(entries);
    for (const [assigneeId, list] of assigned) await notifyAssigned(actor, assigneeId, list);
    return { updated };
  },
});
