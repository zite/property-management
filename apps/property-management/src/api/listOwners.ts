import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, getActor } from '@project/shared/server/actor';
import { propertyCash } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { iso, num } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canSeeMoney, toOwnerDetail } from '../server/portfolio';

/**
 * Owners with what the list shows: properties and units they own, portal
 * access, and (for money roles) distributions and fees this year and the cash
 * held across their properties. A distribution or fee counts toward an owner
 * when it's tagged with them or posted to a property they own.
 */

const Input = z.object({});

export default createEndpoint({
  description: 'List owners with portfolio size, portal access and year-to-date money',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'owners.manage');
    parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = canSeeMoney(actor);
    const yearStart = `${today.slice(0, 4)}-01-01`;

    const [owners, portfolio, ytd, cash, lastMessage] = await Promise.all([
      zite.sql({ query: `SELECT * FROM "Owners" ORDER BY "name" ASC LIMIT 2000`, params: [] }),
      zite.sql({
        query: `
          SELECT p."ownerId" AS oid, COUNT(DISTINCT p.id) AS properties, COUNT(u.id) AS units, STRING_AGG(DISTINCT p.id::text, ',') AS ids
          FROM "Properties" p LEFT JOIN "Units" u ON u."propertyId" = p.id::text AND COALESCE(u."archived", false) = false
          WHERE COALESCE(p."ownerId", '') <> '' AND COALESCE(p."status", 'Active') <> 'Archived'
          GROUP BY p."ownerId"`,
        params: [],
      }),
      money
        ? zite.sql({
            query: `
              SELECT COALESCE(NULLIF(t."ownerId", ''), p."ownerId") AS oid, t."kind", SUM(t."amount") AS amount
              FROM "Transactions" t LEFT JOIN "Properties" p ON p.id::text = t."propertyId"
              WHERE t."status" = 'Posted' AND t."kind" IN ('Owner distribution', 'Owner contribution', 'Management fee') AND t."date" >= $1::date AND t."date" <= $2::date
              GROUP BY 1, 2`,
            params: [yearStart, today],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      money ? propertyCash() : Promise.resolve(new Map<string, number>()),
      zite.sql({ query: `SELECT "ownerId" AS oid, MAX("sentAt") AS at FROM "Messages" WHERE COALESCE("ownerId", '') <> '' GROUP BY "ownerId"`, params: [] }),
    ]);

    const port = new Map(portfolio.rows.map(r => [String(r.oid), { properties: num(r.properties), units: num(r.units), ids: String(r.ids ?? '').split(',').filter(Boolean) }]));
    const sums = new Map<string, { distributions: number; contributions: number; fees: number }>();
    for (const r of ytd.rows) {
      const k = String(r.oid ?? '');
      const cur = sums.get(k) ?? { distributions: 0, contributions: 0, fees: 0 };
      const c = toCents(num(r.amount));
      if (r.kind === 'Owner distribution') cur.distributions += c;
      else if (r.kind === 'Owner contribution') cur.contributions += c;
      else cur.fees += c;
      sums.set(k, cur);
    }
    const lastBy = new Map(lastMessage.rows.map(r => [String(r.oid), iso(r.at)]));

    return {
      today,
      money,
      defaultFeePercent: settings.managementFeePercent,
      owners: owners.rows.map(r => {
        const o = toOwnerDetail(r);
        const p = port.get(o.id) ?? { properties: 0, units: 0, ids: [] };
        const s = sums.get(o.id);
        return {
          ...o,
          propertyCount: p.properties,
          unitCount: p.units,
          propertyIds: p.ids,
          distributionsYtd: money ? fromCents(s?.distributions ?? 0) : null,
          contributionsYtd: money ? fromCents(s?.contributions ?? 0) : null,
          feesYtd: money ? fromCents(s?.fees ?? 0) : null,
          cash: money ? fromCents(p.ids.reduce((a, id) => a + toCents(cash.get(id) ?? 0), 0)) : null,
          lastMessageAt: lastBy.get(o.id) ?? null,
        };
      }),
    };
  },
});
