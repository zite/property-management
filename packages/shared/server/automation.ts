import { zite } from 'zitejs/db';
import { SCHEDULE_MONTHS } from '../constants';
import { addDays, addMonths, addPeriods, daysBetween, formatDay, periodLabel, periodOf, todayIn } from '../dates';
import { leaseRef, workOrderRef } from '../leases';
import { formatMoney, percentOf, toCents } from '../money';
import { ordinal } from '../merge';
import { logActivity } from './activity';
import { getChart } from './accounts';
import { leaseRecipients, sendTriggered } from './email';
import { collectedIncome, insertTransactions, leaseBalances, autoApply, nextNumber, type TxnInput } from './ledger';
import { postRecurringCharges } from './leases';
import { membersWith } from './actor';
import { notify } from './notify';
import { getSettings, lateFeeFor, type OrgSettings } from './settings';
import { num, ref, str } from './sql';

/**
 * The daily run that keeps the books and the calendar honest without anyone
 * remembering to:
 *
 *   1. post recurring charges (rent, pet rent, parking) as they come due
 *   2. assess late fees once the grace period has passed on unpaid rent
 *   3. remind residents a few days before rent is due
 *   4. open renewal tasks as leases approach their end, and move-out tasks after
 *   5. create preventive maintenance work orders from schedules
 *   6. warn about vendor insurance that is expiring
 *   7. post last month's management fees
 *
 * Every step is idempotent — keyed by period, by a task's system key or by an
 * activity marker — so a retry, an overlap or an admin pressing "Run now"
 * never double-charges or double-sends.
 */

export type AutomationSummary = {
  ranAt: string;
  today: string;
  chargesPosted: number;
  lateFees: number;
  rentReminders: number;
  renewalTasks: number;
  moveOutTasks: number;
  workOrdersCreated: number;
  insuranceAlerts: number;
  managementFees: number;
  errors: string[];
};

async function step<T>(name: string, errors: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Automation step "${name}" failed`, msg);
    errors.push(`${name}: ${msg.slice(0, 160)}`);
    return fallback;
  }
}

/** Create a task once per system key; later runs find it and do nothing. */
export async function ensureTask(t: {
  systemKey: string;
  title: string;
  description?: string | null;
  category: string;
  priority?: string;
  dueDate?: string | null;
  assigneeId?: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  tenantId?: string | null;
  vendorId?: string | null;
  workOrderId?: string | null;
}) {
  const { rows } = await zite.sql({ query: `SELECT id FROM "Tasks" WHERE "systemKey" = $1 LIMIT 1`, params: [t.systemKey] });
  if (rows.length) return null;
  const created = await zite.tasks.create({
    record: {
      title: t.title.slice(0, 240),
      description: t.description ?? null,
      status: 'To do',
      priority: t.priority ?? 'Normal',
      category: t.category,
      dueDate: t.dueDate ?? null,
      assigneeId: t.assigneeId ?? null,
      propertyId: t.propertyId ?? null,
      unitId: t.unitId ?? null,
      leaseId: t.leaseId ?? null,
      tenantId: t.tenantId ?? null,
      vendorId: t.vendorId ?? null,
      workOrderId: t.workOrderId ?? null,
      systemKey: t.systemKey,
    },
  });
  return created.id;
}

async function fallbackManagers() {
  const pms = await membersWith('portfolio.manage');
  return pms.map(m => m.id);
}

export async function assessLateFees(settings: OrgSettings, today: string) {
  if (settings.lateFeeType === 'None') return 0;
  const chart = await getChart();
  const rentAccount = chart.key('rent_income').id;
  const lateAccount = chart.key('late_fee_income').id;
  const ar = chart.key('accounts_receivable').id;
  const cutoff = addDays(today, -settings.gracePeriodDays);
  const floor = addDays(today, -45);
  const { rows } = await zite.sql({
    query: `
      SELECT t."leaseId", t."period", MIN(t."dueDate") AS "dueDate", l."rent", l."propertyId", l."unitId", l."number",
        SUM(t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0)) AS "openRent"
      FROM "Transactions" t
      JOIN "Leases" l ON l.id::text = t."leaseId"
      WHERE t."kind" = 'Charge' AND t."status" = 'Posted' AND t."accountId" = $1
        AND COALESCE(t."period", '') <> '' AND t."dueDate" < $2 AND t."dueDate" >= $3
        AND l."status" = 'Active' AND COALESCE(l."lateFeeExempt", false) = false
        AND NOT EXISTS (SELECT 1 FROM "Transactions" f WHERE f."leaseId" = t."leaseId" AND f."source" = 'Late fee' AND f."period" = t."period")
      GROUP BY t."leaseId", t."period", l."rent", l."propertyId", l."unitId", l."number"`,
    params: [rentAccount, cutoff, floor],
  });
  const due = rows.filter(r => toCents(num(r.openRent)) > 0);
  if (!due.length) return 0;
  const txns: TxnInput[] = due
    .map(r => {
      const fee = lateFeeFor(settings, num(r.rent));
      if (!(fee > 0)) return null;
      const t: TxnInput = {
        kind: 'Charge',
        date: today,
        dueDate: today,
        amount: fee,
        description: `Late fee — ${periodLabel(String(r.period))} rent`,
        propertyId: ref(r.propertyId),
        unitId: ref(r.unitId),
        leaseId: String(r.leaseId),
        accountId: lateAccount,
        source: 'Late fee',
        period: String(r.period),
        lines: [{ accountId: ar, debit: fee }, { accountId: lateAccount, credit: fee }],
      };
      return t;
    })
    .filter(Boolean) as TxnInput[];
  await insertTransactions(txns);
  for (const t of txns) await autoApply(t.leaseId!);

  const balances = await leaseBalances(txns.map(t => t.leaseId!));
  for (const t of txns) {
    const recipients = await leaseRecipients(t.leaseId!);
    for (const recipient of recipients) {
      await sendTriggered({
        trigger: 'Late notice',
        settings,
        recipient,
        leaseId: t.leaseId,
        propertyId: t.propertyId,
        context: { late_fee: formatMoney(t.amount, settings.currency), balance_due: formatMoney(balances.get(t.leaseId!)?.balance ?? 0, settings.currency), grace_period_days: String(settings.gracePeriodDays) },
      }).catch(() => null);
    }
  }
  await logActivity(txns.map(t => ({ entityType: 'lease' as const, entityId: t.leaseId!, action: 'late_fee_assessed', summary: `assessed a ${formatMoney(t.amount, settings.currency)} late fee for ${periodLabel(t.period!)}`, leaseId: t.leaseId, propertyId: t.propertyId, data: { amount: t.amount, period: t.period } })));
  return txns.length;
}

export async function sendRentReminders(settings: OrgSettings, today: string) {
  const days = settings.rentReminderDays;
  if (!(days > 0)) return 0;
  const target = addDays(today, days);
  const period = periodOf(target);
  const { rows } = await zite.sql({
    query: `
      SELECT l.id, l."rent", l."rentDueDay", l."propertyId", l."number" FROM "Leases" l
      WHERE l."status" = 'Active' AND (l."startDate" IS NULL OR l."startDate" <= $1)
        AND (l."moveOutDate" IS NULL OR l."moveOutDate" >= $1)
        AND NOT EXISTS (SELECT 1 FROM "Activity" a WHERE a."entityId" = l.id::text AND a."action" = $2)`,
    params: [target, `rent_reminder:${period}`],
  });
  const matching = rows.filter(r => {
    const dueDay = Math.min(28, Math.max(1, num(r.rentDueDay, settings.rentDueDay)));
    return Number(target.slice(8, 10)) === dueDay;
  });
  if (!matching.length) return 0;
  const balances = await leaseBalances(matching.map(r => String(r.id)));
  let sent = 0;
  for (const r of matching) {
    const leaseId = String(r.id);
    const balance = balances.get(leaseId)?.balance ?? 0;
    // Rent not yet posted for the coming period is still owed on the due date.
    const owed = Math.max(balance, 0) + (target > today ? num(r.rent) : 0);
    const recipients = await leaseRecipients(leaseId);
    let any = false;
    for (const recipient of recipients) {
      const res = await sendTriggered({
        trigger: 'Rent reminder',
        settings,
        recipient,
        leaseId,
        propertyId: ref(r.propertyId),
        context: { rent_amount: formatMoney(num(r.rent), settings.currency), balance_due: formatMoney(owed, settings.currency), due_date: formatDay(target, 'long'), rent_due_day: ordinal(Number(target.slice(8, 10))) },
      }).catch(() => null);
      if (res) any = true;
    }
    if (any) {
      await logActivity({ entityType: 'lease', entityId: leaseId, action: `rent_reminder:${period}`, summary: `sent the rent reminder for ${periodLabel(period)}`, leaseId, propertyId: ref(r.propertyId) });
      sent++;
    }
  }
  return sent;
}

export async function leaseTasks(settings: OrgSettings, today: string) {
  const horizon = addDays(today, settings.renewalNoticeDays);
  const fallback = await fallbackManagers();
  const { rows: expiring } = await zite.sql({
    query: `
      SELECT l.id, l."name", l."number", l."endDate", l."propertyId", l."unitId", p."managerId"
      FROM "Leases" l LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
      WHERE l."status" = 'Active' AND l."leaseType" = 'Fixed term' AND l."endDate" IS NOT NULL
        AND l."endDate" >= $1 AND l."endDate" <= $2
        AND COALESCE(l."renewalStatus", 'None') IN ('None', '') AND l."noticeGivenOn" IS NULL AND l."moveOutDate" IS NULL`,
    params: [today, horizon],
  });
  let renewals = 0;
  for (const l of expiring) {
    const end = String(l.endDate).slice(0, 10);
    const assignee = ref(l.managerId) ?? fallback[0] ?? null;
    const id = await ensureTask({
      systemKey: `renewal:${l.id}:${end}`,
      title: `Decide on renewal for ${str(l.name) || leaseRef(num(l.number))}`,
      description: `The lease ends ${formatDay(end, 'long')} (${daysBetween(today, end)} days). Offer a renewal, or confirm the residents are moving out.`,
      category: 'Renewal',
      priority: daysBetween(today, end) <= 30 ? 'High' : 'Normal',
      dueDate: addDays(end, -30) > today ? addDays(end, -30) : today,
      assigneeId: assignee,
      propertyId: ref(l.propertyId),
      unitId: ref(l.unitId),
      leaseId: String(l.id),
    });
    if (id) {
      renewals++;
      await notify({ recipientIds: [assignee], kind: 'lease_expiring', title: `${str(l.name)} ends ${formatDay(end)}`, body: 'Decide whether to offer a renewal.', link: `/leases/${l.id}`, entityType: 'lease', entityId: String(l.id) });
    }
  }
  const { rows: movingOut } = await zite.sql({
    query: `
      SELECT l.id, l."name", l."number", l."moveOutDate", l."propertyId", l."unitId", p."managerId"
      FROM "Leases" l LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
      WHERE l."status" = 'Active' AND l."moveOutDate" IS NOT NULL AND l."moveOutDate" <= $1`,
    params: [today],
  });
  let moveOuts = 0;
  for (const l of movingOut) {
    const assignee = ref(l.managerId) ?? fallback[0] ?? null;
    const id = await ensureTask({
      systemKey: `moveout:${l.id}`,
      title: `Complete move-out for ${str(l.name) || leaseRef(num(l.number))}`,
      description: 'Inspect the unit, settle the security deposit and end the lease.',
      category: 'Move-out',
      priority: 'High',
      dueDate: today,
      assigneeId: assignee,
      propertyId: ref(l.propertyId),
      unitId: ref(l.unitId),
      leaseId: String(l.id),
    });
    if (id) moveOuts++;
  }
  return { renewals, moveOuts };
}

/**
 * Create the work order a preventive maintenance schedule is due for (once per
 * due date) and advance the schedule. The daily automation and "Generate now"
 * both run this, so the rules can't drift apart.
 */
export async function generateFromSchedule(s: Record<string, unknown>, today: string, by: { id: string; name: string } | null = null) {
  const id = String(s.id);
  const due = String(s.nextDueOn).slice(0, 10);
  const { rows: existing } = await zite.sql({ query: `SELECT "number" FROM "WorkOrders" WHERE "scheduleId" = $1 AND "dueDate" = $2 LIMIT 1`, params: [id, due] });
  const months = SCHEDULE_MONTHS[(String(s.frequency) as keyof typeof SCHEDULE_MONTHS)] ?? 12;
  let next = addMonths(due, months);
  while (next <= today) next = addMonths(next, months);
  let number: number | null = existing[0] ? num(existing[0].number) : null;
  let created = false;
  if (!existing.length) {
    number = await nextNumber('WorkOrders', 1000);
    const now = new Date().toISOString();
    const title = str(s.title) ?? 'Preventive maintenance';
    const wo = await zite.workOrders.create({
      record: {
        title,
        number,
        description: str(s.description) ?? null,
        propertyId: ref(s.propertyId),
        unitId: ref(s.unitId),
        category: str(s.category) || 'General',
        priority: str(s.priority) || 'Normal',
        // No visit time yet, even with a vendor assigned: it's New until someone books it.
        status: 'New',
        source: 'Recurring',
        assigneeId: ref(s.assigneeId),
        vendorId: ref(s.vendorId),
        dueDate: due,
        estimateAmount: s.estimateAmount == null || s.estimateAmount === '' ? null : num(s.estimateAmount),
        ownerApproval: 'Not required',
        scheduleId: id,
        createdById: by?.id ?? null,
        reportedAt: now,
        lastActivityAt: now,
      },
    });
    created = true;
    await logActivity({ entityType: 'work_order', entityId: wo.id, workOrderId: wo.id, propertyId: ref(s.propertyId), unitId: ref(s.unitId), action: 'created', summary: 'created the work order from a preventive maintenance schedule', actorId: by?.id ?? null, actorName: by?.name ?? null });
    await notify({ recipientIds: [ref(s.assigneeId)], kind: 'work_order_created', title: `${workOrderRef(number)} ${title}`, body: `Preventive maintenance due ${formatDay(due)}.`, link: `/work-orders/${number}`, entityType: 'work_order', entityId: wo.id, actorId: by?.id ?? null, actorName: by?.name ?? null });
  }
  await zite.maintenanceSchedules.update({ id, record: { nextDueOn: next, lastGeneratedOn: today } });
  return { created, number, dueDate: due, nextDueOn: next };
}

export async function generateScheduledWorkOrders(today: string) {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "MaintenanceSchedules" WHERE COALESCE("active", false) = true AND "nextDueOn" IS NOT NULL AND "nextDueOn"::date - COALESCE("leadDays", 7)::int <= $1::date LIMIT 200`,
    params: [today],
  });
  let created = 0;
  for (const s of rows) if ((await generateFromSchedule(s, today)).created) created++;
  return created;
}

export async function insuranceAlerts(today: string) {
  const { rows } = await zite.sql({
    query: `SELECT id, "name", "insuranceExpiresOn" FROM "Vendors" WHERE COALESCE("status", 'Active') = 'Active' AND "insuranceExpiresOn" IS NOT NULL AND "insuranceExpiresOn" <= $1`,
    params: [addDays(today, 30)],
  });
  if (!rows.length) return 0;
  const people = await membersWith('vendors.manage');
  const assignee = people.find(p => p.role === 'Maintenance')?.id ?? people[0]?.id ?? null;
  let count = 0;
  for (const v of rows) {
    const exp = String(v.insuranceExpiresOn).slice(0, 10);
    const expired = exp < today;
    const id = await ensureTask({
      systemKey: `insurance:${v.id}:${exp}`,
      title: `${expired ? 'Insurance expired' : 'Insurance expiring'} — ${str(v.name)}`,
      description: `${str(v.name)}'s certificate of insurance ${expired ? 'expired' : 'expires'} ${formatDay(exp, 'long')}. Request an updated certificate before assigning more work.`,
      category: 'Compliance',
      priority: expired ? 'High' : 'Normal',
      dueDate: expired ? today : exp,
      assigneeId: assignee,
      vendorId: String(v.id),
    });
    if (id) {
      count++;
      await notify({ recipientIds: people.map(p => p.id), kind: 'insurance_expiring', title: `${str(v.name)} insurance ${expired ? 'expired' : 'expires'} ${formatDay(exp)}`, link: `/vendors/${v.id}`, entityType: 'vendor', entityId: String(v.id) });
    }
  }
  return count;
}

/**
 * Last month's management fees, once the month has closed: each property's fee
 * percentage (property override, then owner, then the organization's default)
 * of the rent actually collected.
 */
export async function postManagementFees(settings: OrgSettings, today: string) {
  const period = addPeriods(periodOf(today), -1);
  const collected = await collectedIncome(period);
  if (!collected.size) return 0;
  const { rows } = await zite.sql({
    query: `
      SELECT p.id, p."name", p."managementFeePercent" AS "propertyPct", p."ownerId", o."managementFeePercent" AS "ownerPct",
        EXISTS (SELECT 1 FROM "Transactions" t WHERE t."propertyId" = p.id::text AND t."kind" = 'Management fee' AND t."period" = $1 AND t."status" = 'Posted') AS "posted"
      FROM "Properties" p LEFT JOIN "Owners" o ON o.id::text = p."ownerId"
      WHERE COALESCE(p."status", 'Active') <> 'Archived'`,
    params: [period],
  });
  const chart = await getChart();
  const txns: TxnInput[] = [];
  for (const p of rows) {
    if (p.posted === true) continue;
    const base = collected.get(String(p.id)) ?? 0;
    if (!(base > 0)) continue;
    const pct = p.propertyPct != null && p.propertyPct !== '' ? num(p.propertyPct) : p.ownerPct != null && p.ownerPct !== '' ? num(p.ownerPct) : settings.managementFeePercent;
    const fee = percentOf(base, pct);
    if (!(fee > 0)) continue;
    const { rows: bankRow } = await zite.sql({ query: `SELECT "bankAccountId" FROM "Properties" WHERE id::text = $1`, params: [String(p.id)] });
    const bankId = ref(bankRow[0]?.bankAccountId) && chart.byId.get(String(bankRow[0].bankAccountId))?.subtype === 'Bank' ? String(bankRow[0].bankAccountId) : chart.key('operating_bank').id;
    const fees = chart.key('management_fees').id;
    txns.push({
      kind: 'Management fee',
      date: today,
      amount: fee,
      description: `Management fee — ${periodLabel(period)} (${pct}% of ${formatMoney(base, settings.currency)})`,
      propertyId: String(p.id),
      ownerId: ref(p.ownerId),
      accountId: fees,
      bankAccountId: bankId,
      period,
      source: 'System',
      lines: [{ accountId: fees, debit: fee }, { accountId: bankId, credit: fee }],
    });
  }
  await insertTransactions(txns);
  return txns.length;
}

export async function runAutomation(opts: { now?: Date } = {}): Promise<AutomationSummary> {
  const settings = await getSettings();
  const today = todayIn(settings.timezone, opts.now);
  const errors: string[] = [];
  const summary: AutomationSummary = {
    ranAt: new Date().toISOString(),
    today,
    chargesPosted: 0,
    lateFees: 0,
    rentReminders: 0,
    renewalTasks: 0,
    moveOutTasks: 0,
    workOrdersCreated: 0,
    insuranceAlerts: 0,
    managementFees: 0,
    errors,
  };
  summary.chargesPosted = (await step('Recurring charges', errors, () => postRecurringCharges({ today, daysAhead: settings.chargeDaysAhead }), { posted: 0, leases: 0 })).posted;
  summary.lateFees = await step('Late fees', errors, () => assessLateFees(settings, today), 0);
  summary.rentReminders = await step('Rent reminders', errors, () => sendRentReminders(settings, today), 0);
  const tasks = await step('Lease tasks', errors, () => leaseTasks(settings, today), { renewals: 0, moveOuts: 0 });
  summary.renewalTasks = tasks.renewals;
  summary.moveOutTasks = tasks.moveOuts;
  summary.workOrdersCreated = await step('Preventive maintenance', errors, () => generateScheduledWorkOrders(today), 0);
  summary.insuranceAlerts = await step('Vendor insurance', errors, () => insuranceAlerts(today), 0);
  summary.managementFees = await step('Management fees', errors, () => postManagementFees(settings, today), 0);
  await zite.settings.update({ id: settings.id, record: { automationRanAt: summary.ranAt, automationSummary: JSON.stringify(summary) } }).catch(() => undefined);
  return summary;
}
