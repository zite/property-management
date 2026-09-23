import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from '@project/shared/constants';
import { assertCan, can, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { applyWorkOrderPatch, loadWorkOrder } from '../server/workOrders';

/**
 * Change one or many work orders. Every change goes through the same patch
 * logic, so a status dragged on the board, set from the palette or applied to
 * forty rows at once has the same timestamps, activity and notifications.
 * Maintenance-created-only roles (leasing agents) may edit only what they reported.
 */

const Patch = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(10000).optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  category: z.enum(WORK_ORDER_CATEGORIES).optional(),
  propertyId: z.string().min(1).optional(),
  unitId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  permissionToEnter: z.boolean().optional(),
  entryNotes: z.string().max(500).optional(),
  estimateAmount: z.number().min(0).max(10_000_000).nullable().optional(),
  actualCost: z.number().min(0).max(10_000_000).nullable().optional(),
  completionNotes: z.string().max(10000).optional(),
  photos: z.array(z.object({ url: z.string().url(), name: z.string().max(200) })).max(30).optional(),
});

const Input = z.object({ ids: z.array(z.string().min(1)).min(1).max(200), patch: Patch, silent: z.boolean().optional() });

export default createEndpoint({
  description: 'Update one or more work orders',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'maintenance.create');
    const { ids, patch, silent } = parseInput(Input, input);
    if (patch.scheduledFor && Number.isNaN(Date.parse(patch.scheduledFor))) throw new ZiteError('Choose a valid date and time.', 'BAD_REQUEST');
    const settings = await getSettings();
    const manager = can(actor.role, 'maintenance.manage');
    let updated = 0;
    for (const id of ids) {
      const before = await loadWorkOrder({ id });
      if (!manager && before.createdById !== actor.id) throw new ZiteError('You can only change work orders you created.', 'FORBIDDEN');
      const after = await applyWorkOrderPatch(actor, before, patch, { silent: silent || ids.length > 1, settings });
      if (after !== before) updated++;
    }
    return { updated };
  },
});
