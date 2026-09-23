import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { iso, num, ref, str } from '@project/shared/server/sql';

/**
 * The team, for Settings → Team: everyone who has been invited or has signed
 * in, with when they were invited and last seen, and how much open work each
 * person holds — so deactivating someone can say what stays assigned to them.
 */

export const TeamMember = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  color: z.string(),
  avatarUrl: z.string().nullable(),
  title: z.string(),
  phone: z.string(),
  invitedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  joinedAt: z.string().nullable(),
  openWorkOrders: z.number(),
  openTasks: z.number(),
});

export default createEndpoint({
  description: 'List team members with their status and open work (admins)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ members: z.array(TeamMember), meId: z.string() }),
  execute: async ({ context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'members.manage');
    const { rows } = await zite.sql({
      query: `
        SELECT m.id, m."name", m."email", m."role", m."status", m."color", m."avatarUrl", m."title", m."phone", m."invitedAt", m."lastSeenAt", m.created_at,
          (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."assigneeId" = m.id::text AND w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')) AS "openWorkOrders",
          (SELECT COUNT(*) FROM "Tasks" t WHERE t."assigneeId" = m.id::text AND t."status" IN ('To do', 'In progress')) AS "openTasks"
        FROM "Members" m
        ORDER BY CASE m."status" WHEN 'Deactivated' THEN 1 ELSE 0 END, LOWER(m."name") ASC
        LIMIT 2000`,
      params: [],
    });
    return {
      meId: actor.id,
      members: rows.map(r => ({
        id: String(r.id),
        name: str(r.name) ?? '',
        email: str(r.email) ?? '',
        role: str(r.role) || 'Property Manager',
        status: str(r.status) || 'Active',
        color: str(r.color) || '#64748b',
        avatarUrl: ref(r.avatarUrl),
        title: str(r.title) ?? '',
        phone: str(r.phone) ?? '',
        invitedAt: iso(r.invitedAt),
        lastSeenAt: iso(r.lastSeenAt),
        joinedAt: iso(r.created_at),
        openWorkOrders: num(r.openWorkOrders),
        openTasks: num(r.openTasks),
      })),
    };
  },
});
