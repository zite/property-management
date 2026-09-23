import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { ROLES } from '@project/shared/constants';
import { logActivity } from '@project/shared/server/activity';
import { asRole, assertCan, getActor } from '@project/shared/server/actor';
import { emailMember } from '@project/shared/server/email';
import { getSettings, staffLink } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Change a teammate: their role, name and title, deactivate or reactivate
 * them, or resend a pending invite.
 *
 * There is always at least one active admin — the last one can't be
 * demoted or deactivated — and nobody can deactivate themselves.
 */

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('role'), id: z.string().min(1), role: z.enum(ROLES, { errorMap: () => ({ message: 'Choose a role.' }) }) }),
  z.object({
    action: z.literal('details'),
    id: z.string().min(1),
    name: z.string().trim().min(1, 'Enter a name.').max(80, 'Keep the name under 80 characters.'),
    title: z.string().trim().max(80, 'Keep the title under 80 characters.'),
  }),
  z.object({ action: z.literal('deactivate'), id: z.string().min(1) }),
  z.object({ action: z.literal('reactivate'), id: z.string().min(1) }),
  z.object({ action: z.literal('resend'), id: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Change a teammate’s role or details, deactivate, reactivate or resend an invite (admins)',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), status: z.string(), role: z.string(), delivery: z.enum(['Sent', 'Failed']).nullable() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');
    const data = parseInput(Input, input);

    const { rows } = await zite.sql({ query: `SELECT id, "name", "email", "role", "status", "lastSeenAt" FROM "Members" WHERE id::text = $1`, params: [data.id] });
    const m = rows[0];
    if (!m) throw new ZiteError('That teammate no longer exists.', 'NOT_FOUND');
    const name = str(m.name) || str(m.email) || 'This teammate';
    const role = asRole(m.role);
    const status = str(m.status) || 'Active';
    const isSelf = String(m.id) === actor.id;

    /** Refuse a change that would leave nobody who can manage the team. */
    const assertAnotherAdmin = async (verb: string) => {
      if (role !== 'Admin' || status !== 'Active') return;
      const { rows: others } = await zite.sql({
        query: `SELECT COUNT(*) AS n FROM "Members" WHERE "role" = 'Admin' AND "status" = 'Active' AND id::text <> $1`,
        params: [data.id],
      });
      if (Number(others[0]?.n ?? 0) === 0) {
        throw new ZiteError(`${isSelf ? 'You’re' : `${name} is`} the only active admin, so ${isSelf ? 'you' : 'they'} can’t be ${verb}. Make someone else an admin first.`, 'CONFLICT');
      }
    };
    const log = (action: string, summary: string, extra?: Record<string, unknown>) =>
      logActivity({ entityType: 'member', entityId: String(m.id), action, summary, actorId: actor.id, actorName: actor.name, data: extra ?? null });

    if (data.action === 'role') {
      if (data.role === role) return { id: data.id, status, role, delivery: null };
      if (data.role !== 'Admin') await assertAnotherAdmin('demoted');
      await zite.members.update({ id: data.id, record: { role: data.role } });
      await log('member_role_changed', `changed ${name}’s role from ${role} to ${data.role}`, { from: role, to: data.role });
      return { id: data.id, status, role: data.role, delivery: null };
    }

    if (data.action === 'details') {
      await zite.members.update({ id: data.id, record: { name: data.name, title: data.title || null } });
      return { id: data.id, status, role, delivery: null };
    }

    if (data.action === 'deactivate') {
      if (isSelf) throw new ZiteError('You can’t deactivate yourself. Ask another admin to do it.', 'CONFLICT');
      if (status === 'Deactivated') return { id: data.id, status, role, delivery: null };
      await assertAnotherAdmin('deactivated');
      await zite.members.update({ id: data.id, record: { status: 'Deactivated' } });
      await log('member_deactivated', status === 'Invited' ? `revoked ${name}’s invite` : `deactivated ${name}`);
      return { id: data.id, status: 'Deactivated', role, delivery: null };
    }

    if (data.action === 'reactivate') {
      if (status !== 'Deactivated') return { id: data.id, status, role, delivery: null };
      // Someone who never signed in goes back to a pending invite.
      const next = m.lastSeenAt ? 'Active' : 'Invited';
      await zite.members.update({ id: data.id, record: { status: next } });
      await log('member_reactivated', `reactivated ${name}`);
      return { id: data.id, status: next, role, delivery: null };
    }

    // resend
    if (status !== 'Invited') throw new ZiteError(`${name} has already signed in, so there’s no invite to resend.`, 'CONFLICT');
    const settings = await getSettings();
    const email = str(m.email) ?? '';
    const link = staffLink(settings, '/home');
    const delivery = await emailMember({
      settings,
      to: email,
      subject: `Reminder: ${actor.name} invited you to ${settings.organizationName}`,
      text: [
        `Hi ${name.split(/\s+/)[0]},`,
        `You’ve been added to ${settings.organizationName} with the ${role} role.`,
        link ? `Sign in with this email address (${email}) to get started: ${link}` : `Sign in with this email address (${email}) to get started.`,
      ].join('\n\n'),
      hashPath: '/home',
      linkLabel: 'Sign in',
    });
    await zite.members.update({ id: data.id, record: { invitedAt: new Date().toISOString() } });
    return { id: data.id, status, role, delivery };
  },
});
