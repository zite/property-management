import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { fromCents, sumMoney, toCents } from '@project/shared/money';
import { day, num, numOrNull, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { vendorScope } from '../server/vendor';

/**
 * What the office owes this vendor and what it has paid: their bills with
 * open or paid status, the payments sent (method, check number), and the total
 * paid this calendar year — the figure their 1099 will show.
 */

const Input = z.object({});

export default createEndpoint({
  description: "The vendor's bills and payments",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    parseInput(Input, input);
    const scope = await vendorScope(context);
    const year = scope.today.slice(0, 4);
    const [bills, payments, applied] = await Promise.all([
      zite.sql({
        query: `
          SELECT t.id, t."number", t."date", t."dueDate", t."amount", t."description", t."reference", p."name" AS "propertyName", w."number" AS "workOrderNumber",
            COALESCE((SELECT SUM(a."amount") FROM "Allocations" a JOIN "Transactions" bp ON bp.id::text = a."paymentId" WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false AND bp."status" = 'Posted'), 0) AS paid,
            (SELECT MAX(bp."date") FROM "Allocations" a JOIN "Transactions" bp ON bp.id::text = a."paymentId" WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false AND bp."status" = 'Posted') AS "paidOn"
          FROM "Transactions" t
          LEFT JOIN "Properties" p ON p.id::text = t."propertyId"
          LEFT JOIN "WorkOrders" w ON w.id::text = t."workOrderId"
          WHERE t."kind" = 'Bill' AND t."status" = 'Posted' AND t."vendorId" = $1
          ORDER BY t."date" DESC, t."number" DESC LIMIT 500`,
        params: [scope.vendorId],
      }),
      zite.sql({
        query: `
          SELECT t.id, t."number", t."kind", t."date", t."amount", t."paymentMethod", t."reference", t."description", p."name" AS "propertyName"
          FROM "Transactions" t LEFT JOIN "Properties" p ON p.id::text = t."propertyId"
          WHERE t."kind" IN ('Bill payment', 'Expense') AND t."status" = 'Posted' AND t."vendorId" = $1
          ORDER BY t."date" DESC, t."number" DESC LIMIT 500`,
        params: [scope.vendorId],
      }),
      zite.sql({
        query: `
          SELECT a."paymentId", b."reference", b."number"
          FROM "Allocations" a JOIN "Transactions" b ON b.id::text = a."chargeId" JOIN "Transactions" bp ON bp.id::text = a."paymentId"
          WHERE bp."vendorId" = $1 AND bp."kind" = 'Bill payment' AND bp."status" = 'Posted' AND COALESCE(a."void", false) = false
          ORDER BY b."number" ASC`,
        params: [scope.vendorId],
      }),
    ]);

    const paidFor = new Map<string, string[]>();
    for (const a of applied.rows) {
      const k = String(a.paymentId);
      paidFor.set(k, [...(paidFor.get(k) ?? []), str(a.reference) || `Bill #${num(a.number)}`]);
    }

    const billRows = bills.rows.map(b => {
      const amount = num(b.amount);
      const open = Math.max(0, fromCents(toCents(amount) - toCents(num(b.paid))));
      const dueDate = day(b.dueDate);
      const status = open === 0 ? 'Paid' : dueDate && dueDate < scope.today ? 'Overdue' : num(b.paid) > 0 ? 'Partially paid' : 'Open';
      return {
        id: String(b.id),
        number: num(b.number),
        date: day(b.date) ?? '',
        dueDate,
        amount,
        paid: num(b.paid),
        open,
        paidOn: open === 0 ? day(b.paidOn) : null,
        status,
        description: str(b.description) ?? '',
        invoiceNumber: str(b.reference) ?? '',
        propertyName: str(b.propertyName) ?? '',
        workOrderNumber: numOrNull(b.workOrderNumber),
      };
    });
    const paymentRows = payments.rows.map(p => ({
      id: String(p.id),
      number: num(p.number),
      date: day(p.date) ?? '',
      amount: num(p.amount),
      method: str(p.paymentMethod) ?? '',
      reference: str(p.reference) ?? '',
      direct: p.kind === 'Expense',
      description: str(p.description) ?? '',
      propertyName: str(p.propertyName) ?? '',
      paidFor: paidFor.get(String(p.id)) ?? [],
    }));

    return {
      currency: scope.settings.currency,
      vendorName: scope.vendor.name,
      year,
      ytdPaid: sumMoney(paymentRows.filter(p => p.date.startsWith(year)).map(p => p.amount)),
      openTotal: sumMoney(billRows.map(b => b.open)),
      overdueTotal: sumMoney(billRows.filter(b => b.status === 'Overdue').map(b => b.open)),
      bills: billRows,
      payments: paymentRows,
    };
  },
});
