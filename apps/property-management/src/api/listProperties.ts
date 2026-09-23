import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { getActor } from '@project/shared/server/actor';
import { propertyCash } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canSeeMoney, pastDueBy } from '../server/portfolio';

/**
 * Per-property figures for the Properties list. Names, addresses, owners and
 * occupancy already arrive with bootstrap; this adds what has to be summed:
 * scheduled rent, past due, cash, and open work. Money is null for roles
 * without `accounting.view`.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'Rent, past due, cash and open work orders for every property',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = canSeeMoney(actor);

    const [rent, work, pastDue, cash] = await Promise.all([
      zite.sql({
        query: `
          SELECT l."propertyId" AS pid, SUM(l."rent") AS rent, COUNT(*) AS leases
          FROM "Leases" l
          WHERE l."status" = 'Active' AND (l."startDate" IS NULL OR l."startDate" <= $1::date) AND (l."moveOutDate" IS NULL OR l."moveOutDate" >= $1::date)
          GROUP BY l."propertyId"`,
        params: [today],
      }),
      zite.sql({
        query: `
          SELECT w."propertyId" AS pid, COUNT(*) AS open, SUM(CASE WHEN w."priority" = 'Emergency' THEN 1 ELSE 0 END) AS emergency
          FROM "WorkOrders" w WHERE w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')
          GROUP BY w."propertyId"`,
        params: [],
      }),
      money ? pastDueBy('propertyId', today) : Promise.resolve(new Map<string, number>()),
      money ? propertyCash() : Promise.resolve(new Map<string, number>()),
    ]);

    const rentBy = new Map(rent.rows.map(r => [String(r.pid), { rent: fromCents(toCents(num(r.rent))), leases: num(r.leases) }]));
    const workBy = new Map(work.rows.map(r => [String(r.pid), { open: num(r.open), emergency: num(r.emergency) }]));
    const ids = new Set([...rentBy.keys(), ...workBy.keys(), ...pastDue.keys(), ...cash.keys()].filter(Boolean));

    return {
      today,
      money,
      stats: [...ids].map(id => ({
        propertyId: id,
        scheduledRent: money ? rentBy.get(id)?.rent ?? 0 : null,
        currentLeases: rentBy.get(id)?.leases ?? 0,
        pastDue: money ? pastDue.get(id) ?? 0 : null,
        cash: money ? cash.get(id) ?? 0 : null,
        openWorkOrders: workBy.get(id)?.open ?? 0,
        emergencyWorkOrders: workBy.get(id)?.emergency ?? 0,
      })),
    };
  },
});
