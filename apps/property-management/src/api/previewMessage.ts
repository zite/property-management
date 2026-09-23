import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadPeople, mergeContexts, missingTags, PERSON_KINDS, personKey, render, renderKnown } from '../server/comms';

/**
 * What a message will look like before it goes: the recipients as the server
 * knows them (so the composer can warn about missing emails without ever
 * handling an address itself), an email template's text, and the subject and
 * body rendered for one recipient with any merge tags that came out empty.
 */

const Id = z.string().min(1).max(64);
const Input = z.object({
  recipients: z.array(z.object({ kind: z.enum(PERSON_KINDS), id: Id })).max(500).default([]),
  /** Which recipient to render the preview for; defaults to the first. */
  previewFor: z.object({ kind: z.enum(PERSON_KINDS), id: Id }).nullish(),
  subject: z.string().max(400).default(''),
  body: z.string().max(20000).default(''),
  templateId: Id.nullish(),
  context: z.object({ workOrderId: Id.nullish(), propertyId: Id.nullish() }).nullish(),
  /** Leave tags without a value in place (`{{due_date}}`) instead of blanking them. */
  keepMissing: z.boolean().default(false),
});

export default createEndpoint({
  description: 'Resolve message recipients and render a template or draft for one of them',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    recipients: z.array(z.object({ kind: z.string(), id: z.string(), name: z.string(), label: z.string(), hint: z.string(), hasEmail: z.boolean(), email: z.string(), unitId: z.string().nullable(), propertyId: z.string().nullable() })),
    missing: z.array(z.object({ kind: z.string(), id: z.string() })),
    template: z.object({ id: z.string(), name: z.string(), subject: z.string(), body: z.string(), audience: z.string() }).nullable(),
    preview: z.object({ kind: z.string(), id: z.string(), name: z.string(), subject: z.string(), body: z.string(), missingTags: z.array(z.string()) }).nullable(),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'communications.send');
    const data = parseInput(Input, input);
    const [settings, people, template] = await Promise.all([
      getSettings(),
      loadPeople(data.previewFor ? [...data.recipients, data.previewFor] : data.recipients),
      data.templateId ? zite.sql({ query: `SELECT id, "name", "subject", "body", "audience" FROM "EmailTemplates" WHERE id::text = $1`, params: [data.templateId] }) : Promise.resolve(null),
    ]);
    if (data.templateId && !template?.rows[0]) throw new ZiteError('That email template no longer exists.', 'NOT_FOUND');
    const t = template?.rows[0];
    const subject = t ? str(t.subject) ?? '' : data.subject;
    const body = t ? str(t.body) ?? '' : data.body;

    const target = data.previewFor ?? data.recipients[0];
    const person = target ? people.get(personKey(target.kind, target.id)) : undefined;
    let preview: { kind: string; id: string; name: string; subject: string; body: string; missingTags: string[] } | null = null;
    if (person) {
      const ctx = (await mergeContexts([person], settings, { workOrderId: data.context?.workOrderId ?? null, propertyId: data.context?.propertyId ?? null })).get(personKey(person.kind, person.id)) ?? {};
      const fill = data.keepMissing ? renderKnown : render;
      preview = { kind: person.kind, id: person.id, name: person.label, subject: fill(subject, ctx), body: fill(body, ctx), missingTags: missingTags(`${subject}\n${body}`, ctx) };
    }

    return {
      recipients: data.recipients.flatMap(r => {
        const p = people.get(personKey(r.kind, r.id));
        // Staff see whether there is an address, and which, for the person they chose — never a way to type one in.
        return p ? [{ kind: p.kind, id: p.id, name: p.name, label: p.label, hint: p.hint, hasEmail: p.hasEmail, email: p.hasEmail ? p.email ?? '' : '', unitId: p.unitId, propertyId: p.propertyId }] : [];
      }),
      missing: data.recipients.filter(r => !people.has(personKey(r.kind, r.id))),
      template: t ? { id: String(t.id), name: str(t.name) ?? '', subject, body, audience: str(t.audience) || 'Tenant' } : null,
      preview,
    };
  },
});
