import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { postBill } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { num, ref, str } from '@project/shared/server/sql';
import { Day, existingProperties, Id, isBillableAccount } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Enter a vendor bill into payables. Lines can be split across expense
 * accounts and properties (a landscaping invoice covering three buildings);
 * accounts payable is credited per property so each building's payable pays
 * down on its own. A bill number already entered for the same vendor is
 * refused, so the same invoice can't be paid twice.
 */

const Input = z.object({
  vendorId: Id,
  date: Day,
  dueDate: Day,
  reference: z.string().trim().max(80).optional(),
  description: z.string().trim().max(250).optional(),
  notes: z.string().max(2000).optional(),
  attachmentUrl: z.string().url().max(2000).optional(),
  workOrderId: z.string().optional(),
  unitId: z.string().optional(),
  lines: z
    .array(z.object({ accountId: Id, propertyId: Id, amount: z.number().positive('Every line needs an amount greater than zero.').max(10_000_000), memo: z.string().max(250).optional() }))
    .min(1, 'Add at least one line to the bill.')
    .max(50, 'A bill can have at most 50 lines.'),
});

export default createEndpoint({
  description: 'Enter a vendor bill with expense lines split across properties',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'payables.manage');
    const data = parseInput(Input, input);
    if (data.dueDate < data.date) throw new ZiteError('The due date can’t be before the bill date.', 'BAD_REQUEST');

    const chart = await getChart();
    for (const l of data.lines) if (!isBillableAccount(chart, l.accountId)) throw new ZiteError('Choose an expense account for each line.', 'BAD_REQUEST');
    const props = await existingProperties(data.lines.map(l => l.propertyId));
    if (data.lines.some(l => !props.has(l.propertyId))) throw new ZiteError('One of the properties no longer exists. Reload and try again.', 'BAD_REQUEST');

    const { rows: vendors } = await zite.sql({ query: `SELECT id, "name", "status" FROM "Vendors" WHERE id::text = $1`, params: [data.vendorId] });
    const vendor = vendors[0];
    if (!vendor) throw new ZiteError('That vendor no longer exists.', 'NOT_FOUND');
    const vendorName = str(vendor.name) ?? 'the vendor';

    if (data.reference) {
      const { rows: dupes } = await zite.sql({
        query: `SELECT "number" FROM "Transactions" WHERE "kind" = 'Bill' AND "status" = 'Posted' AND "vendorId" = $1 AND LOWER(TRIM("reference")) = LOWER($2) LIMIT 1`,
        params: [data.vendorId, data.reference],
      });
      if (dupes[0]) throw new ZiteError(`Bill ${data.reference} from ${vendorName} is already entered as #${num(dupes[0].number)}.`, 'CONFLICT');
    }

    let workOrder: Record<string, unknown> | null = null;
    if (data.workOrderId) {
      const { rows } = await zite.sql({ query: `SELECT id, "number", "title", "billId", "actualCost", "unitId" FROM "WorkOrders" WHERE id::text = $1`, params: [data.workOrderId] });
      workOrder = rows[0] ?? null;
      if (!workOrder) throw new ZiteError('That work order no longer exists.', 'NOT_FOUND');
    }

    // The header's property is the one carrying the most of the bill.
    const byProperty = new Map<string, number>();
    for (const l of data.lines) byProperty.set(l.propertyId, (byProperty.get(l.propertyId) ?? 0) + toCents(l.amount));
    const mainProperty = [...byProperty.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const total = fromCents([...byProperty.values()].reduce((a, b) => a + b, 0));
    const unitId = byProperty.size === 1 ? data.unitId || ref(workOrder?.unitId) : null;

    const posted = await postBill({
      vendorId: data.vendorId,
      propertyId: mainProperty,
      unitId,
      workOrderId: data.workOrderId || null,
      date: data.date,
      dueDate: data.dueDate,
      reference: data.reference || null,
      description: data.description || (workOrder ? `${workOrderRef(num(workOrder.number))} ${str(workOrder.title) ?? ''}`.trim() : undefined),
      notes: data.notes || null,
      attachmentUrl: data.attachmentUrl || null,
      createdById: actor.id,
      lines: data.lines.map(l => ({ accountId: l.accountId, amount: l.amount, propertyId: l.propertyId, unitId: byProperty.size === 1 ? unitId : null, memo: l.memo || null })),
    });

    const settings = await getSettings();
    if (workOrder) {
      const current = ref(workOrder.billId);
      let replace = !current;
      if (current) {
        const { rows } = await zite.sql({ query: `SELECT "status" FROM "Transactions" WHERE id::text = $1`, params: [current] });
        replace = rows[0]?.status !== 'Posted';
      }
      if (replace) {
        await zite.workOrders.update({ id: String(workOrder.id), record: { billId: posted.id, actualCost: workOrder.actualCost == null || workOrder.actualCost === '' ? total : num(workOrder.actualCost), lastActivityAt: new Date().toISOString() } });
      }
      await logActivity({ entityType: 'work_order', entityId: String(workOrder.id), workOrderId: String(workOrder.id), propertyId: mainProperty, vendorId: data.vendorId, action: 'bill_entered', summary: `entered bill #${posted.number} for ${formatMoney(total, settings.currency)}`, actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id } });
    }
    await logActivity({
      entityType: 'transaction', entityId: posted.id, propertyId: mainProperty, vendorId: data.vendorId, workOrderId: data.workOrderId || null,
      action: 'bill_entered', summary: `entered bill #${posted.number} from ${vendorName} for ${formatMoney(total, settings.currency)}`,
      actorId: actor.id, actorName: actor.name, data: { transactionId: posted.id, number: posted.number },
    });
    return { id: posted.id, number: posted.number, total };
  },
});
