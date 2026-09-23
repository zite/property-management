import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { applicationRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { num, ref, str } from '@project/shared/server/sql';
import { WITHDRAWABLE, findListingById, leasingRecipients } from '../server/applications';
import { assertReasonable, parseInput, requireOwnApplication } from '../server/identity';

/**
 * Take an application back. A draft nobody has seen is simply deleted; a sent
 * application is marked Withdrawn so the leasing team's records stay whole,
 * the reason (if given) lands in the conversation, and whoever is handling it
 * is told.
 */
const Input = z.object({ id: z.string().min(1).max(64), reason: z.string().max(1000, 'Shorten your note to 1,000 characters.').default('') });

export default createEndpoint({
  description: 'Withdraw a submitted application, or delete a draft',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), deleted: z.boolean(), status: z.string() }),
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const app = await requireOwnApplication(context, data.id);
    const status = String(app.status);
    if (!WITHDRAWABLE.includes(status)) {
      const why = status === 'Withdrawn' ? 'This application was already withdrawn.' : status === 'Leased' ? 'This application became a lease, so it can’t be withdrawn. Message the office instead.' : 'A decision has been made on this application, so it can’t be withdrawn.';
      throw new ZiteError(why, 'CONFLICT');
    }

    if (status === 'Draft') {
      await zite.applications.delete({ id: data.id });
      return { id: data.id, deleted: true, status: 'Deleted' };
    }

    assertReasonable(data.reason, 1000);
    const reason = data.reason.trim();
    const now = new Date().toISOString();
    const name = str(app.applicantName) || 'The applicant';
    const number = num(app.number);
    const reference = applicationRef(number);
    const listing = await findListingById(String(app.listingId ?? ''));
    const title = str(listing?.title) || 'the home';

    await zite.applications.update({ id: data.id, record: { status: 'Withdrawn', lastActivityAt: now } });

    const inquiryId = ref(app.inquiryId);
    if (inquiryId) {
      const { rows } = await zite.sql({ query: `SELECT "status" FROM "Inquiries" WHERE id::text = $1`, params: [inquiryId] });
      if (rows[0]?.status === 'Applied') await zite.inquiries.update({ id: inquiryId, record: { status: 'Closed' } }).catch(() => undefined);
    }

    if (reason) {
      await zite.messages.create({
        record: {
          subject: `Withdrew ${reference}`,
          body: reason,
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
    }

    const assignee = ref(app.assigneeId);
    const recipients = assignee ? [assignee] : (await leasingRecipients(ref(listing?.contactMemberId))).map(m => m.id);
    await notify({
      recipientIds: recipients,
      kind: 'application_withdrawn',
      title: `${name} withdrew their application for ${title}`,
      body: reason ? `${reference} · “${reason.slice(0, 300)}”` : `${reference} · No reason given`,
      link: number ? `/applications/${number}` : '/applications',
      entityType: 'application',
      entityId: data.id,
      actorName: name,
    });
    await logActivity({
      entityType: 'application',
      entityId: data.id,
      action: 'withdrawn',
      summary: 'withdrew the application',
      actorName: name,
      applicationId: data.id,
      propertyId: ref(app.propertyId),
      unitId: ref(app.unitId),
      data: { from: status, to: 'Withdrawn', reason: reason || null, source: 'Portal' },
    });
    return { id: data.id, deleted: false, status: 'Withdrawn' };
  },
});
