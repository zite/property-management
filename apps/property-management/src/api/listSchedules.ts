import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { assertMaintenance, SCHEDULE_SELECT, toSchedule } from '../server/maintenance';

/** Preventive maintenance schedules with their next due date, when the next work order is created, and the last one created. */

const Input = z.object({});

export default createEndpoint({
  description: 'List preventive maintenance schedules',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'recurring maintenance');
    parseInput(Input, input);
    const settings = await getSettings();
    const { rows } = await zite.sql({ query: `SELECT ${SCHEDULE_SELECT} FROM "MaintenanceSchedules" s ORDER BY s."nextDueOn" ASC NULLS LAST, s."title" ASC LIMIT 2000`, params: [] });
    return { today: todayIn(settings.timezone), automationRanAt: settings.automationRanAt, schedules: rows.map(toSchedule) };
  },
});
