import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { ROLES } from '@project/shared/constants';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, colorFor, getActor, nameFromEmail } from '@project/shared/server/actor';
import { emailMember } from '@project/shared/server/email';
import { getSettings, staffLink } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Invite someone to the team. They get a Members row straight away (status
 * Invited, with the role chosen here), and an email with a link to sign in.
 * The first time they sign in with that address, `getActor` finds the row and
 * makes them Active — the role is already theirs.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const Input = z.object({
  email: z.string().trim().toLowerCase().max(200).refine(v => EMAIL_RE.test(v), { message: 'Enter a valid email address.' }),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Choose a role.' }) }),
  name: z.string().trim().max(80, 'Keep the name under 80 characters.').optional(),
  title: z.string().trim().max(80, 'Keep the title under 80 characters.').optional(),
});

export default createEndpoint({
  description: 'Invite a teammate by email with a role (admins)',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), delivery: z.enum(['Sent', 'Failed']) }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');
    const data = parseInput(Input, input);

    const { rows } = await zite.sql({ query: `SELECT id, "name", "status" FROM "Members" WHERE LOWER("email") = $1 LIMIT 1`, params: [data.email] });
    if (rows[0]) {
      const who = str(rows[0].name) || data.email;
      if (rows[0].status === 'Deactivated') throw new ZiteError(`${who} is already on the team but deactivated. Reactivate them instead.`, 'CONFLICT');
      if (rows[0].status === 'Invited') throw new ZiteError(`${who} has already been invited. Resend the invite from their row.`, 'CONFLICT');
      throw new ZiteError(`${who} is already on the team.`, 'CONFLICT');
    }

    const settings = await getSettings();
    const name = data.name || nameFromEmail(data.email);
    const created = await zite.members.create({
      record: { name, email: data.email, role: data.role, status: 'Invited', color: colorFor(data.email), title: data.title || null, invitedAt: new Date().toISOString() },
    });

    const link = staffLink(settings, '/home');
    const delivery = await emailMember({
      settings,
      to: data.email,
      subject: `${actor.name} invited you to ${settings.organizationName}`,
      text: [
        `Hi ${name.split(/\s+/)[0]},`,
        `${actor.name} added you to ${settings.organizationName} with the ${data.role} role. This is where the team runs properties, leases, maintenance and the books.`,
        link
          ? `Sign in with this email address (${data.email}) to get started: ${link}`
          : `Sign in with this email address (${data.email}) to get started. Ask ${actor.name.split(/\s+/)[0]} for the link if you don’t have it.`,
      ].join('\n\n'),
      hashPath: '/home',
      linkLabel: 'Sign in',
    });

    await logActivity({ entityType: 'member', entityId: created.id, action: 'member_invited', summary: `invited ${name} with the ${data.role} role`, actorId: actor.id, actorName: actor.name, data: { email: data.email, role: data.role } });
    return { id: created.id, delivery };
  },
});
