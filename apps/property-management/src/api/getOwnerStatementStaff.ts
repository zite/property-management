import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { assertCan, getActor } from '@project/shared/server/actor';
import { ownerStatement, statementPeriod, statementTransactions } from '@project/shared/server/ownerStatement';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { loadOwner } from '../server/portfolio';

/**
 * An owner's cash-basis statement for a month (or year to date), as staff see
 * it: per-property sections, combined totals, and the cash register behind
 * the numbers. The figures come from `ownerStatement` — the same engine the
 * owner portal uses — so what staff review is what the owner sees.
 *
 * Archived properties are included when they had cash activity in the period.
 */

const Input = z.object({
  ownerId: z.string().min(1),
  period: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])|ytd)$/, 'Choose a month.'),
  propertyIds: z.array(z.string().min(1)).max(500).optional(),
});

export default createEndpoint({
  description: 'Owner statement for a month or year to date, with its transactions',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'owners.manage');
    assertCan(actor, 'accounting.view');
    const { ownerId, period, propertyIds } = parseInput(Input, input);
    const owner = await loadOwner(ownerId);
    if (!owner) throw new ZiteError('That owner doesn’t exist, or they were deleted.', 'NOT_FOUND');
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    if (period !== 'ytd' && `${period}-01` > today) throw new ZiteError('That month hasn’t started yet. Choose this month or an earlier one.', 'BAD_REQUEST');
    const range = statementPeriod(period, today);

    const { rows } = await zite.sql({
      query: `
        SELECT p.id, p."status",
          EXISTS (SELECT 1 FROM "JournalLines" jl WHERE jl."propertyId" = p.id::text AND jl."date" >= $2::date AND jl."date" <= $3::date AND COALESCE(jl."void", false) = false) AS active_in_period
        FROM "Properties" p WHERE p."ownerId" = $1`,
      params: [ownerId, range.periodStart, range.periodEnd],
    });
    const owned = rows.filter(r => r.status !== 'Archived' || r.active_in_period === true || r.active_in_period === 'true').map(r => String(r.id));
    const scope = propertyIds?.length ? owned.filter(id => propertyIds.includes(id)) : owned;

    const [statement, register] = await Promise.all([
      ownerStatement({ propertyIds: scope, periodStart: range.periodStart, periodEnd: range.periodEnd }),
      statementTransactions({ propertyIds: scope, periodStart: range.periodStart, periodEnd: range.periodEnd, organizationName: settings.organizationName, limit: 1500 }),
    ]);

    return {
      today,
      owner: { id: owner.id, name: owner.name, contactName: owner.contactName, email: owner.email, mailingAddress: owner.mailingAddress, distributionMethod: owner.distributionMethod },
      organization: { name: settings.organizationName, address: settings.address, phone: settings.phone, email: settings.supportEmail ?? '' },
      period: { choice: period, ...range },
      statement,
      transactions: register.rows,
      truncated: register.truncated,
    };
  },
});
