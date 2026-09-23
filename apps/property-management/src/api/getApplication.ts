import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { bool, day, iso, json, numOrNull, ref, str } from '@project/shared/server/sql';
import { normalizeScreening } from '../components/leasing/rules';
import { parseInput } from '../server/input';
import { coApplicantsOf, loadApplicationRecord, toApplication } from '../server/leasing';
import { messagesWhere, timelineActivity } from '../server/timeline';

/**
 * One application with everything its page shows: the full answers as the
 * portal stored them, the screening checklist, the conversation with the
 * applicant, other applications for the same home, and the lease once one exists.
 */

const Input = z.object({ number: z.number().int().positive() });

export default createEndpoint({
  description: 'Get a rental application with screening, conversation and related records',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { number } = parseInput(Input, input);
    const [r, settings] = await Promise.all([loadApplicationRecord({ number }), getSettings()]);
    const app = toApplication(r);
    const details = json<Record<string, unknown>>(r.details, {});

    const [messages, activity, others, lease, inquiry, listing] = await Promise.all([
      messagesWhere(`(m."thread" = $1 OR m."applicationId" = $2)`, [`applicant:${app.id}`, app.id]),
      timelineActivity('applicationId', app.id),
      app.unitId
        ? zite.sql({
            query: `SELECT id, "number", "applicantName", "status", "submittedAt", "decidedAt" FROM "Applications" WHERE "unitId" = $1 AND id::text <> $2 AND "status" <> 'Draft' ORDER BY COALESCE("submittedAt", created_at) DESC LIMIT 12`,
            params: [app.unitId, app.id],
          })
        : Promise.resolve({ rows: [] }),
      app.leaseId ? zite.sql({ query: `SELECT id, "number", "status", "name", "startDate" FROM "Leases" WHERE id::text = $1 LIMIT 1`, params: [app.leaseId] }) : Promise.resolve({ rows: [] }),
      ref(r.inquiryId) ? zite.sql({ query: `SELECT id, "name", "status", "source", "receivedAt", "showingAt" FROM "Inquiries" WHERE id::text = $1 LIMIT 1`, params: [String(r.inquiryId)] }) : Promise.resolve({ rows: [] }),
      app.listingId ? zite.sql({ query: `SELECT id, "title", "slug", "status", "rent", "deposit", "applicationFee", "availableOn" FROM "Listings" WHERE id::text = $1 LIMIT 1`, params: [app.listingId] }) : Promise.resolve({ rows: [] }),
    ]);
    const l = lease.rows[0];
    const q = inquiry.rows[0];
    const li = listing.rows[0];

    // Anything the apply form stores that the page doesn't lay out on its own still shows, as plain answers.
    const known = new Set(['references', 'emergencyContact', 'hasPets', 'hasVehicles', 'priorEvictionAnswered']);
    const extraAnswers = Object.entries(details)
      .filter(([k, v]) => !known.has(k) && v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => ({ key: k, value: typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v) }))
      .slice(0, 40);
    const refs = Array.isArray(details.references) ? details.references : [];
    const emergency = details.emergencyContact && typeof details.emergencyContact === 'object' ? (details.emergencyContact as Record<string, unknown>) : null;

    return {
      today: todayIn(settings.timezone),
      incomeMultiple: settings.incomeMultiple,
      application: {
        ...app,
        portalEmail: str(r.portalEmail) ?? '',
        employer: str(r.employer) ?? '',
        jobTitle: str(r.jobTitle) ?? '',
        employmentMonths: numOrNull(r.employmentMonths),
        currentAddress: str(r.currentAddress) ?? '',
        currentRent: numOrNull(r.currentRent),
        currentLandlord: str(r.currentLandlord) ?? '',
        landlordPhone: str(r.landlordPhone) ?? '',
        residenceMonths: numOrNull(r.residenceMonths),
        reasonForMoving: str(r.reasonForMoving) ?? '',
        priorEviction: bool(r.priorEviction),
        pets: str(r.pets) ?? '',
        vehicles: str(r.vehicles) ?? '',
        coApplicants: coApplicantsOf(r.coApplicants),
        references: refs
          .filter(x => x && typeof x === 'object')
          .map(x => {
            const o = x as Record<string, unknown>;
            return { name: String(o.name ?? ''), relationship: String(o.relationship ?? ''), phone: String(o.phone ?? ''), email: String(o.email ?? '') };
          })
          .filter(x => x.name || x.phone || x.email),
        emergencyContact: emergency && (emergency.name || emergency.phone) ? { name: String(emergency.name ?? ''), relationship: String(emergency.relationship ?? ''), phone: String(emergency.phone ?? '') } : null,
        extraAnswers,
        screening: normalizeScreening(r.screening),
        screeningNotes: str(r.screeningNotes) ?? '',
        consentAt: iso(r.consentAt),
        signature: str(r.signature) ?? '',
        decisionReason: str(r.decisionReason) ?? '',
        decidedById: ref(r.decidedById),
        inquiryId: ref(r.inquiryId),
        createdAt: iso(r.created_at),
      },
      listing: li ? { id: String(li.id), title: str(li.title) ?? '', slug: str(li.slug) ?? '', status: str(li.status) ?? 'Draft', rent: numOrNull(li.rent), deposit: numOrNull(li.deposit), availableOn: day(li.availableOn) } : null,
      lease: l ? { id: String(l.id), number: numOrNull(l.number), status: str(l.status) ?? '', name: str(l.name) ?? '', startDate: day(l.startDate) } : null,
      inquiry: q ? { id: String(q.id), name: str(q.name) ?? '', status: str(q.status) ?? '', source: str(q.source) ?? '', receivedAt: iso(q.receivedAt), showingAt: iso(q.showingAt) } : null,
      others: others.rows.map(o => ({ id: String(o.id), number: numOrNull(o.number), applicantName: str(o.applicantName) ?? '', status: String(o.status), submittedAt: iso(o.submittedAt), decidedAt: iso(o.decidedAt) })),
      statusLink: portalLink(settings, `/applications/${app.id}`) || null,
      messageCount: messages.filter(m => m.direction !== 'Internal').length,
      unread: messages.filter(m => m.direction === 'Inbound' && !m.readAt).length,
      messages,
      activity,
    };
  },
});
