import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addPeriods, periodOf, todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { ownerStatement } from '@project/shared/server/ownerStatement';
import { getSettings } from '@project/shared/server/settings';
import { day, num, ref, str } from '@project/shared/server/sql';
import { feePercent } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Owner funds today, per property: cash, deposits held, reserve, unpaid bills
 * and what's available to distribute — the same figures as the owner
 * statement — plus the last distribution and whether last month's
 * management fee has been posted.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'Cash, reserves and available funds for every owner and property',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const feePeriod = addPeriods(periodOf(today), -1);

    const { rows: props } = await zite.sql({
      query: `
        SELECT p.id, p."name", p."status", p."ownerId", p."managementFeePercent" AS "propertyPct", p."bankAccountId", o."managementFeePercent" AS "ownerPct"
        FROM "Properties" p LEFT JOIN "Owners" o ON o.id::text = p."ownerId"
        WHERE COALESCE(p."status", 'Active') <> 'Archived'
        ORDER BY p."name" ASC`,
      params: [],
    });
    const ids = props.map(p => String(p.id));
    const [statement, lastDist, fees] = await Promise.all([
      ownerStatement({ propertyIds: ids, periodStart: today, periodEnd: today }),
      ids.length
        ? zite.sql({ query: `SELECT DISTINCT ON (t."propertyId") t."propertyId", t."date", t."amount" FROM "Transactions" t WHERE t."kind" = 'Owner distribution' AND t."status" = 'Posted' AND t."propertyId" = ANY($1) ORDER BY t."propertyId", t."date" DESC, t."number" DESC`, params: [ids] })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      ids.length
        ? zite.sql({ query: `SELECT t."propertyId", t."amount" FROM "Transactions" t WHERE t."kind" = 'Management fee' AND t."status" = 'Posted' AND t."period" = $1 AND t."propertyId" = ANY($2)`, params: [feePeriod, ids] })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);
    const figures = new Map(statement.properties.map(s => [s.propertyId, s]));
    const lastBy = new Map(lastDist.rows.map(r => [String(r.propertyId), { date: day(r.date) ?? '', amount: num(r.amount) }]));
    const feeBy = new Map(fees.rows.map(r => [String(r.propertyId), num(r.amount)]));

    const properties = props.map(p => {
      const id = String(p.id);
      const s = figures.get(id);
      return {
        propertyId: id,
        name: str(p.name) ?? '',
        ownerId: ref(p.ownerId),
        cash: s?.endingCash ?? 0,
        depositsHeld: s?.depositsHeld ?? 0,
        reserve: s?.reserve ?? 0,
        unpaidBills: s?.unpaidBills ?? 0,
        available: s?.availableForDistribution ?? 0,
        feePercent: feePercent(p.propertyPct, p.ownerPct, settings),
        lastDistribution: lastBy.get(id) ?? null,
        lastPeriodFee: feeBy.has(id) ? feeBy.get(id)! : null,
      };
    });
    return { today, feePeriod, properties, warnings: statement.warnings };
  },
});
