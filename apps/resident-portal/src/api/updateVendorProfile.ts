import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { joinNames } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { vendorScope } from '../server/vendor';

/**
 * The vendor updates how the office reaches them: contact name, phone and
 * mailing address. The sign-in email, tax details, insurance and W-9 status
 * are the office's to change.
 */

const Input = z.object({
  contactName: z.string().trim().min(1, 'Enter a contact name.').max(120, 'Keep the contact name under 120 characters.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Enter a shorter phone number.')
    .refine(v => v === '' || (v.replace(/\D/g, '').length >= 7 && /^[\d\s()+.\-x#]+$/i.test(v)), 'Enter a phone number with at least 7 digits.'),
  address: z.string().trim().max(300, 'Keep the address under 300 characters.'),
});

export default createEndpoint({
  description: "Update the vendor's contact details",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const req = parseInput(Input, input);
    const scope = await vendorScope(context);
    const { rows } = await zite.sql({ query: `SELECT "contactName", "phone", "address" FROM "Vendors" WHERE id::text = $1`, params: [scope.vendorId] });
    const before = rows[0] ?? {};
    const changed = (['contactName', 'phone', 'address'] as const).filter(k => (str(before[k]) ?? '') !== req[k]);
    if (changed.length) {
      await zite.vendors.update({ id: scope.vendorId, record: { contactName: req.contactName, phone: req.phone || null, address: req.address || null } });
      const labels = { contactName: 'contact name', phone: 'phone', address: 'address' };
      await logActivity({
        entityType: 'vendor',
        entityId: scope.vendorId,
        action: 'profile_updated',
        summary: `updated their ${joinNames(changed.map(k => labels[k]))} in the vendor portal`,
        actorName: req.contactName || scope.vendor.name,
        data: { by: 'vendor', before: Object.fromEntries(changed.map(k => [k, str(before[k]) ?? ''])), after: Object.fromEntries(changed.map(k => [k, req[k]])) },
        vendorId: scope.vendorId,
      });
    }
    return { contactName: req.contactName, phone: req.phone, address: req.address, changed: changed.length };
  },
});
