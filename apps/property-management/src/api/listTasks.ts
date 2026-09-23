import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '@project/shared/constants';
import { addDays, todayIn } from '@project/shared/dates';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canManageAllTasks, TASK_FROM, TASK_SELECT, toTask } from '../server/tasks';

/**
 * Tasks for lists. `scope` is the tab: mine, all open, created by me, done.
 * Filters are ANDed; within a filter values are ORed; `__me__` and `__none__`
 * work for assignee. People who don't manage tasks only ever see tasks
 * assigned to them or created by them, whatever they ask for.
 */

const id = z.string().min(1);
export const TaskFilters = z.object({
  scope: z.enum(['mine', 'open', 'created', 'done']).optional(),
  statuses: z.array(z.enum(TASK_STATUSES)).optional(),
  priorities: z.array(z.enum(TASK_PRIORITIES)).optional(),
  categories: z.array(z.enum(TASK_CATEGORIES)).optional(),
  assigneeIds: z.array(id).optional(),
  propertyIds: z.array(id).optional(),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  source: z.enum(['automatic', 'manual']).optional(),
  search: z.string().max(120).optional(),
  /** Include tasks completed or canceled in the last 14 days. */
  showDone: z.boolean().optional(),
});

const Input = z.object({ filters: TaskFilters.default({}) });

export default createEndpoint({
  description: 'List tasks with filters',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { filters: f } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const manager = canManageAllTasks(actor);
    const p = new Params();
    const where: string[] = [];
    const scope = f.scope ?? 'mine';
    // Bind the actor only when a clause uses it: an unused bound parameter fails the query.
    let meParam: string | null = null;
    const me = () => meParam || (meParam = p.add(actor.id));

    if (!manager) where.push(`(t."assigneeId" = ${me()} OR t."createdById" = ${me()})`);
    if (scope === 'mine') where.push(`t."assigneeId" = ${me()}`);
    if (scope === 'created') where.push(`t."createdById" = ${me()}`);

    const open = `COALESCE(NULLIF(t."status", ''), 'To do') IN ('To do', 'In progress')`;
    const recentlyClosed = (days: number) => `(t."status" IN ('Done', 'Canceled') AND COALESCE(t."completedAt", t.created_at) >= NOW() - (${p.add(days)}::int * INTERVAL '1 day'))`;
    if (f.statuses?.length) where.push(`COALESCE(NULLIF(t."status", ''), 'To do') IN ${p.list(f.statuses)}`);
    else if (scope === 'done') where.push(recentlyClosed(120));
    else where.push(f.showDone ? `(${open} OR ${recentlyClosed(14)})` : open);

    if (f.priorities?.length) where.push(`COALESCE(NULLIF(t."priority", ''), 'Normal') IN ${p.list(f.priorities)}`);
    if (f.categories?.length) where.push(`COALESCE(NULLIF(t."category", ''), 'General') IN ${p.list(f.categories)}`);
    if (f.propertyIds?.length) where.push(`t."propertyId" IN ${p.list(f.propertyIds)}`);
    if (f.assigneeIds?.length) {
      const ids = f.assigneeIds.map(v => (v === '__me__' ? actor.id : v)).filter(v => v !== '__none__');
      const parts: string[] = [];
      if (ids.length) parts.push(`t."assigneeId" IN ${p.list(ids)}`);
      if (f.assigneeIds.includes('__none__')) parts.push(`COALESCE(t."assigneeId", '') = ''`);
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.due === 'overdue') where.push(`t."dueDate" < ${p.add(today)}::date`);
    if (f.due === 'today') where.push(`t."dueDate" = ${p.add(today)}::date`);
    if (f.due === 'week') where.push(`t."dueDate" <= ${p.add(addDays(today, 7))}::date`);
    if (f.due === 'none') where.push(`t."dueDate" IS NULL`);
    if (f.source === 'automatic') where.push(`COALESCE(t."systemKey", '') <> ''`);
    if (f.source === 'manual') where.push(`COALESCE(t."systemKey", '') = ''`);
    if (f.search?.trim()) {
      const q = p.add(`%${f.search.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
      where.push(`(t."title" ILIKE ${q} OR t."description" ILIKE ${q} OR l."name" ILIKE ${q} OR tn."name" ILIKE ${q} OR v."name" ILIKE ${q} OR o."name" ILIKE ${q})`);
    }

    const order = scope === 'done' ? `t."completedAt" DESC NULLS LAST, t.created_at DESC` : `t."dueDate" ASC NULLS LAST, t.created_at DESC`;
    const { rows } = await zite.sql({
      query: `SELECT ${TASK_SELECT} FROM ${TASK_FROM} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 1000`,
      params: p.values,
    });
    return { tasks: rows.map(toTask), today, canManageAll: manager };
  },
});
