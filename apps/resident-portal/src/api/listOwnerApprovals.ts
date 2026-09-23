import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { threadKey } from '@project/shared/server/email';
import { iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { ownerScope, photoList, propertyAddress } from '../server/owner';

/**
 * Repairs on the owner's properties that need their decision, with what they
 * need to make it — the description, estimate, vendor, photos, quotes shared
 * with them and the messages about it — plus the decisions they've made.
 */

const Input = z.object({});

export default createEndpoint({
  description: "Repairs waiting for the owner's approval, and past decisions",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await ownerScope(context);
    const { propertyIds, ownerId } = scope;
    if (!propertyIds.length) return { currency: scope.settings.currency, pending: [], history: [] };

    const { rows } = await zite.sql({
      query: `
        SELECT w.id, w."number", w."title", w."description", w."category", w."priority", w."status", w."estimateAmount", w."actualCost", w."photos",
          w."ownerApproval", w."ownerApprovalNote", w."ownerRespondedAt", w."reportedAt", w."scheduledFor", w."completedAt", w."propertyId",
          p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", u."name" AS "unitName",
          v."name" AS "vendorName", v."trade" AS "vendorTrade",
          (SELECT MAX(a."occurredAt") FROM "Activity" a WHERE a."workOrderId" = w.id::text AND a."action" = 'approval_requested') AS "requestedAt"
        FROM "WorkOrders" w
        JOIN "Properties" p ON p.id::text = w."propertyId"
        LEFT JOIN "Units" u ON u.id::text = w."unitId"
        LEFT JOIN "Vendors" v ON v.id::text = w."vendorId"
        WHERE w."propertyId" = ANY($1) AND w."ownerApproval" IN ('Pending', 'Approved', 'Declined')
        ORDER BY CASE WHEN w."ownerApproval" = 'Pending' THEN 0 ELSE 1 END, COALESCE(w."ownerRespondedAt", w."reportedAt", w.created_at) DESC
        LIMIT 200`,
      params: [propertyIds],
    });
    const ids = rows.map(r => String(r.id));
    const pendingSince = rows.filter(r => str(r.ownerApproval) === 'Pending').map(r => iso(r.requestedAt) ?? iso(r.reportedAt)).filter((v): v is string => Boolean(v)).sort()[0];
    // A day before the request, so the office's heads-up call-out is included.
    const since = pendingSince ? new Date(Date.parse(pendingSince) - 86400_000).toISOString() : '9999-12-31T00:00:00.000Z';
    const [docs, messages] = await Promise.all([
      ids.length
        ? zite.sql({
            query: `SELECT id, "name", "url", "category", "workOrderId", "uploadedAt", created_at FROM "Documents" WHERE "workOrderId" = ANY($1) AND COALESCE("sharedWithOwner", false) = true ORDER BY COALESCE("uploadedAt", created_at) DESC`,
            params: [ids],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      ids.length
        ? zite.sql({
            // Messages filed against the repair, plus the owner's conversation since the earliest open request (approval emails are often sent from the owner's thread).
            query: `SELECT id, "workOrderId", "direction", "subject", "body", "senderName", "sentAt", created_at FROM "Messages"
              WHERE "ownerId" = $2 AND "direction" <> 'Internal' AND "channel" <> 'Note'
                AND ("workOrderId" = ANY($1) OR ("thread" = $3 AND COALESCE("workOrderId", '') = '' AND COALESCE("sentAt", created_at) >= $4))
              ORDER BY COALESCE("sentAt", created_at) ASC LIMIT 500`,
            params: [ids, ownerId, threadKey('owner', ownerId), since],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);

    const items = rows.map(r => {
      const id = String(r.id);
      const decision = str(r.ownerApproval) as 'Pending' | 'Approved' | 'Declined';
      const status = str(r.status) || 'New';
      return {
        id,
        number: num(r.number),
        title: str(r.title) ?? '',
        description: str(r.description) ?? '',
        category: str(r.category) ?? '',
        priority: str(r.priority) || 'Normal',
        status,
        estimate: numOrNull(r.estimateAmount),
        cost: status === 'Completed' ? numOrNull(r.actualCost) : null,
        propertyId: String(r.propertyId),
        propertyName: str(r.propertyName) ?? '',
        unitName: str(r.unitName) ?? '',
        address: propertyAddress(r),
        vendor: ref(r.vendorName) ? { name: str(r.vendorName) ?? '', trade: str(r.vendorTrade) ?? '' } : null,
        photos: photoList(r.photos),
        quotes: docs.rows.filter(d => String(d.workOrderId) === id).map(d => ({ id: String(d.id), name: str(d.name) ?? 'Document', url: str(d.url) ?? '', category: str(d.category) ?? '', uploadedAt: iso(d.uploadedAt) ?? iso(d.created_at) })),
        messages: messages.rows
          .filter(m => String(m.workOrderId) === id || (decision === 'Pending' && !ref(m.workOrderId) && (iso(m.sentAt) ?? '') >= new Date(Date.parse(iso(r.requestedAt) ?? iso(r.reportedAt) ?? '') - 86400_000).toISOString()))
          .slice(-8)
          .map(m => ({ id: String(m.id), mine: m.direction === 'Inbound', senderName: str(m.senderName) ?? '', subject: str(m.subject) ?? '', body: str(m.body) ?? '', sentAt: iso(m.sentAt) ?? iso(m.created_at) })),
        requestedAt: iso(r.requestedAt) ?? iso(r.reportedAt),
        reportedAt: iso(r.reportedAt),
        scheduledFor: iso(r.scheduledFor),
        completedAt: iso(r.completedAt),
        decision,
        note: decision === 'Pending' ? '' : str(r.ownerApprovalNote) ?? '',
        respondedAt: iso(r.ownerRespondedAt),
        // A request for a job that was canceled or finished before anyone answered can't be answered now.
        canRespond: decision === 'Pending' && status !== 'Completed' && status !== 'Canceled',
      };
    });

    return {
      currency: scope.settings.currency,
      pending: items.filter(i => i.canRespond),
      history: items.filter(i => i.decision !== 'Pending'),
    };
  },
});
