import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { homeLabel, residentFor } from '../server/resident';

/**
 * Documents the office has shared with this household — the lease, notices,
 * addenda, inspection reports — plus what the resident uploaded themselves.
 * The signed lease and shared inspection reports are listed even when nobody
 * filed a separate document for them.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish() });

type Doc = { id: string; name: string; url: string; category: string; size: number | null; mimeType: string; uploadedAt: string | null; uploadedBy: string; mine: boolean; expiresOn: string | null };

export default createEndpoint({
  description: 'Documents shared with a resident',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId } = parseInput(Input, input);
    const me = await residentFor(context, leaseId);
    const { lease, tenantId } = me;
    const [{ rows }, { rows: inspections }] = await Promise.all([
      zite.sql({
        query: `
          SELECT id, "name", "url", "category", "size", "mimeType", "uploadedAt", "uploadedByName", "uploadedById", "tenantId", "expiresOn", created_at
          FROM "Documents"
          WHERE COALESCE("sharedWithTenant", false) = true AND ("leaseId" = $1 OR ("tenantId" = $2 AND COALESCE("leaseId", '') = ''))
          ORDER BY COALESCE("uploadedAt", created_at) DESC LIMIT 500`,
        params: [lease.id, tenantId],
      }),
      zite.sql({
        query: `SELECT id, "title", "reportUrl", "completedAt" FROM "Inspections" WHERE "leaseId" = $1 AND COALESCE("sharedWithTenant", false) = true AND "status" = 'Completed' AND COALESCE("reportUrl", '') <> ''`,
        params: [lease.id],
      }),
    ]);

    const docs: Doc[] = rows
      .filter(r => /^https?:\/\//.test(String(r.url ?? '')))
      .map(r => {
        const mine = ref(r.tenantId) === tenantId && !ref(r.uploadedById);
        return {
          id: String(r.id),
          name: str(r.name) || 'Document',
          url: String(r.url),
          category: str(r.category) || 'Other',
          size: numOrNull(r.size),
          mimeType: str(r.mimeType) ?? '',
          uploadedAt: iso(r.uploadedAt) ?? iso(r.created_at),
          uploadedBy: mine ? 'You' : str(r.uploadedByName) || 'The office',
          mine,
          expiresOn: r.expiresOn ? String(r.expiresOn).slice(0, 10) : null,
        };
      });

    const urls = new Set(docs.map(d => d.url));
    if (lease.documentUrl && !urls.has(lease.documentUrl) && !docs.some(doc => doc.category === 'Lease')) {
      docs.push({ id: `lease-${lease.id}`, name: lease.countersignedAt ? 'Signed lease' : 'Lease agreement', url: lease.documentUrl, category: 'Lease', size: null, mimeType: 'application/pdf', uploadedAt: lease.countersignedAt ?? lease.signedAt, uploadedBy: 'The office', mine: false, expiresOn: null });
    }
    for (const i of inspections) {
      const url = String(i.reportUrl);
      if (urls.has(url)) continue;
      docs.push({ id: `inspection-${i.id}`, name: `${str(i.title) || 'Inspection'} report`, url, category: 'Inspection', size: null, mimeType: 'application/pdf', uploadedAt: iso(i.completedAt), uploadedBy: 'The office', mine: false, expiresOn: null });
    }
    docs.sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));

    return { home: homeLabel(lease), documents: docs, total: num(docs.length) };
  },
});
