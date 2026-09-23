import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { addDays, addPeriods, formatDay, isDay, periodOf, periodStart, todayIn } from '@project/shared/dates';
import { leaseRef } from '@project/shared/leases';
import { formatMoney } from '@project/shared/money';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { acceptRenewal, declineRenewal, giveNotice, recordSignature } from '@project/shared/server/leases';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { ref, str, withRetry } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import {
  countersignAndActivate, homeLabel, isSigner, leasePeople, leaseWatchers, loadStaffLease, requireStatus, sendForSignature, sendLeaseTemplate, type SendTally,
} from '../server/leaseStaff';

/**
 * Every event in a lease's life, from staff: send for signature, record a
 * signature collected on paper, countersign and activate, offer a renewal
 * (to one lease or many), accept or decline it on a resident's behalf,
 * convert to month-to-month, record notice, complete the move-out, cancel.
 * The engine does the work; this adds permission checks, activity, emails and
 * the inbox notifications.
 */

const id = z.string().min(1);
const dayStr = z.string().refine(isDay, 'Choose a valid date.');

const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sendForSignature'), leaseId: id, resend: z.boolean().optional() }),
  z.object({ action: z.literal('recordSignature'), leaseId: id, tenantId: id, typedName: z.string().trim().min(2, 'Type the name as it was signed.').max(120) }),
  z.object({ action: z.literal('activate'), leaseId: id, signAll: z.boolean().optional(), sendWelcome: z.boolean().optional() }),
  z.object({
    action: z.literal('offerRenewal'),
    offers: z.array(z.object({ leaseId: id, rent: z.number().positive('Enter the renewal rent.').max(1_000_000) })).min(1).max(200),
    termMonths: z.number().int().min(1, 'The term must be at least a month.').max(60, 'Keep the term to five years or less.'),
    expiresOn: dayStr,
    send: z.boolean().optional(),
  }),
  z.object({ action: z.literal('withdrawRenewal'), leaseId: id }),
  z.object({ action: z.literal('acceptRenewal'), leaseId: id }),
  z.object({ action: z.literal('declineRenewal'), leaseId: id }),
  z.object({ action: z.literal('monthToMonth'), leaseId: id }),
  z.object({ action: z.literal('giveNotice'), leaseId: id, noticeDate: dayStr, moveOutDate: dayStr, reason: z.string().trim().max(240).optional(), forwardingAddress: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('updateNotice'), leaseId: id, moveOutDate: dayStr, reason: z.string().trim().max(240).optional(), forwardingAddress: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('rescindNotice'), leaseId: id }),
  z.object({ action: z.literal('endLease'), leaseId: id, moveOutDate: dayStr, readiness: z.enum(['Make ready', 'Ready']).optional() }),
  z.object({ action: z.literal('cancel'), leaseId: id, reason: z.string().trim().max(240).optional() }),
]);

type Result = { ok: true; message: string; tally?: SendTally | null; count?: number; skipped?: string[] };

export default createEndpoint({
  description: 'Lease lifecycle: signatures, activation, renewals, notice, move-out and canceling',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }): Promise<Result> => {
    const actor = await getActor(context);
    assertCan(actor, 'residents.manage');
    const data = parseInput(Input, input);
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = (n: number) => formatMoney(n, settings.currency);

    // ── Renewal offers can cover many leases at once ─────────────────────────
    if (data.action === 'offerRenewal') {
      if (data.expiresOn < today) throw new ZiteError('The offer can’t expire in the past.', 'BAD_REQUEST');
      const skipped: string[] = [];
      let count = 0;
      const tally: SendTally = { sent: 0, failed: 0, noEmail: 0, templateOff: false };
      for (const offer of data.offers) {
        const lease = await loadStaffLease(offer.leaseId);
        const label = `${leaseRef(lease.number)} ${homeLabel(lease)}`;
        if (lease.status !== 'Active') {
          skipped.push(`${label} isn’t active`);
          continue;
        }
        if (lease.noticeGivenOn || lease.moveOutDate) {
          skipped.push(`${label} has given notice`);
          continue;
        }
        if (lease.renewalStatus === 'Accepted' && lease.endDate && lease.endDate > addDays(today, 180)) {
          skipped.push(`${label} already renewed`);
          continue;
        }
        const now = new Date().toISOString();
        await withRetry(() => zite.leases.update({ id: lease.id, record: { renewalStatus: 'Offered', renewalRent: offer.rent, renewalTermMonths: data.termMonths, renewalOfferedAt: now, renewalExpiresOn: data.expiresOn, renewalRespondedAt: null } }));
        const people = await leasePeople(lease.id);
        const change = lease.rent > 0 ? Math.round(((offer.rent - lease.rent) / lease.rent) * 1000) / 10 : 0;
        await logActivity({
          entityType: 'lease', entityId: lease.id, leaseId: lease.id, propertyId: lease.propertyId || null, unitId: lease.unitId || null, action: 'renewal_offered',
          summary: `offered a renewal at ${money(offer.rent)}/mo for ${data.termMonths} months${change ? ` (${change > 0 ? '+' : ''}${change}%)` : ''}, open until ${formatDay(data.expiresOn)}`,
          actorId: actor.id, actorName: actor.name, data: { rent: offer.rent, previousRent: lease.rent, termMonths: data.termMonths, expiresOn: data.expiresOn },
        });
        if (data.send !== false) {
          const res = await sendLeaseTemplate({
            trigger: 'Renewal offer', lease: { ...lease, renewalStatus: 'Offered' }, people, settings, actor, buttonLabel: 'Review the offer',
            extra: { renewal_rent: money(offer.rent), renewal_term: `${data.termMonths} months`, renewal_expires: formatDay(data.expiresOn, 'long') },
          });
          tally.sent += res.sent;
          tally.failed += res.failed;
          tally.noEmail += res.noEmail;
          tally.templateOff = tally.templateOff || res.templateOff;
        }
        count++;
      }
      if (!count) throw new ZiteError(skipped.length === 1 ? `No offer sent: ${skipped[0]}.` : `No offers sent — ${skipped.slice(0, 3).join('; ')}.`, 'BAD_REQUEST');
      return { ok: true, message: count === 1 ? 'Renewal offered' : `${count} renewals offered`, tally: data.send === false ? null : tally, count, skipped };
    }

    const lease = await loadStaffLease(data.leaseId);
    const ref_ = leaseRef(lease.number);
    const base = { entityType: 'lease' as const, entityId: lease.id, leaseId: lease.id, propertyId: lease.propertyId || null, unitId: lease.unitId || null, actorId: actor.id, actorName: actor.name };

    switch (data.action) {
      case 'sendForSignature': {
        const { tally } = await sendForSignature(actor, lease.id, settings, { resend: data.resend });
        await logActivity({ ...base, action: 'sent_for_signature', summary: data.resend || lease.status === 'Pending signature' ? 'resent the signature request' : 'sent the lease for signature' });
        return { ok: true, message: lease.status === 'Draft' ? 'Sent for signature' : 'Signature request resent', tally };
      }

      case 'recordSignature': {
        requireStatus(lease, ['Pending signature'], 'Send the lease for signature before recording signatures.');
        const people = await leasePeople(lease.id);
        const person = people.find(p => p.id === data.tenantId);
        if (!person || !isSigner(person)) throw new ZiteError('That person isn’t a signer on this lease.', 'BAD_REQUEST');
        if (person.signedAt) throw new ZiteError(`${person.name} has already signed.`, 'CONFLICT');
        const { allSigned } = await recordSignature(lease.id, person.id, data.typedName, 'staff');
        await logActivity({ ...base, tenantId: person.id, action: 'signed', summary: `recorded ${person.name}’s signature${allSigned ? ' — everyone has signed' : ''}`, data: { typedName: data.typedName, by: 'staff' } });
        return { ok: true, message: allSigned ? 'Everyone has signed — ready to countersign' : `${person.name}’s signature recorded` };
      }

      case 'activate': {
        const res = await countersignAndActivate(actor, lease.id, settings, { signAll: data.signAll, sendWelcome: data.sendWelcome, today });
        await logActivity({ ...base, action: 'activated', summary: `${res.recorded ? 'recorded the remaining signatures, ' : ''}countersigned and activated the lease${res.posted ? ` — posted ${res.posted} move-in ${res.posted === 1 ? 'charge' : 'charges'}` : ''}` });
        await notify({ recipientIds: await leaseWatchers(lease), kind: 'lease_signed', title: `${ref_} ${homeLabel(lease)} is active`, body: `${actor.name} countersigned and activated it.`, link: `/leases/${lease.id}`, entityType: 'lease', entityId: lease.id, actorId: actor.id, actorName: actor.name });
        return { ok: true, message: 'Lease activated', tally: res.welcome, count: res.posted };
      }

      case 'withdrawRenewal': {
        if (lease.renewalStatus !== 'Offered') throw new ZiteError('There’s no open renewal offer to withdraw.', 'BAD_REQUEST');
        await withRetry(() => zite.leases.update({ id: lease.id, record: { renewalStatus: 'None', renewalRent: null, renewalTermMonths: null, renewalOfferedAt: null, renewalExpiresOn: null } }));
        await logActivity({ ...base, action: 'renewal_withdrawn', summary: 'withdrew the renewal offer' });
        return { ok: true, message: 'Offer withdrawn' };
      }

      case 'acceptRenewal': {
        if (lease.renewalExpiresOn && lease.renewalExpiresOn < today) {
          // Staff can still accept a late answer: extend the offer to today first.
          await withRetry(() => zite.leases.update({ id: lease.id, record: { renewalExpiresOn: addDays(today, 1) } }));
        }
        const res = await acceptRenewal(lease.id, { timezone: settings.timezone });
        await rentSwitchNotBackdated(lease.id);
        await logActivity({ ...base, action: 'renewal_accepted', summary: `accepted the renewal on the residents’ behalf — ${res.months} months at ${money(res.newRent)}/mo through ${formatDay(res.newEnd)}`, data: { ...res } });
        return { ok: true, message: `Renewed through ${formatDay(res.newEnd)}` };
      }

      case 'declineRenewal': {
        await declineRenewal(lease.id);
        await logActivity({ ...base, action: 'renewal_declined', summary: 'recorded that the residents declined the renewal' });
        return { ok: true, message: 'Renewal declined' };
      }

      case 'monthToMonth': {
        requireStatus(lease, ['Active'], 'Only an active lease can go month-to-month.');
        if (lease.leaseType === 'Month-to-month') throw new ZiteError('This lease is already month-to-month.', 'BAD_REQUEST');
        await withRetry(() => zite.leases.update({ id: lease.id, record: { leaseType: 'Month-to-month', endDate: null, ...(lease.renewalStatus === 'Offered' ? { renewalStatus: 'None' } : {}) } }));
        await logActivity({ ...base, action: 'month_to_month', summary: `converted the lease to month-to-month${lease.endDate ? ` (the term ended ${formatDay(lease.endDate)})` : ''}` });
        return { ok: true, message: 'Now month-to-month' };
      }

      case 'giveNotice': {
        requireStatus(lease, ['Active'], 'Only an active lease can be given notice.');
        if (lease.noticeGivenOn || lease.moveOutDate) throw new ZiteError(`Notice is already recorded — moving out ${formatDay(lease.moveOutDate)}. Change the date instead.`, 'CONFLICT');
        if (data.noticeDate > today) throw new ZiteError('The notice date can’t be in the future.', 'BAD_REQUEST');
        if (data.moveOutDate < today) throw new ZiteError('Choose a move-out date from today onward. For a move-out that already happened, complete the move-out instead.', 'BAD_REQUEST');
        if (lease.startDate && data.moveOutDate < lease.startDate) throw new ZiteError('The move-out date is before the lease starts.', 'BAD_REQUEST');
        await giveNotice(lease.id, { moveOutDate: data.moveOutDate, reason: data.reason || null, forwardingAddress: data.forwardingAddress || null, noticeDate: data.noticeDate, timezone: settings.timezone });
        const primary = (await leasePeople(lease.id)).find(p => p.role === 'Primary');
        await logActivity({ ...base, tenantId: primary?.id ?? null, action: 'notice_given', summary: `recorded notice — moving out ${formatDay(data.moveOutDate)}${data.reason ? ` (${data.reason.slice(0, 120)})` : ''}`, data: { noticeDate: data.noticeDate, moveOutDate: data.moveOutDate } });
        await notify({ recipientIds: await leaseWatchers(lease), kind: 'notice_given', title: `${homeLabel(lease)} moving out ${formatDay(data.moveOutDate)}`, body: `${actor.name} recorded the residents’ notice.${data.reason ? ` Reason: ${data.reason}` : ''}`, link: `/leases/${lease.id}`, entityType: 'lease', entityId: lease.id, actorId: actor.id, actorName: actor.name });
        return { ok: true, message: `Notice recorded — moving out ${formatDay(data.moveOutDate)}` };
      }

      case 'updateNotice': {
        requireStatus(lease, ['Active'], 'Only an active lease’s notice can be changed.');
        if (!lease.noticeGivenOn && !lease.moveOutDate) throw new ZiteError('There’s no notice on this lease to change.', 'BAD_REQUEST');
        if (data.moveOutDate < today) throw new ZiteError('Choose a move-out date from today onward.', 'BAD_REQUEST');
        await withRetry(() => zite.leases.update({ id: lease.id, record: { moveOutDate: data.moveOutDate, ...(data.reason !== undefined ? { moveOutReason: data.reason || null } : {}), ...(data.forwardingAddress !== undefined ? { forwardingAddress: data.forwardingAddress || null } : {}) } }));
        if (data.moveOutDate !== lease.moveOutDate) await logActivity({ ...base, action: 'notice_updated', summary: `changed the move-out date to ${formatDay(data.moveOutDate)}` });
        return { ok: true, message: 'Move-out details saved' };
      }

      case 'rescindNotice': {
        requireStatus(lease, ['Active'], 'Only an active lease’s notice can be withdrawn.');
        if (!lease.noticeGivenOn && !lease.moveOutDate) throw new ZiteError('There’s no notice on this lease.', 'BAD_REQUEST');
        await withRetry(() => zite.leases.update({ id: lease.id, record: { noticeGivenOn: null, moveOutDate: null, moveOutReason: null, forwardingAddress: null, renewalStatus: 'None' } }));
        await logActivity({ ...base, action: 'notice_rescinded', summary: 'withdrew the notice — the residents are staying' });
        return { ok: true, message: 'Notice withdrawn' };
      }

      case 'endLease': {
        requireStatus(lease, ['Active'], 'Only an active lease can be ended.');
        if (data.moveOutDate > today) throw new ZiteError(`You can complete the move-out on or after ${formatDay(data.moveOutDate)}. Until then the residents still live there.`, 'BAD_REQUEST');
        if (lease.startDate && data.moveOutDate < lease.startDate) throw new ZiteError('The move-out date is before the lease starts.', 'BAD_REQUEST');
        await withRetry(() => zite.leases.update({ id: lease.id, record: { status: 'Ended', moveOutDate: data.moveOutDate, noticeGivenOn: lease.noticeGivenOn ?? data.moveOutDate, ...(lease.renewalStatus === 'Offered' ? { renewalStatus: 'Declined' } : {}) } }));
        // Billing stops at the move-out: recurring charges end there, and ones that hadn't started yet are switched off.
        const { rows: rcs } = await zite.sql({ query: `SELECT id, "startDate", "endDate" FROM "RecurringCharges" WHERE "leaseId" = $1 AND COALESCE("active", false) = true`, params: [lease.id] });
        for (const rc of rcs) {
          const start = rc.startDate ? String(rc.startDate).slice(0, 10) : null;
          const end = rc.endDate ? String(rc.endDate).slice(0, 10) : null;
          await withRetry(() => zite.recurringCharges.update({ id: String(rc.id), record: { active: false, ...(start && start > data.moveOutDate ? {} : { endDate: end && end < data.moveOutDate ? end : data.moveOutDate }) } }));
        }
        const { rows: others } = await zite.sql({ query: `SELECT id FROM "Leases" WHERE "unitId" = $1 AND id::text <> $2 AND "status" IN ('Active', 'Pending signature')`, params: [lease.unitId, lease.id] });
        if (lease.unitId) await withRetry(() => zite.units.update({ id: lease.unitId, record: { readiness: data.readiness ?? 'Make ready', ...(others.length ? {} : { availableOn: addDays(data.moveOutDate, 1) }) } }));
        const primary = (await leasePeople(lease.id)).find(p => p.role === 'Primary');
        await logActivity({ ...base, tenantId: primary?.id ?? null, action: 'moved_out', summary: `completed the move-out on ${formatDay(data.moveOutDate)} — the lease has ended` });
        return { ok: true, message: 'Move-out complete — the lease has ended' };
      }

      case 'cancel': {
        requireStatus(lease, ['Draft', 'Pending signature'], 'Only a draft or unsigned lease can be canceled. End an active lease with a move-out instead.');
        await withRetry(() => zite.leases.update({ id: lease.id, record: { status: 'Canceled', notes: data.reason ? [lease.notes, `Canceled: ${data.reason}`].filter(Boolean).join('\n\n') : lease.notes || null } }));
        const { rows: rcs } = await zite.sql({ query: `SELECT id FROM "RecurringCharges" WHERE "leaseId" = $1 AND COALESCE("active", false) = true`, params: [lease.id] });
        for (const rc of rcs) await withRetry(() => zite.recurringCharges.update({ id: String(rc.id), record: { active: false } }));
        if (lease.applicationId) {
          const { rows } = await zite.sql({ query: `SELECT "status", "leaseId" FROM "Applications" WHERE id::text = $1`, params: [lease.applicationId] });
          if (rows[0]?.status === 'Leased' && ref(rows[0].leaseId) === lease.id) {
            await withRetry(() => zite.applications.update({ id: lease.applicationId!, record: { status: 'Approved', leaseId: null, lastActivityAt: new Date().toISOString() } }));
            await logActivity({ entityType: 'application', entityId: lease.applicationId, applicationId: lease.applicationId, action: 'lease_canceled', summary: `canceled lease ${ref_} — the application is back to Approved`, actorId: actor.id, actorName: actor.name });
          }
        }
        await logActivity({ ...base, action: 'canceled', summary: `canceled the lease${data.reason ? ` — ${data.reason}` : ''}` });
        return { ok: true, message: `${ref_} canceled` };
      }
    }
    throw new ZiteError('That isn’t something a lease can do.', 'BAD_REQUEST');
  },
});

/**
 * `acceptRenewal` switches rent on the first period of the new term. When the
 * old term already ran out (a late acceptance), that period may already be
 * billed at the old rent, and a new recurring charge starting there would
 * bill it again. Move the switch to the first period that hasn't been billed.
 */
async function rentSwitchNotBackdated(leaseId: string) {
  const chart = await getChart();
  const rentAccount = chart.key('rent_income').id;
  const { rows } = await zite.sql({
    query: `SELECT id, "startDate", "endDate", created_at FROM "RecurringCharges" WHERE "leaseId" = $1 AND "accountId" = $2 AND COALESCE("active", false) = true ORDER BY created_at DESC`,
    params: [leaseId, rentAccount],
  });
  const newest = rows[0];
  if (!newest?.startDate) return;
  const newStart = String(newest.startDate).slice(0, 10);
  // The charges acceptRenewal just ended are the ones that stop the day before the new rent starts.
  const switched = rows.slice(1).filter(r => r.endDate && String(r.endDate).slice(0, 10) === addDays(newStart, -1));
  if (!switched.length) return;
  const { rows: billed } = await zite.sql({
    query: `SELECT MAX("period") AS p FROM "Transactions" WHERE "recurringChargeId" = ANY($1) AND "status" = 'Posted' AND COALESCE("period", '') <> ''`,
    params: [switched.map(r => String(r.id))],
  });
  const lastBilled = str(billed[0]?.p);
  if (!lastBilled || periodOf(newStart) > lastBilled) return;
  const switchOn = periodStart(addPeriods(lastBilled, 1));
  await withRetry(() => zite.recurringCharges.update({ id: String(newest.id), record: { startDate: switchOn } }));
  for (const r of switched) await withRetry(() => zite.recurringCharges.update({ id: String(r.id), record: { endDate: addDays(switchOn, -1) } }));
}
