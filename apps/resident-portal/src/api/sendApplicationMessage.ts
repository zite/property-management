import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { applicationRef } from '@project/shared/leases';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { num, ref, str } from '@project/shared/server/sql';
import { ACCEPTS_MESSAGES, PortalMessageSchema, findListingById, leasingRecipients, toPortalMessage } from '../server/applications';
import { parseInput, requireOwnApplication } from '../server/identity';

/**
 * A message from an applicant to the leasing office, in the application's
 * conversation. The person handling the application hears about it; if nobody
 * is yet, the listing's leasing contact or the leasing team does.
 */
const Input = z.object({ id: z.string().min(1).max(64), body: z.string().max(5000, 'Shorten your message to 5,000 characters.').default('') });

export default createEndpoint({
  description: 'Send a message to the leasing office about one of your applications',
  authenticated: true,
  inputSchema: Input,
  outputSchema: PortalMessageSchema,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const body = data.body.trim();
    if (!body) throw new ZiteError('Write a message before sending.', 'BAD_REQUEST');
    const app = await requireOwnApplication(context, data.id);
    const status = String(app.status);
    if (status === 'Draft') throw new ZiteError('Submit your application first — then you can message the office about it here.', 'CONFLICT');
    if (!ACCEPTS_MESSAGES.includes(status) || status === 'Withdrawn') throw new ZiteError('This application was withdrawn, so messages are closed. Contact the office directly if you need to reach them.', 'CONFLICT');

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { rows: recent } = await zite.sql({ query: `SELECT COUNT(*) AS n FROM "Messages" WHERE "applicationId" = $1 AND "direction" = 'Inbound' AND created_at >= $2`, params: [data.id, since] });
    if (num(recent[0]?.n) >= 15) throw new ZiteError('You’ve sent a lot of messages in the last hour. The office will reply soon — please wait before sending more.', 'RATE_LIMITED');

    const settings = await getSettings();
    const name = str(app.applicantName) || 'Applicant';
    const number = num(app.number);
    const reference = applicationRef(number);
    const now = new Date().toISOString();
    const created = await zite.messages.create({
      record: {
        subject: `Message about ${reference}`,
        body,
        thread: `applicant:${data.id}`,
        direction: 'Inbound',
        channel: 'Portal',
        applicationId: data.id,
        propertyId: ref(app.propertyId),
        senderName: name,
        delivery: 'Received',
        sentAt: now,
      },
    });
    await zite.applications.update({ id: data.id, record: { lastActivityAt: now } }).catch(() => undefined);

    const assignee = ref(app.assigneeId);
    let recipients: string[] = [];
    if (assignee) {
      const { rows } = await zite.sql({ query: `SELECT id FROM "Members" WHERE id::text = $1 AND COALESCE("status", '') <> 'Deactivated'`, params: [assignee] });
      if (rows[0]) recipients = [assignee];
    }
    if (!recipients.length) {
      const listing = await findListingById(String(app.listingId ?? ''));
      recipients = (await leasingRecipients(ref(listing?.contactMemberId))).map(m => m.id);
    }
    await notify({
      recipientIds: recipients,
      kind: 'message_received',
      title: `${name} sent a message about ${reference}`,
      body: body.slice(0, 400),
      link: number ? `/applications/${number}` : '/applications',
      entityType: 'application',
      entityId: data.id,
      actorName: name,
    });

    return toPortalMessage({ id: created.id, direction: 'Inbound', senderName: name, subject: `Message about ${reference}`, body, sentAt: now }, settings.organizationName);
  },
});
