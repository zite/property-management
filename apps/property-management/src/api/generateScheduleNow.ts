import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { formatDay, todayIn } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { assertMaintenance, generateForSchedule, loadSchedule } from '../server/maintenance';

/**
 * "Generate now": create a schedule's next work order immediately instead of
 * waiting for the daily run, using the automation's own rules (see
 * `generateForSchedule`). `expectedNextDueOn` is the due date the person was
 * looking at; if the schedule has moved on since (a double click, another
 * tab, the automation running), nothing is created twice.
 */

const Input = z.object({ id: z.string().min(1), expectedNextDueOn: z.string().nullable() });

export default createEndpoint({
  description: 'Create the next work order from a maintenance schedule now',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ created: z.boolean(), number: z.number().nullable(), dueDate: z.string(), nextDueOn: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'recurring maintenance');
    const { id, expectedNextDueOn } = parseInput(Input, input);
    const { row, schedule } = await loadSchedule(id);
    if (!schedule.active) throw new ZiteError('This schedule is paused. Resume it to generate work orders.', 'BAD_REQUEST');
    if (!schedule.propertyId) throw new ZiteError('Choose a property for the schedule first.', 'BAD_REQUEST');
    if (schedule.nextDueOn !== expectedNextDueOn) throw new ZiteError('This schedule just moved to its next due date — it may already have created the work order. Refresh to see it.', 'CONFLICT');
    const settings = await getSettings();
    const result = await generateForSchedule(row, todayIn(settings.timezone), actor);
    await logActivity({ entityType: 'property', entityId: schedule.id, propertyId: schedule.propertyId, unitId: schedule.unitId, action: 'schedule_generated', summary: `generated ${result.created ? `WO-${result.number}` : 'the next work order'} from “${schedule.title}” — next due ${formatDay(result.nextDueOn)}`, actorId: actor.id, actorName: actor.name });
    return result;
  },
});
