import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { voidTransaction } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { num, ref } from '@project/shared/server/sql';
import type { Capability } from '@project/shared/roles';
import { parseInput } from '../server/input';

/**
 * Void any posted transaction. Voids never delete: the entry stays on every
 * ledger, struck through, with who voided it and why. Reconciled money can't
 * be voided (unreconcile first), and a bill with payments against it can't be
 * voided until those payments are.
 */

const Input = z.object({ id: z.string().min(1), reason: z.string().trim().min(3, 'Say why it’s being voided.').max(250) });

const CAPABILITY: Record<string, Capability> = {
  Charge: 'receivables.manage',
  Payment: 'receivables.manage',
  Credit: 'receivables.manage',
  Refund: 'receivables.manage',
  'Deposit application': 'receivables.manage',
  Bill: 'payables.manage',
  'Bill payment': 'payables.manage',
  Expense: 'payables.manage',
};

export default createEndpoint({
  description: 'Void a posted transaction with a reason',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string(), number: z.number(), kind: z.string(), leaseId: z.string().nullable() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { id, reason } = parseInput(Input, input);
    const { rows } = await zite.sql({
      query: `
        SELECT t.id, t."kind", t."status", t."amount", t."number", t."leaseId", t."propertyId", t."vendorId", t."workOrderId",
          (SELECT COUNT(*) FROM "JournalLines" jl WHERE jl."transactionId" = t.id::text AND COALESCE(jl."reconciliationId", '') <> '') AS "reconciled",
          (SELECT COUNT(*) FROM "Allocations" a WHERE a."chargeId" = t.id::text AND COALESCE(a."void", false) = false) AS "paidAgainst"
        FROM "Transactions" t WHERE t.id::text = $1`,
      params: [id],
    });
    const t = rows[0];
    if (!t) throw new ZiteError('That transaction no longer exists.', 'NOT_FOUND');
    const kind = String(t.kind);
    assertCan(actor, CAPABILITY[kind] ?? 'banking.manage');
    if (t.status === 'Void') throw new ZiteError('That transaction is already void.', 'CONFLICT');
    if (num(t.reconciled) > 0) throw new ZiteError('This transaction is part of a completed bank reconciliation. Undo the reconciliation first.', 'CONFLICT');
    if (kind === 'Bill' && num(t.paidAgainst) > 0) throw new ZiteError('This bill has payments against it. Void the bill payment first.', 'CONFLICT');

    const result = await voidTransaction(id, reason, actor.id);
    const settings = await getSettings();
    const leaseId = ref(t.leaseId);
    await logActivity({
      entityType: leaseId ? 'lease' : 'transaction', entityId: leaseId ?? id, leaseId, propertyId: ref(t.propertyId), vendorId: ref(t.vendorId), workOrderId: ref(t.workOrderId),
      action: 'transaction_voided', summary: `voided ${kind.toLowerCase()} #${num(t.number)} (${formatMoney(num(t.amount), settings.currency)}) — ${reason}`,
      actorId: actor.id, actorName: actor.name, data: { transactionId: id },
    });
    return { id: result.id, number: result.number, kind: result.kind, leaseId: result.leaseId };
  },
});
