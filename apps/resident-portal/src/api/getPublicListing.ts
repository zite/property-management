import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { isDemo } from '@project/shared/server/demoPreview';
import { getSettings } from '@project/shared/server/settings';
import { num } from '@project/shared/server/sql';
import {
  LISTING_COLUMNS, LISTING_FROM, ListingCardSchema, ListingDetailSchema, PUBLISHED, SLUG,
  activeApplicationFor, contactFor, findListingBySlug, toListingCard, toListingDetail,
} from '../server/applications';
import { parseInput, sessionEmail } from '../server/identity';

/**
 * One home for rent, by its link. Public; an unpublished or missing listing is
 * the same NOT_FOUND. A signed-in visitor also learns whether they've already
 * started or sent an application for it, so the page can offer "Continue".
 */
const Input = z.object({ slug: SLUG, countView: z.boolean().optional() });

export default createEndpoint({
  description: 'A published listing with photos, details and similar homes',
  inputSchema: Input,
  outputSchema: z.object({
    listing: ListingDetailSchema,
    similar: z.array(ListingCardSchema),
    mine: z.object({ id: z.string(), status: z.string() }).nullable(),
    applicationsOpen: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const { slug, countView } = parseInput(Input, input);
    const row = await findListingBySlug(slug, { publishedOnly: true });
    if (!row) throw new ZiteError("We couldn't find that home. It may have been rented or taken off the market.", 'NOT_FOUND');

    const email = sessionEmail(context);
    const [settings, contact, similarRows, mine] = await Promise.all([
      getSettings(),
      contactFor(row.contactMemberId ? String(row.contactMemberId) : null),
      zite.sql({
        query: `SELECT ${LISTING_COLUMNS} ${LISTING_FROM} WHERE ${PUBLISHED} AND l.id::text <> $1
                ORDER BY CASE WHEN p."city" = $2 THEN 0 ELSE 1 END, ABS(COALESCE(l."rent", 0) - $3::numeric) ASC LIMIT 3`,
        params: [String(row.id), String(row.city ?? ''), num(row.rent)],
      }),
      email ? activeApplicationFor(email, String(row.id)) : Promise.resolve(null),
    ]);

    // Best-effort: a view that fails to count must never fail the page.
    if (countView && !isDemo(context)) await zite.listings.update({ id: String(row.id), record: { views: num(row.views) + 1 } }).catch(() => undefined);

    return {
      listing: toListingDetail(row, settings, contact),
      similar: similarRows.rows.map(toListingCard),
      mine: mine ? { id: mine.id, status: mine.status } : null,
      applicationsOpen: settings.applicationsOpen,
    };
  },
});
