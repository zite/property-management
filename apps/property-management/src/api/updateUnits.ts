import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { UNIT_READINESS } from '@project/shared/constants';
import { formatDay, isDay } from '@project/shared/dates';
import { formatMoney, round2 } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { getSettings } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * The quick edits a units table makes on one or many rows at once: readiness,
 * market rent, deposit and available date. Writes run one at a time (live Zite
 * rate-limits bursts); rows already at the new value are skipped.
 */

const Patch = z
  .object({
    readiness: z.enum(UNIT_READINESS).optional(),
    marketRent: z.number().min(0, 'Market rent can’t be negative.').max(10_000_000).optional(),
    depositAmount: z.number().min(0, 'The deposit can’t be negative.').max(10_000_000).optional(),
    availableOn: z.string().nullable().optional(),
  })
  .refine(p => Object.values(p).some(v => v !== undefined), { message: 'Choose something to change.' });

const Input = z.object({ ids: z.array(z.string().min(1)).min(1).max(500, 'Change up to 500 units at a time.'), patch: Patch });

export default createEndpoint({
  description: 'Set readiness, market rent, deposit or availability on one or more units',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'portfolio.manage');
    const { ids, patch } = parseInput(Input, input);
    if (patch.availableOn && !isDay(patch.availableOn)) throw new ZiteError('Choose a valid available date.', 'BAD_REQUEST');
    const { rows } = await zite.sql({
      query: `
        SELECT u.id, u."name", u."propertyId", u."readiness", u."marketRent", u."depositAmount", u."availableOn", p."name" AS "propertyName", p."propertyType"
        FROM "Units" u LEFT JOIN "Properties" p ON p.id::text = u."propertyId"
        WHERE u.id::text = ANY($1)`,
      params: [ids],
    });
    if (rows.length !== new Set(ids).size) throw new ZiteError('Some of those units no longer exist. Reload and try again.', 'NOT_FOUND');
    const settings = await getSettings();

    const record: Record<string, unknown> = {};
    if (patch.readiness) record.readiness = patch.readiness;
    if (patch.marketRent !== undefined) record.marketRent = round2(patch.marketRent);
    if (patch.depositAmount !== undefined) record.depositAmount = round2(patch.depositAmount);
    if (patch.availableOn !== undefined) record.availableOn = patch.availableOn;

    const entries: ActivityInput[] = [];
    let updated = 0;
    for (const u of rows) {
      const same =
        (record.readiness === undefined || String(u.readiness || 'Ready') === record.readiness) &&
        (record.marketRent === undefined || round2(Number(u.marketRent ?? 0)) === record.marketRent) &&
        (record.depositAmount === undefined || round2(Number(u.depositAmount ?? 0)) === record.depositAmount) &&
        (record.availableOn === undefined || (u.availableOn ? String(u.availableOn).slice(0, 10) : null) === record.availableOn);
      if (same) continue;
      await withRetry(() => zite.units.update({ id: String(u.id), record: record as never }));
      updated++;
      const label = ['Single-family', 'Condo'].includes(String(u.propertyType)) ? String(u.propertyName ?? u.name) : `${u.propertyName ?? ''} ${u.name}`.trim();
      const summary = patch.readiness
        ? `set ${label} to ${patch.readiness}`
        : patch.marketRent !== undefined
          ? `set market rent for ${label} to ${formatMoney(patch.marketRent, settings.currency)}`
          : patch.depositAmount !== undefined
            ? `set the deposit for ${label} to ${formatMoney(patch.depositAmount, settings.currency)}`
            : patch.availableOn
              ? `marked ${label} available on ${formatDay(patch.availableOn)}`
              : `cleared the available date for ${label}`;
      entries.push({ entityType: 'unit', entityId: String(u.id), action: 'updated', summary, propertyId: String(u.propertyId), unitId: String(u.id), actorId: actor.id, actorName: actor.name, data: { fields: Object.keys(record) } });
    }
    await logActivity(entries);
    return { updated };
  },
});
