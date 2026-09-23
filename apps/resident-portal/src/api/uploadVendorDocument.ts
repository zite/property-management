import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, formatDay, isDay } from '@project/shared/dates';
import { membersWith } from '@project/shared/server/actor';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { iso } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { isFileUrl, vendorScope } from '../server/vendor';

/**
 * The vendor sends compliance paperwork: a W-9, a certificate of insurance
 * (with its expiration date) or another document. It's filed on their vendor
 * record and the people who manage vendors are asked to verify it — the
 * vendor's insurance date and W-9 flag only change when staff update them.
 */

const Input = z.object({
  kind: z.enum(['W-9', 'Insurance', 'Other']),
  label: z.string().trim().max(120, 'Keep the name under 120 characters.').nullish(),
  expiresOn: z.string().nullish(),
  file: z.object({ url: z.string().max(2000), name: z.string().max(200), size: z.number().nonnegative().nullish(), type: z.string().max(120).nullish() }),
});

export default createEndpoint({
  description: 'Upload a W-9, certificate of insurance or other document as the vendor',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    if (!isFileUrl(req.file.url)) throw new ZiteError('The file didn’t upload. Choose it again.', 'BAD_REQUEST');
    const scope = await vendorScope(context);
    let expiresOn: string | null = null;
    if (req.kind === 'Insurance') {
      if (!req.expiresOn || !isDay(req.expiresOn)) throw new ZiteError('Enter the date the certificate expires.', 'BAD_REQUEST');
      if (req.expiresOn < scope.today) throw new ZiteError('That certificate has already expired. Upload the current one.', 'BAD_REQUEST');
      if (req.expiresOn > addDays(scope.today, 366 * 3)) throw new ZiteError('Check the expiration date — it’s more than three years away.', 'BAD_REQUEST');
      expiresOn = req.expiresOn;
    }
    if (req.kind === 'Other' && !req.label) throw new ZiteError('Name the document so the office knows what it is.', 'BAD_REQUEST');

    const ext = /\.[a-z0-9]{2,5}$/i.exec(req.file.name)?.[0] ?? '';
    const name = (req.kind === 'W-9' ? `W-9 — ${scope.vendor.name}` : req.kind === 'Insurance' ? `Certificate of insurance — ${scope.vendor.name}` : `${req.label} — ${scope.vendor.name}`) + ext;
    const now = new Date().toISOString();
    const who = scope.vendor.contactName || scope.vendor.name;
    const doc = await zite.documents.create({
      record: {
        name: name.slice(0, 240),
        url: req.file.url,
        category: req.kind === 'Insurance' ? 'Insurance' : 'Other',
        vendorId: scope.vendorId,
        expiresOn,
        uploadedByName: `${who} (${scope.vendor.name})`.slice(0, 200),
        size: req.file.size ?? null,
        mimeType: req.file.type ?? null,
        notes: 'Uploaded in the vendor portal. Verify it and update the vendor record.',
        sharedWithOwner: false,
        sharedWithTenant: false,
        uploadedAt: now,
      },
    });

    const what = req.kind === 'W-9' ? 'a W-9' : req.kind === 'Insurance' ? `a certificate of insurance (expires ${formatDay(expiresOn)})` : `“${req.label}”`;
    const people = await membersWith('vendors.manage');
    await Promise.all([
      logActivity({ entityType: 'vendor', entityId: scope.vendorId, action: 'document_uploaded', summary: `uploaded ${what} in the vendor portal`, actorName: scope.vendor.name, data: { by: 'vendor', kind: req.kind, documentId: doc.id, expiresOn }, vendorId: scope.vendorId }),
      notify({
        recipientIds: people.map(p => p.id),
        // No dedicated kind for vendor paperwork yet (see the Portal C report); these are the closest.
        kind: 'vendor_document',
        title: `${scope.vendor.name} uploaded ${what}`,
        body: req.kind === 'Insurance' ? 'Check the certificate and update their insurance expiration date.' : req.kind === 'W-9' ? 'Check the W-9 and mark it on file.' : 'Review the document on their vendor record.',
        link: `/vendors/${scope.vendorId}`,
        entityType: 'vendor',
        entityId: scope.vendorId,
        actorName: scope.vendor.name,
      }),
    ]);

    return { id: doc.id, name, url: req.file.url, kind: req.kind, expiresOn, uploadedAt: iso(now), uploadedByName: `${who} (${scope.vendor.name})` };
  },
});
