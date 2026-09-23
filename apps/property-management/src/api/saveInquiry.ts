import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { INQUIRY_SOURCES, INQUIRY_STATUSES } from '@project/shared/constants';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { notify } from '@project/shared/server/notify';
import { ref, str } from '@project/shared/server/sql';
import { LOST_REASONS } from '../components/leasing/rules';
import { parseInput } from '../server/input';
import { loadInquiry } from '../server/leasing';

/**
 * Create a lead by hand (a phone call, a walk-in), or change leads: status,
 * assignee, what they're interested in, contact details and notes. Marking a
 * lead lost records why; marking it converted links the application from the
 * same person when there is one.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.');

const Fields = z.object({
  name: z.string().trim().max(120, 'Shorten the name to 120 characters.'),
  email: z.string().trim().max(254, 'That email address is too long.'),
  phone: z.string().trim().max(40, 'That phone number is too long.'),
  message: z.string().max(5000),
  notes: z.string().max(5000),
  listingId: z.string().nullable(),
  propertyId: z.string().nullable(),
  unitId: z.string().nullable(),
  source: z.enum(INQUIRY_SOURCES),
  status: z.enum(INQUIRY_STATUSES),
  desiredMoveIn: day.nullable(),
  assigneeId: z.string().nullable(),
});

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), fields: Fields.partial().extend({ name: Fields.shape.name }) }),
  z.object({ action: z.literal('update'), ids: z.array(z.string().min(1)).min(1).max(200), patch: Fields.partial(), lostReason: z.enum(LOST_REASONS).optional() }),
]);

async function resolveLocation(fields: { listingId?: string | null; unitId?: string | null; propertyId?: string | null }) {
  const out = { listingId: fields.listingId ?? null, unitId: fields.unitId ?? null, propertyId: fields.propertyId ?? null };
  if (out.listingId) {
    const { rows } = await zite.sql({ query: `SELECT "propertyId", "unitId" FROM "Listings" WHERE id::text = $1`, params: [out.listingId] });
    if (!rows[0]) throw new ZiteError('That listing no longer exists.', 'BAD_REQUEST');
    out.unitId = ref(rows[0].unitId);
    out.propertyId = ref(rows[0].propertyId);
  } else if (out.unitId) {
    const { rows } = await zite.sql({ query: `SELECT "propertyId" FROM "Units" WHERE id::text = $1`, params: [out.unitId] });
    if (!rows[0]) throw new ZiteError('That unit no longer exists.', 'BAD_REQUEST');
    out.propertyId = ref(rows[0].propertyId);
  }
  return out;
}

export default createEndpoint({
  description: 'Create or update leasing inquiries (leads)',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const now = new Date().toISOString();

    if (data.action === 'create') {
      const f = data.fields;
      const name = f.name.replace(/\s+/g, ' ').trim();
      const email = (f.email ?? '').toLowerCase();
      const phone = f.phone ?? '';
      if (name.length < 2) throw new ZiteError('Enter the person’s name.', 'BAD_REQUEST');
      if (!email && !phone) throw new ZiteError('Add an email or a phone number so you can follow up.', 'BAD_REQUEST');
      if (email && !EMAIL_RE.test(email)) throw new ZiteError('That email address doesn’t look right.', 'BAD_REQUEST');
      const where = await resolveLocation(f);
      const created = await zite.inquiries.create({
        record: {
          name,
          email,
          phone,
          message: (f.message ?? '').trim(),
          notes: (f.notes ?? '').trim() || null,
          ...where,
          status: f.status ?? 'New',
          source: f.source ?? 'Phone',
          desiredMoveIn: f.desiredMoveIn ?? null,
          assigneeId: f.assigneeId ?? null,
          receivedAt: now,
        },
      });
      await logActivity({ entityType: 'inquiry', entityId: created.id, action: 'created', summary: `logged a ${String(f.source ?? 'Phone').toLowerCase()} lead`, actorId: actor.id, actorName: actor.name, propertyId: where.propertyId, unitId: where.unitId, data: { listingId: where.listingId } });
      if (f.assigneeId && f.assigneeId !== actor.id) {
        await notify({ recipientIds: [f.assigneeId], kind: 'inquiry_received', title: `${actor.name} assigned you a lead: ${name}`, body: (f.message ?? '').slice(0, 300) || null, link: '/leasing/leads', entityType: 'inquiry', entityId: created.id, actorId: actor.id, actorName: actor.name });
      }
      return { id: created.id, updated: 1 };
    }

    const { ids, patch, lostReason } = data;
    if (patch.name !== undefined && patch.name.trim().length < 2) throw new ZiteError('Enter the person’s name.', 'BAD_REQUEST');
    if (patch.email && !EMAIL_RE.test(patch.email)) throw new ZiteError('That email address doesn’t look right.', 'BAD_REQUEST');
    let assigneeName = '';
    if (patch.assigneeId) {
      const { rows } = await zite.sql({ query: `SELECT "name", "status" FROM "Members" WHERE id::text = $1`, params: [patch.assigneeId] });
      if (!rows[0] || rows[0].status === 'Deactivated') throw new ZiteError('That teammate isn’t active anymore.', 'BAD_REQUEST');
      assigneeName = str(rows[0].name) ?? 'a teammate';
    }
    const location = patch.listingId !== undefined || patch.unitId !== undefined ? await resolveLocation(patch) : null;

    let updated = 0;
    for (const id of ids) {
      const before = await loadInquiry(id);
      const record: Record<string, unknown> = {};
      const summaries: string[] = [];
      const setText = (key: 'name' | 'email' | 'phone' | 'message' | 'notes', value: string | undefined, summary?: string) => {
        if (value === undefined) return;
        const v = key === 'email' ? value.trim().toLowerCase() : key === 'notes' || key === 'message' ? value : value.trim();
        if (v === before[key]) return;
        record[key] = v;
        if (summary) summaries.push(summary);
      };
      setText('name', patch.name, 'updated the name');
      setText('email', patch.email, 'updated the email');
      setText('phone', patch.phone, 'updated the phone number');
      setText('message', patch.message);
      setText('notes', patch.notes, 'updated the notes');
      if (patch.source && patch.source !== before.source) {
        record.source = patch.source;
        summaries.push(`set the source to ${patch.source}`);
      }
      if (patch.desiredMoveIn !== undefined && patch.desiredMoveIn !== before.desiredMoveIn) {
        record.desiredMoveIn = patch.desiredMoveIn;
        summaries.push(patch.desiredMoveIn ? 'updated the move-in date' : 'cleared the move-in date');
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
        record.assigneeId = patch.assigneeId;
        summaries.push(patch.assigneeId ? (patch.assigneeId === actor.id ? 'took the lead' : `assigned it to ${assigneeName}`) : 'unassigned it');
      }
      if (location && (location.listingId !== before.listingId || location.unitId !== before.unitId)) {
        Object.assign(record, location);
        summaries.push('changed what they’re interested in');
      }
      if (patch.status && patch.status !== before.status) {
        record.status = patch.status;
        if (patch.status === 'Closed') summaries.push(lostReason ? `marked the lead lost (${lostReason.charAt(0).toLowerCase()}${lostReason.slice(1)})` : 'closed the lead');
        else if (patch.status === 'Applied') summaries.push('marked the lead converted');
        else if (before.status === 'Closed' || before.status === 'Applied') summaries.push(`reopened the lead as ${patch.status}`);
        else summaries.push(`moved it to ${patch.status}`);
        if (patch.status === 'Contacted' && !before.lastContactedAt) record.lastContactedAt = now;
        if (patch.status === 'Applied' && !before.applicationId && before.email) {
          const { rows } = await zite.sql({
            query: `SELECT id FROM "Applications" WHERE (LOWER("email") = $1 OR LOWER("portalEmail") = $1) AND "status" <> 'Draft' ORDER BY CASE WHEN "listingId" = $2 THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
            params: [before.email.toLowerCase(), before.listingId ?? ''],
          });
          if (rows[0]) record.applicationId = String(rows[0].id);
        }
      }
      if (!Object.keys(record).length) continue;
      await zite.inquiries.update({ id, record: record as never });
      updated++;
      if (summaries.length) {
        await logActivity(summaries.map((summary, i) => ({ occurredAt: new Date(Date.parse(now) + i).toISOString(), entityType: 'inquiry' as const, entityId: id, action: record.status ? 'status_changed' : 'updated', summary, actorId: actor.id, actorName: actor.name, propertyId: before.propertyId, unitId: before.unitId, data: record.status ? { from: before.status, to: record.status, lostReason } : undefined })));
      }
      if (record.assigneeId && record.assigneeId !== actor.id) {
        await notify({ recipientIds: [String(record.assigneeId)], kind: 'inquiry_received', title: `${actor.name} assigned you a lead: ${before.name}`, body: before.message.slice(0, 300) || null, link: '/leasing/leads', entityType: 'inquiry', entityId: id, actorId: actor.id, actorName: actor.name });
      }
    }
    return { id: null, updated };
  },
});
