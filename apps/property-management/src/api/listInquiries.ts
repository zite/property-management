import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { INQUIRY_SOURCES, INQUIRY_STATUSES } from '@project/shared/constants';
import { addDays, todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { Params } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { INQUIRY_FROM, INQUIRY_SELECT, toInquiry } from '../server/leasing';

/**
 * Leads: questions and showing requests from the portal, plus the ones staff
 * log by hand. Applied and closed leads are hidden unless asked for, and then
 * only recent ones.
 */

const id = z.string().min(1);
const Input = z.object({
  filters: z
    .object({
      statuses: z.array(z.enum(INQUIRY_STATUSES)).optional(),
      sources: z.array(z.enum(INQUIRY_SOURCES)).optional(),
      propertyIds: z.array(id).optional(),
      unitIds: z.array(id).optional(),
      listingIds: z.array(id).optional(),
      assigneeIds: z.array(id).optional(),
      received: z.enum(['today', 'week', 'month']).optional(),
      showing: z.enum(['upcoming', 'past']).optional(),
      search: z.string().max(120).optional(),
      showClosed: z.boolean().optional(),
    })
    .default({}),
});

export default createEndpoint({
  description: 'List leasing inquiries (leads) with filters',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { filters: f } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const p = new Params();
    const where: string[] = [];
    const inList = (col: string, values?: string[]) => {
      if (values?.length) where.push(`${col} IN ${p.list(values)}`);
    };
    if (f.statuses?.length) inList('q."status"', f.statuses);
    else if (!f.showClosed) where.push(`COALESCE(q."status", 'New') NOT IN ('Applied', 'Closed')`);
    else where.push(`(COALESCE(q."status", 'New') NOT IN ('Applied', 'Closed') OR COALESCE(q."receivedAt", q.created_at) >= NOW() - INTERVAL '180 days')`);
    inList('q."source"', f.sources);
    inList('q."propertyId"', f.propertyIds);
    inList('q."unitId"', f.unitIds);
    inList('q."listingId"', f.listingIds);
    if (f.assigneeIds?.length) {
      const ids = f.assigneeIds.map(v => (v === '__me__' ? actor.id : v)).filter(v => v !== '__none__');
      const parts: string[] = [];
      if (ids.length) parts.push(`q."assigneeId" IN ${p.list(ids)}`);
      if (f.assigneeIds.includes('__none__')) parts.push(`COALESCE(q."assigneeId", '') = ''`);
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.received) {
      const from = f.received === 'today' ? today : addDays(today, f.received === 'week' ? -7 : -30);
      where.push(`COALESCE(q."receivedAt", q.created_at) >= (${p.add(from)}::date - INTERVAL '1 day')`);
    }
    if (f.showing === 'upcoming') where.push(`q."showingAt" >= NOW()`);
    if (f.showing === 'past') where.push(`q."showingAt" < NOW()`);
    if (f.search?.trim()) {
      const q = p.add(`%${f.search.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
      where.push(`(q."name" ILIKE ${q} OR q."email" ILIKE ${q} OR q."phone" ILIKE ${q} OR q."message" ILIKE ${q} OR l."title" ILIKE ${q})`);
    }
    const { rows } = await zite.sql({
      query: `SELECT ${INQUIRY_SELECT} ${INQUIRY_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(q."receivedAt", q.created_at) DESC LIMIT 1000`,
      params: p.values,
    });
    return { inquiries: rows.map(toInquiry), today };
  },
});
