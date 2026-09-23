import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { OWNER_APPROVALS, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_SOURCES, WORK_ORDER_STATUSES } from '@project/shared/constants';
import { todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { toWorkOrder, WORK_ORDER_SELECT } from '../server/workOrders';

/**
 * Work orders for lists and boards. Filters are ANDed; within a filter, values
 * are ORed. `__me__` and `__none__` work for assignee and vendor. Closed work
 * (completed/canceled) is excluded unless asked for, and then limited to the
 * last `closedDays` so a busy company's history doesn't flood the board.
 */

const id = z.string().min(1);
export const WorkOrderFilters = z.object({
  statuses: z.array(z.enum(WORK_ORDER_STATUSES)).optional(),
  priorities: z.array(z.enum(WORK_ORDER_PRIORITIES)).optional(),
  categories: z.array(z.enum(WORK_ORDER_CATEGORIES)).optional(),
  sources: z.array(z.enum(WORK_ORDER_SOURCES)).optional(),
  approvals: z.array(z.enum(OWNER_APPROVALS)).optional(),
  propertyIds: z.array(id).optional(),
  unitIds: z.array(id).optional(),
  assigneeIds: z.array(id).optional(),
  vendorIds: z.array(id).optional(),
  leaseId: id.optional(),
  tenantId: id.optional(),
  scheduleId: id.optional(),
  search: z.string().max(120).optional(),
  due: z.enum(['overdue', 'today', 'week']).optional(),
  unscheduled: z.boolean().optional(),
  showClosed: z.boolean().optional(),
  closedDays: z.number().int().min(1).max(3650).optional(),
});

const Input = z.object({ filters: WorkOrderFilters.default({}), limit: z.number().int().min(1).max(2000).optional() });

export default createEndpoint({
  description: 'List work orders with filters',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'maintenance.create');
    const { filters: f, limit = 1000 } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const p = new Params();
    const where: string[] = [];
    const inList = (col: string, values?: string[]) => {
      if (values?.length) where.push(`${col} IN ${p.list(values)}`);
    };
    const people = (col: string, values?: string[]) => {
      if (!values?.length) return;
      const ids = values.map(v => (v === '__me__' ? actor.id : v)).filter(v => v !== '__none__');
      const parts: string[] = [];
      if (ids.length) parts.push(`${col} IN ${p.list(ids)}`);
      if (values.includes('__none__')) parts.push(`COALESCE(${col}, '') = ''`);
      where.push(`(${parts.join(' OR ')})`);
    };

    if (f.statuses?.length) inList('w."status"', f.statuses);
    else if (!f.showClosed) where.push(`w."status" NOT IN ('Completed', 'Canceled')`);
    if (f.showClosed && !f.statuses?.length) {
      where.push(`(w."status" NOT IN ('Completed', 'Canceled') OR COALESCE(w."completedAt", w."lastActivityAt", w.created_at) >= NOW() - (${p.add(f.closedDays ?? 120)}::int * INTERVAL '1 day'))`);
    }
    inList('w."priority"', f.priorities);
    inList('w."category"', f.categories);
    inList('w."source"', f.sources);
    inList('w."ownerApproval"', f.approvals);
    inList('w."propertyId"', f.propertyIds);
    inList('w."unitId"', f.unitIds);
    people('w."assigneeId"', f.assigneeIds);
    people('w."vendorId"', f.vendorIds);
    if (f.leaseId) where.push(`w."leaseId" = ${p.add(f.leaseId)}`);
    if (f.tenantId) {
      const t = p.add(f.tenantId);
      // Work orders name a resident, or belong to a lease the resident is on.
      where.push(`(w."tenantId" = ${t} OR (COALESCE(w."tenantId", '') = '' AND EXISTS (SELECT 1 FROM "LeaseTenants" lt WHERE lt."leaseId" = w."leaseId" AND lt."tenantId" = ${t})))`);
    }
    if (f.scheduleId) where.push(`w."scheduleId" = ${p.add(f.scheduleId)}`);
    if (f.unscheduled) where.push(`w."scheduledFor" IS NULL`);
    if (f.due === 'overdue') where.push(`w."dueDate" < ${p.add(today)}::date AND w."status" NOT IN ('Completed', 'Canceled')`);
    if (f.due === 'today') where.push(`w."dueDate" = ${p.add(today)}::date`);
    if (f.due === 'week') where.push(`w."dueDate" <= (${p.add(today)}::date + 7)`);
    if (f.search?.trim()) {
      const q = p.add(`%${f.search.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
      const n = /^\s*(wo-?)?\d+\s*$/i.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(w."title" ILIKE ${q} OR w."description" ILIKE ${q} OR w."number" = ${p.add(n)} OR EXISTS (SELECT 1 FROM "Tenants" t WHERE t.id::text = w."tenantId" AND t."name" ILIKE ${q}))`);
    }

    const { rows } = await zite.sql({
      query: `SELECT ${WORK_ORDER_SELECT} FROM "WorkOrders" w ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY w."number" DESC LIMIT ${Math.min(2000, limit)}`,
      params: p.values,
    });
    return { workOrders: rows.map(toWorkOrder), today };
  },
});
