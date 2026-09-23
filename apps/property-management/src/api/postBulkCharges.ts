import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { postCharge } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { ref, str } from '@project/shared/server/sql';
import { Day, Id, Money } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Post one charge to many leases at once — a water bill split across a
 * building, a parking fee, a pest-control assessment. Each lease gets its own
 * charge through the ledger, one after another (bursts of parallel writes are
 * rate-limited). A lease that fails doesn't stop the rest; the result says which.
 */

const Input = z.object({
  accountId: Id,
  description: z.string().trim().min(1, 'Describe the charge — residents see it on their ledger.').max(250),
  date: Day,
  dueDate: Day.optional(),
  items: z.array(z.object({ leaseId: Id, amount: Money })).min(1, 'Choose at least one lease.').max(300, 'Charge at most 300 leases at a time.'),
});

export default createEndpoint({
  description: 'Post a charge to many leases at once',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'receivables.manage');
    const data = parseInput(Input, input);
    if (data.dueDate && data.dueDate < data.date) throw new ZiteError('The due date can’t be before the charge date.', 'BAD_REQUEST');
    const ids = [...new Set(data.items.map(i => i.leaseId))];
    if (ids.length !== data.items.length) throw new ZiteError('A lease appears twice in the list. Reload and try again.', 'BAD_REQUEST');

    const chart = await getChart();
    const account = chart.byId.get(data.accountId);
    if (!account || !account.active || !(account.accountType === 'Income' || account.subtype === 'Deposits held' || account.subtype === 'Other liability')) {
      throw new ZiteError('Choose an income account for the charge.', 'BAD_REQUEST');
    }

    const { rows } = await zite.sql({ query: `SELECT id, "name", "status", "propertyId", "unitId" FROM "Leases" WHERE id::text = ANY($1)`, params: [ids] });
    const leases = new Map(rows.map(r => [String(r.id), r]));
    const missing = ids.filter(id => !leases.has(id));
    if (missing.length) throw new ZiteError(`${missing.length === 1 ? 'One lease' : `${missing.length} leases`} no longer exist. Reload and try again.`, 'NOT_FOUND');
    const closed = rows.filter(r => r.status === 'Draft' || r.status === 'Canceled');
    if (closed.length) throw new ZiteError(`${str(closed[0].name)} is ${String(closed[0].status).toLowerCase()}, so it has no ledger to charge.`, 'BAD_REQUEST');

    const settings = await getSettings();
    const posted: Array<{ leaseId: string; transactionId: string; number: number; amount: number }> = [];
    const failed: Array<{ leaseId: string; name: string; message: string }> = [];
    for (const item of data.items) {
      try {
        // Never retried: a retry after a partial failure could post the charge twice.
        const res = await postCharge({ leaseId: item.leaseId, accountId: account.id, amount: item.amount, date: data.date, dueDate: data.dueDate ?? data.date, description: data.description, createdById: actor.id });
        posted.push({ leaseId: item.leaseId, transactionId: res.id, number: res.number, amount: item.amount });
      } catch (e) {
        failed.push({ leaseId: item.leaseId, name: str(leases.get(item.leaseId)?.name) ?? 'Lease', message: e instanceof ZiteError ? e.message : 'The charge didn’t post.' });
      }
    }

    const entries: ActivityInput[] = posted.map(p => {
      const l = leases.get(p.leaseId)!;
      return {
        entityType: 'lease', entityId: p.leaseId, leaseId: p.leaseId, propertyId: ref(l.propertyId), unitId: ref(l.unitId),
        action: 'ledger_charge', summary: `charged ${formatMoney(p.amount, settings.currency)} for ${data.description}`,
        actorId: actor.id, actorName: actor.name, data: { transactionId: p.transactionId, number: p.number, bulk: true },
      };
    });
    await logActivity(entries);

    return { posted: posted.length, total: fromCents(posted.reduce((s, p) => s + toCents(p.amount), 0)), failed };
  },
});
