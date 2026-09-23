import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { assertCan, can, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { toVendor, VENDOR_SELECT } from '../server/maintenance';

/**
 * Every vendor with what the vendors list shows: open work, compliance
 * (insurance certificate, W-9 for 1099 vendors, paperwork waiting for review)
 * and — for people who can see the books — what's been paid this calendar
 * year and what's still owed. A company has tens to a few hundred vendors, so
 * the list filters and sorts on the client.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'List vendors with their work, spend and compliance',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'vendors.manage');
    parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const { rows } = await zite.sql({ query: `SELECT ${VENDOR_SELECT} FROM "Vendors" v ORDER BY v."name" ASC LIMIT 2000`, params: [`${today.slice(0, 4)}-01-01`, today] });
    const canSeeMoney = can(actor.role, 'accounting.view');
    return { today, year: Number(today.slice(0, 4)), canSeeMoney, vendors: rows.map(r => toVendor(r, today, canSeeMoney)) };
  },
});
