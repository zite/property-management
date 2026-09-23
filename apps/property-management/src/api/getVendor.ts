import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { assertCan, can, getActor } from '@project/shared/server/actor';
import { threadKey } from '@project/shared/server/email';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadVendor } from '../server/maintenance';
import { messagesWhere, timelineActivity } from '../server/timeline';

/**
 * One vendor with everything its page shows: the record and compliance, the
 * certificate of insurance on file, bills and payments (for people who can
 * see the books), the conversation thread with the vendor, and history.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a vendor with compliance, bills, payments, messages and history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'vendors.manage');
    const { id } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const canSeeMoney = can(actor.role, 'accounting.view');
    const vendor = await loadVendor(id, today, canSeeMoney);

    const [coi, money, ratings, schedules, messages, activity] = await Promise.all([
      zite.sql({ query: `SELECT id, "name", "url", "expiresOn", "uploadedByName", "uploadedAt", created_at FROM "Documents" WHERE "vendorId" = $1 AND "category" = 'Insurance' ORDER BY "expiresOn" DESC NULLS LAST, COALESCE("uploadedAt", created_at) DESC LIMIT 1`, params: [id] }),
      canSeeMoney
        ? zite.sql({
            query: `
              SELECT t.id, t."number", t."kind", t."status", t."date", t."dueDate", t."amount", t."description", t."reference", t."paymentMethod", t."propertyId", t."workOrderId",
                w."number" AS "workOrderNumber",
                CASE WHEN t."kind" = 'Bill' AND t."status" = 'Posted'
                  THEN t."amount" - COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false), 0)
                  ELSE 0 END AS "openAmount"
              FROM "Transactions" t
              LEFT JOIN "WorkOrders" w ON w.id::text = t."workOrderId"
              WHERE t."vendorId" = $1 AND t."kind" IN ('Bill', 'Bill payment', 'Expense')
              ORDER BY t."date" DESC, t."number" DESC LIMIT 500`,
            params: [id],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      zite.sql({ query: `SELECT AVG("tenantRating") AS "avg", COUNT("tenantRating") AS "n" FROM "WorkOrders" WHERE "vendorId" = $1 AND "tenantRating" IS NOT NULL`, params: [id] }),
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "MaintenanceSchedules" WHERE "vendorId" = $1 AND COALESCE("active", false) = true`, params: [id] }),
      messagesWhere(`m."thread" = $1`, [threadKey('vendor', id)]),
      timelineActivity('vendorId', id),
    ]);

    const c = coi.rows[0];
    const transactions = money.rows.map(t => ({
      id: String(t.id),
      number: num(t.number),
      kind: String(t.kind) as 'Bill' | 'Bill payment' | 'Expense',
      status: str(t.status) || 'Posted',
      date: day(t.date) ?? '',
      dueDate: day(t.dueDate),
      amount: num(t.amount),
      open: Math.max(0, Math.round(num(t.openAmount) * 100) / 100),
      description: str(t.description) ?? '',
      reference: str(t.reference) ?? '',
      paymentMethod: str(t.paymentMethod) ?? '',
      propertyId: ref(t.propertyId),
      workOrderNumber: numOrNull(t.workOrderNumber),
    }));

    return {
      today,
      vendor,
      canSeeMoney,
      portalLinked: Boolean(portalLink(settings, '/vendor')),
      certificate: c ? { id: String(c.id), name: str(c.name) ?? 'Certificate of insurance', url: str(c.url) ?? '', expiresOn: day(c.expiresOn), uploadedBy: str(c.uploadedByName) ?? '', uploadedAt: iso(c.uploadedAt) ?? iso(c.created_at) } : null,
      residentRating: { average: numOrNull(ratings.rows[0]?.avg), count: num(ratings.rows[0]?.n) },
      activeSchedules: num(schedules.rows[0]?.n),
      bills: transactions.filter(t => t.kind === 'Bill'),
      payments: transactions.filter(t => t.kind !== 'Bill'),
      messages,
      activity,
    };
  },
});
