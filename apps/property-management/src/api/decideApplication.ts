import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { applicationRef } from '@project/shared/leases';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { numOrNull, ref, str } from '@project/shared/server/sql';
import { DENIAL_REASONS, normalizeScreening, screeningDone } from '../components/leasing/rules';
import { parseInput } from '../server/input';
import { appLabel, loadApplicationRecord, sendDecisionEmail } from '../server/leasing';

/**
 * Decisions on an application: approve (optionally with conditions), deny
 * (with a reason from a fixed list), withdraw, or reopen.
 *
 * A person decides — never AI. The applicant is emailed the organization's
 * template: an approval lists any conditions; a denial stays neutral, names
 * no reason, and tells them they can ask for it. The reason itself is kept
 * with the leasing team for consistency and audit.
 */

const Input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    id: z.string().min(1),
    conditions: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
    note: z.string().max(2000).default(''),
    notifyApplicant: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('deny'),
    id: z.string().min(1),
    reason: z.enum(DENIAL_REASONS, { errorMap: () => ({ message: 'Choose the reason for this decision.' }) }),
    note: z.string().max(2000).default(''),
    notifyApplicant: z.boolean().default(true),
  }),
  z.object({ action: z.literal('withdraw'), id: z.string().min(1), note: z.string().max(2000).default('') }),
  z.object({ action: z.literal('reopen'), id: z.string().min(1), note: z.string().max(2000).default('') }),
]);

export default createEndpoint({
  description: 'Approve, deny, withdraw or reopen a rental application',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const r = await loadApplicationRecord({ id: data.id });
    const status = String(r.status);
    const label = appLabel(r);
    const settings = await getSettings();
    const now = new Date().toISOString();
    const name = str(r.applicantName) ?? 'Applicant';
    const listingTitle = str(r.listingTitle) || 'the home you applied for';
    const context_ = { application_number: label, listing_title: listingTitle, applicant_name: name };
    let emailed: string | null = null;
    let summary = '';
    const record: Record<string, unknown> = { lastActivityAt: now };

    if (status === 'Leased') throw new ZiteError(`${label} already has a signed lease, so its decision can’t change.`, 'CONFLICT');

    if (data.action === 'approve') {
      if (!['Submitted', 'Screening'].includes(status)) throw new ZiteError(`${label} is ${status.toLowerCase()}. Reopen it before approving.`, 'CONFLICT');
      const conditions = [...new Set(data.conditions)];
      Object.assign(record, {
        status: 'Approved',
        decidedAt: now,
        decidedById: actor.id,
        decisionReason: [conditions.length ? `Conditions: ${conditions.join('; ')}` : 'Approved', data.note.trim()].filter(Boolean).join(' — ').slice(0, 2000),
      });
      summary = conditions.length ? `approved the application with conditions: ${conditions.join('; ')}` : 'approved the application';
      await zite.applications.update({ id: data.id, record: record as never });
      if (data.notifyApplicant) {
        const extra = conditions.length ? `This approval comes with ${conditions.length === 1 ? 'a condition' : 'a few conditions'}:\n${conditions.map(c => `• ${c}`).join('\n')}` : null;
        const sent = await sendDecisionEmail({ trigger: 'Application approved', settings, app: r, context: context_, extra, senderMemberId: actor.id, senderName: actor.name }).catch(e => {
          console.error('Approval email failed', e instanceof Error ? e.message : e);
          return null;
        });
        emailed = sent?.delivery ?? null;
      }
    } else if (data.action === 'deny') {
      if (!['Submitted', 'Screening', 'Approved'].includes(status)) throw new ZiteError(`${label} is ${status.toLowerCase()}. Reopen it before changing the decision.`, 'CONFLICT');
      Object.assign(record, {
        status: 'Denied',
        decidedAt: now,
        decidedById: actor.id,
        decisionReason: [data.reason, data.note.trim()].filter(Boolean).join(' — ').slice(0, 2000),
      });
      summary = `denied the application (${data.reason.charAt(0).toLowerCase()}${data.reason.slice(1)})`;
      await zite.applications.update({ id: data.id, record: record as never });
      if (data.notifyApplicant) {
        const sent = await sendDecisionEmail({
          trigger: 'Application denied',
          settings,
          app: r,
          context: context_,
          extra: 'You can ask us for the specific reason for this decision within 60 days — reply to this email or send us a message from your application page.',
          senderMemberId: actor.id,
          senderName: actor.name,
        }).catch(e => {
          console.error('Denial email failed', e instanceof Error ? e.message : e);
          return null;
        });
        emailed = sent?.delivery ?? null;
      }
    } else if (data.action === 'withdraw') {
      if (!['Submitted', 'Screening', 'Approved'].includes(status)) throw new ZiteError(`${label} is ${status.toLowerCase()} and can’t be withdrawn.`, 'CONFLICT');
      Object.assign(record, { status: 'Withdrawn', decidedAt: now, decidedById: actor.id, decisionReason: (data.note.trim() || 'Withdrawn by the leasing team').slice(0, 2000) });
      summary = data.note.trim() ? `withdrew the application: ${data.note.trim().slice(0, 120)}` : 'withdrew the application';
      await zite.applications.update({ id: data.id, record: record as never });
    } else {
      if (!['Approved', 'Denied', 'Withdrawn'].includes(status)) throw new ZiteError(`${label} is still open.`, 'CONFLICT');
      const started = screeningDone(normalizeScreening(r.screening)) > 0;
      Object.assign(record, { status: started ? 'Screening' : 'Submitted', decidedAt: null, decidedById: null, decisionReason: null });
      summary = data.note.trim() ? `reopened the application: ${data.note.trim().slice(0, 120)}` : 'reopened the application';
      await zite.applications.update({ id: data.id, record: record as never });
    }

    await logActivity({
      entityType: 'application',
      entityId: data.id,
      applicationId: data.id,
      propertyId: ref(r.propertyId),
      unitId: ref(r.unitId),
      action: data.action === 'reopen' ? 'reopened' : data.action === 'withdraw' ? 'withdrawn' : data.action === 'approve' ? 'approved' : 'denied',
      summary,
      actorId: actor.id,
      actorName: actor.name,
      data: { from: status, to: record.status, emailed },
    });

    const assignee = ref(r.assigneeId);
    if (assignee && assignee !== actor.id && (data.action === 'approve' || data.action === 'deny')) {
      await notify({
        recipientIds: [assignee],
        kind: 'application_submitted',
        title: `${actor.name} ${data.action === 'approve' ? 'approved' : 'denied'} ${label}`,
        body: `${name} · ${listingTitle}`,
        link: `/applications/${r.number}`,
        entityType: 'application',
        entityId: data.id,
        actorId: actor.id,
        actorName: actor.name,
      });
    }

    // Approving one application for a home leaves the others waiting on a decision.
    const { rows: others } = ref(r.unitId) && data.action === 'approve'
      ? await zite.sql({
          query: `SELECT "number", "applicantName", "status" FROM "Applications" WHERE "unitId" = $1 AND id::text <> $2 AND "status" IN ('Submitted', 'Screening', 'Approved') ORDER BY "number" ASC LIMIT 20`,
          params: [String(r.unitId), data.id],
        })
      : { rows: [] };

    return {
      status: String(record.status),
      emailed,
      otherOpen: others.map(o => ({ number: numOrNull(o.number), reference: applicationRef(numOrNull(o.number)), applicantName: str(o.applicantName) ?? '', status: String(o.status) })),
    };
  },
});
