import { zite } from 'zitejs/db';
import { addMonths, daysBetween, formatDay, periodLabel } from '@project/shared/dates';
import { applicationRef } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { day, iso, num, Params, ref, str } from '@project/shared/server/sql';
import { cents, pct, type PillTone, type ReportRow } from '../../components/reports/doc';
import { collator, compact, envelope, inProperties, joinLabel, links, occupyingSql, periodOf, residentsSql, type ReportScope } from './common';

const READINESS_TONE: Record<string, PillTone> = { Ready: 'success', 'Make ready': 'warning', Down: 'danger', 'Off market': 'neutral' };

/**
 * Vacant and on-notice units today: how long each has been empty (since the
 * last lease moved out, or since it was added), the rent it's losing, whether
 * it's ready, listed, has applications or a signed next lease.
 */
export async function buildVacancy(scope: ReportScope) {
  const today = scope.today;
  const p = new Params();
  const t = p.add(today);
  const { rows: units } = await zite.sql({
    query: `
      SELECT u.id, u."name", u."propertyId", u."marketRent", u."readiness", u."availableOn", u.created_at,
        cur.id AS "leaseId", cur."moveOutDate", cur."noticeGivenOn", cur."endDate", cur.residents,
        (SELECT MAX(COALESCE(x."moveOutDate", x."endDate")) FROM "Leases" x WHERE x."unitId" = u.id::text AND x."status" IN ('Active', 'Ended') AND COALESCE(x."moveOutDate", x."endDate") < ${t}::date) AS "vacatedOn",
        (SELECT li."status" FROM "Listings" li WHERE li."unitId" = u.id::text ORDER BY CASE li."status" WHEN 'Published' THEN 0 WHEN 'Paused' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END, li.created_at DESC LIMIT 1) AS listing,
        (SELECT COUNT(*) FROM "Applications" ap WHERE ap."unitId" = u.id::text AND ap."status" IN ('Submitted', 'Screening', 'Approved')) AS applications,
        (SELECT MIN(n."startDate") FROM "Leases" n WHERE n."unitId" = u.id::text AND n."status" IN ('Active', 'Pending signature') AND n."startDate" > ${t}::date) AS "nextLease"
      FROM "Units" u
      LEFT JOIN LATERAL (
        SELECT l.id, l."moveOutDate", l."noticeGivenOn", l."endDate", ${residentsSql('l')} AS residents
        FROM "Leases" l WHERE l."unitId" = u.id::text AND ${occupyingSql('l', `${t}::date`, `${t}::date`)}
        ORDER BY l."startDate" DESC LIMIT 1
      ) cur ON true
      WHERE COALESCE(u."archived", false) = false ${inProperties(p, 'u."propertyId"', scope)}
        AND (cur.id IS NULL OR cur."noticeGivenOn" IS NOT NULL OR cur."moveOutDate" IS NOT NULL)
      LIMIT 2000`,
    params: p.values,
  });
  const { rows: totals } = await (async () => {
    const q = new Params();
    return zite.sql({ query: `SELECT COUNT(*) AS n, SUM(COALESCE(u."marketRent", 0)) AS market FROM "Units" u WHERE COALESCE(u."archived", false) = false ${inProperties(q, 'u."propertyId"', scope)}`, params: q.values });
  })();
  const unitCount = num(totals[0]?.n);

  let vacant = 0;
  let notice = 0;
  let daysSum = 0;
  let lossSum = 0;
  let vacantMarket = 0;
  const rows: ReportRow[] = [];
  const sorted = [...units].sort((a, b) => collator.compare(scope.propertyById.get(String(a.propertyId))?.name ?? '', scope.propertyById.get(String(b.propertyId))?.name ?? '') || collator.compare(str(a.name) ?? '', str(b.name) ?? ''));
  for (const u of sorted) {
    const onNotice = Boolean(u.leaseId);
    const market = toCents(num(u.marketRent));
    const pid = String(u.propertyId);
    const since = day(u.vacatedOn) ?? day(u.availableOn) ?? day(iso(u.created_at));
    const daysVacant = !onNotice && since ? Math.max(0, daysBetween(since, today)) : null;
    const loss = daysVacant != null ? Math.round((market * 12 * daysVacant) / 365) : 0;
    const moveOut = day(u.moveOutDate) ?? (u.noticeGivenOn ? day(u.endDate) : null);
    if (onNotice) notice += 1;
    else {
      vacant += 1;
      daysSum += daysVacant ?? 0;
      lossSum += loss;
      vacantMarket += market;
    }
    const readiness = str(u.readiness) || 'Ready';
    const listing = str(u.listing);
    const apps = num(u.applications);
    const next = day(u.nextLease);
    rows.push({
      id: String(u.id),
      cells: {
        unit: [scope.propertyById.get(pid)?.name, str(u.name)].filter(Boolean).join(' · '),
        status: onNotice ? 'Notice' : 'Vacant',
        since: onNotice ? moveOut : since,
        days: daysVacant,
        market: fromCents(market),
        loss: onNotice ? null : fromCents(loss),
        readiness,
        listing: listing ?? 'Not listed',
        applications: apps,
        next: next,
        residents: onNotice ? str(u.residents) || null : null,
      },
      links: compact({ unit: links.unit(String(u.id)) }),
      pills: {
        status: onNotice ? { label: 'Notice', tone: 'warning' } : { label: 'Vacant', tone: 'danger' },
        readiness: { label: readiness, tone: READINESS_TONE[readiness] ?? 'neutral' },
        listing: listing === 'Published' ? { label: 'Listed', tone: 'success' } : listing === 'Paused' ? { label: 'Paused', tone: 'warning' } : listing === 'Draft' ? { label: 'Draft', tone: 'neutral' } : listing === 'Leased' ? { label: 'Leased', tone: 'accent' } : { label: 'Not listed', tone: 'danger' },
      },
      hints: compact({
        since: onNotice ? (moveOut ? 'Moving out' : 'Notice given') : u.vacatedOn ? 'Vacated' : 'Available',
        next: next ? 'Pre-leased' : undefined,
      }),
      tones: compact({ days: daysVacant != null && daysVacant > 60 ? ('danger' as const) : daysVacant != null && daysVacant > 30 ? ('warning' as const) : undefined }),
    });
  }

  return envelope(scope, {
    subtitle: joinLabel(`As of today, ${formatDay(today)}`, scope.propertyLabel),
    figures: [
      { label: 'Vacant', value: vacant, kind: 'number', hint: `${pct(vacant, unitCount) ?? 0}% of ${unitCount} units`, tone: vacant ? 'warning' : undefined },
      { label: 'On notice', value: notice, kind: 'number' },
      { label: 'Average days vacant', value: vacant ? Math.round(daysSum / vacant) : null, kind: 'days' },
      { label: 'Estimated loss to date', value: fromCents(lossSum), kind: 'money', tone: lossSum ? 'danger' : undefined },
      { label: 'Vacant market rent', value: fromCents(vacantMarket), kind: 'money', hint: 'Per month' },
    ],
    sections: [
      {
        id: 'vacancy',
        columns: [
          { key: 'unit', label: 'Unit', kind: 'text' },
          { key: 'status', label: 'Status', kind: 'text', width: 90 },
          { key: 'since', label: 'Since / until', kind: 'date', width: 104, hideBelow: 'md' },
          { key: 'days', label: 'Days vacant', kind: 'days', width: 100 },
          { key: 'market', label: 'Market rent', kind: 'money', width: 100, hideBelow: 'sm', wholeDollars: true },
          { key: 'loss', label: 'Est. loss', kind: 'money', width: 110 },
          { key: 'readiness', label: 'Readiness', kind: 'text', width: 110, hideBelow: 'lg' },
          { key: 'listing', label: 'Listing', kind: 'text', width: 100, hideBelow: 'lg' },
          { key: 'applications', label: 'Apps', kind: 'number', width: 60, hideBelow: 'xl' },
          { key: 'next', label: 'Next lease', kind: 'date', width: 104, hideBelow: 'xl' },
          { key: 'residents', label: 'Residents on notice', kind: 'text', exportOnly: true },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { unit: `${vacant} vacant · ${notice} on notice`, market: fromCents(rows.reduce((a, r) => a + toCents(Number(r.cells.market ?? 0)), 0)), loss: fromCents(lossSum) } },
        sortable: true,
        empty: 'Every unit is occupied, and nobody has given notice.',
      },
    ],
    notes: ['Days vacant count from the last resident’s move-out (or the unit’s available date if it has never been leased). Estimated loss is market rent per day for those days.'],
  });
}

/** Leases ending in the next N months, with renewal status and rent against market; month-to-month leases first. */
export async function buildExpirations(scope: ReportScope) {
  const today = scope.today;
  const months = scope.input.months ?? 6;
  const until = addMonths(today, months);
  const p = new Params();
  const { rows } = await zite.sql({
    query: `
      SELECT l.id, l."name", l."number", l."leaseType", l."startDate", l."endDate", l."noticeGivenOn", l."moveOutDate", l."rent", l."renewalStatus", l."renewalRent", l."renewalOfferedAt",
        l."propertyId", l."unitId", u."name" AS "unitName", u."marketRent", ${residentsSql('l')} AS residents
      FROM "Leases" l LEFT JOIN "Units" u ON u.id::text = l."unitId"
      WHERE l."status" = 'Active' AND l."startDate" <= ${p.add(today)}::date
        AND (l."leaseType" = 'Month-to-month' OR l."endDate" IS NULL OR l."endDate" <= ${p.add(until)}::date)
        ${inProperties(p, 'l."propertyId"', scope)}
      ORDER BY l."endDate" ASC NULLS FIRST
      LIMIT 2000`,
    params: p.values,
  });

  type Item = { r: Record<string, unknown>; group: string; end: string | null };
  const items: Item[] = rows.map(r => {
    const end = day(r.endDate);
    const m2m = str(r.leaseType) === 'Month-to-month' || !end || end < today;
    return { r, end, group: m2m ? 'm2m' : end!.slice(0, 7) };
  });
  const groups = new Map<string, Item[]>();
  for (const i of items) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  const keys = [...groups.keys()].sort((a, b) => (a === 'm2m' ? -1 : b === 'm2m' ? 1 : a.localeCompare(b)));

  let offered = 0;
  let accepted = 0;
  let noticeCount = 0;
  let atRisk = 0;
  let expiring = 0;
  const out: ReportRow[] = [];
  for (const k of keys) {
    const list = groups.get(k)!;
    const rentTotal = list.reduce((a, i) => a + toCents(num(i.r.rent)), 0);
    out.push({ id: `g:${k}`, kind: 'group', cells: { residents: k === 'm2m' ? 'Month-to-month' : periodLabel(k), unit: `${list.length} ${list.length === 1 ? 'lease' : 'leases'}`, rent: fromCents(rentTotal) } });
    for (const { r, end } of list) {
      const rent = toCents(num(r.rent));
      const market = toCents(num(r.marketRent));
      const gap = market ? rent - market : null;
      const renewal = str(r.renewalStatus) || 'None';
      const onNotice = Boolean(r.noticeGivenOn || r.moveOutDate);
      if (k !== 'm2m') expiring += 1;
      if (renewal === 'Offered' || renewal === 'Accepted' || renewal === 'Declined') offered += 1;
      if (renewal === 'Accepted') accepted += 1;
      if (onNotice) noticeCount += 1;
      if (onNotice || renewal === 'Declined') atRisk += rent;
      const status = onNotice ? { label: 'Notice given', tone: 'warning' as const } : renewal === 'Accepted' ? { label: 'Renewed', tone: 'success' as const } : renewal === 'Declined' ? { label: 'Declined', tone: 'danger' as const } : renewal === 'Offered' ? { label: 'Offer sent', tone: 'info' as const } : { label: 'Not offered', tone: 'neutral' as const };
      out.push({
        id: String(r.id),
        depth: 1,
        cells: {
          residents: str(r.residents) || str(r.name) || 'Lease',
          unit: [scope.propertyById.get(String(r.propertyId))?.name, str(r.unitName)].filter(Boolean).join(' · '),
          end: k === 'm2m' ? day(r.moveOutDate) : end,
          days: k === 'm2m' ? null : daysBetween(today, end!),
          renewal: status.label,
          rent: fromCents(rent),
          market: market ? fromCents(market) : null,
          renewalRent: r.renewalRent != null && num(r.renewalRent) > 0 ? num(r.renewalRent) : null,
          gap: gap == null ? null : fromCents(gap),
          gapPct: gap == null || !market ? null : cents((gap / market) * 100),
        },
        links: compact({ residents: links.lease(String(r.id)), unit: links.unit(ref(r.unitId)) }),
        pills: { renewal: status },
        tones: compact({ gap: gap != null && gap < 0 ? ('warning' as const) : undefined, days: k !== 'm2m' && daysBetween(today, end!) <= 30 ? ('danger' as const) : undefined }),
        hints: compact({ end: k === 'm2m' ? (day(r.moveOutDate) ? 'Moving out' : 'No end date') : undefined }),
      });
    }
  }

  return envelope(scope, {
    subtitle: joinLabel(`Ending by ${formatDay(until)}`, scope.propertyLabel),
    figures: [
      { label: 'Expiring', value: expiring, kind: 'number', hint: `Next ${months} months` },
      { label: 'Month-to-month', value: groups.get('m2m')?.length ?? 0, kind: 'number' },
      { label: 'Renewal offered', value: pct(offered, items.length), kind: 'percent', hint: `${offered} of ${items.length}` },
      { label: 'Renewed', value: accepted, kind: 'number', tone: accepted ? 'success' : undefined },
      { label: 'Monthly rent at risk', value: fromCents(atRisk), kind: 'money', hint: `${noticeCount} on notice or declined`, tone: atRisk ? 'warning' : undefined },
    ],
    sections: [
      {
        id: 'expirations',
        columns: [
          { key: 'residents', label: 'Residents', kind: 'text' },
          { key: 'unit', label: 'Unit', kind: 'text', width: 190, hideBelow: 'md' },
          { key: 'end', label: 'Ends', kind: 'date', width: 108 },
          { key: 'days', label: 'Days left', kind: 'days', width: 88, hideBelow: 'sm' },
          { key: 'renewal', label: 'Renewal', kind: 'text', width: 118 },
          { key: 'rent', label: 'Rent', kind: 'money', width: 96, wholeDollars: true },
          { key: 'market', label: 'Market', kind: 'money', width: 96, hideBelow: 'lg', wholeDollars: true },
          { key: 'renewalRent', label: 'Offered rent', kind: 'money', width: 104, hideBelow: 'xl', wholeDollars: true },
          { key: 'gap', label: 'vs market', kind: 'money', width: 100, hideBelow: 'lg' },
          { key: 'gapPct', label: '%', kind: 'percent', width: 70, hideBelow: 'xl' },
        ],
        rows: out,
        totals: { id: 'total', kind: 'total', cells: { residents: `${items.length} ${items.length === 1 ? 'lease' : 'leases'}`, rent: fromCents(items.reduce((a, i) => a + toCents(num(i.r.rent)), 0)) } },
        empty: `No leases end in the next ${months} months, and none are month-to-month.`,
      },
    ],
    notes: ['“vs market” is current rent less the unit’s market rent; negative means the lease is below market.'],
  });
}

/**
 * The leasing funnel for a period. Inquiries and applications are counted by
 * when they arrived; approvals and leases are counted from the applications
 * that arrived in the period, so every rate compares like with like.
 */
export async function buildLeasingFunnel(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const bySource = scope.input.groupBy === 'source';
  const tz = scope.settings.timezone || 'UTC';
  const pi = new Params();
  const pa = new Params();
  const inqKey = bySource ? `COALESCE(NULLIF(q."source", ''), 'Unknown')` : `COALESCE(q."propertyId", '')`;
  const appKey = bySource ? `COALESCE(NULLIF(a."source", ''), 'Unknown')` : `COALESCE(a."propertyId", '')`;
  const localDay = (col: string, p: Params) => `(${col} AT TIME ZONE ${p.add(tz)})::date`;
  const [inquiries, applications] = await Promise.all([
    zite.sql({
      query: `
        SELECT ${inqKey} AS key, COUNT(*) AS inquiries, COUNT(*) FILTER (WHERE q."showingAt" IS NOT NULL) AS showings
        FROM "Inquiries" q
        WHERE ${localDay('COALESCE(q."receivedAt", q.created_at)', pi)} BETWEEN ${pi.add(from)}::date AND ${pi.add(to)}::date ${inProperties(pi, 'q."propertyId"', scope)}
        GROUP BY 1`,
      params: pi.values,
    }),
    zite.sql({
      query: `
        SELECT a.id, a."number", a."applicantName", a."status", a."source", a."propertyId", a."unitId", a."submittedAt", a."decidedAt", a."leaseId", ${appKey} AS key,
          l."signedAt", l.created_at AS "leaseCreatedAt", l."startDate" AS "leaseStart", l."status" AS "leaseStatus", un."name" AS "unitName"
        FROM "Applications" a LEFT JOIN "Leases" l ON l.id::text = a."leaseId" LEFT JOIN "Units" un ON un.id::text = a."unitId"
        WHERE a."status" <> 'Draft' AND ${localDay('COALESCE(a."submittedAt", a.created_at)', pa)} BETWEEN ${pa.add(from)}::date AND ${pa.add(to)}::date ${inProperties(pa, 'a."propertyId"', scope)}
        ORDER BY COALESCE(a."submittedAt", a.created_at) DESC
        LIMIT 2000`,
      params: pa.values,
    }),
  ]);

  type G = { inquiries: number; showings: number; applications: number; approved: number; leased: number; days: number[] };
  const groups = new Map<string, G>();
  const g = (k: string) => {
    if (!groups.has(k)) groups.set(k, { inquiries: 0, showings: 0, applications: 0, approved: 0, leased: 0, days: [] });
    return groups.get(k)!;
  };
  for (const r of inquiries.rows) {
    const x = g(String(r.key));
    x.inquiries += num(r.inquiries);
    x.showings += num(r.showings);
  }
  const isLeased = (r: Record<string, unknown>) => r.status === 'Leased' || Boolean(ref(r.leaseId) && r.leaseStatus && r.leaseStatus !== 'Canceled');
  for (const r of applications.rows) {
    const x = g(String(r.key));
    x.applications += 1;
    if (r.status === 'Approved' || isLeased(r)) x.approved += 1;
    if (isLeased(r)) {
      x.leased += 1;
      const submitted = day(iso(r.submittedAt));
      const signed = day(iso(r.signedAt)) ?? day(iso(r.leaseCreatedAt));
      if (submitted && signed) x.days.push(Math.max(0, daysBetween(submitted, signed)));
    }
  }
  const labelOf = (k: string) => (bySource ? k : scope.propertyById.get(k)?.name ?? 'No property');
  const total: G = { inquiries: 0, showings: 0, applications: 0, approved: 0, leased: 0, days: [] };
  for (const x of groups.values()) {
    total.inquiries += x.inquiries;
    total.showings += x.showings;
    total.applications += x.applications;
    total.approved += x.approved;
    total.leased += x.leased;
    total.days.push(...x.days);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const cellsOf = (x: G) => ({
    inquiries: x.inquiries,
    showings: x.showings,
    applications: x.applications,
    approved: x.approved,
    leased: x.leased,
    inqToApp: pct(x.applications, x.inquiries),
    appToApproved: pct(x.approved, x.applications),
    approvedToLease: pct(x.leased, x.approved),
    days: avg(x.days),
  });
  const rows: ReportRow[] = [...groups.entries()]
    .sort((a, b) => b[1].applications + b[1].inquiries - (a[1].applications + a[1].inquiries) || collator.compare(labelOf(a[0]), labelOf(b[0])))
    .map(([k, x]) => ({ id: k || 'none', cells: { group: labelOf(k), ...cellsOf(x) }, links: bySource ? undefined : compact({ group: links.property(k || null) }) }));

  const STATUS_TONE: Record<string, PillTone> = { Submitted: 'info', Screening: 'warning', Approved: 'success', Denied: 'danger', Withdrawn: 'neutral', Leased: 'accent' };
  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Inquiries', value: total.inquiries, kind: 'number' },
      { label: 'Applications', value: total.applications, kind: 'number', hint: total.inquiries ? `${pct(total.applications, total.inquiries)}% of inquiries` : undefined },
      { label: 'Approved', value: total.approved, kind: 'number', hint: total.applications ? `${pct(total.approved, total.applications)}% of applications` : undefined },
      { label: 'Leases signed', value: total.leased, kind: 'number', hint: total.approved ? `${pct(total.leased, total.approved)}% of approvals` : undefined },
      { label: 'Days to lease', value: avg(total.days), kind: 'days', hint: 'Application to signed lease' },
    ],
    sections: [
      {
        id: 'funnel',
        title: bySource ? 'By source' : 'By property',
        columns: [
          { key: 'group', label: bySource ? 'Source' : 'Property', kind: 'text' },
          { key: 'inquiries', label: 'Inquiries', kind: 'number', width: 90 },
          { key: 'showings', label: 'Showings', kind: 'number', width: 90, hideBelow: 'lg' },
          { key: 'applications', label: 'Applications', kind: 'number', width: 104 },
          { key: 'approved', label: 'Approved', kind: 'number', width: 90, hideBelow: 'sm' },
          { key: 'leased', label: 'Leased', kind: 'number', width: 80 },
          { key: 'inqToApp', label: 'Inquiry → app', kind: 'percent', width: 110, hideBelow: 'md' },
          { key: 'appToApproved', label: 'App → approved', kind: 'percent', width: 120, hideBelow: 'md' },
          { key: 'approvedToLease', label: 'Approved → lease', kind: 'percent', width: 130, hideBelow: 'lg' },
          { key: 'days', label: 'Days to lease', kind: 'days', width: 110, hideBelow: 'xl' },
        ],
        rows,
        totals: { id: 'total', kind: 'total', cells: { group: 'Total', ...cellsOf(total) } },
        sortable: true,
        empty: 'No inquiries or applications in this period.',
      },
      {
        id: 'applications',
        title: 'Applications',
        columns: [
          { key: 'number', label: 'ID', kind: 'text', width: 90 },
          { key: 'applicant', label: 'Applicant', kind: 'text' },
          { key: 'unit', label: 'Unit', kind: 'text', width: 200, hideBelow: 'md' },
          { key: 'source', label: 'Source', kind: 'text', width: 110, hideBelow: 'lg' },
          { key: 'submitted', label: 'Submitted', kind: 'date', width: 110, hideBelow: 'sm' },
          { key: 'status', label: 'Status', kind: 'text', width: 110 },
        ],
        rows: applications.rows.map(r => {
          const status = isLeased(r) ? 'Leased' : String(r.status);
          return {
            id: String(r.id),
            cells: {
              number: applicationRef(numOrUndefined(r.number)),
              applicant: str(r.applicantName) || 'Applicant',
              unit: [scope.propertyById.get(String(r.propertyId))?.name, str(r.unitName)].filter(Boolean).join(' · ') || null,
              source: str(r.source) || null,
              submitted: day(iso(r.submittedAt)),
              status,
            },
            links: compact({ number: links.application(numOrUndefined(r.number)), applicant: links.application(numOrUndefined(r.number)) }),
            pills: { status: { label: status, tone: STATUS_TONE[status] ?? 'neutral' } },
          };
        }),
        sortable: true,
        empty: 'No applications in this period.',
      },
    ],
    notes: ['Inquiries and applications count when they arrived. Approved and leased count from those same applications, whenever the decision or lease came.'],
  });
}

const numOrUndefined = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
