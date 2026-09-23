import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES } from '@project/shared/constants';
import { formatMoney, toCents } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart, invalidateChart } from '@project/shared/server/accounts';
import { getSettings } from '@project/shared/server/settings';
import { num, str } from '@project/shared/server/sql';
import { SUBTYPES_BY_TYPE } from '../server/accounting';
import { parseInput } from '../server/input';

/**
 * Add or edit an account in the chart. Numbers are unique. The accounts the
 * posting engine relies on (those with a system key) can be renamed and
 * renumbered but never retyped or deactivated. An account with a balance, or
 * one a property deposits into, can't be deactivated either.
 */

const Input = z.object({
  id: z.string().optional(),
  number: z.string().trim().min(1, 'Give the account a number.').max(12, 'Keep the number to 12 characters.').regex(/^[A-Za-z0-9.-]+$/, 'Use digits, letters, dots or dashes for the number.'),
  name: z.string().trim().min(1, 'Give the account a name.').max(120),
  accountType: z.enum(ACCOUNT_TYPES),
  subtype: z.enum(ACCOUNT_SUBTYPES),
  description: z.string().trim().max(500).optional(),
  tenantCharge: z.boolean().optional(),
  billExpense: z.boolean().optional(),
  bankName: z.string().trim().max(80).optional(),
  accountLast4: z.string().trim().regex(/^\d{0,4}$/, 'Enter the last four digits of the account number.').optional(),
  active: z.boolean().optional(),
});

export default createEndpoint({
  description: 'Create or update an account in the chart of accounts',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'banking.manage');
    const data = parseInput(Input, input);
    if (!SUBTYPES_BY_TYPE[data.accountType].includes(data.subtype)) throw new ZiteError(`${data.subtype} isn’t a kind of ${data.accountType.toLowerCase()} account.`, 'BAD_REQUEST');

    const chart = await getChart({ fresh: true });
    const clash = chart.all.find(a => a.number.trim().toLowerCase() === data.number.toLowerCase() && a.id !== data.id);
    if (clash) throw new ZiteError(`Account ${data.number} is already ${clash.name}. Choose another number.`, 'CONFLICT');
    const isBank = data.subtype === 'Bank';
    const record = {
      number: data.number,
      name: data.name,
      accountType: data.accountType,
      subtype: data.subtype,
      description: data.description ?? '',
      tenantCharge: data.accountType === 'Income' || data.subtype === 'Deposits held' || data.subtype === 'Other liability' ? Boolean(data.tenantCharge) : false,
      billExpense: data.accountType === 'Expense' ? Boolean(data.billExpense) : false,
      bankName: isBank ? data.bankName ?? '' : '',
      accountLast4: isBank ? data.accountLast4 ?? '' : '',
      active: data.active ?? true,
    };
    const settings = await getSettings();

    if (!data.id) {
      const created = await zite.accounts.create({ record: { ...record, systemKey: null, position: chart.all.length } });
      invalidateChart();
      await logActivity({ entityType: 'settings', entityId: created.id, action: 'account_created', summary: `added account ${data.number} ${data.name}`, actorId: actor.id, actorName: actor.name });
      return { id: created.id };
    }

    const existing = chart.byId.get(data.id);
    if (!existing) throw new ZiteError('That account no longer exists.', 'NOT_FOUND');
    if (existing.systemKey) {
      if (existing.accountType !== data.accountType || existing.subtype !== data.subtype) throw new ZiteError(`${existing.name} is posted to automatically, so its type can’t change. You can rename or renumber it.`, 'BAD_REQUEST');
      if (data.active === false) throw new ZiteError(`${existing.name} is posted to automatically, so it can’t be deactivated.`, 'BAD_REQUEST');
    }
    if (existing.active && data.active === false) {
      const [{ rows: bal }, { rows: props }] = await Promise.all([
        zite.sql({ query: `SELECT SUM(COALESCE("debit", 0) - COALESCE("credit", 0)) AS balance, COUNT(*) AS n FROM "JournalLines" WHERE "accountId" = $1 AND COALESCE("void", false) = false`, params: [existing.id] }),
        zite.sql({ query: `SELECT "name" FROM "Properties" WHERE "bankAccountId" = $1 AND COALESCE("status", 'Active') <> 'Archived' LIMIT 3`, params: [existing.id] }),
      ]);
      if (toCents(num(bal[0]?.balance)) !== 0) throw new ZiteError(`${existing.name} still has a balance of ${formatMoney(Math.abs(num(bal[0]?.balance)), settings.currency)}. Move it to another account with a journal entry before deactivating.`, 'BAD_REQUEST');
      if (props.length) throw new ZiteError(`${props.map(p => str(p.name)).join(', ')} deposit${props.length === 1 ? 's' : ''} into this account. Point ${props.length === 1 ? 'it' : 'them'} at another bank account first.`, 'BAD_REQUEST');
    }
    if (existing.accountType !== data.accountType) {
      const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS n FROM "JournalLines" WHERE "accountId" = $1 AND COALESCE("void", false) = false`, params: [existing.id] });
      if (num(rows[0]?.n) > 0) throw new ZiteError(`${existing.name} already has transactions, so its type can’t change. Create a new account and move the balance with a journal entry.`, 'BAD_REQUEST');
    }
    await zite.accounts.update({ id: existing.id, record });
    invalidateChart();
    const changes = [existing.name !== data.name && `renamed ${existing.name} to ${data.name}`, existing.number !== data.number && `renumbered it ${data.number}`, existing.active !== record.active && (record.active ? 'reactivated it' : 'deactivated it')].filter(Boolean);
    await logActivity({ entityType: 'settings', entityId: existing.id, action: 'account_updated', summary: changes.length ? `${changes.join(', ')} (account ${data.number})` : `updated account ${data.number} ${data.name}`, actorId: actor.id, actorName: actor.name });
    return { id: existing.id };
  },
});
