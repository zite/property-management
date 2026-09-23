import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { activityFor } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { parseInput } from '../server/input';
import { toTimelineActivity } from '../server/timeline';
import { assertCanSeeTask, loadTask } from '../server/tasks';

/** One task with its history, for the task sheet. Anyone who can see a task can change it. */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a task with its history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { id } = parseInput(Input, input);
    const task = await loadTask(id);
    assertCanSeeTask(actor, task);
    const activity = (await activityFor('entityId', id, 100)).map(toTimelineActivity).reverse();
    return { task, activity };
  },
});
