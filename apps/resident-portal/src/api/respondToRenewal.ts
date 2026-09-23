import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { threadKey } from '@project/shared/server/email';
import { acceptRenewal, declineRenewal } from '@project/shared/server/leases';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { homeLabel, officeRecipients, residentFor } from '../server/resident';

/**
 * Accept or decline a renewal offer. Accepting extends this same lease — new
 * end date, and the new rent from the first month of the new term — so the
 * ledger, deposit and history carry on unbroken.
 */

const Input = z.object({
  leaseId: z.string().min(1).max(64),
  decision: z.enum(['accept', 'decline']),
  note: z.string().max(2000, 'Keep the note under 2,000 characters.').optional().default(''),
});

export default createEndpoint({
  description: 'A resident accepts or declines a renewal offer',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    if (lease.status !== 'Active' || lease.renewalStatus !== 'Offered') {
      throw new ZiteError(lease.renewalStatus === 'Accepted' ? 'This renewal was already accepted.' : lease.renewalStatus === 'Declined' ? 'This renewal was already declined. Contact the office if you changed your mind.' : "There's no open renewal offer on this lease.", 'CONFLICT');
    }
    const settings = await getSettings();
    const home = homeLabel(lease);
    const note = data.note.trim();
    const base = { entityType: 'lease' as const, entityId: lease.id, actorName: me.name, propertyId: lease.propertyId || null, unitId: lease.unitId || null, leaseId: lease.id, tenantId };

    let result: { newStart: string; newEnd: string; newRent: number; months: number } | null = null;
    if (data.decision === 'accept') {
      result = await acceptRenewal(lease.id, { timezone: settings.timezone });
      const money = formatMoney(result.newRent, settings.currency);
      await logActivity({ ...base, action: 'renewal_accepted', summary: `accepted the renewal — ${result.months} months at ${money}/mo through ${formatDay(result.newEnd)}`, data: { ...result } });
    } else {
      await declineRenewal(lease.id);
      await logActivity({ ...base, action: 'renewal_declined', summary: `declined the renewal offer${note ? ` — ${note.slice(0, 140)}` : ''}` });
    }

    if (note) {
      await zite.messages.create({
        record: {
          subject: data.decision === 'accept' ? 'Renewal accepted' : 'Renewal declined',
          body: note,
          thread: threadKey('tenant', tenantId),
          direction: 'Inbound',
          channel: 'Portal',
          tenantId,
          leaseId: lease.id,
          propertyId: lease.propertyId || null,
          senderName: me.name,
          delivery: 'Received',
          sentAt: new Date().toISOString(),
        },
      });
    }

    await notify({
      recipientIds: await officeRecipients(lease, 'leasing.manage'),
      kind: 'renewal_response',
      title: data.decision === 'accept' ? `${me.name} accepted the renewal for ${home}` : `${me.name} declined the renewal for ${home}`,
      body: result ? `${result.months} months at ${formatMoney(result.newRent, settings.currency)}/mo, through ${formatDay(result.newEnd)}.${note ? ` “${note.slice(0, 160)}”` : ''}` : note || 'Plan for a move-out when the lease ends.',
      link: `/leases/${lease.id}`,
      entityType: 'lease',
      entityId: lease.id,
      actorName: me.name,
    });

    return { decision: data.decision, renewal: result };
  },
});
