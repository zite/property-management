import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { todayIn } from '@project/shared/dates';
import { canAny, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { canSeeMoney, leaseSummaries } from '../server/portfolio';

/**
 * Every lease at a property or on a unit — current, upcoming and past — with
 * residents, derived phase and (for money roles) balance and past due. The
 * property's Leases tab and its Units table (balances) both read this.
 */

const Input = z.object({ propertyId: z.string().min(1).optional(), unitId: z.string().min(1).optional() }).refine(v => Boolean(v.propertyId || v.unitId), { message: 'Choose a property or a unit.' });

export default createEndpoint({
  description: 'List the leases at a property or unit with residents and balances',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    if (!canAny(actor, 'residents.manage', 'portfolio.manage', 'accounting.view')) throw new ZiteError('Your role can’t see leases.', 'FORBIDDEN');
    const { propertyId, unitId } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = canSeeMoney(actor);
    const leases = unitId
      ? await leaseSummaries(`l."unitId" = $1`, [unitId], { today, money })
      : await leaseSummaries(`l."propertyId" = $1`, [propertyId], { today, money, limit: 2000 });
    return { today, money, leases };
  },
});
