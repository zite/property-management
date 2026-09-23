import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { isDay } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { parseInput } from '../server/identity';
import { assertDailyLimit, homeLabel, officeRecipients, residentFor } from '../server/resident';

/**
 * A resident files a document with the office: renters insurance, ID, a
 * written notice. It's shared back with them and tagged to their lease and
 * home so staff find it on the lease.
 */

const RESIDENT_DOCUMENT_CATEGORIES = ['Insurance', 'Identification', 'Notice', 'Receipt', 'Photo', 'Other'] as const;

const Input = z.object({
  leaseId: z.string().max(64).nullish(),
  name: z.string().trim().min(1, 'Name the document.').max(200, 'Keep the name under 200 characters.'),
  url: z.string().url().regex(/^https:\/\//, 'That upload didn’t finish. Try again.').max(2000),
  category: z.enum(RESIDENT_DOCUMENT_CATEGORIES),
  size: z.number().int().nonnegative().max(50 * 1024 * 1024).nullish(),
  mimeType: z.string().max(120).nullish(),
  expiresOn: z.string().refine(isDay, 'Choose a valid date.').nullish(),
});

export default createEndpoint({
  description: 'A resident uploads a document for the office',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const data = parseInput(Input, input);
    const me = await residentFor(context, data.leaseId);
    const { lease, tenantId } = me;
    await assertDailyLimit('Documents', 'tenantId', tenantId, 30, 'documents');
    const now = new Date().toISOString();
    const doc = await zite.documents.create({
      record: {
        name: data.name,
        url: data.url,
        category: data.category,
        propertyId: lease.propertyId || null,
        unitId: lease.unitId || null,
        leaseId: lease.id,
        tenantId,
        sharedWithTenant: true,
        sharedWithOwner: false,
        uploadedByName: me.name,
        size: data.size ?? null,
        mimeType: data.mimeType ?? null,
        expiresOn: data.category === 'Insurance' ? data.expiresOn ?? null : null,
        uploadedAt: now,
      },
    });
    const home = homeLabel(lease);
    await Promise.all([
      logActivity({
        entityType: 'lease',
        entityId: lease.id,
        action: 'document_uploaded',
        summary: `uploaded ${data.category === 'Insurance' ? 'renters insurance' : `a document`} — ${data.name}`,
        actorName: me.name,
        data: { documentId: doc.id, category: data.category },
        propertyId: lease.propertyId || null,
        unitId: lease.unitId || null,
        leaseId: lease.id,
        tenantId,
      }),
      officeRecipients(lease, 'residents.manage').then(ids =>
        notify({
          recipientIds: ids,
          kind: 'message_received',
          title: `${me.name} uploaded ${data.category === 'Insurance' ? 'renters insurance' : 'a document'}`,
          body: `${data.name} · ${home}`,
          link: `/leases/${lease.id}`,
          entityType: 'lease',
          entityId: lease.id,
          actorName: me.name,
        }),
      ),
    ]);
    return { id: doc.id, uploadedAt: now };
  },
});
