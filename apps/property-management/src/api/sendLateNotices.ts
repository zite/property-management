import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDay, todayIn } from '@project/shared/dates';
import { formatAddress, joinNames } from '@project/shared/merge';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { findTemplate, leaseRecipients, sendTriggered } from '@project/shared/server/email';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings, lateFeeFor } from '@project/shared/server/settings';
import { day, num, ref, str } from '@project/shared/server/sql';
import { Id } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Email residents the organization's Late notice template, with their balance
 * and the oldest due date merged in. Leases that don't owe anything, or have
 * no one with an email address, are skipped and reported back. Sends go out
 * one at a time.
 */

const Input = z.object({ leaseIds: z.array(Id).min(1, 'Choose at least one lease.').max(300, 'Send at most 300 notices at a time.') });

export default createEndpoint({
  description: 'Send the Late notice email to residents who owe money',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'receivables.manage');
    const { leaseIds } = parseInput(Input, input);
    const ids = [...new Set(leaseIds)];
    const template = await findTemplate('Late notice');
    if (!template) throw new ZiteError('Your Late notice email template is turned off. Turn it on in Settings → Email templates, then try again.', 'CONFLICT');

    const [settings, chart] = await Promise.all([getSettings(), getChart()]);
    const today = todayIn(settings.timezone);
    const lateFee = chart.key('late_fee_income').id;
    const [balances, { rows }, { rows: dues }, { rows: fees }] = await Promise.all([
      leaseBalances(ids),
      zite.sql({
        query: `
          SELECT l.id, l."name", l."rent", l."propertyId", l."unitId", p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", u."name" AS "unitName"
          FROM "Leases" l LEFT JOIN "Properties" p ON p.id::text = l."propertyId" LEFT JOIN "Units" u ON u.id::text = l."unitId"
          WHERE l.id::text = ANY($1)`,
        params: [ids],
      }),
      zite.sql({
        query: `
          SELECT t."leaseId", MIN(COALESCE(t."dueDate", t."date")) AS due
          FROM "Transactions" t
          WHERE t."leaseId" = ANY($1) AND t."status" = 'Posted' AND t."kind" = 'Charge' AND COALESCE(t."dueDate", t."date") < $2
            AND t."amount" > COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0) + 0.004
          GROUP BY t."leaseId"`,
        params: [ids, today],
      }),
      zite.sql({
        query: `SELECT DISTINCT ON (t."leaseId") t."leaseId", t."amount" FROM "Transactions" t WHERE t."leaseId" = ANY($1) AND t."kind" = 'Charge' AND t."status" = 'Posted' AND t."accountId" = $2 ORDER BY t."leaseId", t."date" DESC`,
        params: [ids, lateFee],
      }),
    ]);
    const leases = new Map(rows.map(r => [String(r.id), r]));
    const dueBy = new Map(dues.map(d => [String(d.leaseId), day(d.due)]));
    const feeBy = new Map(fees.map(f => [String(f.leaseId), num(f.amount)]));

    const sent: Array<{ leaseId: string; recipients: number }> = [];
    const skipped: Array<{ leaseId: string; name: string; reason: string }> = [];
    for (const id of ids) {
      const l = leases.get(id);
      if (!l) {
        skipped.push({ leaseId: id, name: 'Lease', reason: 'no longer exists' });
        continue;
      }
      const name = str(l.name) ?? 'Lease';
      const balance = balances.get(id)?.balance ?? 0;
      if (!(balance > 0.004)) {
        skipped.push({ leaseId: id, name, reason: 'doesn’t owe anything' });
        continue;
      }
      const recipients = (await leaseRecipients(id)).filter(r => r.email);
      if (!recipients.length) {
        skipped.push({ leaseId: id, name, reason: 'has no resident with an email address' });
        continue;
      }
      const due = dueBy.get(id);
      const context = {
        balance_due: formatMoney(balance, settings.currency),
        due_date: due ? formatDay(due, 'long') : formatDay(today, 'long'),
        late_fee: formatMoney(feeBy.get(id) ?? lateFeeFor(settings, num(l.rent)), settings.currency),
        grace_period_days: String(settings.gracePeriodDays),
        rent_amount: formatMoney(num(l.rent), settings.currency),
        property_name: str(l.propertyName) ?? '',
        unit_name: str(l.unitName) ?? '',
        unit_address: formatAddress({ street: str(l.street), city: str(l.city), state: str(l.state), postalCode: str(l.postalCode) }, str(l.unitName)),
        tenant_names: joinNames(recipients.map(r => r.name)),
      };
      let delivered = 0;
      for (const recipient of recipients) {
        const res = await sendTriggered({ trigger: 'Late notice', settings, recipient, context, leaseId: id, propertyId: ref(l.propertyId), senderMemberId: actor.id }).catch(() => null);
        if (res && res.delivery !== 'Failed') delivered++;
      }
      if (delivered) {
        sent.push({ leaseId: id, recipients: delivered });
        await logActivity({
          entityType: 'lease', entityId: id, leaseId: id, propertyId: ref(l.propertyId), unitId: ref(l.unitId),
          action: 'late_notice_sent', summary: `sent a late notice for a balance of ${formatMoney(balance, settings.currency)}`, actorId: actor.id, actorName: actor.name,
        });
      } else {
        skipped.push({ leaseId: id, name, reason: 'email couldn’t be delivered' });
      }
    }
    return { sent: sent.length, emails: sent.reduce((s, x) => s + x.recipients, 0), skipped };
  },
});
