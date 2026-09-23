import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { can } from '@project/shared/roles';
import { num } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * Saved views for any list: a name, the list it belongs to (`scope`) and the
 * filters/options as JSON. Private views belong to their author; shared views
 * show for everyone, and only their author or an admin can change them.
 */

export const VIEW_SCOPES = ['work_orders', 'leases', 'residents', 'applications', 'tasks', 'units'] as const;

const Config = z.object({ filters: z.record(z.string(), z.unknown()), options: z.record(z.string(), z.unknown()) });

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1, 'Name the view.').max(80), scope: z.enum(VIEW_SCOPES), config: Config, shared: z.boolean().optional() }),
  z.object({ action: z.literal('update'), id: z.string().min(1), name: z.string().trim().min(1).max(80).optional(), config: Config.optional(), shared: z.boolean().optional() }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Create, update or delete a saved view',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    const json = (c: z.infer<typeof Config>) => {
      const s = JSON.stringify(c);
      if (s.length > 20_000) throw new ZiteError('That view has too many filters to save.', 'BAD_REQUEST');
      return s;
    };

    if (data.action === 'create') {
      const { rows } = await zite.sql({ query: `SELECT COALESCE(MAX("position"), 0) AS p FROM "Views"`, params: [] });
      const created = await zite.views.create({ record: { name: data.name, scope: data.scope, config: json(data.config), ownerId: actor.id, shared: Boolean(data.shared), position: num(rows[0]?.p) + 1 } });
      return { id: created.id };
    }

    const { rows } = await zite.sql({ query: `SELECT id, "ownerId", "shared" FROM "Views" WHERE id::text = $1`, params: [data.id] });
    const view = rows[0];
    if (!view) throw new ZiteError('That view no longer exists.', 'NOT_FOUND');
    const mine = String(view.ownerId ?? '') === actor.id;
    if (!mine && !can(actor.role, 'settings.manage')) throw new ZiteError('Only the person who made this view or an admin can change it.', 'FORBIDDEN');

    if (data.action === 'delete') {
      await zite.views.delete({ id: data.id });
      return { id: data.id };
    }
    await zite.views.update({
      id: data.id,
      record: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.config ? { config: json(data.config) } : {}),
        ...(data.shared !== undefined ? { shared: data.shared } : {}),
      },
    });
    return { id: data.id };
  },
});
