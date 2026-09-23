import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { PAYMENT_METHODS } from '@project/shared/constants';
import { formatMoney, fromCents, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { postOwnerMoney, propertyCash } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { Day, existingProperties, Id, Money } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Owner money in and out of a property's trust cash.
 *
 *   contribution — the owner sends money in (to cover a repair, fund a reserve)
 *   distribution — pay the owner
 *   run          — distribute to many properties at once, one after another
 *
 * A distribution that would leave a property with negative cash is refused:
 * that would be paying one owner with another owner's (or a tenant's) money.
 */

const Common = { date: Day, paymentMethod: z.enum(PAYMENT_METHODS), bankAccountId: z.string().optional(), description: z.string().trim().max(250).optional() };

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('contribution'), propertyId: Id, amount: Money, reference: z.string().trim().max(80).optional(), ...Common }),
  z.object({ action: z.literal('distribution'), propertyId: Id, amount: Money, reference: z.string().trim().max(80).optional(), ...Common }),
  z.object({ action: z.literal('run'), items: z.array(z.object({ propertyId: Id, amount: Money, reference: z.string().trim().max(80).optional() })).min(1, 'Choose at least one property.').max(200), ...Common }),
]);

export default createEndpoint({
  description: 'Record owner contributions and distributions, one at a time or as a run',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'banking.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    if (data.bankAccountId) {
      const bank = (await getChart()).byId.get(data.bankAccountId);
      if (!bank || bank.subtype !== 'Bank' || !bank.active) throw new ZiteError('Choose an active bank account.', 'BAD_REQUEST');
    }
    const items = data.action === 'run' ? data.items : [{ propertyId: data.propertyId, amount: data.amount, reference: data.reference }];
    if (new Set(items.map(i => i.propertyId)).size !== items.length) throw new ZiteError('A property appears twice. Reload and try again.', 'BAD_REQUEST');
    const props = await existingProperties(items.map(i => i.propertyId));
    for (const i of items) {
      const p = props.get(i.propertyId);
      if (!p) throw new ZiteError('One of the properties no longer exists. Reload and try again.', 'NOT_FOUND');
      if (!p.ownerId) throw new ZiteError(`${p.name} has no owner. Set its owner before recording owner money.`, 'BAD_REQUEST');
    }
    const direction = data.action === 'contribution' ? 'contribution' : 'distribution';
    if (direction === 'distribution') {
      const cash = await propertyCash();
      for (const i of items) {
        const have = toCents(cash.get(i.propertyId) ?? 0);
        if (toCents(i.amount) > have) {
          const p = props.get(i.propertyId)!;
          throw new ZiteError(`${p.name} only has ${formatMoney(fromCents(Math.max(0, have)), settings.currency)} in cash, so it can’t distribute ${formatMoney(i.amount, settings.currency)}.`, 'BAD_REQUEST');
        }
      }
    }

    const posted: Array<{ propertyId: string; id: string; number: number; amount: number }> = [];
    const failed: Array<{ propertyId: string; name: string; message: string }> = [];
    for (const i of items) {
      const p = props.get(i.propertyId)!;
      try {
        const res = await postOwnerMoney({
          direction, ownerId: p.ownerId!, propertyId: p.id, amount: i.amount, date: data.date, paymentMethod: data.paymentMethod,
          bankAccountId: data.bankAccountId || null, reference: i.reference || null, description: data.description || undefined, createdById: actor.id,
        });
        posted.push({ propertyId: p.id, id: res.id, number: res.number, amount: i.amount });
        await logActivity({
          entityType: 'owner', entityId: p.ownerId!, ownerId: p.ownerId, propertyId: p.id, action: direction === 'contribution' ? 'owner_contribution' : 'owner_distribution',
          summary: `${direction === 'contribution' ? 'recorded an owner contribution of' : 'distributed'} ${formatMoney(i.amount, settings.currency)} ${direction === 'contribution' ? 'to' : 'from'} ${p.name}`,
          actorId: actor.id, actorName: actor.name, data: { transactionId: res.id, number: res.number },
        });
      } catch (e) {
        if (data.action !== 'run') throw e;
        failed.push({ propertyId: p.id, name: p.name, message: e instanceof ZiteError ? e.message : 'It didn’t post.' });
      }
    }
    return { posted, failed, total: fromCents(posted.reduce((s, x) => s + toCents(x.amount), 0)) };
  },
});
