import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { applicationRef } from '@project/shared/leases';
import { getSettings, isStripeConfigured } from '@project/shared/server/settings';
import { day, iso, json, numOrNull, ref, str, withRetry } from '@project/shared/server/sql';
import {
  ACCEPTS_MESSAGES, FormSchema, PortalMessageSchema, SLUG, WITHDRAWABLE,
  applicantMessages, findListingById, findListingBySlug, formFromRecord, isPublished, listingFee, photoList, toPortalMessage,
} from '../server/applications';
import { getIdentity, parseInput, requireOwnApplication, sessionEmail } from '../server/identity';

/**
 * One of the signed-in person's applications — by id for the status page, or
 * by listing link for the apply page (which may find nothing yet).
 *
 * What an applicant sees is deliberately narrow: their own answers, the status
 * in plain terms, dates, the non-internal side of the conversation and the
 * application fee. Screening results, staff notes, the decision reason and who
 * decided stay in the staff app.
 */
const Input = z.object({ id: z.string().max(64).optional(), slug: SLUG.optional() }).refine(v => Boolean(v.id || v.slug), { message: "That request wasn't valid. Reload the page and try again." });

const TimelineItem = z.object({ key: z.string(), label: z.string(), at: z.string().nullable(), done: z.boolean(), tone: z.enum(['default', 'success', 'danger', 'muted']) });

export default createEndpoint({
  description: 'One of the signed-in applicant’s applications with its status, timeline and messages',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    listing: z.object({
      slug: z.string(),
      title: z.string(),
      cover: z.string().nullable(),
      propertyName: z.string(),
      street: z.string(),
      city: z.string(),
      state: z.string(),
      rent: z.number().nullable(),
      deposit: z.number().nullable(),
      availableOn: z.string().nullable(),
      beds: z.number().nullable(),
      baths: z.number().nullable(),
      squareFeet: z.number().nullable(),
      leaseTerm: z.string(),
      applicationFee: z.number(),
      published: z.boolean(),
    }),
    application: z
      .object({
        id: z.string(),
        number: z.number().nullable(),
        reference: z.string(),
        status: z.string(),
        email: z.string(),
        createdAt: z.string(),
        lastSavedAt: z.string().nullable(),
        submittedAt: z.string().nullable(),
        decidedAt: z.string().nullable(),
        signature: z.string(),
        form: FormSchema,
        feeAmount: z.number(),
        feePaidAt: z.string().nullable(),
        canEdit: z.boolean(),
        canWithdraw: z.boolean(),
        canMessage: z.boolean(),
        leaseReady: z.boolean(),
        timeline: z.array(TimelineItem),
        messages: z.array(PortalMessageSchema),
      })
      .nullable(),
    collectFeeOnline: z.boolean(),
    incomeMultiple: z.number(),
    applicationsOpen: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const email = sessionEmail(context);
    if (!email) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
    const settings = await getSettings();

    let app: Record<string, unknown> | null = null;
    let listing: Record<string, unknown> | null = null;
    if (data.id) {
      app = await requireOwnApplication(context, data.id);
      listing = app.listingId ? await findListingById(String(app.listingId)) : null;
    } else {
      listing = await findListingBySlug(data.slug!, { publishedOnly: false });
      if (!listing) throw new ZiteError("We couldn't find that home. It may have been rented or taken off the market.", 'NOT_FOUND');
      const { rows } = await zite.sql({
        query: `SELECT * FROM "Applications" WHERE LOWER("portalEmail") = $1 AND "listingId" = $2 AND "status" <> 'Withdrawn'
                ORDER BY CASE WHEN "status" = 'Draft' THEN 1 ELSE 0 END, created_at DESC LIMIT 1`,
        params: [email, String(listing.id)],
      });
      app = rows[0] ?? null;
      // Someone else's listing link that was never published is simply not found.
      if (!app && !isPublished(listing)) throw new ZiteError("We couldn't find that home. It may have been rented or taken off the market.", 'NOT_FOUND');
    }

    const photos = photoList(listing?.photos);
    const listingOut = {
      slug: str(listing?.slug) ?? '',
      title: str(listing?.title) || str(listing?.propertyName) || 'Rental home',
      cover: photos[0] ?? (str(listing?.propertyPhoto) && /^https:\/\//.test(String(listing?.propertyPhoto)) ? String(listing?.propertyPhoto) : null),
      propertyName: str(listing?.propertyName) ?? '',
      street: str(listing?.street) ?? '',
      city: str(listing?.city) ?? '',
      state: str(listing?.state) ?? '',
      rent: numOrNull(listing?.rent),
      deposit: numOrNull(listing?.deposit),
      availableOn: day(listing?.availableOn),
      beds: numOrNull(listing?.beds),
      baths: numOrNull(listing?.baths),
      squareFeet: numOrNull(listing?.squareFeet),
      leaseTerm: str(listing?.leaseTerm) ?? '',
      applicationFee: listing ? listingFee(listing, settings) : settings.applicationFee,
      published: listing ? isPublished(listing) : false,
    };
    const base = { listing: listingOut, collectFeeOnline: settings.onlinePayments && isStripeConfigured() && listingOut.applicationFee > 0, incomeMultiple: settings.incomeMultiple, applicationsOpen: settings.applicationsOpen };
    if (!app) return { ...base, application: null };

    const id = String(app.id);
    const status = String(app.status || 'Draft');
    const number = numOrNull(app.number);
    const released = status === 'Approved' || status === 'Denied' || status === 'Leased';

    const [messageRows, { rows: acts }] = await Promise.all([
      status === 'Draft' ? Promise.resolve([]) : applicantMessages(id),
      zite.sql({ query: `SELECT "action", "data", "occurredAt", created_at FROM "Activity" WHERE "entityId" = $1 OR "applicationId" = $1 ORDER BY COALESCE("occurredAt", created_at) ASC LIMIT 200`, params: [id] }),
    ]);
    const messages = messageRows.map(r => toPortalMessage(r, settings.organizationName));
    // Opening the page reads the office's messages.
    const unreadIds = messageRows.filter(r => r.direction === 'Outbound' && !r.readAt).map(r => String(r.id));
    if (unreadIds.length) {
      const now = new Date().toISOString();
      // One at a time: live Zite rate-limits bursts of parallel writes.
      for (const mid of unreadIds.slice(0, 50)) await withRetry(() => zite.messages.update({ id: mid, record: { readAt: now } })).catch(() => undefined);
    }

    // Only the times things happened leave the server — never what a staff member wrote about it.
    const whenTo = (to: string) => {
      const hit = acts.find(a => json<Record<string, unknown>>(a.data, {}).to === to || String(a.action ?? '').toLowerCase() === to.toLowerCase());
      return hit ? iso(hit.occurredAt) ?? iso(hit.created_at) : null;
    };
    const withdrawnAt = status === 'Withdrawn' ? (acts.filter(a => /withdr/i.test(String(a.action ?? ''))).map(a => iso(a.occurredAt) ?? iso(a.created_at)).pop() ?? iso(app.lastActivityAt)) : null;
    const reviewing = ['Screening', 'Approved', 'Denied', 'Leased'].includes(status);
    const submittedAt = iso(app.submittedAt);
    const createdAt = iso(app.created_at);
    // Applications entered by staff or imported can be created after they were submitted; don't show time running backwards.
    const startedAt = createdAt && (!submittedAt || createdAt <= submittedAt) ? createdAt : null;
    const timeline: Array<z.infer<typeof TimelineItem>> = [
      { key: 'started', label: 'Started', at: startedAt, done: true, tone: 'default' },
      { key: 'submitted', label: 'Submitted', at: submittedAt, done: Boolean(submittedAt) && status !== 'Draft', tone: 'default' },
    ];
    if (status === 'Withdrawn') {
      if (reviewing || whenTo('Screening')) timeline.push({ key: 'review', label: 'Under review', at: whenTo('Screening'), done: true, tone: 'default' });
      timeline.push({ key: 'withdrawn', label: 'Withdrawn', at: withdrawnAt, done: true, tone: 'muted' });
    } else {
      timeline.push({ key: 'review', label: 'Under review', at: whenTo('Screening'), done: reviewing, tone: 'default' });
      if (status === 'Denied') {
        timeline.push({ key: 'decision', label: 'Not approved', at: iso(app.decidedAt), done: true, tone: 'danger' });
      } else {
        timeline.push({ key: 'decision', label: 'Approved', at: released ? iso(app.decidedAt) : null, done: status === 'Approved' || status === 'Leased', tone: 'success' });
        timeline.push({ key: 'leased', label: 'Lease signed', at: status === 'Leased' ? whenTo('Leased') : null, done: status === 'Leased', tone: 'success' });
      }
    }

    // An approved applicant whose lease is waiting for them can sign it in the resident portal.
    let leaseReady = false;
    const leaseId = ref(app.leaseId);
    if (leaseId && (status === 'Approved' || status === 'Leased')) {
      const identity = await getIdentity(context);
      leaseReady = Boolean(identity?.leases.some(l => l.id === leaseId && (l.status === 'Pending signature' || l.status === 'Active')));
    }

    return {
      ...base,
      application: {
        id,
        number,
        reference: number ? applicationRef(number) : 'Draft',
        status,
        email: str(app.email) || email,
        createdAt: iso(app.created_at) ?? new Date().toISOString(),
        lastSavedAt: iso(app.lastActivityAt),
        submittedAt: status === 'Draft' ? null : submittedAt,
        decidedAt: released ? iso(app.decidedAt) : null,
        signature: status === 'Draft' ? '' : str(app.signature) ?? '',
        form: formFromRecord(app),
        feeAmount: status === 'Draft' ? listingOut.applicationFee : numOrNull(app.feeAmount) ?? listingOut.applicationFee,
        feePaidAt: iso(app.feePaidAt),
        canEdit: status === 'Draft',
        canWithdraw: WITHDRAWABLE.includes(status),
        canMessage: ACCEPTS_MESSAGES.includes(status) && status !== 'Withdrawn',
        leaseReady,
        timeline,
        messages,
      },
    };
  },
});
