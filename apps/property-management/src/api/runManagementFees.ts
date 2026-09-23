import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addPeriods, isDay, periodLabel, periodOf, todayIn } from '@project/shared/dates';
import { formatMoney, fromCents, percentOf, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { collectedIncome, postManagementFee } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { day, num, ref, str } from '@project/shared/server/sql';
import { Day, feePercent } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Management fees for a month: rent collected in the period (payments matched
 * to income charges — never deposits) × each property's fee rate. `preview`
 * shows the math; `post` posts every property that doesn't already have a
 * fee for that period, so running it twice never charges twice. The daily
 * automation posts the same fee the same way.
 */

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.');
const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), period: Period }),
  z.object({ action: z.literal('post'), period: Period, date: Day, propertyIds: z.array(z.string().min(1)).max(200).optional() }),
]);

async function preview(period: string) {
  const settings = await getSettings();
  const [collected, { rows }, { rows: existing }] = await Promise.all([
    collectedIncome(period),
    zite.sql({
      query: `
        SELECT p.id, p."name", p."ownerId", p."managementFeePercent" AS "propertyPct", o."managementFeePercent" AS "ownerPct"
        FROM "Properties" p LEFT JOIN "Owners" o ON o.id::text = p."ownerId"
        WHERE COALESCE(p."status", 'Active') <> 'Archived' ORDER BY p."name" ASC`,
      params: [],
    }),
    zite.sql({ query: `SELECT "propertyId", id, "number", "amount", "date" FROM "Transactions" WHERE "kind" = 'Management fee' AND "status" = 'Posted' AND "period" = $1`, params: [period] }),
  ]);
  const postedBy = new Map(existing.map(e => [String(e.propertyId), { id: String(e.id), number: num(e.number), amount: num(e.amount), date: day(e.date) ?? '' }]));
  return {
    settings,
    rows: rows.map(p => {
      const id = String(p.id);
      const base = collected.get(id) ?? 0;
      const pct = feePercent(p.propertyPct, p.ownerPct, settings);
      return { propertyId: id, name: str(p.name) ?? '', ownerId: ref(p.ownerId), collected: base, percent: pct, fee: percentOf(base, pct), posted: postedBy.get(id) ?? null };
    }),
  };
}

export default createEndpoint({
  description: 'Preview or post management fees for a month',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    if (data.action === 'preview') {
      assertCan(actor, 'accounting.view');
      const { settings, rows } = await preview(data.period);
      return { period: data.period, label: periodLabel(data.period), today: todayIn(settings.timezone), rows, posted: [] as Array<{ propertyId: string; id: string; number: number; amount: number }>, skipped: 0, total: 0 };
    }

    assertCan(actor, 'banking.manage');
    const { settings, rows } = await preview(data.period);
    const today = todayIn(settings.timezone);
    if (data.period >= periodOf(today)) throw new ZiteError(`${periodLabel(data.period)} isn’t over yet. Post fees once the month has closed.`, 'BAD_REQUEST');
    if (!isDay(data.date) || data.date < `${addPeriods(data.period, 1)}-01`) throw new ZiteError('Date the fees after the month they’re for.', 'BAD_REQUEST');
    const wanted = data.propertyIds ? new Set(data.propertyIds) : null;
    const due = rows.filter(r => (!wanted || wanted.has(r.propertyId)) && !r.posted && toCents(r.fee) > 0);
    const skipped = rows.filter(r => (!wanted || wanted.has(r.propertyId)) && r.posted).length;

    const posted: Array<{ propertyId: string; id: string; number: number; amount: number }> = [];
    for (const r of due) {
      // Re-check right before posting, in case the automation or someone else just posted it.
      const { rows: again } = await zite.sql({ query: `SELECT 1 FROM "Transactions" WHERE "kind" = 'Management fee' AND "status" = 'Posted' AND "period" = $1 AND "propertyId" = $2 LIMIT 1`, params: [data.period, r.propertyId] });
      if (again.length) continue;
      const res = await postManagementFee({
        propertyId: r.propertyId, ownerId: r.ownerId, amount: r.fee, period: data.period, date: data.date, createdById: actor.id,
        description: `Management fee — ${periodLabel(data.period)} (${r.percent}% of ${formatMoney(r.collected, settings.currency)})`,
      });
      posted.push({ propertyId: r.propertyId, id: res.id, number: res.number, amount: r.fee });
    }
    if (posted.length) {
      await logActivity(posted.map(p => ({
        entityType: 'property' as const, entityId: p.propertyId, propertyId: p.propertyId, action: 'management_fee_posted',
        summary: `posted the ${periodLabel(data.period)} management fee of ${formatMoney(p.amount, settings.currency)}`, actorId: actor.id, actorName: actor.name, data: { transactionId: p.id, number: p.number },
      })));
    }
    const fresh = await preview(data.period);
    return { period: data.period, label: periodLabel(data.period), today, rows: fresh.rows, posted, skipped, total: fromCents(posted.reduce((s, p) => s + toCents(p.amount), 0)) };
  },
});
