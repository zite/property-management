import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { bool, day, iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/** Documents attached to a record (property, unit, lease, tenant, owner, vendor, work order, application). */

export const DOCUMENT_SCOPES = ['propertyId', 'unitId', 'leaseId', 'tenantId', 'ownerId', 'vendorId', 'workOrderId', 'applicationId'] as const;

const Input = z.object({ scope: z.enum(DOCUMENT_SCOPES), id: z.string().min(1) });

export const DocumentDto = z.object({
  id: z.string(), name: z.string(), url: z.string(), category: z.string(), size: z.number().nullable(), mimeType: z.string(),
  sharedWithTenant: z.boolean(), sharedWithOwner: z.boolean(), uploadedById: z.string().nullable(), uploadedByName: z.string(), uploadedAt: z.string(),
  expiresOn: z.string().nullable(), notes: z.string(),
  propertyId: z.string().nullable(), unitId: z.string().nullable(), leaseId: z.string().nullable(), tenantId: z.string().nullable(), ownerId: z.string().nullable(),
  vendorId: z.string().nullable(), workOrderId: z.string().nullable(), applicationId: z.string().nullable(),
});

export function toDocumentDto(r: Record<string, unknown>) {
  return {
    id: String(r.id), name: str(r.name) ?? 'Untitled', url: str(r.url) ?? '', category: str(r.category) || 'Other', size: r.size == null || r.size === '' ? null : num(r.size), mimeType: str(r.mimeType) ?? '',
    sharedWithTenant: bool(r.sharedWithTenant), sharedWithOwner: bool(r.sharedWithOwner), uploadedById: ref(r.uploadedById), uploadedByName: str(r.uploadedByName) ?? '',
    uploadedAt: iso(r.uploadedAt) ?? iso(r.created_at) ?? new Date().toISOString(), expiresOn: day(r.expiresOn), notes: str(r.notes) ?? '',
    propertyId: ref(r.propertyId), unitId: ref(r.unitId), leaseId: ref(r.leaseId), tenantId: ref(r.tenantId), ownerId: ref(r.ownerId),
    vendorId: ref(r.vendorId), workOrderId: ref(r.workOrderId), applicationId: ref(r.applicationId),
  };
}

export default createEndpoint({
  description: 'List documents attached to a record',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ documents: z.array(DocumentDto) }),
  execute: async ({ input, context }) => {
    await getActor(context);
    const { scope, id } = parseInput(Input, input);
    // `scope` is from a closed enum, so it's safe as an identifier.
    const { rows } = await zite.sql({ query: `SELECT * FROM "Documents" WHERE "${scope}" = $1 ORDER BY COALESCE("uploadedAt", created_at) DESC LIMIT 500`, params: [id] });
    return { documents: rows.map(toDocumentDto) };
  },
});
