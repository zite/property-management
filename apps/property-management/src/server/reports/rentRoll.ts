import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { day, num, numOrNull, Params, ref, str } from '@project/shared/server/sql';
import { pct, type ReportRow } from '../../components/reports/doc';
import { asOfOf, collator, compact, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, monthlySql, noRows, occupyingSql, POSTED_LINES, residentsSql, type ReportScope } from './common';

/**
 * Rent roll as of a date: every unit, grouped by property, with who lives
 * there, the lease dates, market rent against lease rent (the lease's active
 * rent recurring charges), other recurring charges, deposit held and balance
 * (both from the journal through the as-of date). Vacant units are listed.
 */
export async function buildRentRoll(scope: ReportScope) {
  const { asOf, label } = asOfOf(scope);
  const ar = scope.chart.key('accounts_receivable').id;
  const rentIncome = scope.chart.key('rent_income').id;
  const depositIds = scope.chart.all.filter(a => a.subtype === 'Deposits held').map(a => a.id);

  const pu = new Params();
  const pl = new Params();
  const d = pl.add(asOf);
  const t = pl.add(scope.today);
  const pn = new Params();
  const pn1 = pn.add(asOf);

  const [units, leases, upcoming] = await Promise.all([
    zite.sql({
      query: `
        SELECT u.id, u."name", u."propertyId", u."beds", u."baths", u."squareFeet", u."marketRent", u."readiness"
        FROM "Units" u
        WHERE COALESCE(u."archived", false) = false ${inProperties(pu, 'u."propertyId"', scope)}
        LIMIT 2000`,
      params: pu.values,
    }),
    zite.sql({
      query: `
        SELECT DISTINCT ON (l."unitId") l.id, l."unitId", l."number", l."startDate", l."endDate", l."moveOutDate", l."noticeGivenOn", l."leaseType", l."rent", l."deposit", ${residentsSql('l')} AS residents
        FROM "Leases" l
        WHERE ${occupyingSql('l', `${d}::date`, `${t}::date`)} ${inProperties(pl, 'l."propertyId"', scope)}
        ORDER BY l."unitId", l."startDate" DESC
        LIMIT 2000`,
      params: pl.values,
    }),
    zite.sql({
      query: `
        SELECT DISTINCT ON (l."unitId") l."unitId", l."startDate"
        FROM "Leases" l
        WHERE l."status" IN ('Active', 'Pending signature') AND l."startDate" > ${pn1}::date ${inProperties(pn, 'l."propertyId"', scope)}
        ORDER BY l."unitId", l."startDate" ASC
        LIMIT 2000`,
      params: pn.values,
    }),
  ]);

  const leaseIds = leases.rows.map(r => String(r.id));
  const [charges, balances] = leaseIds.length
    ? await Promise.all([
        zite.sql({
          query: `
            SELECT rc."leaseId",
              SUM(CASE WHEN rc."accountId" = $2 THEN ${monthlySql('rc')} ELSE 0 END) AS rent,
              SUM(CASE WHEN rc."accountId" <> $2 THEN ${monthlySql('rc')} ELSE 0 END) AS other
            FROM "RecurringCharges" rc
            WHERE rc."leaseId" = ANY($1)
              AND (rc."startDate" IS NULL OR rc."startDate" <= $3::date) AND (rc."endDate" IS NULL OR rc."endDate" >= $3::date)
              AND (COALESCE(rc."active", false) = true OR $3::date < $4::date)
            GROUP BY rc."leaseId"`,
          params: [leaseIds, rentIncome, asOf, scope.today],
        }),
        zite.sql({
          query: `
            SELECT jl."leaseId",
              SUM(CASE WHEN jl."accountId" = $2 THEN COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0) ELSE 0 END) AS balance,
              SUM(CASE WHEN jl."accountId" = ANY($3) THEN COALESCE(jl."credit", 0) - COALESCE(jl."debit", 0) ELSE 0 END) AS deposit
            FROM ${POSTED_LINES}
            WHERE ${LINE_IS_POSTED} AND jl."leaseId" = ANY($1) AND jl."date" <= $4::date
            GROUP BY jl."leaseId"`,
          params: [leaseIds, ar, depositIds, asOf],
        }),
      ])
    : [noRows(), noRows()];

  const leaseByUnit = new Map(leases.rows.map(r => [String(r.unitId), r]));
  const upcomingByUnit = new Map(upcoming.rows.map(r => [String(r.unitId), day(r.startDate)]));
  const chargesBy = new Map(charges.rows.map(r => [String(r.leaseId), { rent: toCents(num(r.rent)), other: toCents(num(r.other)) }]));
  const balanceBy = new Map(balances.rows.map(r => [String(r.leaseId), { balance: toCents(num(r.balance)), deposit: toCents(num(r.deposit)) }]));

  type Acc = { units: number; occupied: number; notice: number; market: number; rent: number; other: number; deposit: number; balance: number; vacantMarket: number; loss: number };
  const blank = (): Acc => ({ units: 0, occupied: 0, notice: 0, market: 0, rent: 0, other: 0, deposit: 0, balance: 0, vacantMarket: 0, loss: 0 });
  const grand = blank();
  const byProperty = new Map<string, { acc: Acc; rows: ReportRow[] }>();

  const sortedUnits = [...units.rows].sort((a, b) => {
    const pa = scope.propertyById.get(String(a.propertyId))?.name ?? '';
    const pb = scope.propertyById.get(String(b.propertyId))?.name ?? '';
    return collator.compare(pa, pb) || collator.compare(str(a.name) ?? '', str(b.name) ?? '');
  });

  for (const u of sortedUnits) {
    const pid = String(u.propertyId);
    if (!byProperty.has(pid)) byProperty.set(pid, { acc: blank(), rows: [] });
    const group = byProperty.get(pid)!;
    const lease = leaseByUnit.get(String(u.id));
    const leaseId = lease ? String(lease.id) : null;
    const market = toCents(num(u.marketRent));
    const rc = leaseId ? chargesBy.get(leaseId) : undefined;
    // A lease with no rent recurring charge still has a contract rent; show it rather than zero.
    const leaseRent = lease ? (rc && rc.rent > 0 ? rc.rent : toCents(num(lease.rent))) : 0;
    const other = rc?.other ?? 0;
    const bal = leaseId ? balanceBy.get(leaseId) : undefined;
    const notice = Boolean(lease && (day(lease.noticeGivenOn) && day(lease.noticeGivenOn)! <= asOf || day(lease.moveOutDate)));
    const status = !lease ? 'Vacant' : notice ? 'Notice' : 'Occupied';
    const next = upcomingByUnit.get(String(u.id));
    const beds = num(u.beds);
    const baths = num(u.baths);

    for (const acc of [group.acc, grand]) {
      acc.units += 1;
      acc.market += market;
      if (lease) {
        acc.occupied += 1;
        if (notice) acc.notice += 1;
        acc.rent += leaseRent;
        acc.other += other;
        acc.deposit += bal?.deposit ?? 0;
        acc.balance += bal?.balance ?? 0;
        acc.loss += market - leaseRent;
      } else {
        acc.vacantMarket += market;
      }
    }

    group.rows.push({
      id: String(u.id),
      depth: 1,
      cells: {
        unit: str(u.name) ?? 'Unit',
        layout: `${beds === 0 ? 'Studio' : `${beds} bd`} · ${Number.isInteger(baths) ? baths : baths.toFixed(1)} ba`,
        sqft: numOrNull(u.squareFeet),
        residents: lease ? str(lease.residents) || 'No residents on the lease' : null,
        status,
        start: lease ? day(lease.startDate) : null,
        end: lease ? (day(lease.endDate) ?? null) : null,
        market: fromCents(market),
        rent: lease ? fromCents(leaseRent) : null,
        other: lease ? fromCents(other) : null,
        deposit: lease ? fromCents(bal?.deposit ?? 0) : null,
        balance: lease ? fromCents(bal?.balance ?? 0) : null,
      },
      links: compact({ unit: links.unit(String(u.id)), residents: links.lease(leaseId), balance: links.ledger(leaseId) }),
      pills: { status: { label: status, tone: status === 'Vacant' ? 'danger' : status === 'Notice' ? 'warning' : 'neutral' } },
      hints: compact({
        unit: `${beds === 0 ? 'Studio' : `${beds} bd`} · ${Number.isInteger(baths) ? baths : baths.toFixed(1)} ba`,
        end: lease && !day(lease.endDate) ? 'Month-to-month' : undefined,
        residents: !lease && next ? `Leased from ${formatDay(next)}` : undefined,
      }),
      tones: compact({ balance: bal && bal.balance > 0 ? ('danger' as const) : bal && bal.balance < 0 ? ('success' as const) : undefined }),
    });
  }

  const sums = (acc: Acc, label: string, kind: 'subtotal' | 'total', idKey: string): ReportRow => ({
    id: idKey,
    kind,
    cells: {
      unit: label,
      layout: null,
      sqft: null,
      residents: `${acc.units} ${acc.units === 1 ? 'unit' : 'units'} · ${pct(acc.occupied, acc.units) ?? 0}% occupied`,
      status: null,
      start: null,
      end: null,
      market: fromCents(acc.market),
      rent: fromCents(acc.rent),
      other: fromCents(acc.other),
      deposit: fromCents(acc.deposit),
      balance: fromCents(acc.balance),
    },
  });

  const rows: ReportRow[] = [];
  const properties = [...byProperty.entries()].sort((a, b) => collator.compare(scope.propertyById.get(a[0])?.name ?? '', scope.propertyById.get(b[0])?.name ?? ''));
  for (const [pid, g] of properties) {
    const name = scope.propertyById.get(pid)?.name ?? 'Property';
    rows.push({ id: `p:${pid}`, kind: 'group', cells: { unit: name }, links: compact({ unit: links.property(pid) }) });
    rows.push(...g.rows);
    if (properties.length > 1 && g.acc.units > 1) rows.push(sums(g.acc, `Total ${name}`, 'subtotal', `s:${pid}`));
  }

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Occupancy', value: pct(grand.occupied, grand.units), kind: 'percent', hint: `${grand.occupied} of ${grand.units} units${grand.notice ? ` · ${grand.notice} on notice` : ''}` },
      { label: 'Scheduled rent', value: fromCents(grand.rent), kind: 'money', hint: 'Monthly lease rent' },
      { label: 'Market rent', value: fromCents(grand.market), kind: 'money', hint: 'Monthly, all units' },
      { label: 'Loss to vacancy', value: fromCents(grand.vacantMarket), kind: 'money', hint: `${grand.units - grand.occupied} vacant ${grand.units - grand.occupied === 1 ? 'unit' : 'units'}`, tone: grand.vacantMarket > 0 ? 'warning' : undefined },
      { label: 'Loss to lease', value: fromCents(grand.loss), kind: 'money', hint: 'Below market, occupied units' },
      { label: 'Resident balances', value: fromCents(grand.balance), kind: 'money', hint: 'Current residents, net of credits', tone: grand.balance > 0 ? 'danger' : undefined },
    ],
    sections: [
      {
        id: 'units',
        columns: [
          { key: 'unit', label: 'Unit', kind: 'text', width: 170 },
          { key: 'layout', label: 'Bed / bath', kind: 'text', exportOnly: true },
          { key: 'sqft', label: 'Sq ft', kind: 'number', exportOnly: true },
          { key: 'residents', label: 'Residents', kind: 'text' },
          { key: 'status', label: 'Status', kind: 'text', width: 86 },
          { key: 'start', label: 'Start', kind: 'date', width: 100, hideBelow: 'xl' },
          { key: 'end', label: 'End', kind: 'date', width: 100, hideBelow: 'md' },
          { key: 'market', label: 'Market', kind: 'money', width: 84, hideBelow: 'lg', wholeDollars: true },
          { key: 'rent', label: 'Lease rent', kind: 'money', width: 90, wholeDollars: true },
          { key: 'other', label: 'Other', kind: 'money', width: 70, hideBelow: 'xl', wholeDollars: true },
          { key: 'deposit', label: 'Deposit', kind: 'money', width: 100, hideBelow: 'lg' },
          { key: 'balance', label: 'Balance', kind: 'money', width: 100 },
        ],
        rows,
        totals: sums(grand, 'Total', 'total', 'total'),
        empty: scope.propertyIds ? 'These properties have no units.' : 'No units yet. Add a property and its units to see a rent roll.',
      },
    ],
    notes: [
      'Lease rent and other charges are monthly amounts from each lease’s recurring charges active on the date (quarterly and annual charges are shown per month). Deposit held and balance come from the journal through the date.',
    ],
  });
}
