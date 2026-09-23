import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { numOrNull, str } from '@project/shared/server/sql';
import { listingDescriptionTemplate } from '../components/leasing/rules';
import { isConfigured, structured, truncate } from '../server/ai';
import { parseInput } from '../server/input';
import { loadListingRecord, stringsOf } from '../server/leasing';

/**
 * Draft a listing description from the facts on file: the unit, the
 * building, the listing's features and anything the person jotted down.
 * Claude when the workspace has it, a plain factual template otherwise.
 * Always a draft to edit — nothing is saved here.
 */

const Input = z.object({
  listingId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  amenities: z.array(z.string().max(60)).max(40).optional(),
});

export default createEndpoint({
  description: 'Draft a listing description with AI, or from a template',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ description: z.string(), ai: z.boolean() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const [r, settings] = await Promise.all([loadListingRecord(data.listingId), getSettings()]);
    const { rows } = r.propertyId
      ? await zite.sql({ query: `SELECT "amenities", "parking", "description", "yearBuilt", "petPolicy" FROM "Properties" WHERE id::text = $1`, params: [String(r.propertyId)] })
      : { rows: [] };
    const p = rows[0] ?? {};
    const amenities = data.amenities ?? stringsOf(r.amenities);
    const facts = {
      propertyName: str(r.propertyName) ?? '',
      unitName: str(r.unitName) ?? '',
      propertyType: str(r.propertyType) ?? '',
      city: str(r.city) ?? '',
      beds: numOrNull(r.beds),
      baths: numOrNull(r.baths),
      squareFeet: numOrNull(r.squareFeet),
      amenities,
      petPolicy: str(r.petPolicy) ?? '',
      leaseTerm: str(r.leaseTerm) ?? '',
      availableOn: String(r.availableOn ?? '').slice(0, 10) || null,
      parking: str(p.parking) ?? '',
    };
    const today = todayIn(settings.timezone);
    const fallback = listingDescriptionTemplate(facts, today);
    if (!isConfigured()) return { description: fallback, ai: false };

    try {
      const result = await structured<{ description: string }>({
        system:
          'You write rental listing descriptions for a property management company. Write in plain, warm, specific English: two or three short paragraphs, 90–160 words. Use only the facts given — never invent features, distances, neighborhoods, schools or prices. Do not describe who the home is ideal for or suited to (no mention of families, children, age, religion, disability, national origin, sex or any protected class) — describe the home, not the tenant. No exclamation marks, no emoji, no headings, no ALL CAPS.',
        prompt: [
          `Listing title: ${truncate(str(r.title), 200)}`,
          `Home: ${[facts.beds === 0 ? 'studio' : facts.beds != null ? `${facts.beds} bedrooms` : null, facts.baths != null ? `${facts.baths} bathrooms` : null, facts.squareFeet ? `${facts.squareFeet} sq ft` : null, facts.propertyType].filter(Boolean).join(', ')}`,
          `Building: ${facts.propertyName}${facts.city ? `, ${facts.city}` : ''}${numOrNull(p.yearBuilt) ? `, built ${numOrNull(p.yearBuilt)}` : ''}`,
          str(p.description) ? `About the building: ${truncate(str(p.description), 500)}` : '',
          amenities.length ? `Features: ${amenities.join(', ')}` : '',
          facts.petPolicy ? `Pet policy: ${facts.petPolicy}` : '',
          facts.parking ? `Parking: ${truncate(facts.parking, 200)}` : '',
          numOrNull(r.rent) ? `Rent: ${formatMoney(numOrNull(r.rent), settings.currency)} per month` : '',
          facts.leaseTerm ? `Lease term: ${facts.leaseTerm}` : '',
          facts.availableOn ? `Available: ${facts.availableOn <= today ? 'now' : facts.availableOn}` : '',
          data.notes?.trim() ? `Notes from the leasing agent: ${truncate(data.notes, 1200)}` : '',
          str(r.description) ? `Current description (improve on it, keep its facts): ${truncate(str(r.description), 1500)}` : '',
        ].filter(Boolean).join('\n'),
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['description'],
          properties: { description: { type: 'string', description: 'The listing description, paragraphs separated by a blank line' } },
        },
        maxTokens: 900,
      });
      if (!result?.description?.trim()) return { description: fallback, ai: false };
      return { description: result.description.trim().replace(/!/g, '.').slice(0, 8000), ai: true };
    } catch (e) {
      console.error('AI listing description failed', e instanceof Error ? e.message : e);
      return { description: fallback, ai: false };
    }
  },
});
