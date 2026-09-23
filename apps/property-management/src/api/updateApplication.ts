import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { SCREENING_CHECKS, SCREENING_RESULTS } from '@project/shared/constants';
import { formatDay } from '@project/shared/dates';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { notify } from '@project/shared/server/notify';
import { ref, str } from '@project/shared/server/sql';
import { normalizeScreening } from '../components/leasing/rules';
import { parseInput } from '../server/input';
import { appLabel, loadApplicationRecord } from '../server/leasing';

/**
 * Everyday changes to one or many applications: moving between Submitted and
 * Screening, assigning, the desired move-in date, recording the fee as paid,
 * and the screening checklist. Approving, denying and withdrawing are
 * decisions with their own endpoint (`decideApplication`) — they send email
 * and can't happen by dragging a card.
 */

const Patch = z.object({
  status: z.enum(['Submitted', 'Screening']).optional(),
  assigneeId: z.string().nullable().optional(),
  desiredMoveIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid move-in date.').nullable().optional(),
  screeningNotes: z.string().max(5000).optional(),
  feePaid: z.boolean().optional(),
});

const Screening = z.object({
  key: z.enum(SCREENING_CHECKS.map(c => c.key) as [string, ...string[]]),
  result: z.enum(SCREENING_RESULTS),
  note: z.string().max(1000).optional(),
});

const Input = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  patch: Patch.default({}),
  screening: Screening.optional(),
});

export default createEndpoint({
  description: 'Update status, assignee, move-in date, fee or screening on applications',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const { ids, patch, screening } = parseInput(Input, input);
    if (screening && ids.length > 1) throw new ZiteError('Record screening results one application at a time.', 'BAD_REQUEST');

    let assigneeName: string | null = null;
    if (patch.assigneeId) {
      const { rows } = await zite.sql({ query: `SELECT "name", "status" FROM "Members" WHERE id::text = $1`, params: [patch.assigneeId] });
      if (!rows[0] || rows[0].status === 'Deactivated') throw new ZiteError('That teammate isn’t active anymore.', 'BAD_REQUEST');
      assigneeName = str(rows[0].name) ?? 'a teammate';
    }

    const now = new Date().toISOString();
    let updated = 0;
    // Sequential on purpose: the platform refuses bursts of parallel writes.
    for (const id of ids) {
      const r = await loadApplicationRecord({ id });
      const status = String(r.status);
      const label = appLabel(r);
      const record: Record<string, unknown> = {};
      const summaries: Array<{ summary: string; action: string; data?: Record<string, unknown> }> = [];

      if (patch.status && patch.status !== status) {
        if (!['Submitted', 'Screening'].includes(status)) {
          if (ids.length > 1) continue;
          throw new ZiteError(`${label} is ${status.toLowerCase()}. Reopen it before changing its status.`, 'CONFLICT');
        }
        record.status = patch.status;
        summaries.push({ summary: patch.status === 'Screening' ? 'started screening' : 'moved it back to Submitted', action: 'status_changed', data: { from: status, to: patch.status } });
      }
      if (patch.assigneeId !== undefined && (ref(r.assigneeId) ?? null) !== (patch.assigneeId ?? null)) {
        record.assigneeId = patch.assigneeId;
        summaries.push({ summary: patch.assigneeId ? (patch.assigneeId === actor.id ? 'took the application' : `assigned it to ${assigneeName}`) : 'unassigned it', action: 'updated' });
      }
      if (patch.desiredMoveIn !== undefined && (String(r.desiredMoveIn ?? '').slice(0, 10) || null) !== patch.desiredMoveIn) {
        record.desiredMoveIn = patch.desiredMoveIn;
        summaries.push({ summary: patch.desiredMoveIn ? `set the move-in date to ${formatDay(patch.desiredMoveIn)}` : 'cleared the move-in date', action: 'updated' });
      }
      if (patch.screeningNotes !== undefined && (str(r.screeningNotes) ?? '') !== patch.screeningNotes) {
        record.screeningNotes = patch.screeningNotes;
        summaries.push({ summary: 'updated the screening notes', action: 'updated' });
      }
      if (patch.feePaid !== undefined && Boolean(r.feePaidAt) !== patch.feePaid) {
        record.feePaidAt = patch.feePaid ? now : null;
        summaries.push({ summary: patch.feePaid ? 'recorded the application fee as paid' : 'marked the application fee unpaid', action: 'updated' });
      }
      if (screening) {
        if (status === 'Leased') throw new ZiteError(`${label} is already leased, so its screening is locked.`, 'CONFLICT');
        const checks = normalizeScreening(r.screening);
        const check = checks.find(c => c.key === screening.key)!;
        const note = screening.note === undefined ? check.note : screening.note.trim();
        if (check.result !== screening.result || check.note !== note) {
          const resultChanged = check.result !== screening.result;
          check.result = screening.result;
          check.note = note;
          check.byId = actor.id;
          check.byName = actor.name;
          check.at = now;
          record.screening = JSON.stringify(checks);
          summaries.push({
            summary: resultChanged ? `marked “${check.label}” as ${screening.result === 'Pending' ? 'pending' : screening.result === 'Pass' ? 'passed' : screening.result === 'Fail' ? 'failed' : screening.result === 'Concern' ? 'a concern' : 'waived'}` : `added a note to “${check.label}”`,
            action: 'screening',
            data: { key: check.key, result: screening.result },
          });
          // Recording the first result is screening, whether or not someone moved the card.
          if (status === 'Submitted' && screening.result !== 'Pending' && !record.status) {
            record.status = 'Screening';
            summaries.push({ summary: 'started screening', action: 'status_changed', data: { from: 'Submitted', to: 'Screening' } });
          }
        }
      }

      if (!Object.keys(record).length) continue;
      record.lastActivityAt = now;
      await zite.applications.update({ id, record: record as never });
      updated++;
      await logActivity(
        // A millisecond apart, so the timeline keeps the order things happened in.
        summaries.map((s, i) => ({
          occurredAt: new Date(Date.parse(now) + i).toISOString(),
          entityType: 'application' as const,
          entityId: id,
          applicationId: id,
          propertyId: ref(r.propertyId),
          unitId: ref(r.unitId),
          action: s.action,
          summary: s.summary,
          actorId: actor.id,
          actorName: actor.name,
          data: s.data,
        })),
      );
      if (record.assigneeId && record.assigneeId !== actor.id) {
        await notify({
          recipientIds: [String(record.assigneeId)],
          kind: 'application_submitted',
          title: `${actor.name} assigned you ${label}`,
          body: `${str(r.applicantName) ?? 'Applicant'}${r.listingTitle ? ` · ${String(r.listingTitle)}` : ''}`,
          link: `/applications/${r.number}`,
          entityType: 'application',
          entityId: id,
          actorId: actor.id,
          actorName: actor.name,
        });
      }
    }
    return { updated };
  },
});
