import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, formatDay, isDay, todayIn } from '@project/shared/dates';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { threadKey } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { assertDailyLimit, homeLabel, officeRecipients, residentFor } from '../server/resident';

/**
 * "I've paid" — a resident tells the office about a check, money order or
 * bank transfer they sent. It becomes a message in their conversation and a
 * note in the office's inbox. It does NOT post money: staff record the
 * payment when it actually arrives.
 */

const METHODS = ['Check', 'Money order', 'ACH', 'Cash', 'Card', 'Other'] as const;
const METHOD_WORDS: Record<(typeof METHODS)[number], string> = { Check: 'check', 'Money order': 'money order', ACH: 'bank transfer', Cash: 'cash', Card: 'card', Other: 'another method' };

const Input = z.object({
  leaseId: z.string().max(64).nullish(),
  amount: z.number().finite(),
  method: z.enum(METHODS),
  date: z.string().refine(isDay, 'Choose the date you paid.'),
  reference: z.string().max(80).optional().default(''),
  note: z.string().max(1000).optional().default(''),
});

export default createEndpoint({
  description: 'Tell the office about a payment made outside the portal',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const cents = toCents(data.amount);
    if (cents < 100) throw new ZiteError('Enter the amount you paid.', 'BAD_REQUEST');
    if (cents > 100_000_00) throw new ZiteError('That amount looks too large. Check it and try again.', 'BAD_REQUEST');
    if (data.date > addDays(today, 1)) throw new ZiteError("The payment date can't be in the future.", 'BAD_REQUEST');
    if (data.date < addDays(today, -90)) throw new ZiteError('For payments more than 90 days ago, please message the office.', 'BAD_REQUEST');
    await assertDailyLimit('Messages', 'tenantId', tenantId, 40, 'messages');

    const money = formatMoney(fromCents(cents), settings.currency);
    const how = METHOD_WORDS[data.method];
    const reference = data.reference.trim();
    const lines = [
      `I paid ${money} by ${how} on ${formatDay(data.date, 'long')}.`,
      reference ? `${data.method === 'Check' ? 'Check number' : 'Reference'}: ${reference}` : '',
      data.note.trim(),
      `— ${me.name}, ${homeLabel(lease)}`,
    ].filter(Boolean);

    const now = new Date().toISOString();
    const message = await zite.messages.create({
      record: {
        subject: `Payment sent: ${money} by ${how}`,
        body: lines.join('\n\n'),
        thread: threadKey('tenant', tenantId),
        direction: 'Inbound',
        channel: 'Portal',
        tenantId,
        leaseId: lease.id,
        propertyId: lease.propertyId || null,
        senderName: me.name,
        delivery: 'Received',
        sentAt: now,
      },
    });

    const recipients = await officeRecipients(lease, 'receivables.manage');
    await Promise.all([
      notify({
        recipientIds: recipients,
        kind: 'payment_received',
        title: `${me.name} says they paid ${money} by ${how}`,
        body: `${homeLabel(lease)} · ${formatDay(data.date)}${reference ? ` · ${reference}` : ''}. Not recorded yet — post it when it arrives.`,
        link: `/leases/${lease.id}`,
        entityType: 'lease',
        entityId: lease.id,
        actorName: me.name,
      }),
      logActivity({
        entityType: 'lease',
        entityId: lease.id,
        action: 'payment_reported',
        summary: `reported paying ${money} by ${how} on ${formatDay(data.date)} (not yet recorded)`,
        actorName: me.name,
        data: { amount: fromCents(cents), method: data.method, date: data.date, reference },
        propertyId: lease.propertyId || null,
        unitId: lease.unitId || null,
        leaseId: lease.id,
        tenantId,
      }),
    ]);

    return { messageId: message.id, amount: fromCents(cents), sentAt: now };
  },
});
