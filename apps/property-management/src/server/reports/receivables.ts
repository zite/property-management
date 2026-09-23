import { zite } from 'zitejs/db';
import { leasePhase } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { day, num, Params, ref, str } from '@project/shared/server/sql';
import { pct, type ReportRow } from '../../components/reports/doc';
import { asOfOf, collator, compact, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, periodOf, POSTED_LINES, residentsSql, type ReportScope } from './common';

/** Security deposits held by lease as of a date, against what each lease requires. */
export async function buildDeposits(scope: ReportScope) {
  const { asOf, label } = asOfOf(scope);
  const depositIds = scope.chart.all.filter(a => a.subtype === 'Deposits held').map(a => a.id);
  const p = new Params();
  const held = await zite.sql({
    query: `
      SELECT COALESCE(jl."leaseId", '') AS "leaseId", COALESCE(jl."propertyId", '') AS "propertyId", SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS held
      FROM ${POSTED_LINES}
      WHERE ${LINE_IS_POSTED} AND jl."accountId" = ANY(${p.add(depositIds)}) AND jl."date" <= ${p.add(asOf)}::date ${inProperties(p, 'jl."propertyId"', scope)}
      GROUP BY 1, 2
      LIMIT 2000`,
    params: p.values,
  });
  const heldBy = new Map<string, number>();
  const unassigned = new Map<string, number>();
  for (const r of held.rows) {
    const cents = toCents(num(r.held));
    if (!cents) continue;
    const lid = String(r.leaseId);
    if (lid) heldBy.set(lid, (heldBy.get(lid) ?? 0) + cents);
    else unassigned.set(String(r.propertyId), (unassigned.get(String(r.propertyId)) ?? 0) + cents);
  }

  const lp = new Params();
  const ids = lp.add([...heldBy.keys()]);
  const asOfP = lp.add(asOf);
  const leases = await zite.sql({
    query: `
      SELECT l.id, l."name", l."number", l."status", l."leaseType", l."startDate", l."endDate", l."noticeGivenOn", l."moveOutDate", l."propertyId", l."unitId", l."deposit", l."depositSettledAt",
        u."name" AS "unitName", ${residentsSql('l')} AS residents
      FROM "Leases" l LEFT JOIN "Units" u ON u.id::text = l."unitId"
      WHERE (l.id::text = ANY(${ids}) OR (l."status" = 'Active' AND COALESCE(l."deposit", 0) > 0 AND l."startDate" <= ${asOfP}::date))
        ${inProperties(lp, 'l."propertyId"', scope)}
      LIMIT 2000`,
    params: lp.values,
  });

  type Acc = { required: number; held: number; count: number };
  const groups = new Map<string, { acc: Acc; rows: ReportRow[] }>();
  const grand: Acc = { required: 0, held: 0, count: 0 };
  let short = 0;
  let toSettle = 0;
  const sorted = [...leases.rows].sort((a, b) => collator.compare(scope.propertyById.get(String(a.propertyId))?.name ?? '', scope.propertyById.get(String(b.propertyId))?.name ?? '') || collator.compare(str(a.unitName) ?? '', str(b.unitName) ?? ''));
  for (const l of sorted) {
    const pid = String(l.propertyId);
    const lid = String(l.id);
    const h = heldBy.get(lid) ?? 0;
    const status = String(l.status);
    const required = status === 'Active' ? toCents(num(l.deposit)) : 0;
    const phase = leasePhase({ status, leaseType: str(l.leaseType), startDate: day(l.startDate), endDate: day(l.endDate), noticeGivenOn: day(l.noticeGivenOn), moveOutDate: day(l.moveOutDate) }, scope.today);
    const diff = h - required;
    if (status === 'Active' && diff < 0) short += 1;
    const settle = status !== 'Active' && h > 0;
    if (settle) toSettle += 1;
    if (!groups.has(pid)) groups.set(pid, { acc: { required: 0, held: 0, count: 0 }, rows: [] });
    const g = groups.get(pid)!;
    for (const acc of [g.acc, grand]) {
      acc.required += required;
      acc.held += h;
      acc.count += 1;
    }
    g.rows.push({
      id: lid,
      depth: 1,
      cells: { residents: str(l.residents) || str(l.name) || 'Lease', unit: str(l.unitName) ?? '', phase, start: day(l.startDate), required: status === 'Active' ? fromCents(required) : null, held: fromCents(h), difference: status === 'Active' ? fromCents(diff) : null },
      links: compact({ residents: links.ledger(lid), unit: links.unit(ref(l.unitId)) }),
      pills: { phase: settle ? { label: 'Needs settlement', tone: 'warning' } : { label: phase, tone: phase === 'Notice' ? 'warning' : phase === 'Current' ? 'success' : phase === 'Ended' ? 'neutral' : 'info' } },
      tones: compact({ difference: status === 'Active' && diff < 0 ? ('danger' as const) : undefined }),
      hints: compact({ phase: settle && l.moveOutDate ? `Moved out` : undefined }),
    });
  }
  for (const [pid, cents] of unassigned) {
    if (!groups.has(pid)) groups.set(pid, { acc: { required: 0, held: 0, count: 0 }, rows: [] });
    const g = groups.get(pid)!;
    g.acc.held += cents;
    grand.held += cents;
    g.rows.push({ id: `unassigned:${pid}`, depth: 1, cells: { residents: 'Not assigned to a lease', held: fromCents(cents) }, tones: { residents: 'warning' } });
  }

  const rows: ReportRow[] = [];
  const ordered = [...groups.entries()].sort((a, b) => collator.compare(scope.propertyById.get(a[0])?.name ?? '', scope.propertyById.get(b[0])?.name ?? ''));
  for (const [pid, g] of ordered) {
    const name = scope.propertyById.get(pid)?.name ?? 'No property';
    rows.push({ id: `p:${pid}`, kind: 'group', cells: { residents: name }, links: compact({ residents: links.property(pid) }) });
    rows.push(...g.rows);
    if (ordered.length > 1) rows.push({ id: `s:${pid}`, kind: 'subtotal', cells: { residents: `Total ${name}`, required: fromCents(g.acc.required), held: fromCents(g.acc.held), difference: fromCents(g.acc.held - g.acc.required) } });
  }

  // The same figure straight from the balance sheet account, as a tie-out.
  const bp = new Params();
  const account = await zite.sql({
    query: `SELECT SUM(COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0)) AS held FROM ${POSTED_LINES} WHERE ${LINE_IS_POSTED} AND jl."accountId" = ANY(${bp.add(depositIds)}) AND jl."date" <= ${bp.add(asOf)}::date ${inProperties(bp, 'jl."propertyId"', scope)}`,
    params: bp.values,
  });
  const accountHeld = toCents(num(account.rows[0]?.held));

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Deposits held', value: fromCents(grand.held), kind: 'money' },
      { label: 'Required by active leases', value: fromCents(grand.required), kind: 'money' },
      { label: 'Leases short', value: short, kind: 'number', tone: short ? 'warning' : undefined, hint: 'Hold less than the lease requires' },
      { label: 'Former residents to settle', value: toSettle, kind: 'number', tone: toSettle ? 'warning' : undefined, hint: 'Ended leases still holding a deposit' },
    ],
    checks: [
      {
        label: accountHeld === grand.held ? 'Ties to the balance sheet' : 'Doesn’t tie to the balance sheet',
        ok: accountHeld === grand.held,
        detail: accountHeld === grand.held ? `Security Deposits Held is ${scope.money(fromCents(accountHeld))} on the same date.` : `Security Deposits Held is ${scope.money(fromCents(accountHeld))}, a difference of ${scope.money(fromCents(accountHeld - grand.held))}.`,
      },
    ],
    sections: [
      {
        id: 'deposits',
        columns: [
          { key: 'residents', label: 'Residents', kind: 'text' },
          { key: 'unit', label: 'Unit', kind: 'text', width: 110, hideBelow: 'sm' },
          { key: 'phase', label: 'Lease', kind: 'text', width: 150, hideBelow: 'md' },
          { key: 'start', label: 'Move-in', kind: 'date', width: 110, hideBelow: 'lg' },
          { key: 'required', label: 'Required', kind: 'money', width: 116, hideBelow: 'sm' },
          { key: 'held', label: 'Held', kind: 'money', width: 116 },
          { key: 'difference', label: 'Over / short', kind: 'money', width: 116, hideBelow: 'md' },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { residents: `Total · ${grand.count} ${grand.count === 1 ? 'lease' : 'leases'}`, required: fromCents(grand.required), held: fromCents(grand.held), difference: fromCents(grand.held - grand.required) } },
        empty: 'No deposits are held on this date.',
      },
    ],
    notes: ['Held is the Security Deposits Held balance for each lease through the date. Required is the deposit on the lease, for active leases.'],
  });
}

/** Payments received in a period: by method, by property, and every payment. */
export async function buildPayments(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const where = (p: Params) => `t."kind" = 'Payment' AND t."status" = 'Posted' AND t."date" >= ${p.add(from)}::date AND t."date" <= ${p.add(to)}::date ${inProperties(p, 't."propertyId"', scope)}`;
  const pm = new Params();
  const pp = new Params();
  const pl = new Params();
  const [byMethod, byProperty, list] = await Promise.all([
    zite.sql({ query: `SELECT COALESCE(NULLIF(t."paymentMethod", ''), 'Other') AS method, COUNT(*) AS n, SUM(t."amount") AS amount FROM "Transactions" t WHERE ${where(pm)} GROUP BY 1`, params: pm.values }),
    zite.sql({ query: `SELECT t."propertyId", COUNT(*) AS n, SUM(t."amount") AS amount FROM "Transactions" t WHERE ${where(pp)} GROUP BY 1`, params: pp.values }),
    zite.sql({
      query: `
        SELECT t.id, t."number", t."date", t."amount", t."paymentMethod", t."reference", t."source", t."leaseId", t."propertyId", t."unitId",
          u."name" AS "unitName", COALESCE(NULLIF(tn."name", ''), l."name") AS payer
        FROM "Transactions" t
        LEFT JOIN "Units" u ON u.id::text = t."unitId"
        LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
        LEFT JOIN "Leases" l ON l.id::text = t."leaseId"
        WHERE ${where(pl)}
        ORDER BY t."date" DESC, t."number" DESC
        LIMIT 1001`,
      params: pl.values,
    }),
  ]);
  const total = byMethod.rows.reduce((a, r) => a + toCents(num(r.amount)), 0);
  const count = byMethod.rows.reduce((a, r) => a + num(r.n), 0);
  const online = byMethod.rows.filter(r => r.method === 'Online' || r.method === 'ACH' || r.method === 'Card').reduce((a, r) => a + toCents(num(r.amount)), 0);
  const truncated = list.rows.length > 1000;

  const summaryRows = (rows: Array<Record<string, unknown>>, labelOf: (r: Record<string, unknown>) => string, link?: (r: Record<string, unknown>) => string | undefined): ReportRow[] =>
    rows
      .map(r => ({ r, cents: toCents(num(r.amount)) }))
      .sort((a, b) => b.cents - a.cents)
      .map(({ r, cents }) => ({ id: labelOf(r), cells: { label: labelOf(r), count: num(r.n), amount: fromCents(cents), share: pct(cents, total) }, links: link ? compact({ label: link(r) }) : undefined }));

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Received', value: fromCents(total), kind: 'money' },
      { label: 'Payments', value: count, kind: 'number' },
      { label: 'Average payment', value: count ? fromCents(Math.round(total / count)) : null, kind: 'money' },
      { label: 'Paid electronically', value: pct(online, total), kind: 'percent', hint: 'Online, ACH and card' },
    ],
    sections: [
      {
        id: 'by-method',
        title: 'By method',
        columns: [
          { key: 'label', label: 'Method', kind: 'text' },
          { key: 'count', label: 'Payments', kind: 'number', width: 100 },
          { key: 'amount', label: 'Amount', kind: 'money', width: 140 },
          { key: 'share', label: 'Share', kind: 'percent', width: 90 },
        ],
        rows: summaryRows(byMethod.rows, r => String(r.method)),
        totals: { id: 'm-total', kind: 'total', cells: { label: 'Total', count, amount: fromCents(total), share: total ? 100 : null } },
        empty: 'No payments in this period.',
      },
      {
        id: 'by-property',
        title: 'By property',
        columns: [
          { key: 'label', label: 'Property', kind: 'text' },
          { key: 'count', label: 'Payments', kind: 'number', width: 100 },
          { key: 'amount', label: 'Amount', kind: 'money', width: 140 },
          { key: 'share', label: 'Share', kind: 'percent', width: 90 },
        ],
        rows: summaryRows(byProperty.rows, r => scope.propertyById.get(String(r.propertyId))?.name ?? 'No property', r => links.property(ref(r.propertyId))),
        totals: { id: 'p-total', kind: 'total', cells: { label: 'Total', count, amount: fromCents(total), share: total ? 100 : null } },
        empty: 'No payments in this period.',
      },
      {
        id: 'payments',
        title: 'Payments',
        description: truncated ? 'The 1,000 most recent payments. Narrow the period to see the rest.' : undefined,
        columns: [
          { key: 'date', label: 'Date', kind: 'date', width: 108 },
          { key: 'number', label: 'Receipt', kind: 'text', width: 80, hideBelow: 'lg' },
          { key: 'payer', label: 'Paid by', kind: 'text' },
          { key: 'unit', label: 'Unit', kind: 'text', width: 190, hideBelow: 'md' },
          { key: 'method', label: 'Method', kind: 'text', width: 96, hideBelow: 'sm' },
          { key: 'reference', label: 'Reference', kind: 'text', width: 120, hideBelow: 'xl' },
          { key: 'amount', label: 'Amount', kind: 'money', width: 120 },
        ],
        rows: list.rows.slice(0, 1000).map(r => {
          const pid = ref(r.propertyId);
          return {
            id: String(r.id),
            cells: {
              date: day(r.date),
              number: `#${num(r.number)}`,
              payer: str(r.payer) || 'Unknown payer',
              unit: [pid ? scope.propertyById.get(pid)?.name : '', str(r.unitName)].filter(Boolean).join(' · '),
              method: str(r.paymentMethod) || 'Other',
              reference: str(r.reference) || null,
              amount: num(r.amount),
            },
            links: compact({ payer: links.ledger(ref(r.leaseId)), unit: links.unit(ref(r.unitId)) }),
            hints: compact({ method: r.source === 'Online payment' || r.source === 'Portal' ? 'Portal' : undefined }),
          };
        }),
        totals: { id: 'l-total', kind: 'total', cells: { date: null, payer: `${count} ${count === 1 ? 'payment' : 'payments'}`, amount: fromCents(total) } },
        sortable: true,
        tall: list.rows.length > 40,
        empty: 'No payments in this period.',
      },
    ],
  });
}
