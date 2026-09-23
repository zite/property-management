import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { openBills } from '@project/shared/server/ledger';
import { num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { messagesWhere, timelineActivity } from '../server/timeline';
import { loadWorkOrder } from '../server/workOrders';

/** One work order with everything its page shows: people, money, conversation and history. */

const Input = z.object({ number: z.number().int().positive() });

export default createEndpoint({
  description: 'Get a work order with its conversation, history, bill and related people',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'maintenance.create');
    const { number } = parseInput(Input, input);
    const wo = await loadWorkOrder({ number });

    const [tenant, lease, schedule, messages, activity, bill, charge, related] = await Promise.all([
      wo.tenantId ? zite.sql({ query: `SELECT id, "name", "email", "phone", "pets" FROM "Tenants" WHERE id::text = $1`, params: [wo.tenantId] }) : Promise.resolve({ rows: [] }),
      wo.leaseId ? zite.sql({ query: `SELECT id, "name", "number", "status" FROM "Leases" WHERE id::text = $1`, params: [wo.leaseId] }) : Promise.resolve({ rows: [] }),
      wo.scheduleId ? zite.sql({ query: `SELECT id, "title", "frequency" FROM "MaintenanceSchedules" WHERE id::text = $1`, params: [wo.scheduleId] }) : Promise.resolve({ rows: [] }),
      messagesWhere(`m."workOrderId" = $1`, [wo.id]),
      timelineActivity('workOrderId', wo.id),
      wo.billId ? zite.sql({ query: `SELECT id, "number", "amount", "status", "dueDate", "reference", "vendorId" FROM "Transactions" WHERE id::text = $1`, params: [wo.billId] }) : Promise.resolve({ rows: [] }),
      wo.tenantChargeId ? zite.sql({ query: `SELECT id, "number", "amount", "status" FROM "Transactions" WHERE id::text = $1`, params: [wo.tenantChargeId] }) : Promise.resolve({ rows: [] }),
      // Other open work on the same unit — often the same underlying problem.
      wo.unitId
        ? zite.sql({ query: `SELECT "number", "title", "status", "priority" FROM "WorkOrders" WHERE "unitId" = $1 AND id::text <> $2 ORDER BY "number" DESC LIMIT 6`, params: [wo.unitId, wo.id] })
        : Promise.resolve({ rows: [] }),
    ]);
    const billOpen = wo.billId ? (await openBills({ billIds: [wo.billId] }))[0]?.open ?? 0 : 0;
    const b = bill.rows[0];
    const t = tenant.rows[0];
    const l = lease.rows[0];
    const s = schedule.rows[0];
    const c = charge.rows[0];

    return {
      workOrder: wo,
      tenant: t ? { id: String(t.id), name: str(t.name) ?? '', email: str(t.email) ?? '', phone: str(t.phone) ?? '', pets: str(t.pets) ?? '' } : null,
      lease: l ? { id: String(l.id), name: str(l.name) ?? '', number: num(l.number), status: String(l.status) } : null,
      schedule: s ? { id: String(s.id), title: str(s.title) ?? '', frequency: str(s.frequency) ?? '' } : null,
      bill: b ? { id: String(b.id), number: num(b.number), amount: num(b.amount), status: String(b.status), dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : null, reference: ref(b.reference), open: billOpen } : null,
      tenantCharge: c ? { id: String(c.id), number: num(c.number), amount: num(c.amount), status: String(c.status) } : null,
      related: related.rows.map(r => ({ number: num(r.number), title: str(r.title) ?? '', status: String(r.status), priority: String(r.priority) })),
      messages,
      activity,
    };
  },
});
