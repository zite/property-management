import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { fromCents, toCents } from '@project/shared/money';
import { assertCan, can, getActor } from '@project/shared/server/actor';
import { threadKey } from '@project/shared/server/email';
import { propertyCash } from '@project/shared/server/ledger';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canSeeMoney, depositsHeldByProperty, loadOwner } from '../server/portfolio';
import { messagesWhere, timelineActivity } from '../server/timeline';

/**
 * One owner: the record, the properties they own (with cash and deposits for
 * money roles), this year's owner money, their conversation and history.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get an owner with their properties, money, conversation and history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'owners.manage');
    const { id } = parseInput(Input, input);
    const owner = await loadOwner(id);
    if (!owner) throw new ZiteError('That owner doesn’t exist, or they were deleted.', 'NOT_FOUND');
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = canSeeMoney(actor);
    const yearStart = `${today.slice(0, 4)}-01-01`;

    const [props, ytd, messages, activity, docs, lastDistribution] = await Promise.all([
      zite.sql({ query: `SELECT id, "name", "status" FROM "Properties" WHERE "ownerId" = $1 ORDER BY "name" ASC`, params: [id] }),
      money
        ? zite.sql({
            query: `
              SELECT t."kind", SUM(t."amount") AS amount, COUNT(*) AS n
              FROM "Transactions" t LEFT JOIN "Properties" p ON p.id::text = t."propertyId"
              WHERE t."status" = 'Posted' AND t."kind" IN ('Owner distribution', 'Owner contribution', 'Management fee')
                AND (t."ownerId" = $1 OR p."ownerId" = $1) AND t."date" >= $2::date AND t."date" <= $3::date
              GROUP BY t."kind"`,
            params: [id, yearStart, today],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
      messagesWhere(`(m."thread" = $1 OR m."ownerId" = $2)`, [threadKey('owner', id), id]),
      timelineActivity('ownerId', id, 150),
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "Documents" WHERE "ownerId" = $1`, params: [id] }),
      money
        ? zite.sql({
            query: `SELECT t."date", SUM(t."amount") AS amount FROM "Transactions" t LEFT JOIN "Properties" p ON p.id::text = t."propertyId" WHERE t."status" = 'Posted' AND t."kind" = 'Owner distribution' AND (t."ownerId" = $1 OR p."ownerId" = $1) GROUP BY t."date" ORDER BY t."date" DESC LIMIT 1`,
            params: [id],
          })
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);

    const propertyIds = props.rows.map(r => String(r.id));
    const [cash, held] = money ? await Promise.all([propertyCash(), depositsHeldByProperty(propertyIds)]) : [new Map<string, number>(), new Map<string, number>()];
    const kind = (k: string) => ytd.rows.find(r => r.kind === k);
    const last = lastDistribution.rows[0];

    return {
      today,
      money,
      canMessage: can(actor.role, 'communications.send'),
      portalUrl: portalLink(settings, '/owner') || null,
      defaultFeePercent: settings.managementFeePercent,
      owner,
      properties: props.rows.map(r => {
        const pid = String(r.id);
        return { id: pid, name: str(r.name) ?? '', status: str(r.status) || 'Active', cash: money ? cash.get(pid) ?? 0 : null, depositsHeld: money ? held.get(pid) ?? 0 : null };
      }),
      totals: money
        ? {
            cash: fromCents(propertyIds.reduce((a, p) => a + toCents(cash.get(p) ?? 0), 0)),
            depositsHeld: fromCents(propertyIds.reduce((a, p) => a + toCents(held.get(p) ?? 0), 0)),
            distributionsYtd: num(kind('Owner distribution')?.amount),
            contributionsYtd: num(kind('Owner contribution')?.amount),
            feesYtd: num(kind('Management fee')?.amount),
            lastDistribution: last ? { date: String(last.date ?? '').slice(0, 10), amount: num(last.amount) } : null,
          }
        : null,
      messages,
      activity,
      documentCount: num(docs.rows[0]?.n),
      lastMessageAt: messages.length ? iso(messages[messages.length - 1].sentAt) : null,
      lastInboundAt: ref([...messages].reverse().find(m => m.direction === 'Inbound')?.sentAt ?? null),
    };
  },
});
