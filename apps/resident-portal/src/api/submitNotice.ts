import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { addDays, daysBetween, formatDay, isDay, todayIn } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { giveNotice } from '@project/shared/server/leases';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/identity';
import { homeLabel, officeRecipients, residentFor } from '../server/resident';

/** A resident gives notice to vacate. The office is told at once and plans the move-out. */

const Input = z.object({
  leaseId: z.string().min(1).max(64),
  moveOutDate: z.string().refine(isDay, 'Choose your move-out date.'),
  reason: z.string().trim().max(240, 'Keep the reason under 240 characters.').optional().default(''),
  forwardingAddress: z.string().trim().max(500, 'That address is too long.').optional().default(''),
});

export default createEndpoint({
  description: 'A resident gives notice to vacate',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    if (lease.status !== 'Active') throw new ZiteError('You can give notice on an active lease.', 'BAD_REQUEST');
    if (lease.noticeGivenOn || lease.moveOutDate) throw new ZiteError(`Notice was already given${lease.moveOutDate ? ` — your move-out date is ${formatDay(lease.moveOutDate, 'long')}` : ''}. Message the office to change it.`, 'CONFLICT');
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    if (data.moveOutDate < today) throw new ZiteError('Choose a move-out date from today onward.', 'BAD_REQUEST');
    if (data.moveOutDate > addDays(today, 400)) throw new ZiteError('That move-out date is more than a year away. Message the office instead.', 'BAD_REQUEST');

    await giveNotice(lease.id, { moveOutDate: data.moveOutDate, reason: data.reason || null, forwardingAddress: data.forwardingAddress || null, timezone: settings.timezone });
    const days = daysBetween(today, data.moveOutDate);
    const home = homeLabel(lease);
    await Promise.all([
      logActivity({
        entityType: 'lease',
        entityId: lease.id,
        action: 'notice_given',
        summary: `gave notice — moving out ${formatDay(data.moveOutDate)}${data.reason ? ` (${data.reason.slice(0, 120)})` : ''}`,
        actorName: me.name,
        data: { moveOutDate: data.moveOutDate, daysNotice: days },
        propertyId: lease.propertyId || null,
        unitId: lease.unitId || null,
        leaseId: lease.id,
        tenantId,
      }),
      officeRecipients(lease, 'residents.manage').then(ids =>
        notify({
          recipientIds: ids,
          kind: 'notice_given',
          title: `${me.name} gave notice — ${home} moving out ${formatDay(data.moveOutDate)}`,
          body: `${days} days' notice${days < 30 ? ' (less than 30 days)' : ''}.${data.reason ? ` Reason: ${data.reason}` : ''}`,
          link: `/leases/${lease.id}`,
          entityType: 'lease',
          entityId: lease.id,
          actorName: me.name,
        }),
      ),
    ]);
    return { moveOutDate: data.moveOutDate, daysNotice: days, noticeGivenOn: today };
  },
});
