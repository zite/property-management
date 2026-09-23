import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { Pdf } from 'zitejs/pdf';
import { PAYMENT_METHODS } from '@project/shared/constants';
import { formatDay, isDay, todayIn } from '@project/shared/dates';
import { leaseRef } from '@project/shared/leases';
import { formatAddress } from '@project/shared/merge';
import { formatMoney, subMoney, sumMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { messagePerson } from '@project/shared/server/email';
import { applyDeposit, autoApply, leaseBalances, postCharge, refundDeposit } from '@project/shared/server/ledger';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { day, num, ref, str, withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { homeLabel, leasePeople, loadStaffLease, recipientOf } from '../server/leaseStaff';

/**
 * Settle a security deposit at move-out, in the order the law expects:
 * itemized deductions are charged to the lease, the held deposit pays what's
 * owed, and whatever is left goes back to the resident. The statement is
 * filed on the lease (shared to the portal) and sent to each resident.
 *
 * Every posting goes through the engine, one at a time. Deductions already
 * posted from an earlier, interrupted attempt show on the lease page and are
 * never re-posted by this call — only the ones sent in.
 */

const dayStr = z.string().refine(isDay, 'Choose a valid date.');

const Input = z.object({
  leaseId: z.string().min(1),
  date: dayStr,
  deductions: z.array(z.object({ description: z.string().trim().min(1, 'Describe each deduction.').max(200), accountId: z.string().min(1, 'Choose an account for each deduction.'), amount: z.number().positive('Each deduction needs an amount.').max(1_000_000) })).max(40).default([]),
  applyToBalance: z.boolean().default(true),
  refund: z.object({ paymentMethod: z.enum(PAYMENT_METHODS), reference: z.string().trim().max(80).optional(), bankAccountId: z.string().optional() }).nullable().default(null),
  sendStatement: z.boolean().default(true),
  note: z.string().trim().max(2000).optional(),
});

export default createEndpoint({
  description: 'Settle a security deposit: deductions, apply to balance, refund, statement',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    assertCan(actor, 'receivables.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = (n: number) => formatMoney(n, settings.currency);
    const lease = await loadStaffLease(data.leaseId);
    if (lease.status !== 'Active' && lease.status !== 'Ended') throw new ZiteError('Only an active or ended lease has a deposit to settle.', 'BAD_REQUEST');
    if (lease.depositSettledAt) throw new ZiteError(`This deposit was already settled on ${formatDay(lease.depositSettledAt.slice(0, 10))}.`, 'CONFLICT');
    if (lease.status === 'Active' && !lease.moveOutDate) throw new ZiteError('Record the residents’ notice and move-out date before settling the deposit.', 'BAD_REQUEST');
    if (data.date > today) throw new ZiteError('Settle the deposit with today’s date or earlier.', 'BAD_REQUEST');

    const chart = await getChart();
    for (const d of data.deductions) {
      const a = chart.byId.get(d.accountId);
      if (!a || a.accountType !== 'Income') throw new ZiteError(`Choose an income account for “${d.description}”.`, 'BAD_REQUEST');
    }
    const before = (await leaseBalances([lease.id])).get(lease.id) ?? { balance: 0, depositHeld: 0 };
    if (before.depositHeld <= 0.004 && !data.deductions.length) throw new ZiteError('There’s no deposit held on this lease to settle.', 'BAD_REQUEST');

    // Decide up front where every dollar of the deposit goes, so nothing posts for a settlement that can't finish.
    const projectedBalance = sumMoney([before.balance, ...data.deductions.map(d => d.amount)]);
    const projectedApplied = data.applyToBalance ? Math.max(0, Math.min(projectedBalance, before.depositHeld)) : 0;
    const projectedLeft = subMoney(before.depositHeld, projectedApplied);
    if (projectedLeft > 0.004 && !data.refund) throw new ZiteError(`${money(projectedLeft)} of deposit would still be held. Refund it, or apply it to the balance.`, 'BAD_REQUEST');

    const base = { entityType: 'lease' as const, entityId: lease.id, leaseId: lease.id, propertyId: lease.propertyId || null, unitId: lease.unitId || null, actorId: actor.id, actorName: actor.name };
    const posted: string[] = [];
    try {
      for (const [i, d] of data.deductions.entries()) {
        const p = await withRetry(() =>
          postCharge({ leaseId: lease.id, accountId: d.accountId, amount: d.amount, date: data.date, dueDate: data.date, description: d.description, source: 'Move-out', createdById: actor.id, skipAutoApply: i < data.deductions.length - 1 }),
        );
        posted.push(`#${p.number}`);
      }
      let mid = (await leaseBalances([lease.id])).get(lease.id) ?? { balance: 0, depositHeld: 0 };
      let applied = 0;
      if (data.applyToBalance && mid.balance > 0.004 && mid.depositHeld > 0.004) {
        applied = Math.min(mid.balance, mid.depositHeld);
        const p = await withRetry(() => applyDeposit({ leaseId: lease.id, amount: applied, date: data.date, createdById: actor.id }));
        posted.push(`#${p.number}`);
        mid = (await leaseBalances([lease.id])).get(lease.id) ?? mid;
      }
      let refunded = 0;
      if (data.refund && mid.depositHeld > 0.004) {
        refunded = mid.depositHeld;
        const refund = data.refund;
        const p = await withRetry(() => refundDeposit({ leaseId: lease.id, amount: refunded, date: data.date, paymentMethod: refund.paymentMethod, reference: refund.reference || null, bankAccountId: refund.bankAccountId || null, createdById: actor.id }));
        posted.push(`#${p.number}`);
      }
      await autoApply(lease.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ZiteError(posted.length ? `Stopped partway (${posted.join(', ')} posted): ${msg}. Reload the lease before trying again.` : msg, 'BAD_REQUEST');
    }

    await withRetry(() => zite.leases.update({ id: lease.id, record: { depositSettledAt: new Date().toISOString() } }));

    // ── The statement, from what's actually on the ledger ────────────────────
    const deposits = chart.key('deposits_held').id;
    const [after, { rows: moveOut }, { rows: depositCharges }] = await Promise.all([
      leaseBalances([lease.id]),
      zite.sql({ query: `SELECT "kind", "date", "amount", "description", "accountId", "paymentMethod", "reference" FROM "Transactions" WHERE "leaseId" = $1 AND "source" = 'Move-out' AND "status" = 'Posted' ORDER BY "date" ASC, "number" ASC`, params: [lease.id] }),
      zite.sql({ query: `SELECT COALESCE(SUM(jl."credit"), 0) AS held FROM "JournalLines" jl WHERE jl."leaseId" = $1 AND jl."accountId" = $2 AND COALESCE(jl."void", false) = false`, params: [lease.id, deposits] }),
    ]);
    const final = after.get(lease.id) ?? { balance: 0, depositHeld: 0 };
    const deductions = moveOut.filter(r => r.kind === 'Charge').map(r => ({ description: str(r.description) ?? '', amount: num(r.amount), date: day(r.date) }));
    const appliedTotal = sumMoney(moveOut.filter(r => r.kind === 'Deposit application').map(r => num(r.amount)));
    const refunds = moveOut.filter(r => r.kind === 'Refund' && ref(r.accountId) === deposits);
    const refundTotal = sumMoney(refunds.map(r => num(r.amount)));
    const depositReceived = num(depositCharges[0]?.held);
    const people = await leasePeople(lease.id);
    const address = formatAddress({ street: lease.street, city: lease.city, state: lease.state, postalCode: lease.postalCode }, lease.unitName);
    const refundLine = refunds[0] ? `${money(refundTotal)} refunded by ${str(refunds[0].paymentMethod) ?? 'check'}${refunds[0].reference ? ` #${refunds[0].reference}` : ''}` : 'Nothing refunded';

    const lines = [
      `Security deposit statement — ${address}`,
      `Lease ${leaseRef(lease.number)} · moved out ${formatDay(lease.moveOutDate ?? data.date, 'long')}`,
      '',
      `Deposit held: ${money(depositReceived)}`,
      ...(deductions.length ? ['', 'Deductions:', ...deductions.map(d => `  ${d.description}: ${money(d.amount)}`), `  Total deductions: ${money(sumMoney(deductions.map(d => d.amount)))}`] : ['', 'No deductions.']),
      '',
      `Applied to your balance: ${money(appliedTotal)}`,
      refundLine,
      final.balance > 0.004 ? `Balance still owed: ${money(final.balance)}` : final.balance < -0.004 ? `Credit remaining on your account: ${money(-final.balance)}` : 'Your account is paid in full.',
      ...(lease.forwardingAddress ? ['', `Forwarding address on file: ${lease.forwardingAddress}`] : []),
      ...(data.note ? ['', data.note] : []),
    ];
    const text = lines.join('\n');

    let documentUrl: string | null = null;
    try {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const row = (label: string, value: string, strong = false) => `<tr${strong ? ' class="total"' : ''}><td>${esc(label)}</td><td class="amt">${esc(value)}</td></tr>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;margin:48px;font-size:13px;line-height:1.5}
        h1{font-size:20px;margin:0 0 4px} .muted{color:#555} table{width:100%;border-collapse:collapse;margin-top:18px}
        td{padding:7px 0;border-bottom:1px solid #e5e5e5} .amt{text-align:right;font-variant-numeric:tabular-nums} .total td{font-weight:600;border-bottom:2px solid #111}
      </style></head><body>
        <div class="muted">${esc(settings.organizationName)}</div>
        <h1>Security deposit statement</h1>
        <div class="muted">${esc(address)} · Lease ${esc(leaseRef(lease.number))}</div>
        <div class="muted">Residents: ${esc(people.filter(p => p.role !== 'Guarantor').map(p => p.name).join(', '))} · Moved out ${esc(formatDay(lease.moveOutDate ?? data.date, 'long'))} · Statement date ${esc(formatDay(data.date, 'long'))}</div>
        <table>
          ${row('Security deposit held', money(depositReceived), true)}
          ${deductions.map(d => row(`Deduction — ${d.description}`, `−${money(d.amount)}`)).join('')}
          ${row('Applied to balance owed', `−${money(appliedTotal)}`)}
          ${row(refunds[0] ? `Refunded${refunds[0].paymentMethod ? ` by ${str(refunds[0].paymentMethod)}` : ''}${refunds[0].reference ? ` #${str(refunds[0].reference)}` : ''}` : 'Refunded', money(refundTotal), true)}
          ${row(final.balance > 0.004 ? 'Balance still owed' : final.balance < -0.004 ? 'Credit remaining' : 'Balance', money(Math.abs(final.balance)), true)}
        </table>
        ${lease.forwardingAddress ? `<p class="muted" style="margin-top:18px">Forwarding address: ${esc(lease.forwardingAddress)}</p>` : ''}
        ${data.note ? `<p style="margin-top:12px">${esc(data.note)}</p>` : ''}
      </body></html>`;
      const filename = `Deposit statement ${leaseRef(lease.number)} ${homeLabel(lease)}.pdf`.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-');
      const pdf = await Pdf.renderHtml({ html, filename });
      documentUrl = pdf.url || null;
      if (documentUrl) {
        const primary = people.find(p => p.role === 'Primary') ?? people[0];
        await withRetry(() =>
          zite.documents.create({
            record: { name: filename, url: documentUrl, category: 'Statement', propertyId: lease.propertyId || null, unitId: lease.unitId || null, leaseId: lease.id, tenantId: primary?.id ?? null, sharedWithTenant: true, sharedWithOwner: false, uploadedById: actor.id, uploadedByName: actor.name, mimeType: 'application/pdf', uploadedAt: new Date().toISOString() },
          }),
        );
      }
    } catch (e) {
      console.error('Deposit statement PDF failed', e instanceof Error ? e.message : e);
    }

    let sent = 0;
    if (data.sendStatement) {
      for (const p of people.filter(x => x.role === 'Primary' || x.role === 'Co-tenant')) {
        const res = await withRetry(() =>
          messagePerson({
            settings, recipient: recipientOf(p), subject: `Your security deposit statement — ${homeLabel(lease)}`,
            body: `Hi ${p.name.split(/\s+/)[0] || 'there'},\n\n${text}\n\n${settings.organizationName}`,
            deliver: Boolean(p.email), senderMemberId: actor.id, senderName: actor.name, leaseId: lease.id, propertyId: lease.propertyId || null,
            attachments: documentUrl ? [{ name: 'Deposit statement.pdf', url: documentUrl }] : undefined,
            button: portalLink(settings) ? { label: 'Open the portal', href: portalLink(settings) } : null,
          }),
        );
        if (res.delivery !== 'Failed') sent++;
      }
    }

    await logActivity({
      ...base, action: 'deposit_settled',
      summary: `settled the security deposit — ${deductions.length ? `${money(sumMoney(deductions.map(d => d.amount)))} in deductions, ` : ''}${appliedTotal ? `${money(appliedTotal)} applied to the balance, ` : ''}${money(refundTotal)} refunded`,
      data: { applied: appliedTotal, refunded: refundTotal, deductions: deductions.length, balance: final.balance },
    });

    return { depositHeld: depositReceived, deductions: sumMoney(deductions.map(d => d.amount)), applied: appliedTotal, refunded: refundTotal, balance: final.balance, documentUrl, sent, statement: text };
  },
});
