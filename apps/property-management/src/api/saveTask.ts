import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import { formatDay } from '@project/shared/dates';
import { getActor } from '@project/shared/server/actor';
import { withRetry } from '@project/shared/server/sql';
import { nullableId, parseInput } from '../server/input';
import {
  activityTags, applyTaskPatch, assertActiveMember, assertCanSeeTask, loadTask, logActivity, memberNames, notifyAssigned, resolveLinks, taskContext,
} from '../server/tasks';

/**
 * Create a task, or save every field of one from the task dialog. Anyone can
 * create a task and assign it to anyone; the assignee hears about it in their
 * inbox unless they assigned it to themselves.
 */

const link = z.string().nullable().optional();
const Fields = z.object({
  title: z.string().trim().min(1, 'Give the task a title.').max(240, 'Keep the title under 240 characters.'),
  description: z.string().max(5000, 'Keep the description under 5,000 characters.').optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  category: z.enum(TASK_CATEGORIES).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid due date.').nullable().optional(),
  assigneeId: link,
  propertyId: link,
  unitId: link,
  leaseId: link,
  tenantId: link,
  ownerId: link,
  vendorId: link,
  workOrderId: link,
  applicationId: link,
});

const Input = z.object({ id: z.string().min(1).optional(), task: Fields });

export default createEndpoint({
  description: 'Create or edit a task',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { id, task: t } = parseInput(Input, input);
    const assigneeId = nullableId(t.assigneeId);
    const LINK_KEYS = ['propertyId', 'unitId', 'leaseId', 'tenantId', 'ownerId', 'vendorId', 'workOrderId', 'applicationId'] as const;
    // Links left out of the request stay as they are on an edit; sent as null or '' they are cleared.
    const linkInput = Object.fromEntries(LINK_KEYS.filter(k => t[k] !== undefined).map(k => [k, nullableId(t[k])])) as Partial<Record<(typeof LINK_KEYS)[number], string | null>>;

    if (id) {
      const before = await loadTask(id);
      assertCanSeeTask(actor, before);
      const names = await memberNames();
      const res = await applyTaskPatch(actor, before, {
        title: t.title,
        description: t.description ?? before.description,
        status: t.status ?? before.status,
        priority: t.priority ?? before.priority,
        category: t.category ?? before.category,
        dueDate: t.dueDate === undefined ? before.dueDate : t.dueDate,
        assigneeId: t.assigneeId === undefined ? before.assigneeId : assigneeId,
        ...linkInput,
      }, names);
      if (res.changed) {
        await logActivity(res.entries);
        if (res.notifyAssignee) await notifyAssigned(actor, res.notifyAssignee, [await loadTask(id)]);
      }
      return { id };
    }

    if (assigneeId) await assertActiveMember(assigneeId);
    const links = await resolveLinks(linkInput);
    const status = t.status ?? 'To do';
    if (status === 'Canceled') throw new ZiteError('A new task can’t start out canceled.', 'BAD_REQUEST');
    const now = new Date().toISOString();
    const created = await withRetry(() =>
      zite.tasks.create({
        record: {
          title: t.title,
          description: t.description?.trim() || null,
          status,
          priority: t.priority ?? 'Normal',
          category: t.category ?? 'General',
          dueDate: t.dueDate ?? null,
          assigneeId,
          ...links,
          createdById: actor.id,
          openedAt: now,
          completedAt: status === 'Done' ? now : null,
          systemKey: null,
        },
      }),
    );
    const task = await loadTask(created.id);
    const names = await memberNames();
    const context_ = taskContext(task);
    await logActivity({
      entityType: 'task',
      entityId: task.id,
      action: 'created',
      summary: `created the task “${task.title.slice(0, 80)}”${assigneeId && assigneeId !== actor.id ? ` for ${names.member(assigneeId)}` : ''}${task.dueDate ? `, due ${formatDay(task.dueDate)}` : ''}${context_ ? ` · ${context_}` : ''}`.slice(0, 250),
      actorId: actor.id,
      actorName: actor.name,
      ...activityTags(task),
    });
    if (assigneeId) await notifyAssigned(actor, assigneeId, [task]);
    return { id: task.id };
  },
});
