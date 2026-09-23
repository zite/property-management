import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, todayIn } from '@project/shared/dates';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { assertMaintenance, INSPECTION_SELECT, toInspection } from '../server/maintenance';

/**
 * Inspections for the list: everything scheduled or in progress, plus the
 * last year of completed ones (move-in reports stay relevant for a whole
 * lease). `history` adds older and canceled inspections. Progress and issue
 * counts come from each inspection's checklist; the list filters on the client.
 */

const Input = z.object({ history: z.boolean().optional() });

export default createEndpoint({
  description: 'List inspections with progress and issues',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'inspections');
    const { history } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const where = history ? '' : `WHERE i."status" IN ('Scheduled', 'In progress') OR (i."status" = 'Completed' AND COALESCE(i."completedAt", i."scheduledFor", i.created_at) >= $1::date)`;
    const [{ rows }, { rows: residents }] = await Promise.all([
      zite.sql({
        query: `SELECT ${INSPECTION_SELECT} FROM "Inspections" i LEFT JOIN "Leases" l ON l.id::text = i."leaseId" ${where} ORDER BY COALESCE(i."scheduledFor", i.created_at) DESC LIMIT 2000`,
        params: history ? [] : [addDays(today, -365)],
      }),
      zite.sql({
        query: `
          SELECT lt."leaseId", STRING_AGG(t."name", ', ' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END) AS "names"
          FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId"
          WHERE lt."role" IN ('Primary', 'Co-tenant') AND lt."leaseId" IN (SELECT i."leaseId" FROM "Inspections" i WHERE COALESCE(i."leaseId", '') <> '')
          GROUP BY lt."leaseId"`,
        params: [],
      }),
    ]);
    const names = new Map(residents.map(r => [String(r.leaseId), str(r.names) ?? '']));
    return {
      today,
      history: Boolean(history),
      inspections: rows.map(r => {
        const i = toInspection(r);
        return { ...i, residentNames: i.leaseId ? names.get(i.leaseId) ?? '' : '' };
      }),
    };
  },
});
