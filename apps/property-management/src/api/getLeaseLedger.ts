import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { canAny, getActor } from '@project/shared/server/actor';
import { leaseLedger, openCharges } from '@project/shared/server/ledger';
import { bool, day, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';

/**
 * A lease's ledger: every entry with a running balance, what's open and past
 * due, deposit held, the recurring charges that bill it, and who's on it.
 * Leases, residents and accounting all render this one payload.
 */

const Input = z.object({ leaseId: z.string().min(1) });

export default createEndpoint({
  description: "Get a lease's ledger, balances, open charges and recurring charges",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    if (!canAny(actor, 'accounting.view', 'residents.manage', 'leasing.manage')) throw new ZiteError('Your role can’t see resident ledgers.', 'FORBIDDEN');
    const { leaseId } = parseInput(Input, input);

    const [ledger, open, lease, tenants, recurring] = await Promise.all([
      leaseLedger(leaseId),
      openCharges(leaseId),
      zite.sql({ query: `SELECT id, "name", "number", "status", "propertyId", "unitId", "rent", "deposit", "startDate", "endDate", "moveOutDate", "lateFeeExempt" FROM "Leases" WHERE id::text = $1`, params: [leaseId] }),
      zite.sql({
        query: `SELECT t.id, t."name", t."email", t."phone", lt."role" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 ELSE 2 END, t."name" ASC`,
        params: [leaseId],
      }),
      zite.sql({ query: `SELECT id, "description", "accountId", "amount", "frequency", "dayOfMonth", "startDate", "endDate", "lastPostedPeriod", "active" FROM "RecurringCharges" WHERE "leaseId" = $1 ORDER BY COALESCE("active", false) DESC, "startDate" ASC`, params: [leaseId] }),
    ]);
    const l = lease.rows[0];

    return {
      lease: l
        ? {
            id: String(l.id), name: str(l.name) ?? '', number: num(l.number), status: str(l.status) ?? 'Draft', propertyId: ref(l.propertyId), unitId: ref(l.unitId),
            rent: num(l.rent), deposit: num(l.deposit), startDate: day(l.startDate), endDate: day(l.endDate), moveOutDate: day(l.moveOutDate), lateFeeExempt: bool(l.lateFeeExempt),
          }
        : null,
      tenants: tenants.rows.map(t => ({ id: String(t.id), name: str(t.name) ?? '', email: str(t.email) ?? '', phone: str(t.phone) ?? '', role: str(t.role) ?? 'Primary' })),
      entries: ledger.entries,
      balance: ledger.balance,
      depositHeld: ledger.depositHeld,
      pastDue: ledger.pastDue,
      unappliedCredit: ledger.unappliedCredit,
      openCharges: open,
      recurring: recurring.rows.map(r => ({
        id: String(r.id), description: str(r.description) ?? '', accountId: ref(r.accountId), amount: num(r.amount), frequency: str(r.frequency) || 'Monthly', dayOfMonth: num(r.dayOfMonth, 1),
        startDate: day(r.startDate), endDate: day(r.endDate), lastPostedPeriod: ref(r.lastPostedPeriod), active: bool(r.active),
      })),
    };
  },
});
