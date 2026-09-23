import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { ensureTemplates } from '@project/shared/server/setup';
import { bool, num, str } from '@project/shared/server/sql';

/**
 * Every email template with its full subject and body, for the editor in
 * Settings → Email templates. Built-in templates are added back first if any
 * are missing, so the list always has one per event.
 */

export const EmailTemplate = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.string(),
  audience: z.string(),
  subject: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  position: z.number(),
});

export default createEndpoint({
  description: 'List email templates with subject and body (admins)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ templates: z.array(EmailTemplate) }),
  execute: async ({ context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    await ensureTemplates();
    const { rows } = await zite.sql({
      query: `SELECT id, "name", "trigger", "audience", "subject", "body", "enabled", "position" FROM "EmailTemplates" ORDER BY COALESCE("position", 0) ASC, created_at ASC LIMIT 500`,
      params: [],
    });
    return {
      templates: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        trigger: str(r.trigger) || 'Manual',
        audience: str(r.audience) || 'Tenant',
        subject: str(r.subject) ?? '',
        body: str(r.body) ?? '',
        enabled: bool(r.enabled),
        position: num(r.position),
      })),
    };
  },
});
