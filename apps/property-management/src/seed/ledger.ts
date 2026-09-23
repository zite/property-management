import { addDays, addPeriods, daysInMonth, dueDateIn, periodEnd, periodLabel, periodOf, periodStart, prorateToMonthEnd } from '@project/shared/dates';
import type { Chart, SystemKey } from '@project/shared/server/accounts';
import type { LineInput, TxnInput } from '@project/shared/server/ledger';
import { fromCents, percentOf, toCents } from '@project/shared/money';
import { PROPERTIES, VENDORS, prng, type LeasePlan, type WorkOrderPlan } from './model';

/**
 * Eight months of books for the demo portfolio, simulated day by day.
 *
 * Each lease has a payment habit (autopay, on time, late, partial, delinquent)
 * that drives when and how much its tenants pay; charges, late fees,
 * move-out deposit settlements and FIFO allocations follow the same rules the
 * real engine applies. Bills, management fees and owner distributions are then
 * computed from the simulated cash, so every number on an owner statement adds up.
 */

export type SeedTxn = TxnInput & { key: string };
export type SeedAllocation = { paymentKey: string; chargeKey: string; amount: number; date: string };

type Ids = {
  leaseId: Map<number, string>;
  primaryTenant: Map<number, string>;
  unit: Map<string, { id: string; propertyId: string }>;
  property: Map<string, { id: string; ownerId: string; reserve: number; feePct: number; distributionMethod: string }>;
  vendor: Map<string, string>;
  recurring: Map<string, string>; // `${leaseId}|${description}`
  workOrder: Map<number, { id: string; propertyId: string; unitId: string | null }>;
};

const ORDER: Record<string, number> = {
  'Journal entry': 0, Charge: 1, Bill: 2, Payment: 3, Credit: 4, 'Deposit application': 5, Refund: 6, 'Bill payment': 7, 'Management fee': 8, 'Owner distribution': 9,
};

export function simulateLedger(today: string, chart: Chart, plans: LeasePlan[], workOrders: WorkOrderPlan[], ids: Ids) {
  const rand = prng(1301);
  const M0 = periodOf(today);
  const windowStart = periodStart(addPeriods(M0, -7));
  const openingDate = addDays(windowStart, -1);
  const acct = (k: SystemKey) => chart.key(k).id;
  const AR = acct('accounts_receivable');
  const BANK = acct('operating_bank');
  const DEP = acct('deposits_held');
  const RENT = acct('rent_income');
  const LATE = acct('late_fee_income');
  const incomeIds = new Set(chart.all.filter(a => a.accountType === 'Income').map(a => a.id));
  const txns: SeedTxn[] = [];
  const allocations: SeedAllocation[] = [];
  let seq = 0;
  const key = (prefix: string) => `${prefix}:${++seq}`;
  const push = (t: Omit<SeedTxn, 'key'>, prefix = 't') => {
    const k = key(prefix);
    txns.push({ ...t, key: k });
    return k;
  };
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const methods = ['ACH', 'Online', 'Online', 'Check'] as const;

  // ── Opening balances: owner cash and deposits held from before the window ──
  const openingDeposits = new Map<string, Array<{ leaseId: string; unitId: string; amount: number }>>();
  for (const p of plans) {
    if (p.status === 'Pending signature' || p.start >= windowStart) continue;
    const unit = ids.unit.get(p.unit)!;
    const list = openingDeposits.get(unit.propertyId) ?? [];
    list.push({ leaseId: ids.leaseId.get(p.number)!, unitId: unit.id, amount: p.deposit });
    openingDeposits.set(unit.propertyId, list);
  }
  for (const def of PROPERTIES) {
    const prop = ids.property.get(def.code)!;
    const deps = openingDeposits.get(prop.id) ?? [];
    const cash = prop.reserve + 2500;
    const depTotal = fromCents(deps.reduce((a, d) => a + toCents(d.amount), 0));
    const lines: LineInput[] = [
      { accountId: BANK, debit: fromCents(toCents(cash) + toCents(depTotal)) },
      { accountId: acct('owner_equity'), credit: cash, ownerId: prop.ownerId },
      ...deps.map(d => ({ accountId: DEP, credit: d.amount, leaseId: d.leaseId, unitId: d.unitId, memo: 'Security deposit held (opening balance)' })),
    ];
    push({ kind: 'Journal entry', date: openingDate, amount: fromCents(toCents(cash) + toCents(depTotal)), description: `Opening balances — ${def.name}`, propertyId: prop.id, ownerId: prop.ownerId, source: 'Import', lines });
  }

  // ── Leases, day by day ─────────────────────────────────────────────────
  for (const p of plans) {
    if (p.status === 'Pending signature') continue;
    const leaseId = ids.leaseId.get(p.number)!;
    const unit = ids.unit.get(p.unit)!;
    const tenantId = ids.primaryTenant.get(p.number) ?? null;
    const base = { propertyId: unit.propertyId, unitId: unit.id, leaseId, tenantId };
    type Open = { key: string; open: number; due: string; late: boolean; seq: number; accountId: string };
    const charges: Open[] = [];
    const credits: Array<{ key: string; open: number; date: string }> = [];
    let depositHeld = p.start < windowStart ? p.deposit : 0;

    const apply = () => {
      const ordered = charges.filter(c => c.open > 0).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) || Number(a.late) - Number(b.late) || a.seq - b.seq);
      for (const cr of credits) {
        let left = toCents(cr.open);
        for (const ch of ordered) {
          if (left <= 0) break;
          const chCents = toCents(ch.open);
          if (chCents <= 0) continue;
          const take = Math.min(left, chCents);
          allocations.push({ paymentKey: cr.key, chargeKey: ch.key, amount: fromCents(take), date: cr.date > ch.due ? cr.date : ch.due });
          ch.open = fromCents(chCents - take);
          left -= take;
        }
        cr.open = fromCents(left);
      }
    };
    const balance = () => fromCents(charges.reduce((a, c) => a + toCents(c.open), 0) - credits.reduce((a, c) => a + toCents(c.open), 0));
    const charge = (date: string, due: string, amount: number, accountId: string, description: string, extra: Partial<TxnInput> = {}) => {
      const k = push({ ...base, kind: 'Charge', date, dueDate: due, amount, description, accountId, lines: [{ accountId: AR, debit: amount }, { accountId, credit: amount }], ...extra });
      charges.push({ key: k, open: amount, due, late: accountId === LATE, seq, accountId });
      apply();
      return k;
    };
    const pay = (date: string, amount: number, method: string, reference?: string) => {
      if (!(toCents(amount) > 0)) return;
      const k = push({ ...base, kind: 'Payment', date, amount, description: method === 'Online' ? 'Online payment' : `Payment · ${method}`, accountId: AR, bankAccountId: BANK, paymentMethod: method as never, reference: reference ?? null, source: method === 'Online' ? 'Online payment' : 'Manual', lines: [{ accountId: BANK, debit: amount }, { accountId: AR, credit: amount }] });
      credits.push({ key: k, open: amount, date });
      apply();
    };

    const start = p.start;
    const first = start < windowStart ? windowStart : start;
    const lastDay = p.moveOut ? (addDays(p.moveOut, 14) < today ? addDays(p.moveOut, 14) : today) : today;
    const rentRc = ids.recurring.get(`${leaseId}|Rent`) ?? null;

    // Pending payments for the period, decided when rent posts.
    let plan: Array<{ date: string; amount: 'balance' | 'rent' | number; method: string; ref?: string }> = [];

    for (let d = first; d <= lastDay; d = addDays(d, 1)) {
      const P = periodOf(d);
      const dayOfMonth = Number(d.slice(8, 10));
      const occupied = d >= start && (!p.moveOut || d <= p.moveOut);

      if (d === start && start >= windowStart && p.deposit > 0) {
        charge(d, d, p.deposit, DEP, 'Security deposit', { source: 'System' });
        depositHeld += p.deposit;
        pay(d, p.deposit, 'Check', String(between(1100, 4800)));
      }

      const due = dueDateIn(P, 1);
      const isPeriodStart = occupied && (d === due || (d === start && Number(start.slice(8, 10)) !== 1));
      if (isPeriodStart) {
        const prorated = d === start && Number(start.slice(8, 10)) !== 1;
        const rent = prorated ? prorateToMonthEnd(p.rent, start) : p.rent;
        charge(d, d, rent, RENT, prorated ? `Prorated rent (${start.slice(8, 10)}–end of month)` : `Rent — ${periodLabel(P)}`, prorated ? { source: 'System', period: P } : { source: 'Recurring', period: P, recurringChargeId: rentRc });
        if (!prorated) {
          for (const x of p.extras) {
            charge(d, d, x.amount, acct(x.key), `${x.description} — ${periodLabel(P)}`, { source: 'Recurring', period: P, recurringChargeId: ids.recurring.get(`${leaseId}|${x.description}`) ?? null });
          }
        }
        const monthIndex = Number(P.slice(5, 7));
        const method = methods[between(0, methods.length - 1)];
        const isLastMonth = p.moveOut && periodOf(p.moveOut) === P;
        plan = [];
        switch (p.behavior) {
          case 'autopay':
            plan.push({ date: d, amount: 'balance', method: 'Online', ref: 'Autopay' });
            break;
          case 'ontime':
            if (p.isActor && P === M0) plan.push({ date: addDays(d, 0), amount: 'rent', method: 'Online' });
            else plan.push({ date: addDays(d, prorated ? 0 : between(0, 3)), amount: 'balance', method });
            break;
          case 'late':
            plan.push({ date: addDays(d, between(7, 12)), amount: 'balance', method });
            break;
          case 'partial':
            if (isLastMonth) plan.push({ date: addDays(d, 3), amount: fromCents(Math.round(toCents(p.rent) * 0.8)), method });
            else if (monthIndex % 2 === 1) plan.push({ date: addDays(d, between(2, 4)), amount: fromCents(Math.round(toCents(p.rent) * 0.72)), method });
            else plan.push({ date: addDays(d, between(3, 5)), amount: fromCents(toCents(p.rent) + 25000), method });
            break;
          case 'delinquent': {
            const monthsBack = (Number(M0.slice(0, 4)) * 12 + Number(M0.slice(5, 7))) - (Number(P.slice(0, 4)) * 12 + Number(P.slice(5, 7)));
            if (monthsBack >= 3) plan.push({ date: addDays(d, between(1, 4)), amount: 'balance', method });
            else if (monthsBack === 2) plan.push({ date: addDays(d, 9), amount: fromCents(Math.round(toCents(p.rent) * 0.6)), method: 'Money order' });
            else if (monthsBack === 1) plan.push({ date: addDays(d, 19), amount: 2200, method: 'Money order' });
            break;
          }
        }
      }

      // Late fee on the day after the grace period, if rent for the period is still open.
      if (occupied && dayOfMonth === 7) {
        const openRent = charges.some(c => c.accountId === RENT && c.due.slice(0, 7) === P && c.open > 0);
        if (openRent && !charges.some(c => c.late && c.due.slice(0, 7) === P)) {
          charge(d, d, 75, LATE, `Late fee — ${periodLabel(P)} rent`, { source: 'Late fee', period: P });
        }
      }

      for (const item of plan.filter(x => x.date === d)) {
        const amount = item.amount === 'balance' ? balance() : item.amount === 'rent' ? p.rent : Math.min(item.amount, Math.max(balance(), 0));
        pay(d, amount, item.method, item.method === 'Check' ? String(between(1100, 4800)) : item.ref);
      }

      // Move-out: deductions, then deposit against the balance, then refund what's left.
      if (p.moveOut && p.status === 'Ended') {
        if (d === p.moveOut) {
          for (const x of p.deductions ?? []) charge(d, d, x.amount, acct('damage_income'), x.description, { source: 'Move-out' });
        }
        if (p.depositSettled && d === addDays(p.moveOut, 10)) {
          const owed = Math.max(0, balance());
          const applied = Math.min(owed, depositHeld);
          if (applied > 0) {
            const k = push({ ...base, kind: 'Deposit application', date: d, amount: applied, description: 'Security deposit applied to balance', accountId: DEP, source: 'Move-out', lines: [{ accountId: DEP, debit: applied }, { accountId: AR, credit: applied }] });
            credits.push({ key: k, open: applied, date: d });
            depositHeld = fromCents(toCents(depositHeld) - toCents(applied));
            apply();
          }
        }
        if (p.depositSettled && d === addDays(p.moveOut, 14) && depositHeld > 0) {
          push({ ...base, kind: 'Refund', date: d, amount: depositHeld, description: 'Security deposit refund', accountId: DEP, bankAccountId: BANK, paymentMethod: 'Check', reference: String(between(5100, 5900)), source: 'Move-out', lines: [{ accountId: DEP, debit: depositHeld }, { accountId: BANK, credit: depositHeld }] });
          depositHeld = 0;
        }
      }
    }
  }

  // ── Bills: utilities, services, insurance, taxes and work orders ────────
  const vendorAccount = new Map<string, string>(VENDORS.map(v => [v.name, acct(v.account as SystemKey)]));
  const vendorTerms = new Map<string, number>(VENDORS.map(v => [v.name, v.terms]));
  type BillEvent = { key: string; propertyId: string; amount: number; date: string; due: string; paid: boolean; vendor: string };
  const bills: BillEvent[] = [];
  const bill = (code: string, vendor: string, date: string, amount: number, description: string, opts: { unitId?: string | null; workOrderId?: string | null; accountId?: string; paid?: boolean; dueDays?: number; reference?: string } = {}) => {
    if (date > today || date <= openingDate) return;
    const prop = ids.property.get(code)!;
    const accountId = opts.accountId ?? vendorAccount.get(vendor)!;
    const due = addDays(date, opts.dueDays ?? vendorTerms.get(vendor) ?? 30);
    const vendorId = ids.vendor.get(vendor)!;
    const k = push({ kind: 'Bill', date, dueDate: due, amount, description, propertyId: prop.id, unitId: opts.unitId ?? null, vendorId, workOrderId: opts.workOrderId ?? null, accountId, reference: opts.reference ?? `INV-${between(10000, 99999)}`, lines: [{ accountId, debit: amount, vendorId }, { accountId: acct('accounts_payable'), credit: amount, vendorId }] });
    bills.push({ key: k, propertyId: prop.id, amount, date, due, paid: opts.paid ?? true, vendor });
  };
  const money = (base: number, spread: number) => fromCents(toCents(base) + Math.round((rand() - 0.5) * spread * 100));
  const periods = Array.from({ length: 8 }, (_, i) => addPeriods(M0, i - 7));
  const PROFILE: Record<string, { water: number; trash: number; landscaping: number; insurance: number; tax: number; hoa?: number }> = {
    ALD: { water: 820, trash: 240, landscaping: 325, insurance: 1420, tax: 6400 },
    JUN: { water: 430, trash: 180, landscaping: 280, insurance: 1050, tax: 4200 },
    LRK: { water: 360, trash: 160, landscaping: 0, insurance: 1180, tax: 5300 },
    SAB: { water: 140, trash: 0, landscaping: 0, insurance: 390, tax: 1450 },
    ELM: { water: 0, trash: 0, landscaping: 0, insurance: 310, tax: 1650 },
    CTW: { water: 0, trash: 0, landscaping: 0, insurance: 340, tax: 1850, hoa: 95 },
  };
  for (const P of periods) {
    const month = Number(P.slice(5, 7));
    for (const [code, prof] of Object.entries(PROFILE)) {
      const day = (n: number) => `${P}-${String(Math.min(n, daysInMonth(Number(P.slice(0, 4)), month))).padStart(2, '0')}`;
      if (prof.water) bill(code, 'Clearwater Utilities', day(6), money(prof.water, prof.water * 0.14), `Water & sewer — ${periodLabel(addPeriods(P, -1))}`);
      if (prof.trash) bill(code, 'Front Range Waste Services', day(2), prof.trash, `Trash & recycling — ${periodLabel(P)}`);
      if (prof.landscaping && month >= 4 && month <= 10) bill(code, 'Evergreen Grounds Co.', day(28), prof.landscaping, `Grounds maintenance — ${periodLabel(P)}`, { paid: !(code === 'JUN' && P === addPeriods(M0, -1)) });
      if (prof.hoa) bill(code, 'Cottonwood Hills HOA', day(1), prof.hoa, `HOA dues — ${periodLabel(P)}`, { dueDays: 9 });
      if (month % 3 === 1) bill(code, 'Granite Mutual Insurance', day(15), prof.insurance, `Property insurance — quarterly premium`, { dueDays: 30 });
      if (month === 2 || month === 6) bill(code, 'County Treasurer', day(20), prof.tax / 2, `Property tax — ${month === 2 ? 'first' : 'second'} half`, { dueDays: month === 2 ? 8 : 15 });
    }
  }
  for (const w of workOrders) {
    if (w.status !== 'Completed' || !w.vendor || !(w.cost && w.cost > 0) || w.completedDaysAgo == null) continue;
    const info = ids.workOrder.get(w.number)!;
    const code = w.unit.split('-')[0];
    bill(code, w.vendor, addDays(today, -w.completedDaysAgo), w.cost, w.title, { unitId: info.unitId, workOrderId: info.id, accountId: w.category === 'Turnover' || w.category === 'Painting' ? acct('turnover') : w.category === 'Pest control' ? acct('pest_control') : w.category === 'Landscaping' ? acct('landscaping') : acct('repairs'), paid: w.billPaid !== false });
  }
  let check = 5000;
  for (const b of bills) {
    const payOn = addDays(b.due, -3) < b.date ? b.date : addDays(b.due, -3);
    if (!b.paid || payOn > today) continue;
    const vendorId = ids.vendor.get(b.vendor)!;
    const method = b.vendor === 'Clearwater Utilities' || b.vendor === 'Front Range Waste Services' || b.vendor === 'Granite Mutual Insurance' ? 'ACH' : 'Check';
    const k = push({ kind: 'Bill payment', date: payOn, amount: b.amount, description: `Payment to ${b.vendor}`, propertyId: b.propertyId, vendorId, accountId: acct('accounts_payable'), bankAccountId: BANK, paymentMethod: method, reference: method === 'Check' ? String(++check) : null, lines: [{ accountId: acct('accounts_payable'), debit: b.amount, vendorId }, { accountId: BANK, credit: b.amount, vendorId }] });
    allocations.push({ paymentKey: k, chargeKey: b.key, amount: b.amount, date: payOn });
  }

  // ── Management fees on collected income, then owner distributions ───────
  const byKey = new Map(txns.map(t => [t.key, t]));
  const collected = new Map<string, number>(); // `${propertyId}|${period}` in cents
  for (const a of allocations) {
    const pmt = byKey.get(a.paymentKey)!;
    const chg = byKey.get(a.chargeKey)!;
    if (pmt.kind !== 'Payment' || !incomeIds.has(chg.accountId ?? '')) continue;
    const k = `${pmt.propertyId}|${periodOf(pmt.date)}`;
    collected.set(k, (collected.get(k) ?? 0) + toCents(a.amount));
  }
  for (const def of PROPERTIES) {
    const prop = ids.property.get(def.code)!;
    for (const P of periods.slice(0, -1)) {
      const date = `${addPeriods(P, 1)}-03`;
      if (date > today) continue;
      const base = fromCents(collected.get(`${prop.id}|${P}`) ?? 0);
      const fee = percentOf(base, prop.feePct);
      if (!(fee > 0)) continue;
      push({ kind: 'Management fee', date, amount: fee, description: `Management fee — ${periodLabel(P)} (${prop.feePct}% of collected income)`, propertyId: prop.id, ownerId: prop.ownerId, accountId: acct('management_fees'), bankAccountId: BANK, period: P, source: 'System', lines: [{ accountId: acct('management_fees'), debit: fee }, { accountId: BANK, credit: fee }] });
    }
  }
  for (const def of PROPERTIES) {
    const prop = ids.property.get(def.code)!;
    for (const P of periods.slice(0, -1)) {
      const date = `${addPeriods(P, 1)}-10`;
      if (date > today) continue;
      let cash = 0;
      let deposits = 0;
      for (const t of txns) {
        if (t.date > date) continue;
        for (const l of t.lines) {
          const lp = l.propertyId ?? t.propertyId;
          if (lp !== prop.id) continue;
          if (l.accountId === BANK) cash += toCents(l.debit ?? 0) - toCents(l.credit ?? 0);
          if (l.accountId === DEP) deposits += toCents(l.credit ?? 0) - toCents(l.debit ?? 0);
        }
      }
      const openBills = bills.filter(b => b.propertyId === prop.id && b.date <= date).reduce((a, b) => {
        const paid = allocations.filter(x => x.chargeKey === b.key && x.date <= date).reduce((s, x) => s + toCents(x.amount), 0);
        return a + toCents(b.amount) - paid;
      }, 0);
      const available = cash - deposits - toCents(prop.reserve) - openBills;
      const amount = Math.floor(available / 10000) * 100;
      if (amount < 100) continue;
      push({ kind: 'Owner distribution', date, amount, description: `Owner distribution — ${periodLabel(P)}`, propertyId: prop.id, ownerId: prop.ownerId, accountId: acct('owner_distributions'), bankAccountId: BANK, paymentMethod: prop.distributionMethod === 'Check' ? 'Check' : 'ACH', reference: prop.distributionMethod === 'Check' ? String(++check) : null, source: 'Manual', lines: [{ accountId: acct('owner_distributions'), debit: amount, ownerId: prop.ownerId }, { accountId: BANK, credit: amount, ownerId: prop.ownerId }] });
    }
  }

  // Chronological numbering: the ledger reads in the order things happened.
  const sorted = txns.map((t, i) => ({ t, i })).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0) || (ORDER[a.t.kind] ?? 9) - (ORDER[b.t.kind] ?? 9) || a.i - b.i).map(x => x.t);
  return { txns: sorted, allocations, windowStart, periodEnd: periodEnd(M0) };
}
