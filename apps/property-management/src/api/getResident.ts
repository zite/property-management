import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { isOccupying, leaseRef } from '@project/shared/leases';
import { toActivityRow } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { threadKey } from '@project/shared/server/email';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { daysLeft, phaseFor } from '../server/leaseStaff';
import { messagesWhere, toTimelineActivity } from '../server/timeline';

/**
 * A resident: contact details, every lease they've been on (with the one they
 * live under picked out), their conversation with the office, and everything
 * that happened on their record or their leases.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a resident with their leases, conversation and history',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const { id } = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const [{ rows: tenantRows }, { rows: leaseRows }] = await Promise.all([
      zite.sql({ query: `SELECT * FROM "Tenants" WHERE id::text = $1 LIMIT 1`, params: [id] }),
      zite.sql({
        query: `
          SELECT lt."role", lt."signedAt", l.id, l."name", l."number", l."status", l."leaseType", l."propertyId", l."unitId", l."startDate", l."endDate", l."moveInDate", l."moveOutDate", l."noticeGivenOn",
            l."rent", l."deposit", l."renewalStatus", l."depositSettledAt"
          FROM "LeaseTenants" lt JOIN "Leases" l ON l.id::text = lt."leaseId"
          WHERE lt."tenantId" = $1
          ORDER BY l."startDate" DESC NULLS LAST`,
        params: [id],
      }),
    ]);
    const t = tenantRows[0];
    if (!t) throw new ZiteError('That resident no longer exists.', 'NOT_FOUND');
    const leaseIds = leaseRows.map(r => String(r.id));

    const [balances, messages, activity, households] = await Promise.all([
      leaseBalances(leaseIds),
      messagesWhere(`(m."thread" = $1 OR (m."tenantId" = $2 AND COALESCE(m."workOrderId", '') = ''))`, [threadKey('tenant', id), id], 400),
      zite.sql({
        query: `SELECT * FROM "Activity" WHERE "tenantId" = $1 OR "entityId" = $1 ${leaseIds.length ? `OR "leaseId" = ANY($2)` : ''} ORDER BY "occurredAt" DESC NULLS LAST, created_at DESC LIMIT 200`,
        params: leaseIds.length ? [id, leaseIds] : [id],
      }),
      leaseIds.length
        ? zite.sql({ query: `SELECT lt."leaseId", t.id, t."name", lt."role" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = ANY($1) AND lt."tenantId" <> $2 ORDER BY lt.created_at ASC`, params: [leaseIds, id] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    const others = new Map<string, Array<{ id: string; name: string; role: string }>>();
    for (const h of households.rows) {
      const k = String(h.leaseId);
      if (!others.has(k)) others.set(k, []);
      others.get(k)!.push({ id: String(h.id), name: str(h.name) ?? '', role: str(h.role) ?? '' });
    }

    const leases = leaseRows
      .filter(r => r.status !== 'Canceled' || leaseRows.length === 1)
      .map(r => {
        const l = {
          id: String(r.id), name: str(r.name) ?? '', number: numOrNull(r.number), ref: leaseRef(numOrNull(r.number)), status: str(r.status) || 'Draft', leaseType: str(r.leaseType) || 'Fixed term',
          propertyId: ref(r.propertyId), unitId: ref(r.unitId), startDate: day(r.startDate), endDate: day(r.endDate), moveInDate: day(r.moveInDate), moveOutDate: day(r.moveOutDate), noticeGivenOn: day(r.noticeGivenOn),
          rent: num(r.rent), deposit: num(r.deposit), renewalStatus: str(r.renewalStatus) || 'None', depositSettled: Boolean(r.depositSettledAt), role: str(r.role) || 'Primary', signedAt: iso(r.signedAt),
        };
        const b = balances.get(l.id);
        return { ...l, phase: phaseFor(l, today, settings), daysToEnd: daysLeft(l.endDate, today), balance: b?.balance ?? 0, depositHeld: b?.depositHeld ?? 0, household: others.get(l.id) ?? [] };
      });
    const current = leases.find(l => isOccupying(l, today)) ?? leases.find(l => (l.status === 'Active' || l.status === 'Pending signature') && l.startDate && l.startDate > today) ?? null;

    return {
      today,
      tenant: {
        id: String(t.id), name: str(t.name) ?? '', email: str(t.email) ?? '', phone: str(t.phone) ?? '', altPhone: str(t.altPhone) ?? '', company: str(t.company) ?? '',
        emergencyContact: str(t.emergencyContact) ?? '', emergencyPhone: str(t.emergencyPhone) ?? '', vehicles: str(t.vehicles) ?? '', pets: str(t.pets) ?? '', notes: str(t.notes) ?? '', color: str(t.color) ?? '',
        portalInvitedAt: iso(t.portalInvitedAt), portalSeenAt: iso(t.portalSeenAt), archived: bool(t.archived), createdAt: iso(t.created_at),
      },
      leases,
      currentLeaseId: current?.id ?? null,
      messages,
      unread: messages.filter(m => m.direction === 'Inbound' && !m.readAt).length,
      activity: activity.rows.map(r => toTimelineActivity(toActivityRow(r))).reverse(),
      portalConfigured: Boolean(settings.portalUrl),
    };
  },
});
