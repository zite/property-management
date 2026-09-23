import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { day, iso, num, ref, str } from '@project/shared/server/sql';
import { toTxnRow, TXN_JOINS, TXN_SELECT } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * One transaction with everything behind it: its journal lines (debits equal
 * credits), what it paid or was paid by (allocations), who entered and voided
 * it, and whether any of its bank lines are reconciled. Bills, payments,
 * transfers and journal entries all open this.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a transaction with its journal lines and allocations',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'accounting.view');
    const { id } = parseInput(Input, input);
    const { rows } = await zite.sql({ query: `SELECT ${TXN_SELECT}, t."voidedById", t."notes", w."title" AS "workOrderTitle" FROM "Transactions" t ${TXN_JOINS} WHERE t.id::text = $1 LIMIT 1`, params: [id] });
    const r = rows[0];
    if (!r) throw new ZiteError('That transaction no longer exists.', 'NOT_FOUND');
    const txn = toTxnRow(r);
    const chart = await getChart();

    const [lines, applied, people] = await Promise.all([
      zite.sql({
        query: `
          SELECT jl.id, jl."accountId", jl."propertyId", jl."unitId", jl."leaseId", jl."vendorId", jl."ownerId", jl."memo", jl."debit", jl."credit", jl."void", jl."clearedAt", jl."reconciliationId",
            l."name" AS "leaseName", v."name" AS "vendorName", o."name" AS "ownerName"
          FROM "JournalLines" jl
          LEFT JOIN "Leases" l ON l.id::text = jl."leaseId"
          LEFT JOIN "Vendors" v ON v.id::text = jl."vendorId"
          LEFT JOIN "Owners" o ON o.id::text = jl."ownerId"
          WHERE jl."transactionId" = $1
          ORDER BY CASE WHEN COALESCE(jl."debit", 0) > 0 THEN 0 ELSE 1 END, jl.created_at ASC`,
        params: [id],
      }),
      zite.sql({
        query: `
          SELECT a.id, a."amount", a."date", a."void", a."paymentId", a."chargeId",
            other.id AS "otherId", other."number" AS "otherNumber", other."kind" AS "otherKind", other."description" AS "otherDescription", other."date" AS "otherDate",
            other."status" AS "otherStatus", other."reference" AS "otherReference", other."paymentMethod" AS "otherMethod", other."amount" AS "otherAmount"
          FROM "Allocations" a
          JOIN "Transactions" other ON other.id::text = CASE WHEN a."paymentId" = $1 THEN a."chargeId" ELSE a."paymentId" END
          WHERE a."paymentId" = $1 OR a."chargeId" = $1
          ORDER BY other."date" ASC, other."number" ASC`,
        params: [id],
      }),
      zite.sql({ query: `SELECT id, "name" FROM "Members" WHERE id::text = ANY($1)`, params: [[txn.createdById, ref(r.voidedById)].filter(Boolean)] }),
    ]);
    const nameOf = new Map(people.rows.map(p => [String(p.id), str(p.name) ?? '']));

    const journal = lines.rows.map(l => {
      const account = chart.byId.get(String(l.accountId));
      return {
        id: String(l.id),
        accountId: String(l.accountId),
        accountName: account?.name ?? 'Deleted account',
        accountNumber: account?.number ?? '',
        accountSubtype: account?.subtype ?? '',
        propertyId: ref(l.propertyId),
        unitId: ref(l.unitId),
        leaseId: ref(l.leaseId),
        leaseName: ref(l.leaseName),
        vendorId: ref(l.vendorId),
        vendorName: ref(l.vendorName),
        ownerId: ref(l.ownerId),
        ownerName: ref(l.ownerName),
        memo: str(l.memo) ?? '',
        debit: num(l.debit),
        credit: num(l.credit),
        void: l.void === true,
        clearedAt: day(l.clearedAt),
        reconciled: Boolean(ref(l.reconciliationId)),
      };
    });

    const allocations = applied.rows.map(a => ({
      id: String(a.id),
      amount: num(a.amount),
      date: day(a.date),
      void: a.void === true,
      /** `paid` — this transaction paid the other (a payment paying a charge); `paidBy` — the other paid this. */
      direction: String(a.paymentId) === id ? ('paid' as const) : ('paidBy' as const),
      other: {
        id: String(a.otherId),
        number: num(a.otherNumber),
        kind: String(a.otherKind ?? ''),
        description: str(a.otherDescription) ?? '',
        date: day(a.otherDate),
        status: str(a.otherStatus) ?? 'Posted',
        reference: ref(a.otherReference),
        paymentMethod: ref(a.otherMethod),
        amount: num(a.otherAmount),
      },
    }));

    return {
      transaction: {
        ...txn,
        workOrderTitle: str(r.workOrderTitle),
        voidedById: ref(r.voidedById),
        voidedByName: ref(r.voidedById) ? nameOf.get(String(r.voidedById)) ?? 'Former teammate' : null,
        createdByName: txn.createdById ? nameOf.get(txn.createdById) ?? 'Former teammate' : null,
        notes: str(r.notes),
      },
      lines: journal,
      allocations,
      reconciled: journal.some(l => l.reconciled),
      totals: { debit: journal.reduce((s, l) => s + Math.round(l.debit * 100), 0) / 100, credit: journal.reduce((s, l) => s + Math.round(l.credit * 100), 0) / 100 },
    };
  },
});
