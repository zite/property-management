import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { threadKey } from '@project/shared/server/email';
import { mentionedIds, notify, plainMentions } from '@project/shared/server/notify';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { deliverMessage, loadPeople, mergeContexts, PERSON_KINDS, personKey, render, requireThread, workOrderResidentId } from '../server/comms';

/**
 * Send messages from the staff app. Three shapes:
 *
 *   people    — one message per recipient into each person's own conversation
 *               (compose, a reply in a person's thread). Merge tags render per
 *               person. Up to 25 recipients per call, sent one at a time; the
 *               client sends larger lists in chunks. Recipients are looked up
 *               by id — emails never come from the client.
 *   workOrder — a message to a work order's resident or vendor, in the work
 *               order's thread (what their portal request page shows).
 *   note      — an internal note on any thread, with @mentions.
 *
 * `byEmail: false` is portal-only; people without a valid email are always
 * portal-only and reported as such.
 */

const Attachment = z.object({ name: z.string().trim().min(1).max(200), url: z.string().url().max(2000) });
const Body = z.string().trim().min(1, 'Write a message first.').max(10000, 'That message is too long — keep it under 10,000 characters.');
const Id = z.string().min(1).max(64);

const Input = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('people'),
    recipients: z.array(z.object({ kind: z.enum(PERSON_KINDS), id: Id })).min(1, 'Add at least one recipient.').max(25, 'Send to at most 25 people at a time.'),
    subject: z.string().trim().min(1, 'Add a subject.').max(200, 'Keep the subject under 200 characters.'),
    body: Body,
    byEmail: z.boolean(),
    templateId: z.string().max(64).nullish(),
    attachments: z.array(Attachment).max(10, 'Attach up to 10 files.').default([]),
    context: z.object({ leaseId: Id.nullish(), workOrderId: Id.nullish(), propertyId: Id.nullish(), applicationId: Id.nullish() }).nullish(),
  }),
  z.object({
    mode: z.literal('workOrder'),
    workOrderId: Id,
    to: z.enum(['tenant', 'vendor']),
    subject: z.string().trim().max(200).nullish(),
    body: Body,
    byEmail: z.boolean(),
    templateId: z.string().max(64).nullish(),
    attachments: z.array(Attachment).max(10, 'Attach up to 10 files.').default([]),
  }),
  z.object({ mode: z.literal('note'), thread: z.string().min(3).max(100), body: Body, attachments: z.array(Attachment).max(10).default([]) }),
]);

const Result = z.object({
  kind: z.string(),
  id: z.string(),
  name: z.string(),
  thread: z.string(),
  messageId: z.string().nullable(),
  delivery: z.string().nullable(),
  noEmail: z.boolean(),
  error: z.string().nullable(),
});

const BUDGET_MS = 100_000;

export default createEndpoint({
  description: 'Send messages to residents, owners, vendors or applicants, or add an internal note',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ results: z.array(Result) }),
  execute: async ({ input, context }) => {
    const started = Date.now();
    const actor = await getActor(context);
    assertCan(actor, 'communications.send');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const now = new Date().toISOString();

    if (data.mode === 'note') {
      const t = requireThread(data.thread);
      const links: Record<string, string | null> = { tenantId: null, ownerId: null, vendorId: null, applicationId: null, workOrderId: null, leaseId: null, propertyId: null };
      let link = `/messages/${t.key}`;
      let title = `${actor.name} mentioned you in a note`;
      if (t.kind === 'work_order') {
        const { rows } = await zite.sql({ query: `SELECT id, "number", "propertyId", "leaseId" FROM "WorkOrders" WHERE id::text = $1`, params: [t.id] });
        if (!rows[0]) throw new ZiteError('That work order no longer exists.', 'NOT_FOUND');
        Object.assign(links, { workOrderId: t.id, propertyId: rows[0].propertyId || null, leaseId: rows[0].leaseId || null });
        link = `/work-orders/${rows[0].number}`;
        title = `${actor.name} mentioned you on ${workOrderRef(Number(rows[0].number))}`;
      } else {
        const people = await loadPeople([{ kind: t.kind, id: t.id }]);
        const p = people.get(personKey(t.kind, t.id));
        if (!p) throw new ZiteError('That person no longer exists.', 'NOT_FOUND');
        links[t.kind === 'applicant' ? 'applicationId' : `${t.kind}Id`] = t.id;
        if (p.kind === 'tenant') Object.assign(links, { leaseId: p.leaseId, propertyId: p.propertyId });
        title = `${actor.name} mentioned you in a note about ${p.label}`;
      }
      const created = await withRetry(() =>
        zite.messages.create({
          record: { subject: 'Note', body: data.body, thread: t.key, direction: 'Internal', channel: 'Note', ...links, senderMemberId: actor.id, senderName: actor.name, sentAt: now, readAt: now, attachments: data.attachments.length ? JSON.stringify(data.attachments) : null },
        }),
      );
      await notify({ recipientIds: mentionedIds(data.body), kind: 'mention', title, body: plainMentions(data.body).slice(0, 300), link, entityType: t.kind === 'applicant' ? 'application' : t.kind, entityId: t.id, actorId: actor.id, actorName: actor.name });
      if (t.kind === 'work_order') await withRetry(() => zite.workOrders.update({ id: t.id, record: { lastActivityAt: now } }));
      return { results: [{ kind: 'note', id: t.id, name: 'Internal note', thread: t.key, messageId: created.id, delivery: null, noEmail: false, error: null }] };
    }

    if (data.mode === 'workOrder') {
      const { rows } = await zite.sql({ query: `SELECT id, "number", "title", "tenantId", "vendorId", "leaseId", "propertyId" FROM "WorkOrders" WHERE id::text = $1`, params: [data.workOrderId] });
      const wo = rows[0];
      if (!wo) throw new ZiteError('That work order no longer exists.', 'NOT_FOUND');
      const personId = data.to === 'tenant' ? await workOrderResidentId({ id: String(wo.id), tenantId: (wo.tenantId as string) || null, leaseId: (wo.leaseId as string) || null }) : String(wo.vendorId ?? '');
      if (!personId) throw new ZiteError(data.to === 'tenant' ? 'This work order has no resident to message.' : 'Assign a vendor before messaging one.', 'BAD_REQUEST');
      const people = await loadPeople([{ kind: data.to, id: personId }]);
      const person = people.get(personKey(data.to, personId));
      if (!person) throw new ZiteError(data.to === 'tenant' ? 'The resident on this work order no longer exists.' : 'The vendor on this work order no longer exists.', 'BAD_REQUEST');
      const number = Number(wo.number);
      const ctx = (await mergeContexts([person], settings, { workOrderId: String(wo.id) })).get(personKey(person.kind, person.id)) ?? {};
      const href = portalLink(settings, data.to === 'tenant' ? `/resident/maintenance/${number}` : `/vendor/work-orders/${number}`);
      const sent = await deliverMessage({
        settings,
        person,
        subject: render(data.subject?.trim() || `${workOrderRef(number)}: ${String(wo.title ?? '')}`, ctx),
        body: render(data.body, ctx),
        byEmail: data.byEmail,
        senderMemberId: actor.id,
        senderName: actor.name,
        templateId: data.templateId ?? null,
        attachments: data.attachments,
        thread: threadKey('work_order', String(wo.id)),
        workOrderId: String(wo.id),
        leaseId: (wo.leaseId as string) || null,
        propertyId: (wo.propertyId as string) || null,
        button: href ? { label: 'View the work order', href } : null,
      });
      await withRetry(() => zite.workOrders.update({ id: String(wo.id), record: { lastActivityAt: now } }));
      await logActivity({ entityType: 'work_order', entityId: String(wo.id), workOrderId: String(wo.id), propertyId: (wo.propertyId as string) || null, action: 'message_sent', summary: `messaged ${data.to === 'tenant' ? 'the resident' : 'the vendor'}${sent.delivery === 'Failed' ? ' (email not delivered)' : ''}`, actorId: actor.id, actorName: actor.name });
      return { results: [{ kind: person.kind, id: person.id, name: person.label, thread: sent.thread, messageId: sent.id, delivery: sent.delivery, noEmail: !person.hasEmail, error: null }] };
    }

    // ── people ──
    const ctxLinks = data.context ?? {};
    const people = await loadPeople(data.recipients);
    const found = data.recipients.map(r => people.get(personKey(r.kind, r.id))).filter(Boolean) as NonNullable<ReturnType<typeof people.get>>[];
    const merges = await mergeContexts(found, settings, { workOrderId: ctxLinks.workOrderId ?? null, propertyId: ctxLinks.propertyId ?? null });
    const results: Array<z.infer<typeof Result>> = [];
    const seen = new Set<string>();
    for (const r of data.recipients) {
      const key = personKey(r.kind, r.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const person = people.get(key);
      if (!person) {
        results.push({ kind: r.kind, id: r.id, name: 'Unknown', thread: threadKey(r.kind, r.id), messageId: null, delivery: null, noEmail: false, error: 'This person no longer exists.' });
        continue;
      }
      // Stop well inside the platform timeout; the client sends whoever is left.
      if (Date.now() - started > BUDGET_MS) break;
      const ctx = merges.get(key) ?? {};
      try {
        const sent = await deliverMessage({
          settings,
          person,
          subject: render(data.subject, ctx),
          body: render(data.body, ctx),
          byEmail: data.byEmail,
          senderMemberId: actor.id,
          senderName: actor.name,
          templateId: data.templateId ?? null,
          attachments: data.attachments,
          leaseId: person.kind === 'tenant' ? ctxLinks.leaseId ?? person.leaseId : null,
          workOrderId: ctxLinks.workOrderId ?? null,
          propertyId: ctxLinks.propertyId ?? person.propertyId,
        });
        if (person.kind === 'applicant') await withRetry(() => zite.applications.update({ id: person.id, record: { lastActivityAt: now } })).catch(() => undefined);
        results.push({ kind: person.kind, id: person.id, name: person.label, thread: sent.thread, messageId: sent.id, delivery: sent.delivery, noEmail: !person.hasEmail, error: null });
      } catch (e) {
        console.error('Message send failed', e instanceof Error ? e.message : e);
        results.push({ kind: person.kind, id: person.id, name: person.label, thread: threadKey(person.kind, person.id), messageId: null, delivery: null, noEmail: !person.hasEmail, error: 'Couldn’t save this message. Try again.' });
      }
    }
    return { results };
  },
});
