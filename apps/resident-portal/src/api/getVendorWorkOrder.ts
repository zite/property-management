import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { fileList, residentFor, toVendorRow, vendorScope, vendorWorkOrder } from '../server/vendor';

/**
 * One job, as the vendor sees it: what's wrong, where (full address and unit),
 * how to get in, photos, when it's scheduled, their conversation with the
 * office, invoices they've sent and whether the office has entered and paid
 * the bill. Opening it marks the office's messages to them as read.
 */

const Input = z.object({ number: z.coerce.number().int().positive() });

export default createEndpoint({
  description: 'One work order assigned to the vendor',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { number } = parseInput(Input, input, "We couldn't find that work order.");
    const scope = await vendorScope(context);
    const w = await vendorWorkOrder(scope.vendorId, number);
    const id = String(w.id);
    const row = toVendorRow(w);

    const [messages, invoices, bills, assignee] = await Promise.all([
      zite.sql({
        query: `
          SELECT id, "direction", "subject", "body", "senderName", "sentAt", "attachments", "readAt", created_at FROM "Messages"
          WHERE "workOrderId" = $1 AND "vendorId" = $2 AND "direction" <> 'Internal' AND "channel" <> 'Note'
          ORDER BY COALESCE("sentAt", created_at) ASC LIMIT 300`,
        params: [id, scope.vendorId],
      }),
      zite.sql({
        query: `SELECT id, "name", "url", "notes", "uploadedAt", created_at FROM "Documents" WHERE "workOrderId" = $1 AND "vendorId" = $2 AND "category" = 'Invoice' ORDER BY COALESCE("uploadedAt", created_at) DESC`,
        params: [id, scope.vendorId],
      }),
      zite.sql({
        query: `
          SELECT t.id, t."number", t."date", t."dueDate", t."amount", t."reference",
            COALESCE((SELECT SUM(a."amount") FROM "Allocations" a JOIN "Transactions" bp ON bp.id::text = a."paymentId" WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false AND bp."status" = 'Posted'), 0) AS paid,
            (SELECT MAX(bp."date") FROM "Allocations" a JOIN "Transactions" bp ON bp.id::text = a."paymentId" WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false AND bp."status" = 'Posted') AS "paidOn"
          FROM "Transactions" t
          WHERE t."kind" = 'Bill' AND t."status" = 'Posted' AND t."workOrderId" = $1 AND t."vendorId" = $2
          ORDER BY t."date" DESC`,
        params: [id, scope.vendorId],
      }),
      ref(w.assigneeId)
        ? zite.sql({ query: `SELECT "name", "phone" FROM "Members" WHERE id::text = $1 LIMIT 1`, params: [String(w.assigneeId)] })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);

    // Contact with the resident only when the vendor has to arrange entry (see server/vendor.ts).
    const needsAccess = row.open && !row.permissionToEnter;
    const resident = needsAccess ? await residentFor(w) : null;

    const unread = messages.rows.filter(m => m.direction === 'Outbound' && !m.readAt).map(m => String(m.id));
    if (unread.length) {
      const now = new Date().toISOString();
      // One at a time: live Zite rate-limits bursts of parallel writes.
      for (const mid of unread.slice(0, 50)) await zite.messages.update({ id: mid, record: { readAt: now } }).catch(() => undefined);
    }

    const a = assignee.rows[0];
    return {
      vendorName: scope.vendor.name,
      currency: scope.settings.currency,
      office: { name: scope.settings.organizationName, phone: scope.settings.phone, emergencyPhone: scope.settings.emergencyPhone },
      workOrder: {
        ...row,
        unreadMessages: 0,
        description: str(w.description) ?? '',
        entryNotes: str(w.entryNotes) ?? '',
        estimate: numOrNull(w.estimateAmount),
        completionNotes: str(w.completionNotes) ?? '',
        photos: fileList(w.photos),
        propertyStreet: str(w.street) ?? '',
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([str(w.street), str(w.city), str(w.state), str(w.postalCode)].filter(Boolean).join(', '))}`,
        resident: resident ? { firstName: resident.name.trim().split(/\s+/)[0] || 'Resident', phone: resident.phone } : null,
        contact: a ? { name: str(a.name) ?? '', phone: str(a.phone) ?? '' } : null,
      },
      messages: messages.rows.map(m => ({
        id: String(m.id),
        mine: m.direction === 'Inbound',
        senderName: str(m.senderName) ?? '',
        subject: str(m.subject) ?? '',
        body: str(m.body) ?? '',
        sentAt: iso(m.sentAt) ?? iso(m.created_at) ?? '',
      })),
      invoices: invoices.rows.map(d => ({ id: String(d.id), name: str(d.name) ?? 'Invoice', url: str(d.url) ?? '', notes: str(d.notes) ?? '', uploadedAt: iso(d.uploadedAt) ?? iso(d.created_at) })),
      bills: bills.rows.map(b => {
        const amount = num(b.amount);
        const paid = num(b.paid);
        return { id: String(b.id), number: num(b.number), date: String(b.date ?? '').slice(0, 10), dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : null, amount, paid, open: Math.max(0, Math.round((amount - paid) * 100) / 100), paidOn: b.paidOn ? String(b.paidOn).slice(0, 10) : null, reference: str(b.reference) ?? '' };
      }),
    };
  },
});
