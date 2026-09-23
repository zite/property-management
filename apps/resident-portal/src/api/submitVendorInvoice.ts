import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { workOrderRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { membersWith } from '@project/shared/server/actor';
import { logActivity } from '@project/shared/server/activity';
import { notify } from '@project/shared/server/notify';
import { iso, ref, str } from '@project/shared/server/sql';
import { assertReasonable, parseInput } from '../server/identity';
import { isFileUrl, vendorScope, vendorWorkOrder } from '../server/vendor';

/**
 * The vendor sends their invoice for a job: the file, their invoice number and
 * the amount. It's filed as an Invoice document on the work order and the
 * people who pay bills are told. It does NOT post to the books — staff review
 * it and enter the bill.
 */

const Input = z.object({
  number: z.number().int().positive(),
  invoiceNumber: z.string().trim().min(1, 'Enter your invoice number.').max(60, 'Keep the invoice number under 60 characters.'),
  amount: z.number({ invalid_type_error: 'Enter the invoice total.' }).positive('The invoice total must be more than zero.').max(1_000_000, 'That total looks too large. Check the amount.'),
  notes: z.string().trim().max(2000, 'Keep the notes under 2,000 characters.').nullish(),
  file: z.object({ url: z.string().max(2000), name: z.string().max(200), size: z.number().nonnegative().nullish(), type: z.string().max(120).nullish() }, { required_error: 'Attach the invoice as a PDF or photo.' }),
});

export default createEndpoint({
  description: 'Submit an invoice for a work order',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    assertReasonable(req.notes, 2000);
    if (!isFileUrl(req.file.url)) throw new ZiteError('The invoice file didn’t upload. Attach it again.', 'BAD_REQUEST');
    const scope = await vendorScope(context);
    const w = await vendorWorkOrder(scope.vendorId, req.number);
    if (str(w.status) === 'Canceled') throw new ZiteError('This work order was canceled, so it can’t take an invoice. Call the office if you did work on it.', 'CONFLICT');
    const id = String(w.id);
    const number = Number(w.number);
    const refNo = workOrderRef(number);

    const dup = await zite.sql({
      query: `SELECT 1 FROM "Documents" WHERE "workOrderId" = $1 AND "vendorId" = $2 AND "category" = 'Invoice' AND "name" LIKE $3 LIMIT 1`,
      params: [id, scope.vendorId, `Invoice ${req.invoiceNumber} —%`],
    });
    if (dup.rows.length) throw new ZiteError(`You already sent invoice ${req.invoiceNumber} for ${refNo}.`, 'CONFLICT');

    const now = new Date().toISOString();
    const amount = formatMoney(req.amount, scope.settings.currency);
    const ext = /\.[a-z0-9]{2,5}$/i.exec(req.file.name)?.[0] ?? '';
    const who = scope.vendor.contactName || scope.vendor.name;
    const doc = await zite.documents.create({
      record: {
        name: `Invoice ${req.invoiceNumber} — ${refNo}${ext}`.slice(0, 240),
        url: req.file.url,
        category: 'Invoice',
        propertyId: ref(w.propertyId),
        unitId: ref(w.unitId),
        workOrderId: id,
        vendorId: scope.vendorId,
        uploadedByName: `${who} (${scope.vendor.name})`.slice(0, 200),
        size: req.file.size ?? null,
        mimeType: req.file.type ?? null,
        notes: `Invoice ${req.invoiceNumber} for ${amount}, submitted in the vendor portal.${req.notes ? `\n\n${req.notes}` : ''}`,
        sharedWithOwner: false,
        sharedWithTenant: false,
        uploadedAt: now,
      },
    });

    const payables = await membersWith('payables.manage');
    await Promise.all([
      zite.workOrders.update({ id, record: { lastActivityAt: now } }),
      logActivity({ entityType: 'work_order', entityId: id, action: 'invoice_submitted', summary: `submitted invoice ${req.invoiceNumber} for ${amount}`, actorName: scope.vendor.name, data: { by: 'vendor', invoiceNumber: req.invoiceNumber, amount: req.amount, documentId: doc.id }, workOrderId: id, vendorId: scope.vendorId, propertyId: ref(w.propertyId), unitId: ref(w.unitId) }),
      notify({
        recipientIds: payables.map(m => m.id),
        kind: 'invoice_submitted',
        title: `${scope.vendor.name} sent invoice ${req.invoiceNumber} (${amount}) for ${refNo}`,
        body: [str(w.title), req.notes].filter(Boolean).join('\n'),
        link: `/work-orders/${number}`,
        entityType: 'work_order',
        entityId: id,
        actorName: scope.vendor.name,
      }),
    ]);

    return { id: doc.id, name: `Invoice ${req.invoiceNumber} — ${refNo}${ext}`, url: req.file.url, notes: `Invoice ${req.invoiceNumber} for ${amount}, submitted in the vendor portal.${req.notes ? `\n\n${req.notes}` : ''}`, uploadedAt: iso(now) };
  },
});
