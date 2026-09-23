import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { applicationRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { sendTriggered } from '@project/shared/server/email';
import { nextNumber } from '@project/shared/server/ledger';
import { notify } from '@project/shared/server/notify';
import { getSettings, isStripeConfigured, portalLink } from '@project/shared/server/settings';
import { num, ref, str } from '@project/shared/server/sql';
import { APPLY_STEPS, CONTENT_STEPS, householdIncome, signatureMatches, validateStep } from '../lib/applyRules';
import { findListingById, formFromRecord, isPublished, leasingRecipients, listingFee, todayFor } from '../server/applications';
import { parseInput, requireOwnApplication, sessionEmail } from '../server/identity';

/**
 * Send a finished application to the leasing team.
 *
 * Everything the apply page checked is checked again here from what's actually
 * saved, because the page can be skipped. Then the application gets its
 * number, the matching inquiry is marked Applied, the applicant is emailed a
 * receipt, and the listing's leasing contact (or the whole leasing team) is told.
 */
const Input = z.object({
  id: z.string().min(1).max(64),
  consent: z.boolean().default(false),
  signature: z.string().max(200).default(''),
});

export default createEndpoint({
  description: 'Submit the signed-in applicant’s draft rental application',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), number: z.number(), reference: z.string(), alreadySubmitted: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const email = sessionEmail(context)!;
    const app = await requireOwnApplication(context, data.id);

    if (app.status !== 'Draft') {
      if (app.status === 'Submitted' && app.number) return { id: data.id, number: num(app.number), reference: applicationRef(num(app.number)), alreadySubmitted: true };
      throw new ZiteError('This application has already been sent and can’t be submitted again.', 'CONFLICT');
    }

    const [listing, settings] = await Promise.all([findListingById(String(app.listingId ?? '')), getSettings()]);
    if (!listing || !isPublished(listing)) throw new ZiteError('This home is no longer taking applications, so your application wasn’t sent. Your answers are still saved.', 'CONFLICT');
    if (!settings.applicationsOpen) throw new ZiteError(`${settings.organizationName} isn’t accepting applications online right now. Your answers are saved — call the office to finish applying.`, 'BAD_REQUEST');

    const form = formFromRecord(app);
    const ctx = { today: todayFor(settings), applicantEmail: email };
    for (const step of CONTENT_STEPS) {
      const problems = Object.values(validateStep(form, step, ctx));
      if (problems.length) {
        const title = APPLY_STEPS.find(s => s.id === step)?.title ?? step;
        throw new ZiteError(`“${title}” needs another look: ${problems[0]}`, 'BAD_REQUEST');
      }
    }
    if (!data.consent) throw new ZiteError('Check the box to authorize screening before you submit.', 'BAD_REQUEST');
    if (!signatureMatches(data.signature, form.applicantName)) throw new ZiteError(`Type your full legal name, ${form.applicantName.trim()}, exactly as it appears above to sign.`, 'BAD_REQUEST');

    const fee = listingFee(listing, settings);
    const collectOnline = fee > 0 && settings.onlinePayments && isStripeConfigured();
    if (collectOnline && !app.feePaidAt) {
      const { rows: paid } = await zite.sql({
        query: `SELECT 1 FROM "OnlinePayments" WHERE "applicationId" = $1 AND "purpose" = 'Application fee' AND "status" IN ('Succeeded', 'Processing') LIMIT 1`,
        params: [data.id],
      });
      if (!paid.length) throw new ZiteError(`Pay the ${formatMoney(fee, settings.currency)} application fee to submit.`, 'BAD_REQUEST');
    }

    const title = str(listing.title) || 'your new home';
    const name = form.applicantName.trim();
    const now = new Date().toISOString();
    const [number, recipients, { rows: inquiries }] = await Promise.all([
      nextNumber('Applications', 200),
      leasingRecipients(ref(listing.contactMemberId)),
      zite.sql({
        query: `SELECT id FROM "Inquiries" WHERE "listingId" = $1 AND LOWER("email") = $2 AND COALESCE("applicationId", '') = '' ORDER BY created_at DESC LIMIT 1`,
        params: [String(listing.id), email],
      }),
    ]);
    const reference = applicationRef(number);
    const contactId = ref(listing.contactMemberId);
    const inquiryId = inquiries[0] ? String(inquiries[0].id) : null;

    await zite.applications.update({
      id: data.id,
      record: {
        status: 'Submitted',
        number,
        submittedAt: now,
        consentAt: now,
        signature: data.signature.trim().slice(0, 200),
        feeAmount: fee,
        lastActivityAt: now,
        email,
        ...(inquiryId ? { inquiryId } : {}),
        ...(!ref(app.assigneeId) && recipients.length === 1 && recipients[0].id === contactId ? { assigneeId: contactId } : {}),
      },
    });
    if (inquiryId) await zite.inquiries.update({ id: inquiryId, record: { status: 'Applied', applicationId: data.id } }).catch(() => undefined);

    const statusLink = portalLink(settings, `/applications/${data.id}`);
    await sendTriggered({
      trigger: 'Application received',
      settings,
      recipient: { kind: 'applicant', id: data.id, name, email },
      applicationId: data.id,
      propertyId: ref(listing.propertyId),
      context: {
        application_number: reference,
        listing_title: title,
        applicant_name: name,
        property_name: str(listing.propertyName) ?? '',
        ...(statusLink ? { portal_link: statusLink } : {}),
      },
      button: statusLink ? { label: 'Check your application', href: statusLink } : null,
    }).catch(e => console.error('Application receipt failed', e instanceof Error ? e.message : e));

    const income = householdIncome(form);
    const rent = num(listing.rent);
    const ratio = rent > 0 && income > 0 ? ` (${(income / rent).toFixed(1)}× rent)` : '';
    await notify({
      recipientIds: recipients.map(r => r.id),
      kind: 'application_submitted',
      title: `${name} applied for ${title}`,
      body: `${reference} · Household income ${formatMoney(income, settings.currency, { cents: false })}/mo${ratio}`,
      link: `/applications/${number}`,
      entityType: 'application',
      entityId: data.id,
      actorName: name,
    });
    await logActivity({
      entityType: 'application',
      entityId: data.id,
      action: 'submitted',
      summary: `applied for ${title}`,
      actorName: name,
      applicationId: data.id,
      propertyId: ref(listing.propertyId),
      unitId: ref(listing.unitId),
      data: { number, source: 'Portal', inquiryId },
    });

    return { id: data.id, number, reference, alreadySubmitted: false };
  },
});
