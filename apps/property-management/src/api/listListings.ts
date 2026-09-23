import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { LISTING_FROM, LISTING_SELECT, toListing } from '../server/leasing';

/**
 * Every listing with its unit, days on market and how it's performing
 * (views, leads, applications). A company lists dozens of homes, not
 * thousands, so the whole set comes back and the page filters instantly.
 */

const Input = z.object({ unitId: z.string().min(1).optional() });

export default createEndpoint({
  description: 'List rental listings with performance',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { unitId } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const { rows } = await zite.sql({
      query: `SELECT ${LISTING_SELECT} ${LISTING_FROM} ${unitId ? 'WHERE l."unitId" = $1' : ''}
              ORDER BY CASE l."status" WHEN 'Published' THEN 0 WHEN 'Paused' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END, l."publishedAt" DESC NULLS LAST, l.created_at DESC LIMIT 500`,
      params: unitId ? [unitId] : [],
    });
    return { listings: rows.map(r => toListing(r, settings, today)), today, portalKnown: Boolean(settings.portalUrl) };
  },
});
