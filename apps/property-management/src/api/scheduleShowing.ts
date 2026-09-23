import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { firstName } from '@project/shared/merge';
import { logActivity } from '@project/shared/server/activity';
import { assertCan, getActor } from '@project/shared/server/actor';
import { ensureTask } from '@project/shared/server/automation';
import { sendEmail } from '@project/shared/server/email';
import { notify } from '@project/shared/server/notify';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { loadInquiry, recordInquiryMessage } from '../server/leasing';

/**
 * Book (or cancel) a showing for a lead. Booking sets the lead's showing
 * time and status, puts a Leasing task on the calendar of whoever is showing
 * the home, and — unless asked not to — emails the lead the time and place.
 * Rescheduling cancels the earlier showing's task.
 */

const Input = z.object({
  inquiryId: z.string().min(1),
  showingAt: z.string().nullable(),
  assigneeId: z.string().nullable().optional(),
  notifyLead: z.boolean().default(true),
  message: z.string().max(3000).optional(),
});

export default createEndpoint({
  description: 'Schedule, reschedule or cancel a showing for a lead',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'leasing.manage');
    const data = parseInput(Input, input);
    const inquiry = await loadInquiry(data.inquiryId);
    const settings = await getSettings();
    const now = new Date();
    const prefix = `showing:${inquiry.id}:`;
    const { rows: open } = await zite.sql({ query: `SELECT id, "systemKey" FROM "Tasks" WHERE "systemKey" LIKE $1 AND "status" IN ('To do', 'In progress')`, params: [`${prefix}%`] });

    const { rows: where } = await zite.sql({
      query: `SELECT p."name" AS "propertyName", p."street", p."city", p."state", u."name" AS "unitName" FROM "Properties" p LEFT JOIN "Units" u ON u.id::text = $2 WHERE p.id::text = $1`,
      params: [inquiry.propertyId ?? '', inquiry.unitId ?? ''],
    });
    const place = where[0];
    const address = place ? [str(place.street), [str(place.city), str(place.state)].filter(Boolean).join(', ')].filter(Boolean).join(', ') : '';
    const homeName = inquiry.listingTitle ?? (place ? [str(place.propertyName), str(place.unitName)].filter(Boolean).join(' ') : 'the home');

    if (!data.showingAt) {
      if (!inquiry.showingAt && !open.length) return { status: inquiry.status, taskId: null, delivery: null };
      for (const t of open) await zite.tasks.update({ id: String(t.id), record: { status: 'Canceled', completedAt: now.toISOString() } });
      await zite.inquiries.update({ id: inquiry.id, record: { showingAt: null, ...(inquiry.status === 'Showing scheduled' ? { status: 'Contacted' } : {}) } });
      await logActivity({ entityType: 'inquiry', entityId: inquiry.id, action: 'showing_canceled', summary: 'canceled the showing', actorId: actor.id, actorName: actor.name, propertyId: inquiry.propertyId, unitId: inquiry.unitId });
      return { status: inquiry.status === 'Showing scheduled' ? 'Contacted' : inquiry.status, taskId: null, delivery: null };
    }

    const at = new Date(data.showingAt);
    if (Number.isNaN(at.getTime())) throw new ZiteError('Choose a valid date and time for the showing.', 'BAD_REQUEST');
    if (at.getTime() < now.getTime() - 60 * 60 * 1000) throw new ZiteError('Choose a showing time that hasn’t passed.', 'BAD_REQUEST');
    const iso = at.toISOString();
    const assigneeId = data.assigneeId === undefined ? inquiry.assigneeId ?? actor.id : data.assigneeId;
    if (assigneeId) {
      const { rows } = await zite.sql({ query: `SELECT "status" FROM "Members" WHERE id::text = $1`, params: [assigneeId] });
      if (!rows[0] || rows[0].status === 'Deactivated') throw new ZiteError('That teammate isn’t active anymore.', 'BAD_REQUEST');
    }

    const when = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(at);
    const dueDate = todayIn(settings.timezone, at);

    // Rescheduling: the old showing's task is canceled; the new one gets its own key.
    for (const t of open) if (t.systemKey !== `${prefix}${iso}`) await zite.tasks.update({ id: String(t.id), record: { status: 'Canceled', completedAt: now.toISOString() } });
    const taskId = await ensureTask({
      systemKey: `${prefix}${iso}`,
      title: `Show ${homeName} to ${inquiry.name}`,
      description: [`Showing ${when}.`, address ? `Address: ${address}` : '', inquiry.phone ? `Phone: ${inquiry.phone}` : '', inquiry.email ? `Email: ${inquiry.email}` : '', inquiry.message ? `\nThey wrote: “${inquiry.message.slice(0, 600)}”` : ''].filter(Boolean).join('\n'),
      category: 'Leasing',
      priority: 'Normal',
      dueDate,
      assigneeId,
      propertyId: inquiry.propertyId,
      unitId: inquiry.unitId,
    });

    await zite.inquiries.update({
      id: inquiry.id,
      record: {
        showingAt: iso,
        assigneeId,
        ...(data.notifyLead && inquiry.email ? { lastContactedAt: now.toISOString() } : {}),
        ...(inquiry.status === 'Applied' ? {} : { status: 'Showing scheduled' }),
      },
    });
    await logActivity({
      entityType: 'inquiry',
      entityId: inquiry.id,
      action: 'showing_scheduled',
      summary: `${inquiry.showingAt ? 'rescheduled the showing' : 'scheduled a showing'} for ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(at)}`,
      actorId: actor.id,
      actorName: actor.name,
      propertyId: inquiry.propertyId,
      unitId: inquiry.unitId,
      data: { showingAt: iso, taskId },
    });
    if (assigneeId && assigneeId !== actor.id) {
      await notify({ recipientIds: [assigneeId], kind: 'task_assigned', title: `${actor.name} booked you a showing: ${homeName}`, body: `${inquiry.name} · ${when}`, link: '/tasks', entityType: 'inquiry', entityId: inquiry.id, actorId: actor.id, actorName: actor.name });
    }

    let delivery: string | null = null;
    if (data.notifyLead && inquiry.email) {
      const subject = `${inquiry.showingAt ? 'Your showing has moved' : 'Your showing is booked'}: ${homeName}`;
      const body = [
        `Hi ${firstName(inquiry.name) || 'there'},`,
        `${inquiry.showingAt ? 'We’ve moved your showing of' : 'You’re booked to see'} ${homeName} on ${when}.${address ? ` The address is ${address}.` : ''}`,
        data.message?.trim() ?? '',
        `If that time no longer works, reply to this email and we’ll find another.`,
      ].filter(Boolean).join('\n\n');
      delivery = await sendEmail({ to: inquiry.email, subject, text: body, settings });
      await recordInquiryMessage({ inquiry, direction: 'Outbound', subject, body, delivery, senderMemberId: actor.id, senderName: actor.name });
    }
    return { status: inquiry.status === 'Applied' ? 'Applied' : 'Showing scheduled', taskId, delivery };
  },
});
