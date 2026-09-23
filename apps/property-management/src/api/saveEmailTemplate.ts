import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { TEMPLATE_AUDIENCES } from '@project/shared/constants';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { num, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Create, edit, switch on or off, or delete an email template.
 *
 * Templates tied to an event (rent reminder, receipt, late notice…) always
 * exist — they can be edited or switched off, never deleted. Organizations can
 * add their own Manual templates for writing messages by hand, and delete those.
 */

const subject = z.string().trim().min(1, 'Add a subject line.').max(200, 'Keep the subject under 200 characters.');
const body = z.string().max(10_000, 'Keep the email under 10,000 characters.').refine(v => v.trim().length > 0, { message: 'The email needs a body.' });
const name = z.string().trim().min(1, 'Name the template.').max(80, 'Keep the name under 80 characters.');

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name, audience: z.enum(TEMPLATE_AUDIENCES), subject, body }),
  z.object({ action: z.literal('update'), id: z.string().min(1), name: name.optional(), audience: z.enum(TEMPLATE_AUDIENCES).optional(), subject: subject.optional(), body: body.optional() }),
  z.object({ action: z.literal('toggle'), id: z.string().min(1), enabled: z.boolean() }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Create, edit, switch on/off or delete an email template (admins)',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    const data = parseInput(Input, input);
    const log = (id: string, action: string, summary: string) => logActivity({ entityType: 'settings', entityId: id, action, summary, actorId: actor.id, actorName: actor.name });

    if (data.action === 'create') {
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS p FROM "EmailTemplates"`, params: [] });
      const created = await zite.emailTemplates.create({
        record: { name: data.name, trigger: 'Manual', audience: data.audience, subject: data.subject, body: data.body, enabled: true, position: num(rows[0]?.p) + 1 },
      });
      await log(created.id, 'template_created', `created the “${data.name}” email template`);
      return { id: created.id };
    }

    const { rows } = await zite.sql({ query: `SELECT id, "name", "trigger" FROM "EmailTemplates" WHERE id::text = $1`, params: [data.id] });
    const t = rows[0];
    if (!t) throw new ZiteError('That template no longer exists.', 'NOT_FOUND');
    const label = str(t.name) || 'email';
    const isManual = (str(t.trigger) || 'Manual') === 'Manual';

    if (data.action === 'delete') {
      if (!isManual) throw new ZiteError(`“${label}” is sent automatically, so it can’t be deleted. Switch it off instead.`, 'CONFLICT');
      await zite.emailTemplates.delete({ id: data.id });
      await log(data.id, 'template_deleted', `deleted the “${label}” email template`);
      return { id: data.id };
    }

    if (data.action === 'toggle') {
      await zite.emailTemplates.update({ id: data.id, record: { enabled: data.enabled } });
      await log(data.id, data.enabled ? 'template_enabled' : 'template_disabled', `${data.enabled ? 'switched on' : 'switched off'} the “${label}” email`);
      return { id: data.id };
    }

    // Who an automatic email goes to is fixed by its event; only Manual templates choose an audience.
    if (data.audience && !isManual) throw new ZiteError('Automatic emails always go to the same people, so their audience can’t change.', 'BAD_REQUEST');
    await zite.emailTemplates.update({
      id: data.id,
      record: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.audience !== undefined ? { audience: data.audience } : {}),
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
      },
    });
    await log(data.id, 'template_updated', `edited the “${data.name ?? label}” email template`);
    return { id: data.id };
  },
});
