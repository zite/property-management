import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { DOCUMENT_CATEGORIES } from '@project/shared/constants';
import { logActivity } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { parseInput } from '../server/input';

/**
 * Add a document to a record, update its details or sharing, or delete it.
 * The file itself is uploaded from the browser first (`zitejs/upload`); this
 * stores what it is and who can see it.
 */

const Links = z.object({
  propertyId: z.string().nullish(), unitId: z.string().nullish(), leaseId: z.string().nullish(), tenantId: z.string().nullish(),
  ownerId: z.string().nullish(), vendorId: z.string().nullish(), workOrderId: z.string().nullish(), applicationId: z.string().nullish(),
});

const Input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1, 'Give the document a name.').max(200),
    url: z.string().url('The upload didn’t finish. Try again.'),
    category: z.enum(DOCUMENT_CATEGORIES),
    size: z.number().nullish(),
    mimeType: z.string().max(120).nullish(),
    sharedWithTenant: z.boolean().optional(),
    sharedWithOwner: z.boolean().optional(),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    notes: z.string().max(2000).nullish(),
    links: Links,
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    sharedWithTenant: z.boolean().optional(),
    sharedWithOwner: z.boolean().optional(),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    notes: z.string().max(2000).nullish(),
  }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
]);

export default createEndpoint({
  description: 'Create, update or delete a document on a record',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    if (data.action === 'create') {
      const links = Object.fromEntries(Object.entries(data.links).filter(([, v]) => v)) as Record<string, string>;
      if (!Object.keys(links).length) throw new ZiteError('Attach the document to something.', 'BAD_REQUEST');
      const created = await zite.documents.create({
        record: {
          name: data.name, url: data.url, category: data.category, size: data.size ?? null, mimeType: data.mimeType ?? null,
          sharedWithTenant: Boolean(data.sharedWithTenant), sharedWithOwner: Boolean(data.sharedWithOwner), expiresOn: data.expiresOn ?? null, notes: data.notes ?? null,
          uploadedById: actor.id, uploadedByName: actor.name, uploadedAt: new Date().toISOString(), ...links,
        },
      });
      const [entityType, entityId] = links.workOrderId ? ['work_order', links.workOrderId] : links.leaseId ? ['lease', links.leaseId] : links.vendorId ? ['vendor', links.vendorId] : links.tenantId ? ['tenant', links.tenantId] : links.ownerId ? ['owner', links.ownerId] : links.applicationId ? ['application', links.applicationId] : links.unitId ? ['unit', links.unitId] : ['property', links.propertyId];
      await logActivity({ entityType: entityType as never, entityId, action: 'document_added', summary: `added ${data.name}`, actorId: actor.id, actorName: actor.name, ...links });
      return { id: created.id };
    }
    const existing = await zite.documents.findOne({ id: data.id });
    if (!existing) throw new ZiteError('That document no longer exists.', 'NOT_FOUND');
    if (data.action === 'delete') {
      await zite.documents.delete({ id: data.id });
      return { id: data.id };
    }
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'category', 'sharedWithTenant', 'sharedWithOwner', 'expiresOn', 'notes'] as const) if (data[k] !== undefined) patch[k] = data[k];
    if (Object.keys(patch).length) await zite.documents.update({ id: data.id, record: patch });
    return { id: data.id };
  },
});
