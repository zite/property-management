import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { Pdf } from 'zitejs/pdf';
import { formatDay } from '@project/shared/dates';
import { joinNames } from '@project/shared/merge';
import { formatMoney, fromCents, sumMoney, toCents } from '@project/shared/money';
import { leaseLedger } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { homeLabel, residentFor } from '../server/resident';

/**
 * A receipt for one payment on the resident's lease: what was paid, how, and
 * which charges it paid. With `pdf: true` it also renders a printable PDF.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish(), transactionId: z.string().min(1).max(64), pdf: z.boolean().optional() });

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default createEndpoint({
  description: 'A payment receipt for a resident, optionally as a PDF',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId, transactionId, pdf } = parseInput(Input, input);
    const me = await residentFor(context, leaseId);
    const { lease } = me;
    const { rows } = await zite.sql({
      query: `SELECT t.*, tn."name" AS "payerName" FROM "Transactions" t LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId" WHERE t.id::text = $1 AND t."leaseId" = $2 AND t."kind" = 'Payment' LIMIT 1`,
      params: [transactionId, lease.id],
    });
    const t = rows[0];
    if (!t) throw new ZiteError("We couldn't find that payment.", 'NOT_FOUND');

    const settings = await getSettings();
    const [{ rows: allocs }, { rows: household }, ledger] = await Promise.all([
      zite.sql({
        query: `SELECT a."amount", c."description", c."dueDate", c."date" FROM "Allocations" a JOIN "Transactions" c ON c.id::text = a."chargeId" WHERE a."paymentId" = $1 AND COALESCE(a."void", false) = false AND c."status" = 'Posted' ORDER BY COALESCE(c."dueDate", c."date") ASC, c."number" ASC`,
        params: [transactionId],
      }),
      zite.sql({
        query: `SELECT t."name" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at ASC`,
        params: [lease.id],
      }),
      leaseLedger(lease.id),
    ]);

    const amount = num(t.amount);
    const applied = allocs.map(a => ({ description: str(a.description) || 'Charge', amount: num(a.amount), dueDate: a.dueDate ? String(a.dueDate).slice(0, 10) : null }));
    const unapplied = fromCents(Math.max(0, toCents(amount) - toCents(sumMoney(applied.map(a => a.amount)))));
    const entry = ledger.entries.find(e => e.id === transactionId);
    const online = t.source === 'Online payment' || t.paymentMethod === 'Online';
    const method = online ? `Online${ref(t.reference) ? ` · ${t.reference}` : ''}` : [str(t.paymentMethod) || 'Payment', t.paymentMethod === 'Check' && ref(t.reference) ? `#${t.reference}` : ''].filter(Boolean).join(' ');

    const receipt = {
      id: String(t.id),
      number: num(t.number),
      date: String(t.date ?? '').slice(0, 10),
      amount,
      method,
      reference: online ? null : ref(t.reference),
      reversed: t.status === 'Void',
      reversedOn: iso(t.voidedAt)?.slice(0, 10) ?? null,
      payerName: str(t.payerName) || me.name,
      household: joinNames(household.map(h => str(h.name))),
      home: homeLabel(lease),
      address: lease.address,
      applied,
      unapplied,
      balanceAfter: entry?.runningBalance ?? null,
      organization: { name: settings.organizationName, address: settings.address, phone: settings.phone, email: settings.supportEmail, logoUrl: settings.logoUrl },
      currency: settings.currency,
    };

    let pdfUrl: string | null = null;
    if (pdf) {
      const m = (n: number) => esc(formatMoney(n, settings.currency));
      const rowsHtml = [
        ...applied.map(a => `<tr><td>${esc(a.description)}${a.dueDate ? `<div class="muted">Due ${esc(formatDay(a.dueDate, 'long'))}</div>` : ''}</td><td class="num">${m(a.amount)}</td></tr>`),
        ...(unapplied > 0 ? [`<tr><td>Credit on your account<div class="muted">Applied automatically to your next charges</div></td><td class="num">${m(unapplied)}</td></tr>`] : []),
      ].join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: letter; margin: 0.7in; }
        * { box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1a1d23; font-size: 11pt; line-height: 1.5; margin: 0; }
        .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${esc(settings.brandColor)}; padding-bottom: 18px; }
        .org { font-size: 15pt; font-weight: 700; letter-spacing: -0.01em; }
        .org-detail { color: #5b6270; font-size: 9.5pt; white-space: pre-line; margin-top: 2px; }
        .logo { max-height: 44px; max-width: 200px; }
        h1 { font-size: 22pt; margin: 28px 0 2px; letter-spacing: -0.02em; }
        .sub { color: #5b6270; margin: 0; }
        .void { display: inline-block; margin-top: 10px; padding: 3px 10px; border-radius: 999px; background: #fde8e8; color: #9b1c1c; font-weight: 600; font-size: 9.5pt; }
        .amount { margin: 26px 0; padding: 18px 22px; border-radius: 10px; background: #f4f6f8; display: flex; justify-content: space-between; align-items: baseline; }
        .amount .label { color: #5b6270; font-size: 10pt; text-transform: uppercase; letter-spacing: 0.06em; }
        .amount .value { font-size: 24pt; font-weight: 700; font-variant-numeric: tabular-nums; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 32px; margin-bottom: 26px; }
        .k { color: #5b6270; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; }
        .v { font-weight: 500; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5b6270; border-bottom: 1px solid #dde1e6; padding: 8px 0; }
        td { border-bottom: 1px solid #eef0f3; padding: 10px 0; vertical-align: top; }
        .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .muted { color: #6b7280; font-size: 9pt; }
        tfoot td { border-bottom: 0; font-weight: 700; padding-top: 12px; }
        .foot { margin-top: 36px; color: #6b7280; font-size: 9pt; }
      </style></head><body>
        <div class="top">
          <div>
            ${settings.logoUrl && /^https:\/\//.test(settings.logoUrl) ? `<img class="logo" src="${esc(settings.logoUrl)}" alt="">` : `<div class="org">${esc(settings.organizationName)}</div>`}
            <div class="org-detail">${esc([settings.address, [settings.phone, settings.supportEmail].filter(Boolean).join(' · ')].filter(Boolean).join('\n'))}</div>
          </div>
          <div style="text-align:right"><div class="k">Receipt</div><div class="v">#${receipt.number}</div></div>
        </div>
        <h1>Payment receipt</h1>
        <p class="sub">Thank you — we received your payment.</p>
        ${receipt.reversed ? `<span class="void">This payment was reversed${receipt.reversedOn ? ` on ${esc(formatDay(receipt.reversedOn, 'long'))}` : ''}</span>` : ''}
        <div class="amount"><span class="label">Amount paid</span><span class="value">${m(amount)}</span></div>
        <div class="grid">
          <div><div class="k">Paid by</div><div class="v">${esc(receipt.payerName)}</div></div>
          <div><div class="k">Date</div><div class="v">${esc(formatDay(receipt.date, 'long'))}</div></div>
          <div><div class="k">Home</div><div class="v">${esc(receipt.address || receipt.home)}</div></div>
          <div><div class="k">Payment method</div><div class="v">${esc(method)}</div></div>
          ${receipt.household && receipt.household !== receipt.payerName ? `<div><div class="k">Residents</div><div class="v">${esc(receipt.household)}</div></div>` : ''}
          ${receipt.balanceAfter != null ? `<div><div class="k">Balance after this payment</div><div class="v">${m(Math.max(0, receipt.balanceAfter))}${receipt.balanceAfter < 0 ? ` (credit ${m(-receipt.balanceAfter)})` : ''}</div></div>` : ''}
        </div>
        <table>
          <thead><tr><th>What this payment paid</th><th class="num">Amount</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="2" class="muted">Held as a credit on your account.</td></tr>`}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${m(amount)}</td></tr></tfoot>
        </table>
        <p class="foot">${esc(settings.organizationName)} · Receipt #${receipt.number} · Generated ${esc(formatDay(new Date().toISOString().slice(0, 10), 'long'))}</p>
      </body></html>`;
      const rendered = await Pdf.renderHtml({ html, filename: `Receipt ${receipt.number} — ${receipt.home || 'payment'}.pdf` });
      pdfUrl = rendered.url;
    }

    return { receipt, pdfUrl };
  },
});
