import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { leasePhase } from '@project/shared/leases';
import { parseSignatures } from '@project/shared/server/leases';
import { leaseLedger, openCharges } from '@project/shared/server/ledger';
import { firstName, renderMerge } from '@project/shared/merge';
import { getSettings, isStripeConfigured, portalLink } from '@project/shared/server/settings';
import { iso, json, num, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { homeLabel, listRequests, nextRecurringCharges, preview, residentFor, toResidentMessage } from '../server/resident';

/**
 * Everything the resident's home screen shows, in one call: what they owe
 * and why, what's next, open requests, anything waiting on them (a lease to
 * sign, a renewal offer), news for their building and the latest messages.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish() });

export default createEndpoint({
  description: "A resident's dashboard for one of their leases",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId } = parseInput(Input, input);
    const me = await residentFor(context, leaseId);
    const { lease, tenantId } = me;
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const [ledger, open, next, requests, signers, inspections, announcements, messages, unread] = await Promise.all([
      leaseLedger(lease.id),
      openCharges(lease.id),
      nextRecurringCharges(lease, settings.timezone),
      listRequests(lease.id, tenantId, 50),
      zite.sql({
        query: `SELECT lt."tenantId", lt."role", lt."signedAt", t."name" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at ASC`,
        params: [lease.id],
      }),
      zite.sql({
        query: `SELECT COUNT(*) AS n FROM "Inspections" WHERE "leaseId" = $1 AND COALESCE("sharedWithTenant", false) = true AND "status" = 'Completed' AND "tenantAcknowledgedAt" IS NULL`,
        params: [lease.id],
      }),
      zite.sql({
        query: `SELECT id, "title", "body", "audience", "propertyIds", "sentAt", "pinnedUntil" FROM "Announcements" WHERE "status" = 'Sent' AND "audience" IN ('All residents', 'Selected properties') ORDER BY "sentAt" DESC NULLS LAST LIMIT 100`,
        params: [],
      }),
      zite.sql({
        query: `
          SELECT m.id, m."subject", m."body", m."direction", m."senderName", m."sentAt", m."readAt", m."attachments", m.created_at, NULL AS "workOrderNumber"
          FROM "Messages" m
          WHERE m."thread" = $1 AND m."tenantId" = $2 AND m."direction" IN ('Inbound', 'Outbound') AND m."channel" <> 'Note'
          ORDER BY COALESCE(m."sentAt", m.created_at) DESC LIMIT 3`,
        params: [`tenant:${tenantId}`, tenantId],
      }),
      zite.sql({
        query: `SELECT COUNT(*) AS n FROM "Messages" WHERE "tenantId" = $1 AND "direction" = 'Outbound' AND "readAt" IS NULL AND "channel" <> 'Note'`,
        params: [tenantId],
      }),
    ]);

    const signatureList = parseSignatures(lease.signatures);
    const signerRows = signers.rows.map(r => ({
      tenantId: String(r.tenantId),
      name: str(r.name) || 'Resident',
      role: String(r.role),
      signed: Boolean(r.signedAt) || signatureList.some(s => s.tenantId === String(r.tenantId)),
      isMe: String(r.tenantId) === tenantId,
    }));

    // Announcements are written with merge tags ("Hi {{recipient_first_name}}"), rendered for this resident.
    const mergeCtx = {
      recipient_first_name: firstName(me.name) || 'there', recipient_name: me.name, tenant_names: me.name,
      property_name: lease.propertyName, unit_name: lease.unitName, unit_address: lease.address,
      organization_name: settings.organizationName, office_phone: settings.phone, support_email: settings.supportEmail ?? '',
      emergency_phone: settings.emergencyPhone || settings.phone, portal_link: portalLink(settings),
    };
    const announcementsOut = announcements.rows
      .filter(a => {
        if (a.audience === 'All residents') return true;
        const ids = json<unknown[]>(a.propertyIds, []);
        return Array.isArray(ids) && ids.map(String).includes(lease.propertyId);
      })
      .map(a => {
        const pinnedUntil = a.pinnedUntil ? String(a.pinnedUntil).slice(0, 10) : null;
        return { id: String(a.id), title: renderMerge(str(a.title) ?? '', mergeCtx), body: renderMerge(str(a.body) ?? '', mergeCtx), sentAt: iso(a.sentAt), pinned: Boolean(pinnedUntil && pinnedUntil >= today) };
      })
      .filter(a => a.pinned || (a.sentAt && Date.now() - Date.parse(a.sentAt) < 60 * 86_400_000))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
      .slice(0, 4);

    const lastPayment = [...ledger.entries].reverse().find(e => e.kind === 'Payment' && e.status === 'Posted') ?? null;
    const openRequests = requests.filter(r => ['New', 'Scheduled', 'In progress', 'On hold'].includes(r.status));
    const toRate = requests.find(r => r.status === 'Completed' && r.tenantRating == null && r.completedAt && Date.now() - Date.parse(r.completedAt) < 21 * 86_400_000) ?? null;

    return {
      today,
      lease: {
        id: lease.id,
        number: lease.number,
        status: lease.status,
        phase: leasePhase({ status: lease.status, leaseType: lease.leaseType, startDate: lease.startDate, endDate: lease.endDate, noticeGivenOn: lease.noticeGivenOn, moveOutDate: lease.moveOutDate }, today),
        role: lease.role,
        home: homeLabel(lease),
        propertyName: lease.propertyName,
        propertyColor: lease.propertyColor,
        unitName: lease.unitName,
        address: lease.address,
        startDate: lease.startDate,
        endDate: lease.endDate,
        moveOutDate: lease.moveOutDate,
        noticeGivenOn: lease.noticeGivenOn,
        rent: lease.rent,
        rentDueDay: lease.rentDueDay,
      },
      money: {
        balance: ledger.balance,
        pastDue: ledger.pastDue,
        credit: ledger.balance < 0 ? -ledger.balance : 0,
        depositHeld: ledger.depositHeld,
        openCharges: open.map(c => ({ id: c.id, description: c.description, dueDate: c.dueDate, amount: c.amount, open: c.open, overdue: Boolean(c.dueDate && c.dueDate < today) })),
        nextCharges: next,
        lastPayment: lastPayment ? { id: lastPayment.id, date: lastPayment.date, amount: lastPayment.amount } : null,
        canPayOnline: settings.onlinePayments && isStripeConfigured(),
      },
      requests: {
        open: openRequests.length,
        items: openRequests.slice(0, 4),
        toRate: toRate ? { number: toRate.number, title: toRate.title } : null,
      },
      actions: {
        signing: lease.status === 'Pending signature' ? { signers: signerRows, iSigned: signerRows.some(s => s.isMe && s.signed) } : null,
        renewal:
          lease.status === 'Active' && lease.renewalStatus === 'Offered'
            ? { rent: lease.renewalRent ?? lease.rent, currentRent: lease.rent, termMonths: lease.renewalTermMonths ?? 12, expiresOn: lease.renewalExpiresOn }
            : null,
        notice: lease.status === 'Active' && (lease.noticeGivenOn || lease.moveOutDate) ? { noticeGivenOn: lease.noticeGivenOn, moveOutDate: lease.moveOutDate } : null,
        inspectionsToAcknowledge: num(inspections.rows[0]?.n),
      },
      announcements: announcementsOut,
      messages: {
        unread: num(unread.rows[0]?.n),
        latest: messages.rows.map(r => {
          const m = toResidentMessage(r, settings.organizationName);
          return { id: m.id, subject: m.subject, preview: preview(m.body, 120), mine: m.mine, senderName: m.senderName, sentAt: m.sentAt, unread: m.unread };
        }),
      },
      maintenanceEnabled: settings.maintenanceRequests,
    };
  },
});
