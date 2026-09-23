import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { ref, str } from '@project/shared/server/sql';
import { SLUG, assertNotFlooding, findListingBySlug, leasingRecipients, todayFor } from '../server/applications';
import { assertReasonable, parseInput } from '../server/identity';

/**
 * A question about a home, or a request to see it. Public — anyone can ask —
 * so it's defended like a public form: a hidden honeypot field bots fill in,
 * server-side validation, an hourly cap per email, and a 24-hour merge so
 * pressing send twice (or asking a follow-up) doesn't page the leasing team twice.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const Input = z.object({
  slug: SLUG,
  kind: z.enum(['question', 'showing']).default('question'),
  name: z.string().max(120, 'Shorten your name to 120 characters.').default(''),
  email: z.string().max(254, 'That email address is too long.').default(''),
  phone: z.string().max(40, 'That phone number is too long.').default(''),
  message: z.string().max(3000, 'Shorten your message to 3,000 characters.').default(''),
  availability: z.string().max(300, 'Shorten your availability to 300 characters.').default(''),
  desiredMoveIn: z.string().max(10).default(''),
  /** Honeypot: hidden from people, irresistible to bots. */
  website: z.string().max(500).optional(),
});

export default createEndpoint({
  description: 'Send a question or showing request about a published listing',
  inputSchema: Input,
  outputSchema: z.object({ status: z.enum(['received', 'updated']), firstName: z.string() }),
  execute: async ({ input }) => {
    const data = parseInput(Input, input);
    const name = data.name.trim().replace(/\s+/g, ' ');
    const email = data.email.trim().toLowerCase();
    const firstName = name.split(' ')[0] ?? '';
    if (data.website && data.website.trim()) return { status: 'received' as const, firstName };

    if (name.length < 2) throw new ZiteError('Enter your name so we know who to reply to.', 'BAD_REQUEST');
    if (!EMAIL_RE.test(email)) throw new ZiteError('Enter a valid email address so we can reply.', 'BAD_REQUEST');
    const digits = data.phone.replace(/\D/g, '');
    if (data.phone.trim() && (digits.length < 10 || digits.length > 15)) throw new ZiteError('Enter a phone number with area code, or leave it blank.', 'BAD_REQUEST');
    const message = data.message.trim();
    const availability = data.availability.trim();
    if (data.kind === 'question' && message.length < 2) throw new ZiteError('Write your question before sending.', 'BAD_REQUEST');
    if (data.kind === 'showing' && !availability && message.length < 2) throw new ZiteError('Tell us a few days and times that work for you.', 'BAD_REQUEST');
    assertReasonable(message, 3000);

    const listing = await findListingBySlug(data.slug, { publishedOnly: true });
    if (!listing) throw new ZiteError('This home is no longer available, so we couldn’t send your message.', 'NOT_FOUND');
    const listingId = String(listing.id);
    const title = str(listing.title) || 'this home';

    const settings = await getSettings();
    let desiredMoveIn: string | null = null;
    if (data.desiredMoveIn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.desiredMoveIn) || Number.isNaN(Date.parse(data.desiredMoveIn))) throw new ZiteError('Choose a valid move-in date, or leave it blank.', 'BAD_REQUEST');
      if (data.desiredMoveIn < addDays(todayFor(settings), -1)) throw new ZiteError('Choose a move-in date that’s today or later.', 'BAD_REQUEST');
      desiredMoveIn = data.desiredMoveIn;
    }

    await assertNotFlooding('Inquiries', 'email', email, 6);

    const body = [data.kind === 'showing' ? `Showing request${availability ? ` — available ${availability}` : ''}` : '', message].filter(Boolean).join('\n\n');
    const now = new Date().toISOString();

    // The same person about the same home within a day: add to that inquiry rather than opening another.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { rows: recent } = await zite.sql({
      query: `SELECT id, "message", "phone", "status" FROM "Inquiries" WHERE LOWER("email") = $1 AND "listingId" = $2 AND COALESCE("receivedAt", created_at) >= $3 ORDER BY created_at DESC LIMIT 1`,
      params: [email, listingId, since],
    });
    if (recent[0]) {
      const prev = str(recent[0].message) ?? '';
      const merged = prev.includes(body) ? prev : [prev, `— Follow-up ${now.slice(0, 16).replace('T', ' ')} UTC —`, body].filter(Boolean).join('\n\n');
      await zite.inquiries.update({
        id: String(recent[0].id),
        record: {
          message: merged.slice(0, 10000),
          ...(digits && !str(recent[0].phone) ? { phone: data.phone.trim() } : {}),
          ...(desiredMoveIn ? { desiredMoveIn } : {}),
          ...(recent[0].status === 'Closed' ? { status: 'New' } : {}),
        },
      });
      return { status: 'updated' as const, firstName };
    }

    const recipients = await leasingRecipients(ref(listing.contactMemberId));
    const assigneeId = recipients.length === 1 && recipients[0].id === ref(listing.contactMemberId) ? recipients[0].id : null;
    const created = await zite.inquiries.create({
      record: {
        name,
        email,
        phone: data.phone.trim(),
        message: body,
        listingId,
        propertyId: ref(listing.propertyId),
        unitId: ref(listing.unitId),
        status: 'New',
        source: 'Portal',
        desiredMoveIn,
        assigneeId,
        receivedAt: now,
      },
    });

    const verb = data.kind === 'showing' ? 'requested a showing of' : 'asked about';
    await notify({
      recipientIds: recipients.map(r => r.id),
      kind: 'inquiry_received',
      title: `${name} ${verb} ${title}`,
      body: body.slice(0, 400),
      link: '/leasing/inquiries',
      entityType: 'inquiry',
      entityId: created.id,
      actorName: name,
    });
    await logActivity({
      entityType: 'inquiry',
      entityId: created.id,
      action: data.kind === 'showing' ? 'showing_requested' : 'received',
      summary: `${verb} ${title}`,
      actorName: name,
      propertyId: ref(listing.propertyId),
      unitId: ref(listing.unitId),
      data: { listingId, source: 'Portal' },
    });
    return { status: 'received' as const, firstName };
  },
});
