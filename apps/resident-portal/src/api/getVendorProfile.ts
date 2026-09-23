import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays } from '@project/shared/dates';
import { bool, day, iso, num, numOrNull, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { docKind, vendorScope } from '../server/vendor';

/**
 * The vendor's company record as the office has it: contact details they can
 * change, and the compliance paperwork — W-9 and certificate of insurance —
 * with what the office has verified and what's waiting for review.
 */

const Input = z.object({});

export default createEndpoint({
  description: "The vendor's company details and compliance documents",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await vendorScope(context);
    const [vendorRows, docs, stats] = await Promise.all([
      zite.sql({ query: `SELECT * FROM "Vendors" WHERE id::text = $1 LIMIT 1`, params: [scope.vendorId] }),
      zite.sql({
        query: `SELECT id, "name", "url", "category", "expiresOn", "uploadedAt", "uploadedByName", created_at FROM "Documents" WHERE "vendorId" = $1 AND COALESCE("workOrderId", '') = '' AND "category" IN ('Insurance', 'Other') ORDER BY COALESCE("uploadedAt", created_at) DESC LIMIT 100`,
        params: [scope.vendorId],
      }),
      zite.sql({
        query: `SELECT COUNT(*) FILTER (WHERE "status" IN ('New', 'Scheduled', 'In progress', 'On hold')) AS open, COUNT(*) FILTER (WHERE "status" = 'Completed' AND "completedAt" >= $2) AS done FROM "WorkOrders" WHERE "vendorId" = $1`,
        params: [scope.vendorId, `${scope.today.slice(0, 4)}-01-01`],
      }),
    ]);
    const v = vendorRows.rows[0] ?? {};
    const documents = docs.rows.map(d => ({
      id: String(d.id),
      name: str(d.name) || 'Document',
      url: str(d.url) ?? '',
      kind: docKind(str(d.name) ?? '', str(d.category) ?? ''),
      expiresOn: day(d.expiresOn),
      uploadedAt: iso(d.uploadedAt) ?? iso(d.created_at),
      uploadedByName: str(d.uploadedByName) ?? '',
    }));

    const expiresOn = day(v.insuranceExpiresOn);
    const latestCoi = documents.find(d => d.kind === 'Insurance' && d.expiresOn);
    const insuranceStatus = !expiresOn ? 'Missing' : expiresOn < scope.today ? 'Expired' : expiresOn <= addDays(scope.today, 30) ? 'Expiring soon' : 'Current';
    const w9OnFile = bool(v.w9OnFile);
    const latestW9 = documents.find(d => d.kind === 'W-9');

    return {
      today: scope.today,
      vendor: {
        name: str(v.name) ?? scope.vendor.name,
        trade: str(v.trade) ?? '',
        contactName: str(v.contactName) ?? '',
        email: str(v.email) ?? '',
        phone: str(v.phone) ?? '',
        address: str(v.address) ?? '',
        licenseNumber: str(v.licenseNumber) ?? '',
        is1099: bool(v.is1099),
        paymentTermsDays: numOrNull(v.paymentTermsDays),
      },
      compliance: {
        insurance: {
          expiresOn,
          status: insuranceStatus,
          // A certificate newer than what's on file is waiting for someone at the office to check it.
          pendingReview: Boolean(latestCoi && latestCoi.expiresOn && (!expiresOn || latestCoi.expiresOn > expiresOn)),
          pendingExpiresOn: latestCoi && latestCoi.expiresOn && (!expiresOn || latestCoi.expiresOn > expiresOn) ? latestCoi.expiresOn : null,
        },
        w9: { onFile: w9OnFile, pendingReview: !w9OnFile && Boolean(latestW9), required: bool(v.is1099) },
      },
      stats: { openWorkOrders: num(stats.rows[0]?.open), completedThisYear: num(stats.rows[0]?.done) },
      documents,
      office: { name: scope.settings.organizationName, phone: scope.settings.phone, email: scope.settings.supportEmail ?? '' },
    };
  },
});
