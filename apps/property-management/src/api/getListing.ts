import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { APPLICATION_FROM, APPLICATION_SELECT, INQUIRY_FROM, INQUIRY_SELECT, loadListingRecord, stringsOf, toApplication, toInquiry, toListing } from '../server/leasing';
import { timelineActivity } from '../server/timeline';

/** One listing for its edit page: the listing, the unit and building facts it draws on, and its leads and applications. */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a listing with its leads, applications and history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { id } = parseInput(Input, input);
    const [r, settings] = await Promise.all([loadListingRecord(id), getSettings()]);
    const today = todayIn(settings.timezone);
    const listing = toListing(r, settings, today);
    const [leads, applications, activity, property, siblings] = await Promise.all([
      zite.sql({ query: `SELECT ${INQUIRY_SELECT} ${INQUIRY_FROM} WHERE q."listingId" = $1 ORDER BY COALESCE(q."receivedAt", q.created_at) DESC LIMIT 200`, params: [id] }),
      zite.sql({ query: `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE a."listingId" = $1 AND a."status" <> 'Draft' ORDER BY COALESCE(a."submittedAt", a.created_at) DESC LIMIT 200`, params: [id] }),
      timelineActivity('entityId', id, 60),
      listing.propertyId ? zite.sql({ query: `SELECT "amenities", "petPolicy", "parking", "street", "city", "state" FROM "Properties" WHERE id::text = $1`, params: [listing.propertyId] }) : Promise.resolve({ rows: [] }),
      listing.unitId ? zite.sql({ query: `SELECT id, "title", "status" FROM "Listings" WHERE "unitId" = $1 AND id::text <> $2 AND "status" IN ('Published', 'Paused', 'Draft')`, params: [listing.unitId, id] }) : Promise.resolve({ rows: [] }),
    ]);
    const p = property.rows[0];
    return {
      today,
      incomeMultiple: settings.incomeMultiple,
      portalKnown: Boolean(settings.portalUrl),
      applicationsOpen: settings.applicationsOpen,
      listing,
      unitFeatures: stringsOf(r.unitFeatures),
      readiness: str(r.readiness) || 'Ready',
      building: p ? { amenities: stringsOf(p.amenities), petPolicy: str(p.petPolicy) ?? '', parking: str(p.parking) ?? '', address: [str(p.street), [str(p.city), str(p.state)].filter(Boolean).join(', ')].filter(Boolean).join(', ') } : null,
      leads: leads.rows.map(toInquiry),
      applications: applications.rows.map(toApplication),
      activity,
      siblings: siblings.rows.map(s => ({ id: String(s.id), title: str(s.title) ?? '', status: String(s.status) })),
    };
  },
});
