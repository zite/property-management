import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { applicationRef } from '@project/shared/leases';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, str } from '@project/shared/server/sql';
import { CONTENT_STEPS, completedSteps } from '../lib/applyRules';
import { formFromRecord, photoList, todayFor } from '../server/applications';
import { sessionEmail } from '../server/identity';

/**
 * The applications the signed-in person started or sent, newest activity
 * first. Only what an applicant may know: status, dates, unread replies and,
 * for drafts, how far along they are. Never screening results or staff notes.
 */
export default createEndpoint({
  description: 'The signed-in person’s rental applications',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    applications: z.array(
      z.object({
        id: z.string(),
        number: z.number().nullable(),
        reference: z.string(),
        status: z.string(),
        createdAt: z.string(),
        submittedAt: z.string().nullable(),
        decidedAt: z.string().nullable(),
        lastActivityAt: z.string().nullable(),
        unreadMessages: z.number(),
        stepsDone: z.number(),
        stepsTotal: z.number(),
        listing: z.object({
          slug: z.string(),
          title: z.string(),
          cover: z.string().nullable(),
          propertyName: z.string(),
          city: z.string(),
          state: z.string(),
          rent: z.number().nullable(),
          beds: z.number().nullable(),
          baths: z.number().nullable(),
          availableOn: z.string().nullable(),
          published: z.boolean(),
        }),
      }),
    ),
  }),
  execute: async ({ context }) => {
    const email = sessionEmail(context);
    if (!email) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
    const [settings, { rows }] = await Promise.all([
      getSettings(),
      zite.sql({
        query: `
          SELECT a.*,
            l."slug" AS "listingSlug", l."title" AS "listingTitle", l."photos" AS "listingPhotos", l."rent" AS "listingRent", l."status" AS "listingStatus", l."availableOn" AS "listingAvailableOn",
            u."beds", u."baths", p."name" AS "propertyName", p."city", p."state", p."photoUrl" AS "propertyPhoto",
            (SELECT COUNT(*) FROM "Messages" m WHERE (m."thread" = 'applicant:' || a.id::text OR m."applicationId" = a.id::text)
               AND m."direction" = 'Outbound' AND m."readAt" IS NULL AND COALESCE(m."channel", '') <> 'Note') AS "unread"
          FROM "Applications" a
          LEFT JOIN "Listings" l ON l.id::text = a."listingId"
          LEFT JOIN "Units" u ON u.id::text = a."unitId"
          LEFT JOIN "Properties" p ON p.id::text = a."propertyId"
          WHERE LOWER(a."portalEmail") = $1
          ORDER BY COALESCE(a."lastActivityAt", a."submittedAt", a.created_at) DESC
          LIMIT 200`,
        params: [email],
      }),
    ]);
    const ctx = { today: todayFor(settings), applicantEmail: email };
    return {
      applications: rows.map(r => {
        const status = String(r.status || 'Draft');
        const number = numOrNull(r.number);
        const photos = photoList(r.listingPhotos);
        const released = status === 'Approved' || status === 'Denied' || status === 'Leased';
        return {
          id: String(r.id),
          number,
          reference: number ? applicationRef(number) : 'Draft',
          status,
          createdAt: iso(r.created_at) ?? new Date().toISOString(),
          submittedAt: iso(r.submittedAt),
          decidedAt: released ? iso(r.decidedAt) : null,
          lastActivityAt: iso(r.lastActivityAt),
          unreadMessages: status === 'Draft' ? 0 : num(r.unread),
          stepsDone: status === 'Draft' ? completedSteps(formFromRecord(r), ctx) : CONTENT_STEPS.length,
          stepsTotal: CONTENT_STEPS.length,
          listing: {
            slug: str(r.listingSlug) ?? '',
            title: str(r.listingTitle) || str(r.propertyName) || 'Rental home',
            cover: photos[0] ?? (str(r.propertyPhoto) && /^https:\/\//.test(String(r.propertyPhoto)) ? String(r.propertyPhoto) : null),
            propertyName: str(r.propertyName) ?? '',
            city: str(r.city) ?? '',
            state: str(r.state) ?? '',
            rent: numOrNull(r.listingRent),
            beds: numOrNull(r.beds),
            baths: numOrNull(r.baths),
            availableOn: day(r.listingAvailableOn),
            published: r.listingStatus === 'Published',
          },
        };
      }),
    };
  },
});
