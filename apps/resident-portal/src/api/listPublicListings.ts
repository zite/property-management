import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getSettings } from '@project/shared/server/settings';
import { LISTING_COLUMNS, LISTING_FROM, ListingCardSchema, PUBLISHED, toListingCard } from '../server/applications';

/**
 * Every home currently for rent. Public. The whole set comes back at once
 * (a management company lists dozens, not thousands) so filtering and sorting
 * on the page is instant.
 */
export default createEndpoint({
  description: 'Published rental listings for the public homes page',
  inputSchema: z.object({}),
  outputSchema: z.object({
    listings: z.array(ListingCardSchema),
    applicationsOpen: z.boolean(),
  }),
  execute: async () => {
    const [settings, { rows }] = await Promise.all([
      getSettings(),
      zite.sql({
        query: `SELECT ${LISTING_COLUMNS} ${LISTING_FROM} WHERE ${PUBLISHED} ORDER BY l."publishedAt" DESC NULLS LAST, l.created_at DESC LIMIT 500`,
        params: [],
      }),
    ]);
    return { listings: rows.map(toListingCard), applicationsOpen: settings.applicationsOpen };
  },
});
