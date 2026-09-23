import { zite } from 'zitejs/db';
import { leasePhase } from '@project/shared/leases';
import { fromCents, toCents } from '@project/shared/money';
import { day, num, Params, ref, str } from '@project/shared/server/sql';
import type { ReportRow } from '../../components/reports/doc';
import { asOfOf, compact, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, noRows, POSTED_LINES, residentsSql, type ReportScope } from './common';

/**
 * Delinquency and aging as of a date. What is owed is the open amount of each
 * charge (charges and credit refunds, less allocations dated by the as-of
 * date), bucketed by days past its due date. Unapplied payments and credits
 * are shown in their own column and section, and the balance column is the
 * journal's AR for the lease — a check confirms the buckets tie to it.
 */
export async function buildAging(scope: ReportScope) {
  const { asOf, label } = asOfOf(scope);
  const ar = scope.chart.key('accounts_receivable').id;

  const po = new Params();
  const d = po.add(asOf);
  const arParam = po.add(ar);
  const pu = new Params();
  const du = pu.add(asOf);
  const pb = new Params();
  const db = pb.add(asOf);
  const arb = pb.add(ar);

  const [open, unapplied, balances] = await Promise.all([
    zite.sql({
      query: `
        SELECT o."leaseId",
          SUM(CASE WHEN o.days <= 30 THEN o.open ELSE 0 END) AS b0,
          SUM(CASE WHEN o.days BETWEEN 31 AND 60 THEN o.open ELSE 0 END) AS b31,
          SUM(CASE WHEN o.days BETWEEN 61 AND 90 THEN o.open ELSE 0 END) AS b61,
          SUM(CASE WHEN o.days > 90 THEN o.open ELSE 0 END) AS b91,
          SUM(o.open) AS total
        FROM (
          SELECT t."leaseId",
            (${d}::date - COALESCE(t."dueDate", t."date")::date) AS days,
            t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false AND a."date" <= ${d}::date), 0) AS open
          FROM "Transactions" t
          WHERE t."status" = 'Posted' AND COALESCE(t."leaseId", '') <> '' AND t."date" <= ${d}::date
            AND (t."kind" = 'Charge' OR (t."kind" = 'Refund' AND t."accountId" = ${arParam}))
            ${inProperties(po, 't."propertyId"', scope)}
        ) o
        WHERE o.open > 0
        GROUP BY o."leaseId"
        LIMIT 2000`,
      params: po.values,
    }),
    zite.sql({
      query: `
        SELECT u."leaseId", SUM(u.open) AS unapplied
        FROM (
          SELECT t."leaseId",
            t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."paymentId" = t.id::text AND COALESCE(a."void", false) = false AND a."date" <= ${du}::date), 0) AS open
          FROM "Transactions" t
          WHERE t."status" = 'Posted' AND COALESCE(t."leaseId", '') <> '' AND t."date" <= ${du}::date
            AND t."kind" IN ('Payment', 'Credit', 'Deposit application')
            ${inProperties(pu, 't."propertyId"', scope)}
        ) u
        WHERE u.open > 0
        GROUP BY u."leaseId"
        LIMIT 2000`,
      params: pu.values,
    }),
    zite.sql({
      query: `
        SELECT jl."leaseId", SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) AS balance
        FROM ${POSTED_LINES}
        WHERE ${LINE_IS_POSTED} AND jl."accountId" = ${arb} AND COALESCE(jl."leaseId", '') <> '' AND jl."date" <= ${db}::date
          ${inProperties(pb, 'jl."propertyId"', scope)}
        GROUP BY jl."leaseId"
        HAVING SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) <> 0
        LIMIT 2000`,
      params: pb.values,
    }),
  ]);

  const openBy = new Map(open.rows.map(r => [String(r.leaseId), { b0: toCents(num(r.b0)), b31: toCents(num(r.b31)), b61: toCents(num(r.b61)), b91: toCents(num(r.b91)), total: toCents(num(r.total)) }]));
  const unappliedBy = new Map(unapplied.rows.map(r => [String(r.leaseId), toCents(num(r.unapplied))]));
  const balanceBy = new Map(balances.rows.map(r => [String(r.leaseId), toCents(num(r.balance))]));
  const leaseIds = [...new Set([...openBy.keys(), ...unappliedBy.keys(), ...balanceBy.keys()])];

  const [leases, lastPayments] = leaseIds.length
    ? await Promise.all([
        zite.sql({
          query: `
            SELECT l.id, l."name", l."number", l."status", l."leaseType", l."startDate", l."endDate", l."noticeGivenOn", l."moveOutDate", l."propertyId", l."unitId", l."rent",
              u."name" AS "unitName", ${residentsSql('l')} AS residents
            FROM "Leases" l LEFT JOIN "Units" u ON u.id::text = l."unitId"
            WHERE l.id::text = ANY($1)`,
          params: [leaseIds],
        }),
        zite.sql({
          query: `
            SELECT DISTINCT ON (t."leaseId") t."leaseId", t."date", t."amount"
            FROM "Transactions" t
            WHERE t."kind" = 'Payment' AND t."status" = 'Posted' AND t."leaseId" = ANY($1) AND t."date" <= $2::date
            ORDER BY t."leaseId", t."date" DESC, t."number" DESC`,
          params: [leaseIds, asOf],
        }),
      ])
    : [noRows(), noRows()];

  const leaseBy = new Map(leases.rows.map(r => [String(r.id), r]));
  const lastBy = new Map(lastPayments.rows.map(r => [String(r.leaseId), { date: day(r.date), amount: num(r.amount) }]));

  type Line = { leaseId: string; b0: number; b31: number; b61: number; b91: number; total: number; unapplied: number; balance: number };
  const lines: Line[] = leaseIds.map(id => {
    const o = openBy.get(id) ?? { b0: 0, b31: 0, b61: 0, b91: 0, total: 0 };
    return { leaseId: id, ...o, unapplied: unappliedBy.get(id) ?? 0, balance: balanceBy.get(id) ?? 0 };
  });

  const toRow = (l: Line, credit: boolean): ReportRow => {
    const lease = leaseBy.get(l.leaseId);
    const phase = lease
      ? leasePhase({ status: String(lease.status), leaseType: str(lease.leaseType), startDate: day(lease.startDate), endDate: day(lease.endDate), noticeGivenOn: day(lease.noticeGivenOn), moveOutDate: day(lease.moveOutDate) }, scope.today)
      : 'Ended';
    const last = lastBy.get(l.leaseId);
    const pid = lease ? ref(lease.propertyId) : null;
    const unitName = lease ? str(lease.unitName) ?? '' : '';
    const propertyName = pid ? scope.propertyById.get(pid)?.name ?? '' : '';
    return {
      id: l.leaseId,
      cells: {
        residents: (lease && str(lease.residents)) || (lease ? str(lease.name) : null) || 'Unknown lease',
        unit: [propertyName, unitName].filter(Boolean).join(' · '),
        phase,
        ...(credit ? {} : { b0: fromCents(l.b0), b31: fromCents(l.b31), b61: fromCents(l.b61), b91: fromCents(l.b91) }),
        unapplied: l.unapplied ? -fromCents(l.unapplied) : 0,
        balance: fromCents(l.balance),
        lastDate: last?.date ?? null,
        lastAmount: last ? last.amount : null,
      },
      links: compact({ residents: links.ledger(l.leaseId), unit: lease ? links.unit(ref(lease.unitId)) : undefined }),
      pills: { phase: { label: phase === 'Ended' ? 'Former resident' : phase, tone: phase === 'Ended' ? 'neutral' : phase === 'Notice' ? 'warning' : phase === 'Current' ? 'success' : 'info' } },
      tones: compact({ b91: !credit && l.b91 > 0 ? ('danger' as const) : undefined, b61: !credit && l.b61 > 0 ? ('warning' as const) : undefined, balance: credit ? ('success' as const) : ('danger' as const) }),
      hints: compact({ lastDate: last ? undefined : 'No payments' }),
    };
  };

  const owing = lines.filter(l => l.balance > 0).sort((a, b) => b.balance - a.balance);
  const credits = lines.filter(l => l.balance < 0).sort((a, b) => a.balance - b.balance);
  const sum = (ls: Line[], k: keyof Omit<Line, 'leaseId'>) => ls.reduce((a, l) => a + l[k], 0);

  const owingBalance = sum(owing, 'balance');
  const bucketNet = sum(owing, 'total') - sum(owing, 'unapplied');
  const mismatch = owingBalance - bucketNet;
  const orphanOpen = lines.filter(l => l.balance === 0 && l.total > 0 && l.total !== l.unapplied);

  const columns = [
    { key: 'residents', label: 'Residents', kind: 'text' as const },
    { key: 'unit', label: 'Unit', kind: 'text' as const, width: 180, hideBelow: 'md' as const },
    { key: 'phase', label: 'Lease', kind: 'text' as const, width: 128, hideBelow: 'lg' as const },
  ];
  const tail = [
    { key: 'lastDate', label: 'Last payment', kind: 'date' as const, width: 116, hideBelow: 'xl' as const },
    { key: 'lastAmount', label: 'Amount', kind: 'money' as const, width: 100, hideBelow: 'xl' as const },
  ];

  return envelope(scope, {
    subtitle: joinLabel(label, scope.propertyLabel),
    figures: [
      { label: 'Total delinquent', value: fromCents(owingBalance), kind: 'money', hint: `${owing.length} ${owing.length === 1 ? 'lease' : 'leases'} owe money`, tone: owingBalance > 0 ? 'danger' : undefined },
      { label: '0–30 days', value: fromCents(sum(owing, 'b0')), kind: 'money' },
      { label: '31–60 days', value: fromCents(sum(owing, 'b31')), kind: 'money', tone: sum(owing, 'b31') > 0 ? 'warning' : undefined },
      { label: '61–90 days', value: fromCents(sum(owing, 'b61')), kind: 'money', tone: sum(owing, 'b61') > 0 ? 'warning' : undefined },
      { label: 'Over 90 days', value: fromCents(sum(owing, 'b91')), kind: 'money', tone: sum(owing, 'b91') > 0 ? 'danger' : undefined },
      { label: 'Credit balances', value: fromCents(sum(credits, 'balance')), kind: 'money', hint: `${credits.length} ${credits.length === 1 ? 'lease' : 'leases'} in credit` },
    ],
    checks: [
      {
        label: 'Aging ties to the ledger',
        ok: mismatch === 0 && orphanOpen.length === 0,
        detail:
          mismatch === 0 && orphanOpen.length === 0
            ? `Open charges less unapplied credits equal the receivable balance of ${scope.money(fromCents(owingBalance))}.`
            : `Open charges less unapplied credits differ from the receivable balance by ${scope.money(fromCents(mismatch))}. A journal entry may have changed a balance without a charge — review the lease ledgers.`,
      },
    ],
    sections: [
      {
        id: 'owing',
        title: 'Owed',
        columns: [
          ...columns,
          { key: 'b0', label: '0–30', kind: 'money', width: 100 },
          { key: 'b31', label: '31–60', kind: 'money', width: 100, hideBelow: 'sm' },
          { key: 'b61', label: '61–90', kind: 'money', width: 100, hideBelow: 'sm' },
          { key: 'b91', label: '90+', kind: 'money', width: 100, hideBelow: 'sm' },
          { key: 'unapplied', label: 'Credits', kind: 'money', width: 96, hideBelow: 'lg' },
          { key: 'balance', label: 'Balance', kind: 'money', width: 108 },
          ...tail,
        ],
        rows: owing.map(l => toRow(l, false)),
        totals: {
          id: 'total',
          kind: 'total',
          cells: {
            residents: `Total · ${owing.length} ${owing.length === 1 ? 'lease' : 'leases'}`,
            b0: fromCents(sum(owing, 'b0')),
            b31: fromCents(sum(owing, 'b31')),
            b61: fromCents(sum(owing, 'b61')),
            b91: fromCents(sum(owing, 'b91')),
            unapplied: -fromCents(sum(owing, 'unapplied')),
            balance: fromCents(owingBalance),
          },
        },
        sortable: true,
        empty: 'Nobody owes anything on this date.',
      },
      {
        id: 'credits',
        title: 'In credit',
        description: 'Payments and credits not yet applied to a charge. They apply automatically to the next charge, or can be refunded from the lease ledger.',
        columns: [...columns, { key: 'unapplied', label: 'Unapplied', kind: 'money', width: 110 }, { key: 'balance', label: 'Balance', kind: 'money', width: 108 }, ...tail],
        rows: credits.map(l => toRow(l, true)),
        totals: credits.length
          ? { id: 'ctotal', kind: 'total', cells: { residents: `Total · ${credits.length} ${credits.length === 1 ? 'lease' : 'leases'}`, unapplied: -fromCents(sum(credits, 'unapplied')), balance: fromCents(sum(credits, 'balance')) } }
          : null,
        sortable: true,
        empty: 'No lease is in credit on this date.',
      },
    ],
    notes: ['Days past due count from each charge’s due date. Charges not yet due are in 0–30. Former residents with balances are included.'],
  });
}
