import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { APPLICATION_STATUSES } from '@project/shared/constants';
import { addDays, todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { APPLICATION_FROM, APPLICATION_SELECT, toApplication } from '../server/leasing';

/**
 * Rental applications for the leasing queue, boards and saved views. Drafts
 * (applicants still filling the form in) never appear. Decided applications
 * (denied, withdrawn, leased) are left out unless asked for, and then only
 * the last `closedDays` of them.
 */

const id = z.string().min(1);
export const ApplicationFilters = z.object({
  statuses: z.array(z.enum(APPLICATION_STATUSES)).optional(),
  propertyIds: z.array(id).optional(),
  unitIds: z.array(id).optional(),
  listingIds: z.array(id).optional(),
  assigneeIds: z.array(id).optional(),
  submitted: z.enum(['today', 'week', 'month']).optional(),
  feeUnpaid: z.boolean().optional(),
  search: z.string().max(120).optional(),
  showClosed: z.boolean().optional(),
  closedDays: z.number().int().min(1).max(3650).optional(),
});

const Input = z.object({ filters: ApplicationFilters.default({}), limit: z.number().int().min(1).max(2000).optional() });

export default createEndpoint({
  description: 'List rental applications with filters',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { filters: f, limit = 1000 } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const p = new Params();
    const where: string[] = [`a."status" <> 'Draft'`];
    const inList = (col: string, values?: string[]) => {
      if (values?.length) where.push(`${col} IN ${p.list(values)}`);
    };

    if (f.statuses?.length) inList('a."status"', f.statuses.filter(s => s !== 'Draft'));
    else if (!f.showClosed) where.push(`a."status" IN ('Submitted', 'Screening', 'Approved')`);
    if (f.showClosed && !f.statuses?.length) {
      where.push(`(a."status" IN ('Submitted', 'Screening', 'Approved') OR COALESCE(a."decidedAt", a."lastActivityAt", a.created_at) >= NOW() - (${p.add(f.closedDays ?? 180)}::int * INTERVAL '1 day'))`);
    }
    inList('a."propertyId"', f.propertyIds);
    inList('a."unitId"', f.unitIds);
    inList('a."listingId"', f.listingIds);
    if (f.assigneeIds?.length) {
      const ids = f.assigneeIds.map(v => (v === '__me__' ? actor.id : v)).filter(v => v !== '__none__');
      const parts: string[] = [];
      if (ids.length) parts.push(`a."assigneeId" IN ${p.list(ids)}`);
      if (f.assigneeIds.includes('__none__')) parts.push(`COALESCE(a."assigneeId", '') = ''`);
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.submitted) {
      const from = f.submitted === 'today' ? today : addDays(today, f.submitted === 'week' ? -7 : -30);
      where.push(`COALESCE(a."submittedAt", a.created_at) >= (${p.add(from)}::date - INTERVAL '1 day')`);
    }
    if (f.feeUnpaid) where.push(`a."feePaidAt" IS NULL AND COALESCE(a."feeAmount", 0) > 0`);
    if (f.search?.trim()) {
      const q = p.add(`%${f.search.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
      const n = /^\s*(app-?)?\d+\s*$/i.test(f.search) ? Number(f.search.replace(/\D/g, '')) : -1;
      where.push(`(a."applicantName" ILIKE ${q} OR a."email" ILIKE ${q} OR a."phone" ILIKE ${q} OR a."coApplicants" ILIKE ${q} OR a."employer" ILIKE ${q} OR a."number" = ${p.add(n)} OR l."title" ILIKE ${q})`);
    }

    const { rows } = await zite.sql({
      query: `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE ${where.join(' AND ')} ORDER BY COALESCE(a."submittedAt", a.created_at) DESC LIMIT ${Math.min(2000, limit)}`,
      params: p.values,
    });
    return { applications: rows.map(toApplication), today, incomeMultiple: settings.incomeMultiple };
  },
});
