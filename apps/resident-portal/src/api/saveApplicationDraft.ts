import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getSettings } from '@project/shared/server/settings';
import { ref } from '@project/shared/server/sql';
import { coerceForm } from '../lib/applyRules';
import { SLUG, activeApplicationFor, findListingBySlug, recordFromForm } from '../server/applications';
import { parseInput, requireOwnApplication, sessionEmail } from '../server/identity';

/**
 * Autosave for a rental application. The first save creates the draft; every
 * later one updates it. There is one draft per person per home, so opening the
 * apply page again (on any device) continues the same one. Drafts are lenient
 * — anything half-typed saves — and `submitApplication` checks it all properly.
 */
const Input = z.object({
  slug: SLUG,
  id: z.string().max(64).optional().nullable(),
  form: z.record(z.unknown()),
});

export default createEndpoint({
  description: 'Create or update the signed-in applicant’s draft application for a listing',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), savedAt: z.string(), created: z.boolean() }),
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const email = sessionEmail(context);
    if (!email) throw new ZiteError('Sign in to continue', 'UNAUTHORIZED');
    const form = coerceForm(data.form);
    const savedAt = new Date().toISOString();
    const record = { ...recordFromForm(form), email, portalEmail: email, lastActivityAt: savedAt };

    let id = data.id ?? null;
    if (id) {
      const app = await requireOwnApplication(context, id);
      if (app.status !== 'Draft') throw new ZiteError('This application has already been submitted, so it can’t be changed here.', 'CONFLICT');
      await zite.applications.update({ id, record });
      return { id, savedAt, created: false };
    }

    const listing = await findListingBySlug(data.slug, { publishedOnly: true });
    if (!listing) throw new ZiteError('This home is no longer taking applications.', 'NOT_FOUND');
    const existing = await activeApplicationFor(email, String(listing.id));
    if (existing && existing.status !== 'Draft') throw new ZiteError('You’ve already applied for this home. Open My applications to check its status.', 'CONFLICT');
    if (existing) {
      await zite.applications.update({ id: existing.id, record });
      return { id: existing.id, savedAt, created: false };
    }

    const settings = await getSettings();
    if (!settings.applicationsOpen) throw new ZiteError(`${settings.organizationName} isn’t accepting applications online right now. Call the office to apply.`, 'BAD_REQUEST');
    const created = await zite.applications.create({
      record: {
        ...record,
        status: 'Draft',
        source: 'Portal',
        listingId: String(listing.id),
        propertyId: ref(listing.propertyId),
        unitId: ref(listing.unitId),
      },
    });
    id = created.id;
    return { id, savedAt, created: true };
  },
});
