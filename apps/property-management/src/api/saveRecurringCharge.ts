import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { RECURRING_FREQUENCIES } from '@project/shared/constants';
import { addDays, addPeriods, dueDateIn, formatDay, isDay, periodLabel, periodOf, todayIn } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { postRecurringCharges } from '@project/shared/server/leases';
import { getSettings } from '@project/shared/server/settings';
import { bool, day, num, ref, str, withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadStaffLease } from '../server/leaseStaff';

/**
 * What a lease bills every month: rent, pet rent, parking, utilities. History
 * is never rewritten — a new amount ends the old charge and starts a new one
 * from a date, and a charge can only start in a month that hasn't been billed
 * yet (otherwise that month would be billed twice).
 */

const id = z.string().min(1);
const dayStr = z.string().refine(isDay, 'Choose a valid date.');
const amount = z.number().positive('Enter an amount greater than zero.').max(1_000_000, 'That amount is too large.');

const Input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    leaseId: id,
    accountId: z.string().min(1, 'Choose what the charge is for.'),
    description: z.string().trim().min(1, 'Describe the charge.').max(120),
    amount,
    frequency: z.enum(RECURRING_FREQUENCIES).default('Monthly'),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    startDate: dayStr,
    endDate: dayStr.nullish(),
  }),
  z.object({ action: z.literal('end'), id, endDate: dayStr }),
  z.object({ action: z.literal('changeAmount'), id, amount, effectiveDate: dayStr }),
  z.object({ action: z.literal('delete'), id }),
]);

/** The first period this charge would bill if it started on `start`. */
function firstBilledPeriod(start: string, dueDay: number) {
  const p = periodOf(start);
  return dueDateIn(p, dueDay) >= start ? p : addPeriods(p, 1);
}

export default createEndpoint({
  description: 'Add, end, re-price or remove a recurring charge on a lease',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    assertCan(actor, 'receivables.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = (n: number) => formatMoney(n, settings.currency);
    const chart = await getChart();

    const loadCharge = async (chargeId: string) => {
      const { rows } = await zite.sql({ query: `SELECT * FROM "RecurringCharges" WHERE id::text = $1 LIMIT 1`, params: [chargeId] });
      const r = rows[0];
      if (!r) throw new ZiteError('That recurring charge no longer exists.', 'NOT_FOUND');
      const { rows: posted } = await zite.sql({ query: `SELECT MAX("period") AS p, COUNT(*) AS n FROM "Transactions" WHERE "recurringChargeId" = $1 AND "status" = 'Posted'`, params: [chargeId] });
      return {
        id: String(r.id), leaseId: ref(r.leaseId) ?? '', description: str(r.description) ?? '', accountId: ref(r.accountId) ?? '', amount: num(r.amount), frequency: str(r.frequency) || 'Monthly',
        dayOfMonth: num(r.dayOfMonth, 1), startDate: day(r.startDate), endDate: day(r.endDate), active: bool(r.active), lastBilled: ref(posted[0]?.p), postedCount: num(posted[0]?.n),
      };
    };
    const editable = (status: string) => {
      if (status === 'Ended' || status === 'Canceled') throw new ZiteError(`This lease is ${status.toLowerCase()}, so its charges can’t change.`, 'BAD_REQUEST');
    };
    const activity = (leaseId: string, l: { propertyId: string; unitId: string }, summary: string) =>
      logActivity({ entityType: 'lease', entityId: leaseId, leaseId, propertyId: l.propertyId || null, unitId: l.unitId || null, action: 'recurring_charge', summary, actorId: actor.id, actorName: actor.name });

    switch (data.action) {
      case 'add': {
        const lease = await loadStaffLease(data.leaseId);
        editable(lease.status);
        const account = chart.byId.get(data.accountId);
        if (!account || account.accountType !== 'Income') throw new ZiteError('Choose an income account for the charge.', 'BAD_REQUEST');
        if (data.endDate && data.endDate < data.startDate) throw new ZiteError('The charge can’t end before it starts.', 'BAD_REQUEST');
        const dueDay = data.dayOfMonth ?? lease.rentDueDay;
        const created = await withRetry(() =>
          zite.recurringCharges.create({ record: { description: data.description, leaseId: lease.id, accountId: account.id, amount: data.amount, frequency: data.frequency, dayOfMonth: dueDay, startDate: data.startDate, endDate: data.endDate ?? null, active: true } }),
        );
        await activity(lease.id, lease, `added ${data.description} — ${money(data.amount)} ${data.frequency.toLowerCase()} from ${formatDay(data.startDate)}`);
        // A charge that's already due this month posts now rather than waiting for tonight's run.
        const res = lease.status === 'Active' ? await postRecurringCharges({ today, leaseId: lease.id, daysAhead: settings.chargeDaysAhead }) : { posted: 0 };
        return { id: created.id, posted: res.posted, message: res.posted ? `${data.description} added — ${res.posted === 1 ? 'this month’s charge was' : `${res.posted} charges were`} posted` : `${data.description} added` };
      }

      case 'end': {
        const rc = await loadCharge(data.id);
        const lease = await loadStaffLease(rc.leaseId);
        editable(lease.status);
        if (rc.startDate && data.endDate < addDays(rc.startDate, -1)) throw new ZiteError(`The charge starts ${formatDay(rc.startDate)}. Remove it instead if it should never bill.`, 'BAD_REQUEST');
        if (rc.lastBilled && dueDateIn(rc.lastBilled, rc.dayOfMonth) > data.endDate) {
          throw new ZiteError(`${periodLabel(rc.lastBilled)} is already billed. End it on or after ${formatDay(dueDateIn(rc.lastBilled, rc.dayOfMonth))}, or credit the resident for that month.`, 'BAD_REQUEST');
        }
        await withRetry(() => zite.recurringCharges.update({ id: rc.id, record: { endDate: data.endDate } }));
        await activity(lease.id, lease, `ended ${rc.description} (${money(rc.amount)}) after ${formatDay(data.endDate)}`);
        return { id: rc.id, posted: 0, message: `${rc.description} ends ${formatDay(data.endDate)}` };
      }

      case 'changeAmount': {
        const rc = await loadCharge(data.id);
        const lease = await loadStaffLease(rc.leaseId);
        editable(lease.status);
        if (!rc.active) throw new ZiteError('That charge is switched off. Add a new one instead.', 'BAD_REQUEST');
        if (rc.endDate && data.effectiveDate > rc.endDate) throw new ZiteError(`This charge already ends ${formatDay(rc.endDate)}. Add a new charge for after that.`, 'BAD_REQUEST');
        if (rc.startDate && data.effectiveDate <= rc.startDate) {
          // Nothing has billed under the old amount yet from this start: re-price it in place.
          if (!rc.postedCount) {
            await withRetry(() => zite.recurringCharges.update({ id: rc.id, record: { amount: data.amount, startDate: data.effectiveDate } }));
            if (/^rent$/i.test(rc.description) && rc.accountId === chart.key('rent_income').id) await withRetry(() => zite.leases.update({ id: lease.id, record: { rent: data.amount } }));
            await activity(lease.id, lease, `changed ${rc.description} to ${money(data.amount)} from ${formatDay(data.effectiveDate)}`);
            return { id: rc.id, posted: 0, message: `${rc.description} is now ${money(data.amount)}` };
          }
          throw new ZiteError(`Choose a date after ${formatDay(rc.startDate)}, when this charge started.`, 'BAD_REQUEST');
        }
        const first = firstBilledPeriod(data.effectiveDate, rc.dayOfMonth);
        if (rc.lastBilled && first <= rc.lastBilled) {
          const next = addPeriods(rc.lastBilled, 1);
          throw new ZiteError(`${periodLabel(rc.lastBilled)} is already billed at ${money(rc.amount)}. Choose a date from ${formatDay(`${next}-01`)}, and post a charge or credit for the difference if needed.`, 'BAD_REQUEST');
        }
        await withRetry(() => zite.recurringCharges.update({ id: rc.id, record: { endDate: addDays(data.effectiveDate, -1) } }));
        const created = await withRetry(() =>
          zite.recurringCharges.create({ record: { description: rc.description, leaseId: rc.leaseId, accountId: rc.accountId, amount: data.amount, frequency: rc.frequency, dayOfMonth: rc.dayOfMonth, startDate: data.effectiveDate, endDate: rc.endDate, active: true } }),
        );
        if (rc.accountId === chart.key('rent_income').id && data.effectiveDate <= addDays(today, 62)) await withRetry(() => zite.leases.update({ id: lease.id, record: { rent: data.amount } }));
        await activity(lease.id, lease, `changed ${rc.description} from ${money(rc.amount)} to ${money(data.amount)} starting ${formatDay(data.effectiveDate)}`);
        const res = lease.status === 'Active' ? await postRecurringCharges({ today, leaseId: lease.id, daysAhead: settings.chargeDaysAhead }) : { posted: 0 };
        return { id: created.id, posted: res.posted, message: `${rc.description} changes to ${money(data.amount)} on ${formatDay(data.effectiveDate)}` };
      }

      case 'delete': {
        const rc = await loadCharge(data.id);
        const lease = await loadStaffLease(rc.leaseId);
        editable(lease.status);
        if (rc.postedCount) throw new ZiteError(`${rc.description} has already billed ${rc.postedCount === 1 ? 'once' : `${rc.postedCount} times`}. End it instead, so the history stays.`, 'BAD_REQUEST');
        await withRetry(() => zite.recurringCharges.delete({ id: rc.id }));
        await activity(lease.id, lease, `removed ${rc.description} (${money(rc.amount)})`);
        return { id: rc.id, posted: 0, message: `${rc.description} removed` };
      }
    }
    throw new ZiteError('That isn’t something a recurring charge can do.', 'BAD_REQUEST');
  },
});
