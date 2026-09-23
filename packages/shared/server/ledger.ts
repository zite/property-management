import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { PaymentMethod, TransactionKind, TransactionSource } from '../constants';
import { isDay, periodEnd, periodStart } from '../dates';
import { fromCents, sumMoney, toCents } from '../money';
import { getChart, type AccountRow, type Chart } from './accounts';
import { chunked, iso, num, numOrNull, ref, str, withRetry } from './sql';

/**
 * The posting engine: double-entry books for a property management company.
 *
 * Every money event is one row in Transactions plus balanced Journal Lines.
 * Nothing else stores a balance — a tenant's balance IS the Accounts
 * Receivable lines tagged with their lease, a property's cash IS its bank
 * lines — so the tenant ledger, the rent roll, owner statements and the
 * balance sheet can never disagree with each other.
 *
 *   Charge               Dr Accounts Receivable      Cr income (or Deposits Held)
 *   Payment              Dr Bank                     Cr Accounts Receivable
 *   Credit               Dr Concessions (or income)  Cr Accounts Receivable
 *   Refund (of credit)   Dr Accounts Receivable      Cr Bank
 *   Refund (of deposit)  Dr Deposits Held            Cr Bank
 *   Deposit application  Dr Deposits Held            Cr Accounts Receivable
 *   Bill                 Dr expense                  Cr Accounts Payable
 *   Bill payment         Dr Accounts Payable         Cr Bank
 *   Expense              Dr expense                  Cr Bank
 *   Owner contribution   Dr Bank                     Cr Owner Contributions
 *   Owner distribution   Dr Owner Distributions      Cr Bank
 *   Management fee       Dr Management Fees          Cr Bank
 *
 * Which charge a payment paid is recorded in Allocations, so "is September's
 * rent still open?" (late fees) and aging buckets are exact rather than
 * inferred. Voiding never deletes: the transaction, its lines and its
 * allocations are flagged and drop out of every balance.
 *
 * There are no database transactions, so writes are ordered to fail safe:
 * lines are written right after their header, and a header whose lines fail
 * is voided rather than left unbalanced.
 */

export type LineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  ownerId?: string | null;
  vendorId?: string | null;
  memo?: string | null;
};

export type TxnInput = {
  kind: TransactionKind;
  date: string;
  dueDate?: string | null;
  amount: number;
  description: string;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  tenantId?: string | null;
  vendorId?: string | null;
  ownerId?: string | null;
  workOrderId?: string | null;
  accountId?: string | null;
  bankAccountId?: string | null;
  paymentMethod?: PaymentMethod | null;
  reference?: string | null;
  source?: TransactionSource;
  period?: string | null;
  recurringChargeId?: string | null;
  onlinePaymentId?: string | null;
  attachmentUrl?: string | null;
  notes?: string | null;
  createdById?: string | null;
  lines: LineInput[];
};

export type Posted = { id: string; number: number };

const bad = (message: string) => new ZiteError(message, 'BAD_REQUEST');

export function validateTxn(t: TxnInput, chart?: Chart) {
  if (!isDay(t.date)) throw bad('Choose a valid date');
  if (t.dueDate && !isDay(t.dueDate)) throw bad('Choose a valid due date');
  if (!(toCents(t.amount) > 0)) throw bad('The amount must be greater than zero');
  if (toCents(t.amount) > 100_000_000_00) throw bad('That amount is too large');
  if (!t.lines.length) throw bad('A transaction needs at least two lines');
  let dr = 0;
  let cr = 0;
  for (const l of t.lines) {
    const d = toCents(l.debit ?? 0);
    const c = toCents(l.credit ?? 0);
    if (d < 0 || c < 0) throw bad('Debits and credits can’t be negative');
    if (d > 0 && c > 0) throw bad('A line can’t be both a debit and a credit');
    if (!l.accountId) throw bad('Every line needs an account');
    if (chart) {
      const a = chart.byId.get(l.accountId);
      if (!a) throw bad('One of the accounts no longer exists');
    }
    dr += d;
    cr += c;
  }
  if (dr !== cr) throw bad(`Debits (${fromCents(dr).toFixed(2)}) and credits (${fromCents(cr).toFixed(2)}) must balance`);
  if (dr === 0) throw bad('The transaction has no amount');
}

export async function nextNumber(table: 'Transactions' | 'WorkOrders' | 'Leases' | 'Applications', start: number) {
  const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("number"), $1) AS n FROM "${table}"`, params: [start] });
  return Math.max(start, num(rows[0]?.n, start)) + 1;
}

function txnRecord(t: TxnInput, number: number) {
  return {
    description: t.description.slice(0, 250),
    number,
    kind: t.kind,
    date: t.date,
    dueDate: t.dueDate ?? null,
    amount: fromCents(toCents(t.amount)),
    status: 'Posted',
    propertyId: t.propertyId ?? null,
    unitId: t.unitId ?? null,
    leaseId: t.leaseId ?? null,
    tenantId: t.tenantId ?? null,
    vendorId: t.vendorId ?? null,
    ownerId: t.ownerId ?? null,
    workOrderId: t.workOrderId ?? null,
    accountId: t.accountId ?? null,
    bankAccountId: t.bankAccountId ?? null,
    paymentMethod: t.paymentMethod ?? null,
    reference: t.reference?.slice(0, 120) ?? null,
    source: t.source ?? 'Manual',
    period: t.period ?? null,
    recurringChargeId: t.recurringChargeId ?? null,
    onlinePaymentId: t.onlinePaymentId ?? null,
    attachmentUrl: t.attachmentUrl ?? null,
    notes: t.notes ?? null,
    createdById: t.createdById ?? null,
  };
}

function lineRecords(t: TxnInput, transactionId: string) {
  return t.lines
    .filter(l => toCents(l.debit ?? 0) > 0 || toCents(l.credit ?? 0) > 0)
    .map(l => ({
      memo: (l.memo ?? t.description).slice(0, 250),
      transactionId,
      date: t.date,
      accountId: l.accountId,
      propertyId: l.propertyId ?? t.propertyId ?? null,
      unitId: l.unitId ?? t.unitId ?? null,
      leaseId: l.leaseId ?? t.leaseId ?? null,
      ownerId: l.ownerId ?? t.ownerId ?? null,
      vendorId: l.vendorId ?? t.vendorId ?? null,
      debit: toCents(l.debit ?? 0) > 0 ? fromCents(toCents(l.debit)) : null,
      credit: toCents(l.credit ?? 0) > 0 ? fromCents(toCents(l.credit)) : null,
      void: false,
    }));
}

/**
 * Insert many transactions at once — the seed and month-end runs post hundreds.
 * Numbers are assigned in order, and returned ids are matched back by number,
 * never by position.
 */
export async function insertTransactions(txns: TxnInput[], opts: { startNumber?: number; validate?: boolean } = {}): Promise<Posted[]> {
  if (!txns.length) return [];
  const chart = opts.validate === false ? undefined : await getChart();
  for (const t of txns) validateTxn(t, chart);
  let number = opts.startNumber ?? (await nextNumber('Transactions', 1000));
  const numbered = txns.map(t => ({ t, number: number++ }));
  const idByNumber = new Map<number, string>();
  await chunked(numbered, async batch => {
    const res = await withRetry(() => zite.transactions.bulkCreate({ records: batch.map(b => txnRecord(b.t, b.number)) as never }));
    for (const r of res.records as Array<{ id: string; number?: number }>) idByNumber.set(Number(r.number), r.id);
  });
  const posted = numbered.map(b => ({ id: idByNumber.get(b.number) ?? '', number: b.number, t: b.t }));
  const missing = posted.filter(p => !p.id);
  if (missing.length) throw new ZiteError('Some transactions could not be saved. Reload and check the ledger.', 'INTERNAL_ERROR');
  const lines = posted.flatMap(p => lineRecords(p.t, p.id));
  try {
    await chunked(lines, async batch => {
      await withRetry(() => zite.journalLines.bulkCreate({ records: batch as never }));
    });
  } catch (e) {
    // Never leave a header without its lines: void what was written.
    for (const p of posted) await zite.transactions.update({ id: p.id, record: { status: 'Void', voidReason: 'Lines failed to save', voidedAt: new Date().toISOString() } }).catch(() => undefined);
    throw e;
  }
  return posted.map(p => ({ id: p.id, number: p.number }));
}

export async function postTransaction(t: TxnInput): Promise<Posted> {
  const [posted] = await insertTransactions([t]);
  return posted;
}

export type AllocationInput = { paymentId: string; chargeId: string; amount: number; date: string };

export async function insertAllocations(allocs: AllocationInput[]) {
  const records = allocs.filter(a => toCents(a.amount) > 0).map(a => ({ paymentId: a.paymentId, chargeId: a.chargeId, amount: fromCents(toCents(a.amount)), date: a.date, void: false }));
  await chunked(records, async batch => {
    await withRetry(() => zite.allocations.bulkCreate({ records: batch }));
  });
  return records.length;
}

// ── Lease context ────────────────────────────────────────────────────────────

export type LeaseContext = {
  id: string;
  name: string;
  number: number | null;
  status: string;
  propertyId: string;
  unitId: string;
  primaryTenantId: string | null;
  rent: number;
  deposit: number;
  bankAccountId: string | null;
  lateFeeExempt: boolean;
};

export async function leaseContext(leaseId: string): Promise<LeaseContext> {
  const { rows } = await zite.sql({
    query: `
      SELECT l.id, l."name", l."number", l."status", l."propertyId", l."unitId", l."rent", l."deposit", l."lateFeeExempt", p."bankAccountId",
        (SELECT lt."tenantId" FROM "LeaseTenants" lt WHERE lt."leaseId" = l.id::text ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at ASC LIMIT 1) AS "primaryTenantId"
      FROM "Leases" l
      LEFT JOIN "Properties" p ON p.id::text = l."propertyId"
      WHERE l.id::text = $1 LIMIT 1`,
    params: [leaseId],
  });
  const r = rows[0];
  if (!r) throw new ZiteError('That lease no longer exists', 'NOT_FOUND');
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    number: numOrNull(r.number),
    status: str(r.status) ?? 'Draft',
    propertyId: ref(r.propertyId) ?? '',
    unitId: ref(r.unitId) ?? '',
    primaryTenantId: ref(r.primaryTenantId),
    rent: num(r.rent),
    deposit: num(r.deposit),
    bankAccountId: ref(r.bankAccountId),
    lateFeeExempt: r.lateFeeExempt === true,
  };
}

async function propertyBank(propertyId: string | null | undefined, chart: Chart, override?: string | null) {
  if (override) {
    const a = chart.byId.get(override);
    if (!a || a.subtype !== 'Bank') throw bad('Choose a bank account');
    return a;
  }
  if (propertyId) {
    const { rows } = await zite.sql({ query: `SELECT "bankAccountId" FROM "Properties" WHERE id::text = $1`, params: [propertyId] });
    const id = ref(rows[0]?.bankAccountId);
    const a = id ? chart.byId.get(id) : undefined;
    if (a && a.subtype === 'Bank' && a.active) return a;
  }
  return chart.key('operating_bank');
}

function requireAccount(chart: Chart, id: string | null | undefined, allowed: (a: AccountRow) => boolean, message: string) {
  const a = id ? chart.byId.get(id) : undefined;
  if (!a || !allowed(a)) throw bad(message);
  return a;
}

// ── Open items ───────────────────────────────────────────────────────────────

export type OpenItem = { id: string; number: number; kind: string; date: string; dueDate: string | null; amount: number; open: number; description: string; accountId: string | null };

/**
 * Charges on a lease that are not fully paid, oldest due first. Refunds of a
 * credit balance also consume payments, so they count as open items too. Late
 * fees sort last within a day, so a partial payment clears rent first.
 */
export async function openCharges(leaseId: string): Promise<OpenItem[]> {
  const chart = await getChart();
  const ar = chart.key('accounts_receivable').id;
  const lateFee = chart.key('late_fee_income').id;
  const { rows } = await zite.sql({
    query: `
      SELECT t.id, t."number", t."kind", t."date", t."dueDate", t."amount", t."description", t."accountId",
        t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0) AS "openAmount"
      FROM "Transactions" t
      WHERE t."leaseId" = $1 AND t."status" = 'Posted' AND (t."kind" = 'Charge' OR (t."kind" = 'Refund' AND t."accountId" = $2))
      ORDER BY COALESCE(t."dueDate", t."date") ASC, CASE WHEN t."accountId" = $3 THEN 1 ELSE 0 END ASC, t."number" ASC`,
    params: [leaseId, ar, lateFee],
  });
  return rows
    .map(r => ({
      id: String(r.id),
      number: num(r.number),
      kind: String(r.kind),
      date: String(r.date ?? '').slice(0, 10),
      dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
      amount: num(r.amount),
      open: fromCents(toCents(num(r.openAmount))),
      description: str(r.description) ?? '',
      accountId: ref(r.accountId),
    }))
    .filter(r => toCents(r.open) > 0);
}

/** Payments, credits and deposit applications with money not yet matched to a charge. */
export async function unappliedCredits(leaseId: string): Promise<OpenItem[]> {
  const { rows } = await zite.sql({
    query: `
      SELECT t.id, t."number", t."kind", t."date", t."dueDate", t."amount", t."description", t."accountId",
        t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."paymentId" = t.id::text AND COALESCE(a."void", false) = false), 0) AS "openAmount"
      FROM "Transactions" t
      WHERE t."leaseId" = $1 AND t."status" = 'Posted' AND t."kind" IN ('Payment', 'Credit', 'Deposit application')
      ORDER BY t."date" ASC, t."number" ASC`,
    params: [leaseId],
  });
  return rows
    .map(r => ({
      id: String(r.id),
      number: num(r.number),
      kind: String(r.kind),
      date: String(r.date ?? '').slice(0, 10),
      dueDate: null,
      amount: num(r.amount),
      open: fromCents(toCents(num(r.openAmount))),
      description: str(r.description) ?? '',
      accountId: ref(r.accountId),
    }))
    .filter(r => toCents(r.open) > 0);
}

/** Match unapplied money to open charges, oldest first. Returns the allocations written. */
export async function autoApply(leaseId: string): Promise<AllocationInput[]> {
  const [charges, credits] = await Promise.all([openCharges(leaseId), unappliedCredits(leaseId)]);
  const allocs = matchFifo(credits, charges);
  await insertAllocations(allocs);
  return allocs;
}

/** Pure FIFO matching, shared by the engine and the seed. */
export function matchFifo(credits: Array<{ id: string; open: number; date: string }>, charges: Array<{ id: string; open: number; date: string }>): AllocationInput[] {
  const out: AllocationInput[] = [];
  const openCharges = charges.map(c => ({ ...c, cents: toCents(c.open) }));
  for (const credit of credits) {
    let left = toCents(credit.open);
    for (const charge of openCharges) {
      if (left <= 0) break;
      if (charge.cents <= 0) continue;
      const take = Math.min(left, charge.cents);
      out.push({ paymentId: credit.id, chargeId: charge.id, amount: fromCents(take), date: credit.date > charge.date ? credit.date : charge.date });
      charge.cents -= take;
      left -= take;
    }
  }
  return out;
}

/** Check explicit allocations against what's open before anything is posted, so a bad split never leaves a half-applied payment. */
async function planExplicit(date: string, amount: number, leaseId: string, allocations: Array<{ chargeId: string; amount: number }>) {
  const open = new Map((await openCharges(leaseId)).map(c => [c.id, c]));
  let total = 0;
  const out: Array<Omit<AllocationInput, 'paymentId'>> = [];
  for (const a of allocations) {
    const c = open.get(a.chargeId);
    const cents = toCents(a.amount);
    if (cents <= 0) continue;
    if (!c) throw bad('One of the charges is already paid or was voided. Reload and try again.');
    if (cents > toCents(c.open)) throw bad(`You can apply at most ${c.open.toFixed(2)} to “${c.description}”`);
    total += cents;
    out.push({ chargeId: a.chargeId, amount: fromCents(cents), date: date > c.date ? date : c.date });
  }
  if (total > toCents(amount)) throw bad('The amounts applied add up to more than the payment');
  return out;
}

// ── Receivables ──────────────────────────────────────────────────────────────

type Common = { date: string; description?: string; reference?: string | null; notes?: string | null; createdById?: string | null; attachmentUrl?: string | null };

export async function postCharge(input: Common & {
  leaseId: string;
  accountId: string;
  amount: number;
  dueDate?: string | null;
  source?: TransactionSource;
  period?: string | null;
  recurringChargeId?: string | null;
  workOrderId?: string | null;
  skipAutoApply?: boolean;
}) {
  const chart = await getChart();
  const lease = await leaseContext(input.leaseId);
  const account = requireAccount(chart, input.accountId, a => a.accountType === 'Income' || a.subtype === 'Deposits held' || a.subtype === 'Other liability', 'Choose an income account for the charge');
  const posted = await postTransaction({
    kind: 'Charge',
    date: input.date,
    dueDate: input.dueDate ?? input.date,
    amount: input.amount,
    description: input.description || account.name,
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    leaseId: lease.id,
    tenantId: lease.primaryTenantId,
    accountId: account.id,
    workOrderId: input.workOrderId ?? null,
    reference: input.reference,
    source: input.source ?? 'Manual',
    period: input.period ?? null,
    recurringChargeId: input.recurringChargeId ?? null,
    notes: input.notes,
    createdById: input.createdById,
    attachmentUrl: input.attachmentUrl,
    lines: [
      { accountId: chart.key('accounts_receivable').id, debit: input.amount },
      { accountId: account.id, credit: input.amount },
    ],
  });
  if (!input.skipAutoApply) await autoApply(lease.id);
  return posted;
}

export async function receivePayment(input: Common & {
  leaseId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  bankAccountId?: string | null;
  tenantId?: string | null;
  source?: TransactionSource;
  onlinePaymentId?: string | null;
  allocations?: Array<{ chargeId: string; amount: number }>;
}) {
  const chart = await getChart();
  const lease = await leaseContext(input.leaseId);
  const bank = await propertyBank(lease.propertyId, chart, input.bankAccountId);
  const plan = input.allocations?.length ? await planExplicit(input.date, input.amount, lease.id, input.allocations) : [];
  const posted = await postTransaction({
    kind: 'Payment',
    date: input.date,
    amount: input.amount,
    description: input.description || `Payment${input.reference ? ` · ${input.reference}` : ''}`,
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    leaseId: lease.id,
    tenantId: input.tenantId ?? lease.primaryTenantId,
    accountId: chart.key('accounts_receivable').id,
    bankAccountId: bank.id,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    source: input.source ?? 'Manual',
    onlinePaymentId: input.onlinePaymentId ?? null,
    notes: input.notes,
    createdById: input.createdById,
    attachmentUrl: input.attachmentUrl,
    lines: [
      { accountId: bank.id, debit: input.amount },
      { accountId: chart.key('accounts_receivable').id, credit: input.amount },
    ],
  });
  if (plan.length) await insertAllocations(plan.map(a => ({ ...a, paymentId: posted.id })));
  await autoApply(lease.id);
  return posted;
}

export async function postCredit(input: Common & { leaseId: string; amount: number; accountId?: string | null; allocations?: Array<{ chargeId: string; amount: number }> }) {
  const chart = await getChart();
  const lease = await leaseContext(input.leaseId);
  const account = input.accountId
    ? requireAccount(chart, input.accountId, a => a.accountType === 'Income' || a.accountType === 'Expense', 'Choose an income or expense account for the credit')
    : chart.key('concessions');
  const plan = input.allocations?.length ? await planExplicit(input.date, input.amount, lease.id, input.allocations) : [];
  const posted = await postTransaction({
    kind: 'Credit',
    date: input.date,
    amount: input.amount,
    description: input.description || account.name,
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    leaseId: lease.id,
    tenantId: lease.primaryTenantId,
    accountId: account.id,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    lines: [
      { accountId: account.id, debit: input.amount },
      { accountId: chart.key('accounts_receivable').id, credit: input.amount },
    ],
  });
  if (plan.length) await insertAllocations(plan.map(a => ({ ...a, paymentId: posted.id })));
  await autoApply(lease.id);
  return posted;
}

/** Give a tenant back money they overpaid (a credit balance). */
export async function refundCredit(input: Common & { leaseId: string; amount: number; paymentMethod: PaymentMethod; bankAccountId?: string | null }) {
  const chart = await getChart();
  const lease = await leaseContext(input.leaseId);
  const available = sumMoney((await unappliedCredits(lease.id)).map(c => c.open));
  if (toCents(input.amount) > toCents(available)) throw bad(`This lease only has ${available.toFixed(2)} in unapplied credit to refund`);
  const bank = await propertyBank(lease.propertyId, chart, input.bankAccountId);
  const ar = chart.key('accounts_receivable');
  const posted = await postTransaction({
    kind: 'Refund',
    date: input.date,
    amount: input.amount,
    description: input.description || 'Refund of credit balance',
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    leaseId: lease.id,
    tenantId: lease.primaryTenantId,
    accountId: ar.id,
    bankAccountId: bank.id,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    lines: [
      { accountId: ar.id, debit: input.amount },
      { accountId: bank.id, credit: input.amount },
    ],
  });
  await autoApply(lease.id);
  return posted;
}

/** Apply held security deposit to what a tenant owes, usually at move-out. */
export async function applyDeposit(input: Common & { leaseId: string; amount: number }) {
  const chart = await getChart();
  const lease = await leaseContext(input.leaseId);
  const held = (await leaseBalances([lease.id])).get(lease.id)?.depositHeld ?? 0;
  if (toCents(input.amount) > toCents(held)) throw bad(`Only ${held.toFixed(2)} of deposit is held for this lease`);
  const posted = await postTransaction({
    kind: 'Deposit application',
    date: input.date,
    amount: input.amount,
    description: input.description || 'Security deposit applied to balance',
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    leaseId: lease.id,
    tenantId: lease.primaryTenantId,
    accountId: chart.key('deposits_held').id,
    source: 'Move-out',
    notes: input.notes,
    createdById: input.createdById,
    lines: [
      { accountId: chart.key('deposits_held').id, debit: input.amount },
      { accountId: chart.key('accounts_receivable').id, credit: input.amount },
    ],
  });
  await autoApply(lease.id);
  return posted;
}

/** Return held deposit to a tenant. */
export async function refundDeposit(input: Common & { leaseId: string; amount: number; paymentMethod: PaymentMethod; bankAccountId?: string | null }) {
  const chart = await getChart();
  const lease = await leaseContext(input.leaseId);
  const held = (await leaseBalances([lease.id])).get(lease.id)?.depositHeld ?? 0;
  if (toCents(input.amount) > toCents(held)) throw bad(`Only ${held.toFixed(2)} of deposit is held for this lease`);
  const bank = await propertyBank(lease.propertyId, chart, input.bankAccountId);
  return postTransaction({
    kind: 'Refund',
    date: input.date,
    amount: input.amount,
    description: input.description || 'Security deposit refund',
    propertyId: lease.propertyId,
    unitId: lease.unitId,
    leaseId: lease.id,
    tenantId: lease.primaryTenantId,
    accountId: chart.key('deposits_held').id,
    bankAccountId: bank.id,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    source: 'Move-out',
    notes: input.notes,
    createdById: input.createdById,
    lines: [
      { accountId: chart.key('deposits_held').id, debit: input.amount },
      { accountId: bank.id, credit: input.amount },
    ],
  });
}

// ── Payables ─────────────────────────────────────────────────────────────────

export type BillLine = { accountId: string; amount: number; propertyId?: string | null; unitId?: string | null; memo?: string | null };

export async function postBill(input: Common & {
  vendorId: string;
  propertyId: string;
  unitId?: string | null;
  workOrderId?: string | null;
  dueDate: string;
  lines: BillLine[];
}) {
  const chart = await getChart();
  const ap = chart.key('accounts_payable');
  if (!input.lines.length) throw bad('Add at least one line to the bill');
  for (const l of input.lines) requireAccount(chart, l.accountId, a => a.accountType === 'Expense' || a.accountType === 'Asset' || a.accountType === 'Liability', 'Choose an expense account for each bill line');
  const amount = sumMoney(input.lines.map(l => l.amount));
  // AP is credited per property, so a bill split across buildings pays down each building's payable.
  const apByProperty = new Map<string, number>();
  for (const l of input.lines) {
    const p = l.propertyId ?? input.propertyId;
    apByProperty.set(p, (apByProperty.get(p) ?? 0) + toCents(l.amount));
  }
  return postTransaction({
    kind: 'Bill',
    date: input.date,
    dueDate: input.dueDate,
    amount,
    description: input.description || chart.byId.get(input.lines[0].accountId)?.name || 'Bill',
    propertyId: input.propertyId,
    unitId: input.unitId ?? null,
    vendorId: input.vendorId,
    workOrderId: input.workOrderId ?? null,
    accountId: input.lines[0].accountId,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    attachmentUrl: input.attachmentUrl,
    lines: [
      ...input.lines.map(l => ({ accountId: l.accountId, debit: l.amount, propertyId: l.propertyId ?? input.propertyId, unitId: l.unitId ?? input.unitId ?? null, vendorId: input.vendorId, memo: l.memo })),
      ...[...apByProperty.entries()].map(([propertyId, cents]) => ({ accountId: ap.id, credit: fromCents(cents), propertyId, vendorId: input.vendorId })),
    ],
  });
}

export async function openBills(filter: { vendorId?: string; propertyId?: string; billIds?: string[] } = {}): Promise<Array<OpenItem & { vendorId: string | null; propertyId: string | null; workOrderId: string | null; reference: string | null }>> {
  const params: unknown[] = [];
  const where: string[] = [`t."kind" = 'Bill'`, `t."status" = 'Posted'`];
  if (filter.vendorId) {
    params.push(filter.vendorId);
    where.push(`t."vendorId" = $${params.length}`);
  }
  if (filter.propertyId) {
    params.push(filter.propertyId);
    where.push(`t."propertyId" = $${params.length}`);
  }
  if (filter.billIds?.length) {
    params.push(filter.billIds);
    where.push(`t.id::text = ANY($${params.length})`);
  }
  const { rows } = await zite.sql({
    query: `
      SELECT t.id, t."number", t."kind", t."date", t."dueDate", t."amount", t."description", t."accountId", t."vendorId", t."propertyId", t."workOrderId", t."reference",
        t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0) AS "openAmount"
      FROM "Transactions" t WHERE ${where.join(' AND ')}
      ORDER BY t."dueDate" ASC NULLS LAST, t."number" ASC LIMIT 2000`,
    params,
  });
  return rows
    .map(r => ({
      id: String(r.id),
      number: num(r.number),
      kind: 'Bill',
      date: String(r.date ?? '').slice(0, 10),
      dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
      amount: num(r.amount),
      open: fromCents(toCents(num(r.openAmount))),
      description: str(r.description) ?? '',
      accountId: ref(r.accountId),
      vendorId: ref(r.vendorId),
      propertyId: ref(r.propertyId),
      workOrderId: ref(r.workOrderId),
      reference: ref(r.reference),
    }))
    .filter(b => toCents(b.open) > 0);
}

/**
 * Pay one or more bills. One payment per vendor (one check, one ACH), with bank
 * and payable lines split per property so each building's cash is right.
 */
export async function payBills(input: Common & { paymentMethod: PaymentMethod; bankAccountId?: string | null; items: Array<{ billId: string; amount: number }> }) {
  const chart = await getChart();
  const ap = chart.key('accounts_payable');
  const items = input.items.filter(i => toCents(i.amount) > 0);
  if (!items.length) throw bad('Choose at least one bill to pay');
  const bills = new Map((await openBills({ billIds: items.map(i => i.billId) })).map(b => [b.id, b]));
  type Bill = Awaited<ReturnType<typeof openBills>>[number];
  const byVendor = new Map<string, Array<{ bill: Bill; cents: number }>>();
  for (const i of items) {
    const bill = bills.get(i.billId);
    if (!bill) throw bad('One of those bills is already paid or was voided. Reload and try again.');
    const cents = toCents(i.amount);
    if (cents > toCents(bill.open)) throw bad(`Bill #${bill.number} only has ${bill.open.toFixed(2)} left to pay`);
    const v = bill.vendorId ?? '';
    if (!byVendor.has(v)) byVendor.set(v, []);
    byVendor.get(v)!.push({ bill, cents });
  }
  // A bill split across buildings credited payables per line property (see postBill), so each
  // payment is split the same way — proportionally to the bill's payable by property — or one
  // building's cash would pay another's share and its payable would never clear.
  const { rows: apRows } = await zite.sql({
    query: `
      SELECT jl."transactionId", COALESCE(jl."propertyId", '') AS "propertyId", SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS "amount"
      FROM "JournalLines" jl
      WHERE jl."transactionId" = ANY($1) AND jl."accountId" = $2 AND COALESCE(jl."void", false) = false
      GROUP BY jl."transactionId", COALESCE(jl."propertyId", '')`,
    params: [[...bills.keys()], ap.id],
  });
  const apShares = new Map<string, Array<{ propertyId: string; cents: number }>>();
  for (const r of apRows) {
    const key = String(r.transactionId);
    if (!apShares.has(key)) apShares.set(key, []);
    const cents = toCents(num(r.amount));
    if (cents > 0) apShares.get(key)!.push({ propertyId: String(r.propertyId ?? ''), cents });
  }
  const splitPayment = (bill: Bill, cents: number): Array<[string, number]> => {
    const shares = apShares.get(bill.id) ?? [];
    const whole = shares.reduce((a, b) => a + b.cents, 0);
    if (shares.length <= 1 || whole <= 0) return [[shares[0]?.propertyId || bill.propertyId || '', cents]];
    // Largest-remainder rounding so the parts add up to the cent.
    const parts = shares.map(sh => ({ propertyId: sh.propertyId, exact: (cents * sh.cents) / whole }));
    const floored = parts.map(p => ({ ...p, cents: Math.floor(p.exact) }));
    let left = cents - floored.reduce((a, b) => a + b.cents, 0);
    for (const p of [...floored].sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents))) {
      if (left <= 0) break;
      p.cents += 1;
      left -= 1;
    }
    return floored.filter(p => p.cents > 0).map(p => [p.propertyId, p.cents]);
  };

  const results: Posted[] = [];
  for (const [vendorId, list] of byVendor) {
    const byProperty = new Map<string, number>();
    for (const { bill, cents } of list) {
      for (const [propertyId, part] of splitPayment(bill, cents)) byProperty.set(propertyId, (byProperty.get(propertyId) ?? 0) + part);
    }
    const total = fromCents(list.reduce((a, b) => a + b.cents, 0));
    const lines: LineInput[] = [];
    for (const [propertyId, cents] of byProperty) {
      const bank = await propertyBank(propertyId || null, chart, input.bankAccountId);
      lines.push({ accountId: ap.id, debit: fromCents(cents), propertyId: propertyId || null, vendorId: vendorId || null });
      lines.push({ accountId: bank.id, credit: fromCents(cents), propertyId: propertyId || null, vendorId: vendorId || null });
    }
    const firstBank = lines.find(l => l.credit)?.accountId ?? null;
    const posted = await postTransaction({
      kind: 'Bill payment',
      date: input.date,
      amount: total,
      description: input.description || (list.length === 1 ? `Payment for bill #${list[0].bill.number}` : `Payment for ${list.length} bills`),
      propertyId: byProperty.size === 1 ? [...byProperty.keys()][0] || null : null,
      vendorId: vendorId || null,
      accountId: ap.id,
      bankAccountId: firstBank,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      notes: input.notes,
      createdById: input.createdById,
      lines,
    });
    await insertAllocations(list.map(({ bill, cents }) => ({ paymentId: posted.id, chargeId: bill.id, amount: fromCents(cents), date: input.date })));
    results.push(posted);
  }
  return results;
}

/** Money spent directly from the bank without a bill (a card purchase, a check written on the spot). */
export async function postExpense(input: Common & {
  propertyId: string;
  unitId?: string | null;
  vendorId?: string | null;
  workOrderId?: string | null;
  accountId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  bankAccountId?: string | null;
}) {
  const chart = await getChart();
  const account = requireAccount(chart, input.accountId, a => a.accountType === 'Expense', 'Choose an expense account');
  const bank = await propertyBank(input.propertyId, chart, input.bankAccountId);
  return postTransaction({
    kind: 'Expense',
    date: input.date,
    amount: input.amount,
    description: input.description || account.name,
    propertyId: input.propertyId,
    unitId: input.unitId ?? null,
    vendorId: input.vendorId ?? null,
    workOrderId: input.workOrderId ?? null,
    accountId: account.id,
    bankAccountId: bank.id,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    attachmentUrl: input.attachmentUrl,
    lines: [
      { accountId: account.id, debit: input.amount, vendorId: input.vendorId ?? null },
      { accountId: bank.id, credit: input.amount, vendorId: input.vendorId ?? null },
    ],
  });
}

// ── Owners & banking ─────────────────────────────────────────────────────────

export async function postOwnerMoney(input: Common & { direction: 'contribution' | 'distribution'; ownerId: string; propertyId: string; amount: number; paymentMethod: PaymentMethod; bankAccountId?: string | null }) {
  const chart = await getChart();
  const bank = await propertyBank(input.propertyId, chart, input.bankAccountId);
  const contribution = input.direction === 'contribution';
  const equity = chart.key(contribution ? 'owner_contributions' : 'owner_distributions');
  return postTransaction({
    kind: contribution ? 'Owner contribution' : 'Owner distribution',
    date: input.date,
    amount: input.amount,
    description: input.description || (contribution ? 'Owner contribution' : 'Owner distribution'),
    propertyId: input.propertyId,
    ownerId: input.ownerId,
    accountId: equity.id,
    bankAccountId: bank.id,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    lines: contribution
      ? [{ accountId: bank.id, debit: input.amount }, { accountId: equity.id, credit: input.amount }]
      : [{ accountId: equity.id, debit: input.amount }, { accountId: bank.id, credit: input.amount }],
  });
}

export async function postManagementFee(input: Common & { propertyId: string; ownerId?: string | null; amount: number; period: string; bankAccountId?: string | null }) {
  const chart = await getChart();
  const bank = await propertyBank(input.propertyId, chart, input.bankAccountId);
  const fees = chart.key('management_fees');
  return postTransaction({
    kind: 'Management fee',
    date: input.date,
    amount: input.amount,
    description: input.description || 'Management fee',
    propertyId: input.propertyId,
    ownerId: input.ownerId ?? null,
    accountId: fees.id,
    bankAccountId: bank.id,
    period: input.period,
    source: 'System',
    createdById: input.createdById,
    lines: [
      { accountId: fees.id, debit: input.amount },
      { accountId: bank.id, credit: input.amount },
    ],
  });
}

export async function postTransfer(input: Common & { fromBankId: string; toBankId: string; amount: number; propertyId?: string | null }) {
  const chart = await getChart();
  const from = requireAccount(chart, input.fromBankId, a => a.subtype === 'Bank', 'Choose the account to transfer from');
  const to = requireAccount(chart, input.toBankId, a => a.subtype === 'Bank', 'Choose the account to transfer to');
  if (from.id === to.id) throw bad('Choose two different bank accounts');
  return postTransaction({
    kind: 'Transfer',
    date: input.date,
    amount: input.amount,
    description: input.description || `Transfer from ${from.name} to ${to.name}`,
    propertyId: input.propertyId ?? null,
    bankAccountId: from.id,
    accountId: to.id,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    lines: [
      { accountId: to.id, debit: input.amount },
      { accountId: from.id, credit: input.amount },
    ],
  });
}

export async function postJournalEntry(input: Common & { lines: LineInput[]; propertyId?: string | null }) {
  const chart = await getChart();
  const amount = fromCents(input.lines.reduce((a, l) => a + toCents(l.debit ?? 0), 0));
  for (const l of input.lines) requireAccount(chart, l.accountId, a => a.active, 'One of the accounts is inactive or missing');
  return postTransaction({
    kind: 'Journal entry',
    date: input.date,
    amount,
    description: input.description || 'Journal entry',
    propertyId: input.propertyId ?? null,
    reference: input.reference,
    notes: input.notes,
    createdById: input.createdById,
    lines: input.lines,
  });
}

// ── Voiding ──────────────────────────────────────────────────────────────────

export async function voidTransaction(id: string, reason: string, actorId: string | null) {
  const { rows } = await zite.sql({ query: `SELECT id, "status", "kind", "leaseId", "number" FROM "Transactions" WHERE id::text = $1 LIMIT 1`, params: [id] });
  const t = rows[0];
  if (!t) throw new ZiteError('That transaction no longer exists', 'NOT_FOUND');
  if (t.status === 'Void') throw bad('That transaction is already void');
  const now = new Date().toISOString();
  await zite.transactions.update({ id, record: { status: 'Void', voidedAt: now, voidReason: reason.slice(0, 250) || 'Voided', voidedById: actorId } });
  const [{ rows: lines }, { rows: allocs }] = await Promise.all([
    zite.sql({ query: `SELECT id FROM "JournalLines" WHERE "transactionId" = $1`, params: [id] }),
    zite.sql({ query: `SELECT id FROM "Allocations" WHERE ("paymentId" = $1 OR "chargeId" = $1) AND COALESCE("void", false) = false`, params: [id] }),
  ]);
  for (const l of lines) await zite.journalLines.update({ id: String(l.id), record: { void: true } });
  for (const a of allocs) await zite.allocations.update({ id: String(a.id), record: { void: true } });
  // Money freed from a voided charge goes to the next open charge.
  const leaseId = ref(t.leaseId);
  if (leaseId) await autoApply(leaseId);
  return { id, number: num(t.number), kind: String(t.kind), leaseId };
}

// ── Balances ─────────────────────────────────────────────────────────────────

export type LeaseBalance = { balance: number; depositHeld: number };

/** Lease balance (AR by lease, positive = tenant owes) and deposit held, straight from the journal. */
export async function leaseBalances(leaseIds?: string[]): Promise<Map<string, LeaseBalance>> {
  const chart = await getChart();
  const params: unknown[] = [chart.key('accounts_receivable').id, chart.key('deposits_held').id];
  let filter = `COALESCE(jl."leaseId", '') <> ''`;
  if (leaseIds) {
    if (!leaseIds.length) return new Map();
    params.push(leaseIds);
    filter = `jl."leaseId" = ANY($3)`;
  }
  const { rows } = await zite.sql({
    query: `
      SELECT jl."leaseId",
        SUM(CASE WHEN jl."accountId" = $1 THEN COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0) ELSE 0 END) AS "balance",
        SUM(CASE WHEN jl."accountId" = $2 THEN COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0) ELSE 0 END) AS "depositHeld"
      FROM "JournalLines" jl
      WHERE COALESCE(jl."void", false) = false AND ${filter}
      GROUP BY jl."leaseId"`,
    params,
  });
  return new Map(rows.map(r => [String(r.leaseId), { balance: fromCents(toCents(num(r.balance))), depositHeld: fromCents(toCents(num(r.depositHeld))) }]));
}

export type LedgerEntry = {
  id: string;
  number: number;
  kind: TransactionKind;
  date: string;
  dueDate: string | null;
  description: string;
  accountId: string | null;
  amount: number;
  /** Effect on what the tenant owes: charges positive, payments and credits negative. 0 for entries that don't touch AR. */
  effect: number;
  runningBalance: number;
  status: 'Posted' | 'Void';
  paymentMethod: string | null;
  reference: string | null;
  source: string | null;
  open: number | null;
  unapplied: number | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdById: string | null;
  workOrderId: string | null;
  onlinePaymentId: string | null;
  notes: string | null;
};

/**
 * A lease's ledger the way a tenant statement reads it: every charge, payment,
 * credit and deposit movement in date order with a running balance. Void
 * entries are included (struck through in the UI) but never move the balance.
 */
export async function leaseLedger(leaseId: string) {
  const chart = await getChart();
  const ar = chart.key('accounts_receivable').id;
  const dep = chart.key('deposits_held').id;
  // Journal entries (opening balances, corrections) carry the lease on their lines, not the header.
  const { rows } = await zite.sql({
    query: `
      SELECT t.*,
        COALESCE((SELECT SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) FROM "JournalLines" jl WHERE jl."transactionId" = t.id::text AND jl."accountId" = $2 AND jl."leaseId" = $1), 0) AS "arEffect",
        COALESCE((SELECT SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) FROM "JournalLines" jl WHERE jl."transactionId" = t.id::text AND jl."accountId" = $3 AND jl."leaseId" = $1), 0) AS "depositEffect",
        COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0) AS "appliedTo",
        COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."paymentId" = t.id::text AND COALESCE(a."void", false) = false), 0) AS "appliedFrom"
      FROM "Transactions" t
      WHERE t."leaseId" = $1 OR (t."kind" = 'Journal entry' AND EXISTS (SELECT 1 FROM "JournalLines" x WHERE x."transactionId" = t.id::text AND x."leaseId" = $1))
      ORDER BY t."date" ASC, CASE t."kind" WHEN 'Charge' THEN 0 ELSE 1 END ASC, t."number" ASC
      LIMIT 2000`,
    params: [leaseId, ar, dep],
  });
  let running = 0;
  let depositHeld = 0;
  const entries: LedgerEntry[] = rows.map(r => {
    const status = r.status === 'Void' ? 'Void' : 'Posted';
    const effect = fromCents(toCents(num(r.arEffect)));
    if (status === 'Posted') {
      running += toCents(effect);
      depositHeld += toCents(num(r.depositEffect));
    }
    const kind = String(r.kind) as TransactionKind;
    const amount = num(r.amount);
    const isDebitItem = kind === 'Charge' || (kind === 'Refund' && ref(r.accountId) === ar);
    const isCreditItem = kind === 'Payment' || kind === 'Credit' || kind === 'Deposit application';
    return {
      id: String(r.id),
      number: num(r.number),
      kind,
      date: String(r.date ?? '').slice(0, 10),
      dueDate: r.dueDate ? String(r.dueDate).slice(0, 10) : null,
      description: str(r.description) ?? '',
      accountId: ref(r.accountId),
      amount,
      effect: status === 'Posted' ? effect : 0,
      runningBalance: fromCents(running),
      status,
      paymentMethod: ref(r.paymentMethod),
      reference: ref(r.reference),
      source: ref(r.source),
      open: isDebitItem && status === 'Posted' ? fromCents(toCents(amount) - toCents(num(r.appliedTo))) : null,
      unapplied: isCreditItem && status === 'Posted' ? fromCents(toCents(amount) - toCents(num(r.appliedFrom))) : null,
      voidReason: ref(r.voidReason),
      voidedAt: iso(r.voidedAt),
      createdById: ref(r.createdById),
      workOrderId: ref(r.workOrderId),
      onlinePaymentId: ref(r.onlinePaymentId),
      notes: ref(r.notes),
    };
  });
  const posted = entries.filter(e => e.status === 'Posted');
  return {
    entries,
    balance: fromCents(running),
    depositHeld: fromCents(depositHeld),
    openCharges: sumMoney(posted.map(e => e.open ?? 0)),
    unappliedCredit: sumMoney(posted.map(e => e.unapplied ?? 0)),
    pastDue: sumMoney(posted.filter(e => (e.open ?? 0) > 0 && e.dueDate && e.dueDate < new Date().toISOString().slice(0, 10)).map(e => e.open ?? 0)),
  };
}

/** Cash in each bank account, optionally by property and as of a date. */
export async function bankBalances(opts: { propertyId?: string; asOf?: string } = {}) {
  const chart = await getChart();
  const banks = chart.all.filter(a => a.subtype === 'Bank');
  if (!banks.length) return new Map<string, number>();
  const params: unknown[] = [banks.map(b => b.id)];
  const where = [`COALESCE(jl."void", false) = false`, `jl."accountId" = ANY($1)`];
  if (opts.propertyId) {
    params.push(opts.propertyId);
    where.push(`jl."propertyId" = $${params.length}`);
  }
  if (opts.asOf) {
    params.push(opts.asOf);
    where.push(`jl."date" <= $${params.length}`);
  }
  const { rows } = await zite.sql({
    query: `SELECT jl."accountId", SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS "balance" FROM "JournalLines" jl WHERE ${where.join(' AND ')} GROUP BY jl."accountId"`,
    params,
  });
  return new Map(rows.map(r => [String(r.accountId), fromCents(toCents(num(r.balance)))]));
}

/** Cash held for each property across all bank accounts. */
export async function propertyCash(asOf?: string) {
  const chart = await getChart();
  const banks = chart.all.filter(a => a.subtype === 'Bank').map(b => b.id);
  if (!banks.length) return new Map<string, number>();
  const params: unknown[] = [banks];
  let dateFilter = '';
  if (asOf) {
    params.push(asOf);
    dateFilter = `AND jl."date" <= $2`;
  }
  const { rows } = await zite.sql({
    query: `SELECT jl."propertyId", SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS "cash" FROM "JournalLines" jl WHERE COALESCE(jl."void", false) = false AND jl."accountId" = ANY($1) ${dateFilter} GROUP BY jl."propertyId"`,
    params,
  });
  return new Map(rows.map(r => [String(r.propertyId ?? ''), fromCents(toCents(num(r.cash)))]));
}

/**
 * Rent actually collected for a property in a period — the base for the
 * management fee: payments dated in the period, matched to income charges
 * (never deposits, which are the tenant's money).
 */
export async function collectedIncome(period: string, propertyId?: string) {
  const chart = await getChart();
  const incomeIds = chart.all.filter(a => a.accountType === 'Income').map(a => a.id);
  const params: unknown[] = [periodStart(period), periodEnd(period), incomeIds];
  let prop = '';
  if (propertyId) {
    params.push(propertyId);
    prop = `AND p."propertyId" = $4`;
  }
  const { rows } = await zite.sql({
    query: `
      SELECT p."propertyId", SUM(a."amount") AS "collected"
      FROM "Allocations" a
      JOIN "Transactions" p ON p.id::text = a."paymentId"
      JOIN "Transactions" c ON c.id::text = a."chargeId"
      WHERE COALESCE(a."void", false) = false AND p."status" = 'Posted' AND c."status" = 'Posted'
        AND p."kind" = 'Payment' AND p."date" >= $1 AND p."date" <= $2 AND c."accountId" = ANY($3) ${prop}
      GROUP BY p."propertyId"`,
    params,
  });
  return new Map(rows.map(r => [String(r.propertyId ?? ''), fromCents(toCents(num(r.collected)))]));
}
