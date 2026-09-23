import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, toCents } from '@project/shared/money';
import { isDebitNormal, type AccountRow } from '@project/shared/server/accounts';
import { day, num, Params, ref, str } from '@project/shared/server/sql';
import { periodUrlParams, reportHref } from '../../components/reports/catalog';
import type { ReportRow, ReportSection } from '../../components/reports/doc';
import { accountLabel, collator, compact, envelope, inProperties, joinLabel, LINE_IS_POSTED, links, periodOf, POSTED_LINES, type ReportScope } from './common';

/**
 * General ledger for a period. With no account chosen it's a summary — each
 * account's opening balance, debits, credits and closing balance — because
 * the full register runs to thousands of lines. Choose accounts to see every
 * line with a running balance, a page of 500 lines at a time; the running
 * balance is computed in SQL across the whole period, so page 3 carries the
 * right balance forward.
 */

export const GL_PAGE_SIZE = 500;

const KIND_LABEL: Record<string, string> = {
  Charge: 'Charge', Payment: 'Payment', Credit: 'Credit', Refund: 'Refund', 'Deposit application': 'Deposit applied', Bill: 'Bill', 'Bill payment': 'Bill payment',
  Expense: 'Expense', 'Owner contribution': 'Contribution', 'Owner distribution': 'Distribution', 'Management fee': 'Mgmt fee', Transfer: 'Transfer', 'Journal entry': 'Journal entry',
};

export async function buildGeneralLedger(scope: ReportScope) {
  const { from, to, label } = periodOf(scope);
  const chosen = (scope.input.accountIds ?? []).filter(id => scope.chart.byId.has(id));
  if (scope.input.accountIds?.length && !chosen.length) throw new ZiteError('Those accounts no longer exist. Clear the account filter.', 'BAD_REQUEST');

  const p = new Params();
  const accountFilter = chosen.length ? `AND jl."accountId" = ANY(${p.add(chosen)})` : '';
  const fromP = p.add(from);
  const toP = p.add(to);
  const summary = await zite.sql({
    query: `
      SELECT jl."accountId",
        SUM(CASE WHEN jl."date" < ${fromP}::date THEN COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0) ELSE 0 END) AS opening,
        SUM(CASE WHEN jl."date" >= ${fromP}::date THEN COALESCE(jl."debit", 0) ELSE 0 END) AS debits,
        SUM(CASE WHEN jl."date" >= ${fromP}::date THEN COALESCE(jl."credit", 0) ELSE 0 END) AS credits,
        COUNT(*) FILTER (WHERE jl."date" >= ${fromP}::date) AS lines
      FROM ${POSTED_LINES}
      WHERE ${LINE_IS_POSTED} AND jl."date" <= ${toP}::date ${accountFilter} ${inProperties(p, 'jl."propertyId"', scope)}
      GROUP BY jl."accountId"`,
    params: p.values,
  });

  type Sum = { account: AccountRow; opening: number; debits: number; credits: number; lines: number };
  const sums = new Map<string, Sum>();
  for (const r of summary.rows) {
    const account = scope.chart.byId.get(String(r.accountId));
    if (!account) continue;
    sums.set(account.id, { account, opening: toCents(num(r.opening)), debits: toCents(num(r.debits)), credits: toCents(num(r.credits)), lines: num(r.lines) });
  }
  const ordered = [...scope.chart.all].sort((a, b) => collator.compare(a.number, b.number) || collator.compare(a.name, b.name));
  /** Show a balance the way the account normally reads: assets and expenses debit-positive, the rest credit-positive. */
  const signed = (a: AccountRow, net: number) => (isDebitNormal(a.accountType) ? net : -net);
  const subtitleBase = joinLabel(label, scope.propertyLabel);

  if (!chosen.length) {
    const rows: ReportRow[] = [];
    let debits = 0;
    let credits = 0;
    let lineCount = 0;
    for (const type of ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const) {
      const typeRows: ReportRow[] = [];
      for (const a of ordered.filter(x => x.accountType === type)) {
        const s = sums.get(a.id);
        if (!s || (!s.opening && !s.lines)) continue;
        debits += s.debits;
        credits += s.credits;
        lineCount += s.lines;
        const net = s.debits - s.credits;
        typeRows.push({
          id: a.id,
          depth: 1,
          cells: { account: accountLabel(a), opening: fromCents(signed(a, s.opening)), debits: fromCents(s.debits), credits: fromCents(s.credits), closing: fromCents(signed(a, s.opening + net)), lines: s.lines },
          links: { account: reportHref('general-ledger', { accounts: [a.id], properties: scope.propertyIds ?? undefined, ...periodUrlParams(from, to, scope.today) }) },
        });
      }
      if (!typeRows.length) continue;
      rows.push({ id: `g:${type}`, kind: 'group', cells: { account: type === 'Liability' ? 'Liabilities' : type === 'Equity' || type === 'Income' ? type : `${type}s` } });
      rows.push(...typeRows);
    }
    return envelope(scope, {
      subtitle: joinLabel(subtitleBase, 'All accounts'),
      figures: [
        { label: 'Lines posted', value: lineCount, kind: 'number' },
        { label: 'Total debits', value: fromCents(debits), kind: 'money' },
        { label: 'Total credits', value: fromCents(credits), kind: 'money' },
      ],
      checks: [{ label: debits === credits ? 'Debits equal credits for the period' : 'Debits don’t equal credits for the period', ok: debits === credits, detail: debits === credits ? `${scope.money(fromCents(debits))} each.` : `They differ by ${scope.money(fromCents(debits - credits))}.` }],
      sections: [
        {
          id: 'summary',
          description: 'Choose an account to see every line with its running balance.',
          columns: [
            { key: 'account', label: 'Account', kind: 'text' },
            { key: 'opening', label: 'Opening', kind: 'money', width: 130, hideBelow: 'sm' },
            { key: 'debits', label: 'Debits', kind: 'money', width: 130 },
            { key: 'credits', label: 'Credits', kind: 'money', width: 130 },
            { key: 'closing', label: 'Closing', kind: 'money', width: 130 },
            { key: 'lines', label: 'Lines', kind: 'number', width: 70, hideBelow: 'md' },
          ],
          rows,
          totals: { id: 'total', kind: 'total', cells: { account: 'Total', debits: fromCents(debits), credits: fromCents(credits), lines: lineCount } },
          empty: 'Nothing was posted in this period.',
        },
      ],
      notes: ['Opening and closing balances read the way each account normally does: assets and expenses as debits, liabilities, equity and income as credits.'],
    });
  }

  // ── Detail: the lines ──
  const accounts = ordered.filter(a => chosen.includes(a.id));
  const totalRows = accounts.reduce((n, a) => n + (sums.get(a.id)?.lines ?? 0), 0);
  const pages = Math.max(1, Math.ceil(totalRows / GL_PAGE_SIZE));
  const page = Math.min(Math.max(1, scope.input.page ?? 1), pages);
  const offset = (page - 1) * GL_PAGE_SIZE;

  const lp = new Params();
  const { rows: lines } = totalRows
    ? await zite.sql({
        query: `
          SELECT x.* FROM (
            SELECT jl.id, jl."accountId", jl."date", jl."memo", jl."debit", jl."credit", jl."propertyId", jl."unitId", jl."leaseId",
              t.id AS "txnId", t."number", t."kind", t."description", t."reference", t."vendorId", t."ownerId",
              pr."name" AS "propertyName", un."name" AS "unitName", COALESCE(NULLIF(tn."name", ''), NULLIF(v."name", ''), o."name") AS party,
              SUM(COALESCE(jl."debit", 0) - COALESCE(jl."credit", 0)) OVER (PARTITION BY jl."accountId" ORDER BY jl."date", t."number", jl.id) AS running,
              ROW_NUMBER() OVER (PARTITION BY jl."accountId" ORDER BY jl."date", t."number", jl.id) AS seq,
              ROW_NUMBER() OVER (ORDER BY a."number", jl."accountId", jl."date", t."number", jl.id) AS rn
            FROM ${POSTED_LINES}
            JOIN "Accounts" a ON a.id::text = jl."accountId"
            LEFT JOIN "Properties" pr ON pr.id::text = jl."propertyId"
            LEFT JOIN "Units" un ON un.id::text = jl."unitId"
            LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
            LEFT JOIN "Vendors" v ON v.id::text = COALESCE(NULLIF(jl."vendorId", ''), t."vendorId")
            LEFT JOIN "Owners" o ON o.id::text = COALESCE(NULLIF(jl."ownerId", ''), t."ownerId")
            WHERE ${LINE_IS_POSTED} AND jl."accountId" = ANY(${lp.add(chosen)}) AND jl."date" >= ${lp.add(from)}::date AND jl."date" <= ${lp.add(to)}::date
              ${inProperties(lp, 'jl."propertyId"', scope)}
          ) x
          WHERE x.rn > ${lp.add(offset)} AND x.rn <= ${lp.add(offset + GL_PAGE_SIZE)}
          ORDER BY x.rn`,
        params: lp.values,
      })
    : { rows: [] as Array<Record<string, unknown>> };

  const byAccount = new Map<string, Array<Record<string, unknown>>>();
  for (const l of lines) {
    const k = String(l.accountId);
    if (!byAccount.has(k)) byAccount.set(k, []);
    byAccount.get(k)!.push(l);
  }

  const sections: ReportSection[] = [];
  for (const a of accounts) {
    const s = sums.get(a.id) ?? { account: a, opening: 0, debits: 0, credits: 0, lines: 0 };
    const accountLines = byAccount.get(a.id) ?? [];
    // Accounts whose lines all sit on other pages are left out of this page.
    if (s.lines > 0 && !accountLines.length) continue;
    const rows: ReportRow[] = [];
    const first = accountLines[0];
    const startsHere = !first || num(first.seq) === 1;
    const broughtForward = first ? s.opening + toCents(num(first.running)) - (toCents(num(first.debit)) - toCents(num(first.credit))) : s.opening;
    rows.push({ id: `${a.id}:open`, kind: 'subtotal', cells: { date: startsHere ? from : day(first?.date), description: startsHere ? 'Opening balance' : 'Brought forward', balance: fromCents(signed(a, broughtForward)) } });
    for (const l of accountLines) {
      const txn = { id: String(l.txnId), kind: String(l.kind), leaseId: ref(l.leaseId), vendorId: ref(l.vendorId), ownerId: ref(l.ownerId), propertyId: ref(l.propertyId) };
      const href = links.transaction(txn);
      const memo = str(l.memo) ?? '';
      const description = str(l.description) ?? '';
      rows.push({
        id: String(l.id),
        cells: {
          date: day(l.date),
          number: `#${num(l.number)}`,
          kind: KIND_LABEL[String(l.kind)] ?? String(l.kind),
          description: memo && memo !== description ? `${description} — ${memo}` : description,
          location: [str(l.propertyName), str(l.unitName)].filter(Boolean).join(' · ') || null,
          party: str(l.party) || null,
          debit: num(l.debit) ? num(l.debit) : null,
          credit: num(l.credit) ? num(l.credit) : null,
          balance: fromCents(signed(a, s.opening + toCents(num(l.running)))),
        },
        links: compact({ description: href, number: href }),
        hints: compact({ description: str(l.reference) ? `Ref ${str(l.reference)}` : undefined }),
      });
    }
    const last = accountLines[accountLines.length - 1];
    const endsHere = !last || num(last.seq) === s.lines;
    if (endsHere) {
      rows.push({ id: `${a.id}:close`, kind: 'total', cells: { date: to, description: `Closing balance · ${s.lines} ${s.lines === 1 ? 'line' : 'lines'}`, debit: fromCents(s.debits), credit: fromCents(s.credits), balance: fromCents(signed(a, s.opening + s.debits - s.credits)) } });
    }
    sections.push({
      id: a.id,
      title: accountLabel(a),
      description: `${a.accountType}${a.subtype ? ` · ${a.subtype}` : ''} · balances read as ${isDebitNormal(a.accountType) ? 'debits' : 'credits'}${endsHere ? '' : ' · continues on the next page'}`,
      columns: [
        { key: 'date', label: 'Date', kind: 'date', width: 108 },
        { key: 'number', label: 'Txn', kind: 'text', width: 70, hideBelow: 'md' },
        { key: 'kind', label: 'Type', kind: 'text', width: 104, hideBelow: 'lg' },
        { key: 'description', label: 'Description', kind: 'text' },
        { key: 'location', label: 'Property', kind: 'text', width: 170, hideBelow: 'xl' },
        { key: 'party', label: 'Name', kind: 'text', width: 150, hideBelow: 'lg' },
        { key: 'debit', label: 'Debit', kind: 'money', width: 112 },
        { key: 'credit', label: 'Credit', kind: 'money', width: 112 },
        { key: 'balance', label: 'Balance', kind: 'money', width: 124, hideBelow: 'sm' },
      ],
      rows,
      tall: rows.length > 40,
    });
  }

  const debits = accounts.reduce((n, a) => n + (sums.get(a.id)?.debits ?? 0), 0);
  const credits = accounts.reduce((n, a) => n + (sums.get(a.id)?.credits ?? 0), 0);
  return envelope(scope, {
    subtitle: joinLabel(subtitleBase, accounts.length === 1 ? accountLabel(accounts[0]) : `${accounts.length} accounts`),
    figures: [
      { label: 'Lines', value: totalRows, kind: 'number', hint: pages > 1 ? `Page ${page} of ${pages}` : undefined },
      { label: 'Debits', value: fromCents(debits), kind: 'money' },
      { label: 'Credits', value: fromCents(credits), kind: 'money' },
      ...(accounts.length === 1
        ? [
            { label: 'Opening balance', value: fromCents(signed(accounts[0], sums.get(accounts[0].id)?.opening ?? 0)), kind: 'money' as const },
            { label: 'Closing balance', value: fromCents(signed(accounts[0], (sums.get(accounts[0].id)?.opening ?? 0) + debits - credits)), kind: 'money' as const },
          ]
        : []),
    ],
    sections,
    page: { page, pages, totalRows, pageSize: GL_PAGE_SIZE },
    notes: [pages > 1 ? `Showing lines ${offset + 1}–${Math.min(totalRows, offset + GL_PAGE_SIZE)} of ${totalRows}. Export CSV exports this page.` : 'Balances read the way each account normally does: assets and expenses as debits, liabilities, equity and income as credits.'],
  });
}
