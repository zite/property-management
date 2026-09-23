import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { renderMerge, sampleMergeContext } from '@project/shared/merge';
import { assertCan, getActor } from '@project/shared/server/actor';
import { orgMergeContext, sendEmail } from '@project/shared/server/email';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { parseInput } from '../server/input';

/**
 * Email a template — as it stands in the editor, saved or not — to the admin
 * who is editing it, with sample values for anything about a resident, lease
 * or work order and the organization's real name, phone and portal link.
 */

const Input = z.object({
  subject: z.string().trim().min(1, 'Add a subject line before sending a test.').max(200, 'Keep the subject under 200 characters.'),
  body: z.string().max(10_000, 'Keep the email under 10,000 characters.').refine(v => v.trim().length > 0, { message: 'Write the email before sending a test.' }),
});

export default createEndpoint({
  description: 'Send a test of an email template to yourself (admins)',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ to: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'settings.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const org = Object.fromEntries(Object.entries(orgMergeContext(settings)).filter(([, v]) => v));
    const ctx = { ...sampleMergeContext(), ...org, grace_period_days: String(settings.gracePeriodDays), recipient_name: actor.name, recipient_first_name: actor.name.split(/\s+/)[0] || 'there' };
    const home = portalLink(settings);
    const result = await sendEmail({
      to: actor.email,
      subject: `[Test] ${renderMerge(data.subject, ctx)}`,
      text: renderMerge(data.body, ctx),
      settings,
      button: home ? { label: 'Open the portal', href: home } : null,
    });
    if (result === 'Failed') throw new ZiteError(`The test email to ${actor.email} didn’t send. Try again in a minute.`, 'BAD_REQUEST');
    return { to: actor.email };
  },
});
