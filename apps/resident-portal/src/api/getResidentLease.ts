import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, addMonths, todayIn } from '@project/shared/dates';
import { parseAreas } from '@project/shared/inspections';
import { leasePhase, leaseRef } from '@project/shared/leases';
import { parseSignatures } from '@project/shared/server/leases';
import { leaseBalances } from '@project/shared/server/ledger';
import { getSettings } from '@project/shared/server/settings';
import { iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/identity';
import { homeLabel, residentFor } from '../server/resident';

/**
 * The resident's lease: its terms and document, who's on it, what's charged
 * every month, and whatever it's waiting on — signatures, a renewal answer —
 * plus notice to vacate and the inspection reports shared with them.
 */

const Input = z.object({ leaseId: z.string().max(64).nullish() });

export default createEndpoint({
  description: "A resident's lease, signing, renewal, notice and inspections",
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { leaseId } = parseInput(Input, input);
    const me = await residentFor(context, leaseId);
    const { lease, tenantId } = me;
    const settings = await getSettings();
    const today = todayIn(settings.timezone);

    const [{ rows: people }, { rows: charges }, { rows: inspections }, balances] = await Promise.all([
      zite.sql({
        query: `SELECT lt."tenantId", lt."role", lt."signedAt", t."name" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 WHEN 'Co-tenant' THEN 1 WHEN 'Occupant' THEN 2 ELSE 3 END, lt.created_at ASC`,
        params: [lease.id],
      }),
      zite.sql({
        query: `SELECT id, "description", "amount", "frequency", "dayOfMonth", "startDate", "endDate" FROM "RecurringCharges" WHERE "leaseId" = $1 AND COALESCE("active", false) = true AND ("endDate" IS NULL OR "endDate" >= $2::date) ORDER BY "startDate" ASC NULLS FIRST, CASE WHEN "description" = 'Rent' THEN 0 ELSE 1 END, "amount" DESC`,
        params: [lease.id, today],
      }),
      zite.sql({
        query: `SELECT id, "title", "inspectionType", "status", "scheduledFor", "completedAt", "summary", "overallCondition", "areas", "tenantAcknowledgedAt", "reportUrl" FROM "Inspections" WHERE "leaseId" = $1 AND COALESCE("sharedWithTenant", false) = true AND "status" IN ('Scheduled', 'Completed') ORDER BY COALESCE("completedAt", "scheduledFor") DESC NULLS LAST`,
        params: [lease.id],
      }),
      leaseBalances([lease.id]),
    ]);

    const signatures = parseSignatures(lease.signatures);
    const household = people.map(p => {
      const id = String(p.tenantId);
      const sig = signatures.find(s => s.tenantId === id);
      const signer = p.role === 'Primary' || p.role === 'Co-tenant';
      return {
        name: str(p.name) || 'Resident',
        role: String(p.role),
        isMe: id === tenantId,
        signer,
        signedAt: signer ? iso(p.signedAt) ?? sig?.signedAt ?? null : null,
      };
    });
    const mine = household.find(h => h.isMe);

    const renewal =
      lease.renewalStatus === 'Offered' && lease.status === 'Active'
        ? (() => {
            const months = Math.max(1, lease.renewalTermMonths ?? 12);
            const newStart = addDays(lease.endDate ?? today, 1);
            const newEnd = addDays(addMonths(newStart, months), -1);
            const rent = lease.renewalRent ?? lease.rent;
            return {
              rent,
              currentRent: lease.rent,
              termMonths: months,
              newStart,
              newEnd,
              expiresOn: lease.renewalExpiresOn,
              expired: Boolean(lease.renewalExpiresOn && lease.renewalExpiresOn < today),
              offeredAt: lease.renewalOfferedAt,
            };
          })()
        : null;

    return {
      today,
      organizationName: settings.organizationName,
      lease: {
        id: lease.id,
        ref: leaseRef(lease.number),
        status: lease.status,
        phase: leasePhase({ status: lease.status, leaseType: lease.leaseType, startDate: lease.startDate, endDate: lease.endDate, noticeGivenOn: lease.noticeGivenOn, moveOutDate: lease.moveOutDate }, today),
        leaseType: lease.leaseType,
        home: homeLabel(lease),
        propertyName: lease.propertyName,
        unitName: lease.unitName,
        address: lease.address,
        startDate: lease.startDate,
        endDate: lease.endDate,
        moveInDate: lease.moveInDate,
        rent: lease.rent,
        deposit: lease.deposit,
        depositHeld: balances.get(lease.id)?.depositHeld ?? 0,
        rentDueDay: lease.rentDueDay,
        terms: lease.terms,
        documentUrl: lease.documentUrl,
        sentForSignatureAt: lease.sentForSignatureAt,
        signedAt: lease.signedAt,
        countersignedAt: lease.countersignedAt,
        renewalStatus: lease.renewalStatus,
        renewalRespondedAt: lease.renewalRespondedAt,
      },
      household,
      charges: charges.map(c => ({
        id: String(c.id),
        description: str(c.description) || 'Charge',
        amount: num(c.amount),
        frequency: str(c.frequency) || 'Monthly',
        dayOfMonth: num(c.dayOfMonth, lease.rentDueDay),
        startDate: c.startDate ? String(c.startDate).slice(0, 10) : null,
        endDate: c.endDate ? String(c.endDate).slice(0, 10) : null,
        upcoming: Boolean(c.startDate && String(c.startDate).slice(0, 10) > today),
      })),
      signing:
        lease.status === 'Pending signature'
          ? { canSign: Boolean(mine?.signer && !mine.signedAt), iSigned: Boolean(mine?.signedAt), allSigned: household.filter(h => h.signer).every(h => h.signedAt), mySignature: signatures.find(s => s.tenantId === tenantId) ?? null }
          : null,
      renewal,
      notice: {
        canGive: lease.status === 'Active' && !lease.noticeGivenOn && !lease.moveOutDate,
        noticeGivenOn: lease.noticeGivenOn,
        moveOutDate: lease.moveOutDate,
        reason: lease.moveOutReason,
        forwardingAddress: lease.forwardingAddress,
        minimumDays: 30,
      },
      inspections: inspections.map(i => ({
        id: String(i.id),
        title: str(i.title) || `${str(i.inspectionType) || 'Unit'} inspection`,
        type: str(i.inspectionType) || 'Routine',
        status: String(i.status),
        scheduledFor: iso(i.scheduledFor),
        completedAt: iso(i.completedAt),
        summary: str(i.summary) ?? '',
        overallCondition: ref(i.overallCondition),
        acknowledgedAt: iso(i.tenantAcknowledgedAt),
        reportUrl: ref(i.reportUrl),
        areas:
          i.status === 'Completed'
            ? parseAreas(i.areas).map(a => ({
                id: a.id,
                name: a.name,
                items: (a.items ?? []).map(it => ({ id: it.id, name: it.name, condition: it.condition ?? null, notes: it.notes ?? '', photos: (it.photos ?? []).filter(p => p?.url) })),
              }))
            : [],
      })),
    };
  },
});
