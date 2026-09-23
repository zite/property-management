import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { runAutomation } from '@project/shared/server/automation';

/**
 * The daily run: recurring charges, late fees, rent reminders, renewal and
 * move-out tasks, preventive maintenance, vendor insurance and management
 * fees. Scheduled for 6am Mountain; admins can also run it from Settings.
 * Every step is idempotent, so running it by hand never double-posts.
 */
export default createEndpoint({
  description: 'Run the daily automation (scheduled; admins can run it now)',
  schedule: {
    scheduleType: 'recurring',
    schedule: { frequency: 'daily', interval: 1, times: ['06:00'] },
    timezone: 'America/Denver',
    overlapPolicy: 'skip',
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    ranAt: z.string(),
    today: z.string(),
    chargesPosted: z.number(),
    lateFees: z.number(),
    rentReminders: z.number(),
    renewalTasks: z.number(),
    moveOutTasks: z.number(),
    workOrdersCreated: z.number(),
    insuranceAlerts: z.number(),
    managementFees: z.number(),
    errors: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    // Scheduled runs have no user; a manual run must come from someone who manages settings.
    if (context?.user) assertCan(await getActor(context as never), 'settings.manage');
    return runAutomation();
  },
});
