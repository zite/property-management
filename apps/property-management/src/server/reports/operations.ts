import { zite } from 'zitejs/db';
import { daysBetween, formatDay } from '@project/shared/dates';
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { bool, day, iso, num, Params, ref, str } from '@project/shared/server/sql';
import type { PillTone, ReportRow } from '../../components/reports/doc';
import { collator, compact, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, periodOf, POSTED_LINES, type ReportScope } from './common';

const OPEN = `('New', 'Scheduled', 'In progress', 'On hold')`;

/**
 * Work orders for a period, grouped by category, property, vendor or priority:
 * how many were opened and completed, how long completion took, what's still
 * open and how old it is, and what the work cost (bills and direct expenses
 * linked to the work order, less what was billed back to residents).
 */
export async function buildWorkOrders(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const tz = scope.settings.timezone || 'UTC';
  const groupBy = ['property', 'vendor', 'priority'].includes(scope.input.groupBy ?? '') ? scope.input.groupBy! : 'category';
  const keySql = groupBy === 'property' ? `COALESCE(w."propertyId", '')` : groupBy === 'vendor' ? `COALESCE(NULLIF(w."vendorId", ''), '__none__')` : groupBy === 'priority' ? `COALESCE(NULLIF(w."priority", ''), 'Normal')` : `COALESCE(NULLIF(w."category", ''), 'General')`;

  const pg = new Params();
  const tzP = pg.add(tz);
  const fromP = pg.add(from);
  const toP = pg.add(to);
  const todayP = pg.add(scope.today);
  const reported = `(COALESCE(w."reportedAt", w.created_at) AT TIME ZONE ${tzP})::date`;
  const completed = `(w."completedAt" AT TIME ZONE ${tzP})::date`;

  const pc = new Params();
  const po = new Params();
  const [grouped, costs, openList] = await Promise.all([
    zite.sql({
      query: `
        SELECT ${keySql} AS key,
          COUNT(*) FILTER (WHERE ${reported} BETWEEN ${fromP}::date AND ${toP}::date) AS opened,
          COUNT(*) FILTER (WHERE w."status" = 'Completed' AND ${completed} BETWEEN ${fromP}::date AND ${toP}::date) AS completed,
          AVG(EXTRACT(EPOCH FROM (w."completedAt" - COALESCE(w."reportedAt", w.created_at))) / 86400.0) FILTER (WHERE w."status" = 'Completed' AND ${completed} BETWEEN ${fromP}::date AND ${toP}::date) AS "avgDays",
          COUNT(*) FILTER (WHERE w."status" IN ${OPEN}) AS "openNow",
          COUNT(*) FILTER (WHERE w."status" IN ${OPEN} AND ${todayP}::date - ${reported} <= 7) AS "age7",
          COUNT(*) FILTER (WHERE w."status" IN ${OPEN} AND ${todayP}::date - ${reported} BETWEEN 8 AND 30) AS "age30",
          COUNT(*) FILTER (WHERE w."status" IN ${OPEN} AND ${todayP}::date - ${reported} > 30) AS "age31"
        FROM "WorkOrders" w
        WHERE true ${inProperties(pg, 'w."propertyId"', scope)}
        GROUP BY 1`,
      params: pg.values,
    }),
    zite.sql({
      query: `
        SELECT ${keySql} AS key,
          SUM(CASE WHEN t."kind" IN ('Bill', 'Expense') THEN t."amount" ELSE 0 END) AS cost,
          SUM(CASE WHEN t."kind" = 'Charge' THEN t."amount" ELSE 0 END) AS recovered
        FROM "Transactions" t JOIN "WorkOrders" w ON w.id::text = t."workOrderId"
        WHERE t."status" = 'Posted' AND t."kind" IN ('Bill', 'Expense', 'Charge') AND t."date" >= ${pc.add(from)}::date AND t."date" <= ${pc.add(to)}::date
          ${inProperties(pc, 'w."propertyId"', scope)}
        GROUP BY 1`,
      params: pc.values,
    }),
    zite.sql({
      query: `
        SELECT w.id, w."number", w."title", w."status", w."priority", w."category", w."propertyId", w."unitId", w."vendorId", w."dueDate", COALESCE(w."reportedAt", w.created_at) AS reported, u."name" AS "unitName"
        FROM "WorkOrders" w LEFT JOIN "Units" u ON u.id::text = w."unitId"
        WHERE w."status" IN ${OPEN} ${inProperties(po, 'w."propertyId"', scope)}
        ORDER BY COALESCE(w."reportedAt", w.created_at) ASC
        LIMIT 300`,
      params: po.values,
    }),
  ]);

  const costBy = new Map(costs.rows.map(r => [String(r.key), { cost: toCents(num(r.cost)), recovered: toCents(num(r.recovered)) }]));
  const labelOf = (k: string) => {
    if (groupBy === 'property') return scope.propertyById.get(k)?.name ?? 'No property';
    if (groupBy === 'vendor') return k === '__none__' ? 'In-house (no vendor)' : '';
    return k;
  };
  const vendorIds = groupBy === 'vendor' ? [...new Set([...grouped.rows.map(r => String(r.key)), ...costBy.keys()])].filter(k => k !== '__none__') : [];
  const vendorNames = new Map<string, string>();
  if (vendorIds.length) {
    const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Vendors" WHERE id::text = ANY($1)`, params: [vendorIds] });
    for (const r of rows) vendorNames.set(String(r.id), str(r.name) ?? 'Vendor');
  }
  const nameOf = (k: string) => (groupBy === 'vendor' && k !== '__none__' ? vendorNames.get(k) ?? 'Former vendor' : labelOf(k));
  const orderIndex = (k: string) => (groupBy === 'priority' ? WORK_ORDER_PRIORITIES.indexOf(k as never) : groupBy === 'category' ? WORK_ORDER_CATEGORIES.indexOf(k as never) : 0);

  type T = { opened: number; completed: number; daysWeighted: number; openNow: number; age7: number; age30: number; age31: number; cost: number; recovered: number };
  const total: T = { opened: 0, completed: 0, daysWeighted: 0, openNow: 0, age7: 0, age30: 0, age31: 0, cost: 0, recovered: 0 };
  const keys = [...new Set([...grouped.rows.map(r => String(r.key)), ...costBy.keys()])];
  const byKey = new Map(grouped.rows.map(r => [String(r.key), r]));
  const rows: ReportRow[] = [];
  for (const k of keys) {
    const r = byKey.get(k) ?? {};
    const c = costBy.get(k) ?? { cost: 0, recovered: 0 };
    const x: T = { opened: num(r.opened), completed: num(r.completed), daysWeighted: num(r.avgDays) * num(r.completed), openNow: num(r.openNow), age7: num(r.age7), age30: num(r.age30), age31: num(r.age31), cost: c.cost, recovered: c.recovered };
    if (!x.opened && !x.completed && !x.openNow && !x.cost && !x.recovered) continue;
    for (const key of Object.keys(total) as Array<keyof T>) total[key] += x[key];
    rows.push({
      id: k || 'none',
      cells: {
        group: nameOf(k),
        opened: x.opened,
        completed: x.completed,
        avgDays: x.completed ? Math.round((x.daysWeighted / x.completed) * 10) / 10 : null,
        openNow: x.openNow,
        age7: x.age7,
        age30: x.age30,
        age31: x.age31,
        cost: fromCents(x.cost),
        recovered: fromCents(x.recovered),
        net: fromCents(x.cost - x.recovered),
      },
      links: compact({ group: groupBy === 'property' ? links.property(k || null) : groupBy === 'vendor' && k !== '__none__' ? links.vendor(k) : undefined }),
      tones: compact({ age31: x.age31 ? ('danger' as const) : undefined }),
    });
  }
  rows.sort((a, b) => orderIndex(a.id) - orderIndex(b.id) || Number(b.cells.opened) - Number(a.cells.opened) || collator.compare(String(a.cells.group), String(b.cells.group)));

  const PRIORITY_TONE: Record<string, PillTone> = { Emergency: 'danger', High: 'warning', Normal: 'neutral', Low: 'neutral' };
  const vendorName = async () => {
    const ids = [...new Set(openList.rows.map(r => ref(r.vendorId)).filter((v): v is string => Boolean(v) && !vendorNames.has(v!)))];
    if (!ids.length) return;
    const { rows: vs } = await zite.sql({ query: `SELECT id, "name" FROM "Vendors" WHERE id::text = ANY($1)`, params: [ids] });
    for (const v of vs) vendorNames.set(String(v.id), str(v.name) ?? 'Vendor');
  };
  await vendorName();

  const avgDays = total.completed ? Math.round((total.daysWeighted / total.completed) * 10) / 10 : null;
  const groupLabel = groupBy === 'property' ? 'Property' : groupBy === 'vendor' ? 'Vendor' : groupBy === 'priority' ? 'Priority' : 'Category';
  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Opened', value: total.opened, kind: 'number' },
      { label: 'Completed', value: total.completed, kind: 'number' },
      { label: 'Days to complete', value: avgDays, kind: 'days', hint: 'Average, reported to completed' },
      { label: 'Open now', value: total.openNow, kind: 'number', hint: total.age31 ? `${total.age31} open over 30 days` : 'None over 30 days', tone: total.age31 ? 'warning' : undefined },
      { label: 'Vendor costs', value: fromCents(total.cost), kind: 'money', hint: total.recovered ? `${scope.money(fromCents(total.recovered))} billed to residents` : undefined },
    ],
    sections: [
      {
        id: 'summary',
        title: `By ${groupLabel.toLowerCase()}`,
        columns: [
          { key: 'group', label: groupLabel, kind: 'text' },
          { key: 'opened', label: 'Opened', kind: 'number', width: 80 },
          { key: 'completed', label: 'Completed', kind: 'number', width: 90 },
          { key: 'avgDays', label: 'Avg days', kind: 'days', width: 84, hideBelow: 'sm' },
          { key: 'openNow', label: 'Open now', kind: 'number', width: 84 },
          { key: 'age7', label: '≤ 7 days', kind: 'number', width: 76, hideBelow: 'lg' },
          { key: 'age30', label: '8–30', kind: 'number', width: 64, hideBelow: 'lg' },
          { key: 'age31', label: '30+', kind: 'number', width: 60, hideBelow: 'md' },
          { key: 'cost', label: 'Cost', kind: 'money', width: 110, hideBelow: 'sm' },
          { key: 'recovered', label: 'Billed back', kind: 'money', width: 110, hideBelow: 'xl' },
          { key: 'net', label: 'Net cost', kind: 'money', width: 110, hideBelow: 'xl' },
        ],
        rows,
        totals: {
          id: 'total',
          kind: 'total',
          cells: { group: 'Total', opened: total.opened, completed: total.completed, avgDays, openNow: total.openNow, age7: total.age7, age30: total.age30, age31: total.age31, cost: fromCents(total.cost), recovered: fromCents(total.recovered), net: fromCents(total.cost - total.recovered) },
        },
        sortable: true,
        empty: 'No work orders were opened or completed in this period.',
      },
      {
        id: 'open',
        title: 'Open work orders, oldest first',
        columns: [
          { key: 'number', label: 'ID', kind: 'text', width: 84 },
          { key: 'title', label: 'Title', kind: 'text' },
          { key: 'unit', label: 'Unit', kind: 'text', width: 180, hideBelow: 'md' },
          { key: 'priority', label: 'Priority', kind: 'text', width: 100, hideBelow: 'sm' },
          { key: 'status', label: 'Status', kind: 'text', width: 100, hideBelow: 'lg' },
          { key: 'vendor', label: 'Vendor', kind: 'text', width: 160, hideBelow: 'xl' },
          { key: 'age', label: 'Age', kind: 'days', width: 70 },
          { key: 'due', label: 'Due', kind: 'date', width: 108, hideBelow: 'lg' },
        ],
        rows: openList.rows.map(w => {
          const reportedDay = day(iso(w.reported));
          const age = reportedDay ? Math.max(0, daysBetween(reportedDay, scope.today)) : null;
          const due = day(w.dueDate);
          const priority = str(w.priority) || 'Normal';
          return {
            id: String(w.id),
            cells: {
              number: workOrderRef(num(w.number)),
              title: str(w.title) || 'Work order',
              unit: [scope.propertyById.get(String(w.propertyId))?.name, str(w.unitName)].filter(Boolean).join(' · '),
              priority,
              status: str(w.status) || 'New',
              vendor: ref(w.vendorId) ? vendorNames.get(String(w.vendorId)) ?? 'Vendor' : 'In-house',
              age,
              due,
            },
            links: compact({ number: links.workOrder(num(w.number)), title: links.workOrder(num(w.number)), vendor: links.vendor(ref(w.vendorId)) }),
            pills: { priority: { label: priority, tone: PRIORITY_TONE[priority] ?? 'neutral' } },
            tones: compact({ age: age != null && age > 30 ? ('danger' as const) : age != null && age > 7 ? ('warning' as const) : undefined, due: due && due < scope.today ? ('danger' as const) : undefined }),
          };
        }),
        sortable: true,
        tall: openList.rows.length > 40,
        empty: 'No open work orders.',
      },
    ],
    notes: [`Opened and completed count by the day reported and completed. Costs are bills and direct expenses linked to a work order and dated ${formatDay(from)} – ${formatDay(to)}; billed back is what was charged to residents for that work.`],
  });
}

/**
 * Vendor spend for a calendar year and 1099-NEC status. Paid means money out of
 * the bank to the vendor — bill payments and direct expenses — split by
 * property on the bank lines. Card payments are reported by the card
 * processor (1099-K), so they're excluded from the reportable amount.
 */
export async function buildVendorSpend(scope: ReportScope) {
  const year = scope.input.year ?? Number(scope.today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const banks = scope.chart.all.filter(a => a.subtype === 'Bank').map(a => a.id);
  const p = new Params();
  const [paid, vendors] = await Promise.all([
    zite.sql({
      query: `
        SELECT t."vendorId",
          SUM(CASE WHEN t."kind" = 'Bill payment' THEN COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0) ELSE 0 END) AS bills,
          SUM(CASE WHEN t."kind" = 'Expense' THEN COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0) ELSE 0 END) AS expenses,
          SUM(CASE WHEN t."paymentMethod" = 'Card' THEN COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0) ELSE 0 END) AS card,
          COUNT(DISTINCT t.id) AS payments,
          MAX(t."date") AS "lastPaid"
        FROM ${POSTED_LINES}
        WHERE ${LINE_IS_POSTED} AND jl."accountId" = ANY(${p.add(banks)}) AND t."kind" IN ('Bill payment', 'Expense') AND COALESCE(t."vendorId", '') <> ''
          AND jl."date" >= ${p.add(from)}::date AND jl."date" <= ${p.add(to)}::date ${inProperties(p, 'jl."propertyId"', scope)}
        GROUP BY t."vendorId"`,
      params: p.values,
    }),
    zite.sql({ query: `SELECT id, "name", "trade", "is1099", "w9OnFile", "taxIdLast4", "address", "email", "contactName", "status" FROM "Vendors" ORDER BY "name" ASC LIMIT 2000`, params: [] }),
  ]);
  const paidBy = new Map(paid.rows.map(r => [String(r.vendorId), { bills: toCents(num(r.bills)), expenses: toCents(num(r.expenses)), card: toCents(num(r.card)), payments: num(r.payments), lastPaid: day(r.lastPaid) }]));
  const THRESHOLD = 60000;

  type V = { id: string; name: string; trade: string; is1099: boolean; w9: boolean; tin: string; address: string; email: string; bills: number; expenses: number; card: number; payments: number; lastPaid: string | null };
  const list: V[] = vendors.rows
    .map(v => {
      const s = paidBy.get(String(v.id));
      return { id: String(v.id), name: str(v.name) ?? 'Vendor', trade: str(v.trade) || 'General', is1099: bool(v.is1099), w9: bool(v.w9OnFile), tin: str(v.taxIdLast4) ?? '', address: str(v.address) ?? '', email: str(v.email) ?? '', bills: s?.bills ?? 0, expenses: s?.expenses ?? 0, card: s?.card ?? 0, payments: s?.payments ?? 0, lastPaid: s?.lastPaid ?? null };
    })
    .filter(v => v.bills || v.expenses)
    .sort((a, b) => b.bills + b.expenses - (a.bills + a.expenses));

  const reportable = (v: V) => v.bills + v.expenses - v.card;
  const needs1099 = list.filter(v => v.is1099 && reportable(v) >= THRESHOLD);
  const missingW9 = needs1099.filter(v => !v.w9);
  const totalPaid = list.reduce((a, v) => a + v.bills + v.expenses, 0);

  const rows: ReportRow[] = list.map(v => {
    const r = reportable(v);
    const required = v.is1099 && r >= THRESHOLD;
    const status: { label: string; tone: PillTone } = !v.is1099 ? { label: 'Not a 1099 vendor', tone: 'neutral' } : required ? (!v.w9 ? { label: 'File 1099 · W-9 missing', tone: 'danger' } : { label: 'File 1099', tone: 'warning' }) : { label: 'Under $600', tone: 'neutral' };
    return {
      id: v.id,
      cells: {
        vendor: v.name,
        trade: v.trade,
        is1099: v.is1099 ? 'Yes' : 'No',
        w9: v.w9 ? 'On file' : v.is1099 ? 'Missing' : null,
        tin: v.tin ? `••${v.tin}` : null,
        payments: v.payments,
        bills: fromCents(v.bills),
        expenses: fromCents(v.expenses),
        total: fromCents(v.bills + v.expenses),
        reportable: v.is1099 ? fromCents(r) : null,
        status: status.label,
      },
      links: { vendor: links.vendor(v.id)! },
      pills: { status, ...(v.is1099 && !v.w9 ? { w9: { label: 'Missing', tone: 'danger' as const } } : {}) },
      tones: compact({ total: required ? ('warning' as const) : undefined, tin: undefined }),
      hints: compact({ tin: v.is1099 && !v.tin ? 'Not recorded' : undefined, reportable: v.card ? `${scope.money(fromCents(v.card))} by card` : undefined }),
    };
  });

  return envelope(scope, {
    subtitle: joinLabel(`Calendar year ${year}${String(year) === scope.today.slice(0, 4) ? ' to date' : ''}`, scope.propertyLabel),
    figures: [
      { label: 'Paid to vendors', value: fromCents(totalPaid), kind: 'money', hint: `${list.length} ${list.length === 1 ? 'vendor' : 'vendors'}` },
      { label: '1099s to file', value: needs1099.length, kind: 'number', hint: '1099 vendors paid $600 or more', tone: needs1099.length ? 'warning' : undefined },
      { label: 'Reportable total', value: fromCents(needs1099.reduce((a, v) => a + reportable(v), 0)), kind: 'money' },
      { label: 'Missing W-9', value: missingW9.length, kind: 'number', tone: missingW9.length ? 'danger' : 'success', hint: missingW9.length ? 'Collect before filing' : 'Ready to file' },
    ],
    checks: needs1099.length ? [{ label: missingW9.length ? 'Some vendors to file for have no W-9' : 'Every vendor to file for has a W-9', ok: !missingW9.length, detail: missingW9.length ? `Collect a W-9 from ${missingW9.map(v => v.name).join(', ')} before filing.` : needs1099.some(v => !v.tin) ? `${needs1099.filter(v => !v.tin).length} of ${needs1099.length} have no tax ID recorded — copy the last four digits from the W-9 to the vendor.` : `${needs1099.length} ${needs1099.length === 1 ? 'form is' : 'forms are'} ready.` }] : [],
    sections: [
      {
        id: 'vendors',
        title: 'Payments by vendor',
        columns: [
          { key: 'vendor', label: 'Vendor', kind: 'text' },
          { key: 'trade', label: 'Trade', kind: 'text', width: 110, hideBelow: 'xl' },
          { key: 'is1099', label: '1099', kind: 'text', width: 60, hideBelow: 'md' },
          { key: 'w9', label: 'W-9', kind: 'text', width: 84, hideBelow: 'lg' },
          { key: 'tin', label: 'Tax ID', kind: 'text', width: 84, hideBelow: 'xl' },
          { key: 'payments', label: 'Payments', kind: 'number', width: 84, hideBelow: 'lg' },
          { key: 'bills', label: 'Bills paid', kind: 'money', width: 116, hideBelow: 'lg' },
          { key: 'expenses', label: 'Direct', kind: 'money', width: 104, hideBelow: 'xl' },
          { key: 'total', label: 'Total paid', kind: 'money', width: 120 },
          { key: 'reportable', label: 'Reportable', kind: 'money', width: 116, hideBelow: 'md' },
          { key: 'status', label: '1099 status', kind: 'text', width: 170, hideBelow: 'sm' },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { vendor: 'Total', payments: list.reduce((a, v) => a + v.payments, 0), bills: fromCents(list.reduce((a, v) => a + v.bills, 0)), expenses: fromCents(list.reduce((a, v) => a + v.expenses, 0)), total: fromCents(totalPaid) } },
        sortable: true,
        empty: `No vendor payments in ${year}.`,
      },
      {
        id: 'filing',
        title: '1099-NEC filing',
        description: 'Vendors marked for 1099 who were paid $600 or more, excluding card payments. Export this table for your filing service.',
        columns: [
          { key: 'vendor', label: 'Recipient', kind: 'text' },
          { key: 'tin', label: 'Tax ID (last 4)', kind: 'text', width: 120 },
          { key: 'address', label: 'Address', kind: 'text', width: 240, hideBelow: 'md' },
          { key: 'email', label: 'Email', kind: 'text', width: 200, hideBelow: 'lg' },
          { key: 'w9', label: 'W-9', kind: 'text', width: 84, hideBelow: 'sm' },
          { key: 'box1', label: 'Box 1 compensation', kind: 'money', width: 150 },
        ],
        rows: needs1099.map(v => ({
          id: `f:${v.id}`,
          cells: { vendor: v.name, tin: v.tin || null, address: v.address || null, email: v.email || null, w9: v.w9 ? 'On file' : 'Missing', box1: fromCents(reportable(v)) },
          links: { vendor: links.vendor(v.id)! },
          pills: v.w9 ? undefined : { w9: { label: 'Missing', tone: 'danger' } },
          hints: compact({ tin: v.tin ? undefined : 'Not recorded' }),
        })),
        totals: needs1099.length ? { id: 'f-total', kind: 'total', cells: { vendor: `${needs1099.length} ${needs1099.length === 1 ? 'form' : 'forms'}`, box1: fromCents(needs1099.reduce((a, v) => a + reportable(v), 0)) } } : null,
        empty: `No 1099 vendor was paid $600 or more in ${year}.`,
      },
    ],
    notes: ['Paid is money out of the bank in the year: bill payments and direct expenses. Mark vendors for 1099 and record their W-9 on the vendor’s page.'],
  });
}
