import { zite } from 'zitejs/db';
import { activityFor, type ActivityRow } from '@project/shared/server/activity';
import { iso, json, ref, str } from '@project/shared/server/sql';

/**
 * Timeline data for record pages, in the shapes the <Timeline> component
 * takes. Endpoints return `activity` and `messages` from these helpers so every
 * page's history reads the same way.
 */

export type TimelineMessageDto = {
  id: string;
  subject: string;
  body: string;
  direction: string;
  channel: string;
  senderMemberId: string | null;
  senderName: string | null;
  delivery: string | null;
  sentAt: string;
  attachments: Array<{ name: string; url: string }>;
  counterpart: string | null;
  tenantId: string | null;
  ownerId: string | null;
  vendorId: string | null;
  applicationId: string | null;
  readAt: string | null;
};

export function toTimelineMessage(r: Record<string, unknown>): TimelineMessageDto {
  return {
    id: String(r.id),
    subject: str(r.subject) ?? '',
    body: str(r.body) ?? '',
    direction: str(r.direction) || 'Outbound',
    channel: str(r.channel) || 'Email',
    senderMemberId: ref(r.senderMemberId),
    senderName: ref(r.senderName),
    delivery: ref(r.delivery),
    sentAt: iso(r.sentAt) ?? iso(r.created_at) ?? new Date().toISOString(),
    attachments: json<Array<{ name: string; url: string }>>(r.attachments, []),
    counterpart: ref(r.counterpart),
    tenantId: ref(r.tenantId),
    ownerId: ref(r.ownerId),
    vendorId: ref(r.vendorId),
    applicationId: ref(r.applicationId),
    readAt: iso(r.readAt),
  };
}

/** Messages on a thread or linked to a record, oldest first, with the other party's name resolved. */
export async function messagesWhere(clause: string, params: unknown[], limit = 300) {
  const { rows } = await zite.sql({
    query: `
      SELECT m.*, COALESCE(NULLIF(t."name", ''), NULLIF(o."name", ''), NULLIF(v."name", ''), NULLIF(a."applicantName", '')) AS "counterpart"
      FROM "Messages" m
      LEFT JOIN "Tenants" t ON t.id::text = m."tenantId"
      LEFT JOIN "Owners" o ON o.id::text = m."ownerId"
      LEFT JOIN "Vendors" v ON v.id::text = m."vendorId"
      LEFT JOIN "Applications" a ON a.id::text = m."applicationId"
      WHERE ${clause}
      ORDER BY m."sentAt" ASC NULLS LAST, m.created_at ASC
      LIMIT ${Math.min(1000, limit)}`,
    params,
  });
  return rows.map(toTimelineMessage);
}

export function toTimelineActivity(a: ActivityRow) {
  return { id: a.id, summary: a.summary, actorId: a.actorId, actorName: a.actorName, action: a.action, occurredAt: a.occurredAt };
}

export async function timelineActivity(column: Parameters<typeof activityFor>[0], id: string, limit = 150) {
  return (await activityFor(column, id, limit)).map(toTimelineActivity).reverse();
}
