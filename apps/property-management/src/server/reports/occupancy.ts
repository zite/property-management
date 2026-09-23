import { zite } from 'zitejs/db';
import { addPeriods, periodEnd, periodLabel, periodOf as monthOf } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { day, num, Params } from '@project/shared/server/sql';
import { pct, type ReportRow } from '../../components/reports/doc';
import { asOfOf, collator, compact, envelope, inProperties, joinLabel, links, monthlySql, occupyingSql, type ReportScope } from './common';

/**
 * Occupancy by property on a date — physical (units with someone living in
 * them) and economic (scheduled rent against market rent) — plus physical
 * occupancy at the end of each of the last 12 months. Units counted are
 * today's non-archived units.
 */
export async function buildOccupancy(scope: ReportScope) {
  const { asOf, label } = asOfOf(scope);
  const rentIncome = scope.chart.key('rent_income').id;
  const month = monthOf(asOf);
  const days = Array.from({ length: 12 }, (_, i) => {
    const p = addPeriods(month, i - 11);
    return i === 11 ? asOf : periodEnd(p);
  });

  const pn = new Params();
  const asOfP = pn.add(asOf);
  const todayP = pn.add(scope.today);
  const rentP = pn.add(rentIncome);
  const pt = new Params();
  const daysP = pt.add(days);
  const todayT = pt.add(scope.today);

  const [now, trend] = await Promise.all([
    zite.sql({
      query: `
        SELECT u."propertyId", COUNT(*) AS units, SUM(COALESCE(u."marketRent", 0)) AS market,
          COUNT(cur.id) AS occupied,
          COUNT(cur.id) FILTER (WHERE (cur."noticeGivenOn" IS NOT NULL AND cur."noticeGivenOn" <= ${asOfP}::date) OR cur."moveOutDate" IS NOT NULL) AS notice,
          SUM(COALESCE(cur.rent, 0)) AS scheduled
        FROM "Units" u
        LEFT JOIN LATERAL (
          SELECT l.id, l."noticeGivenOn", l."moveOutDate",
            COALESCE(NULLIF((SELECT SUM(${monthlySql('rc')}) FROM "RecurringCharges" rc WHERE rc."leaseId" = l.id::text AND rc."accountId" = ${rentP}
              AND (rc."startDate" IS NULL OR rc."startDate" <= ${asOfP}::date) AND (rc."endDate" IS NULL OR rc."endDate" >= ${asOfP}::date)
              AND (COALESCE(rc."active", false) = true OR ${asOfP}::date < ${todayP}::date)), 0), l."rent") AS rent
          FROM "Leases" l
          WHERE l."unitId" = u.id::text AND ${occupyingSql('l', `${asOfP}::date`, `${todayP}::date`)}
          ORDER BY l."startDate" DESC LIMIT 1
        ) cur ON true
        WHERE COALESCE(u."archived", false) = false ${inProperties(pn, 'u."propertyId"', scope)}
        GROUP BY u."propertyId"`,
      params: pn.values,
    }),
    zite.sql({
      query: `
        SELECT u."propertyId", d.day, COUNT(*) AS units,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Leases" l WHERE l."unitId" = u.id::text AND ${occupyingSql('l', 'd.day', `${todayT}::date`)})) AS occupied
        FROM "Units" u CROSS JOIN (SELECT CAST(x AS date) AS day FROM unnest(CAST(${daysP} AS text[])) AS x) d
        WHERE COALESCE(u."archived", false) = false ${inProperties(pt, 'u."propertyId"', scope)}
        GROUP BY u."propertyId", d.day`,
      params: pt.values,
    }),
  ]);

  type Acc = { units: number; occupied: number; notice: number; market: number; scheduled: number };
  const total: Acc = { units: 0, occupied: 0, notice: 0, market: 0, scheduled: 0 };
  const rows: ReportRow[] = [...now.rows]
    .sort((a, b) => collator.compare(scope.propertyById.get(String(a.propertyId))?.name ?? '', scope.propertyById.get(String(b.propertyId))?.name ?? ''))
    .map(r => {
      const x: Acc = { units: num(r.units), occupied: num(r.occupied), notice: num(r.notice), market: toCents(num(r.market)), scheduled: toCents(num(r.scheduled)) };
      for (const k of Object.keys(total) as Array<keyof Acc>) total[k] += x[k];
      const physical = pct(x.occupied, x.units);
      return {
        id: String(r.propertyId),
        cells: { property: scope.propertyById.get(String(r.propertyId))?.name ?? 'Property', units: x.units, occupied: x.occupied - x.notice, notice: x.notice, vacant: x.units - x.occupied, physical, market: fromCents(x.market), scheduled: fromCents(x.scheduled), economic: pct(x.scheduled, x.market) },
        links: compact({ property: links.property(String(r.propertyId)) }),
        tones: compact({ physical: physical != null && physical < 90 ? ('warning' as const) : undefined }),
      };
    });

  const trendBy = new Map<string, Map<string, { units: number; occupied: number }>>();
  const portfolio = new Map<string, { units: number; occupied: number }>();
  for (const r of trend.rows) {
    const pid = String(r.propertyId);
    const d = day(r.day) ?? '';
    const v = { units: num(r.units), occupied: num(r.occupied) };
    if (!trendBy.has(pid)) trendBy.set(pid, new Map());
    trendBy.get(pid)!.set(d, v);
    const agg = portfolio.get(d) ?? { units: 0, occupied: 0 };
    agg.units += v.units;
    agg.occupied += v.occupied;
    portfolio.set(d, agg);
  }
  const monthKey = (d: string, i: number) => `m${i}`;
  const trendRows: ReportRow[] = [...trendBy.entries()]
    .sort((a, b) => collator.compare(scope.propertyById.get(a[0])?.name ?? '', scope.propertyById.get(b[0])?.name ?? ''))
    .map(([pid, m]) => ({
      id: `t:${pid}`,
      cells: { property: scope.propertyById.get(pid)?.name ?? 'Property', ...Object.fromEntries(days.map((d, i) => [monthKey(d, i), pct(m.get(d)?.occupied ?? 0, m.get(d)?.units ?? 0)])) },
      links: compact({ property: links.property(pid) }),
    }));
  const portfolioCells = Object.fromEntries(days.map((d, i) => [monthKey(d, i), pct(portfolio.get(d)?.occupied ?? 0, portfolio.get(d)?.units ?? 0)]));
  const first = portfolio.get(days[0]);
  const firstPct = first ? pct(first.occupied, first.units) : null;
  const physical = pct(total.occupied, total.units);

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Physical occupancy', value: physical, kind: 'percent', hint: `${total.occupied} of ${total.units} units` },
      { label: 'Economic occupancy', value: pct(total.scheduled, total.market), kind: 'percent', hint: 'Scheduled rent ÷ market rent' },
      { label: 'On notice', value: total.notice, kind: 'number' },
      { label: 'Vacant', value: total.units - total.occupied, kind: 'number', tone: total.units - total.occupied ? 'warning' : undefined },
      {
        label: '12-month change',
        value: physical != null && firstPct != null ? `${physical - firstPct >= 0 ? '+' : '−'}${Math.abs(Math.round((physical - firstPct) * 10) / 10)} pts` : null,
        kind: 'text',
        hint: firstPct != null ? `From ${firstPct}% at the end of ${periodLabel(monthOf(days[0]), true)}` : undefined,
      },
    ],
    chart: { title: 'Portfolio occupancy, last 12 months', kind: 'percent', points: days.map((d, i) => ({ label: periodLabel(monthOf(d), true).replace(/ \d{4}$/, ''), value: Number(portfolioCells[monthKey(d, i)] ?? 0) })) },
    sections: [
      {
        id: 'by-property',
        title: 'By property',
        columns: [
          { key: 'property', label: 'Property', kind: 'text' },
          { key: 'units', label: 'Units', kind: 'number', width: 70 },
          { key: 'occupied', label: 'Occupied', kind: 'number', width: 84, hideBelow: 'sm' },
          { key: 'notice', label: 'Notice', kind: 'number', width: 70, hideBelow: 'md' },
          { key: 'vacant', label: 'Vacant', kind: 'number', width: 70, hideBelow: 'sm' },
          { key: 'physical', label: 'Occupancy', kind: 'percent', width: 96 },
          { key: 'market', label: 'Market rent', kind: 'money', width: 120, hideBelow: 'lg' },
          { key: 'scheduled', label: 'Scheduled rent', kind: 'money', width: 124, hideBelow: 'lg' },
          { key: 'economic', label: 'Economic', kind: 'percent', width: 92, hideBelow: 'md' },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { property: 'Portfolio', units: total.units, occupied: total.occupied - total.notice, notice: total.notice, vacant: total.units - total.occupied, physical, market: fromCents(total.market), scheduled: fromCents(total.scheduled), economic: pct(total.scheduled, total.market) } },
        sortable: true,
        empty: 'No units to report on.',
      },
      {
        id: 'trend',
        title: 'Occupancy at each month end',
        columns: [
          { key: 'property', label: 'Property', kind: 'text', width: 180 },
          ...days.map((d, i) => ({ key: monthKey(d, i), label: i === 11 && d !== periodEnd(monthOf(d)) ? `${periodLabel(monthOf(d), true)}*` : periodLabel(monthOf(d), true), kind: 'percent' as const, width: 84 })),
        ],
        rows: trendRows,
        totals: { id: 'trend-total', kind: 'total', cells: { property: 'Portfolio', ...portfolioCells } },
        empty: 'No units to report on.',
      },
    ],
    notes: [`Physical occupancy counts units with a resident, including those on notice. Economic occupancy is scheduled rent as a share of market rent. The last column is the as-of date${asOf !== periodEnd(month) ? ' (*)' : ''}; history uses today’s units.`],
  });
}
