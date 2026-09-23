import { zite } from 'zitejs/db';
import { chunked, withRetry } from './sql';

/**
 * The staff Inbox.
 *
 * The actor never notifies themselves and recipients are de-duplicated, so a
 * caller can pass "everyone who might care" without filtering first. `link`
 * is an in-app hash route (`/work-orders/1042`), never a full URL.
 */

export type NotificationKind =
  | 'work_order_created'
  | 'work_order_assigned'
  | 'work_order_updated'
  | 'work_order_message'
  | 'work_order_approval'
  | 'payment_received'
  | 'payment_failed'
  | 'application_submitted'
  | 'application_withdrawn'
  | 'application_assigned'
  | 'application_decided'
  | 'showing_booked'
  | 'inquiry_received'
  | 'lease_signed'
  | 'lease_expiring'
  | 'renewal_response'
  | 'notice_given'
  | 'message_received'
  | 'task_assigned'
  | 'task_due'
  | 'mention'
  | 'bill_due'
  | 'invoice_submitted'
  | 'vendor_document'
  | 'insurance_expiring'
  | 'inspection_due'
  | 'automation';

export async function notify(n: {
  recipientIds: Array<string | null | undefined>;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const recipients = [...new Set(n.recipientIds.filter(Boolean) as string[])].filter(id => id !== n.actorId);
  if (!recipients.length) return 0;
  try {
    await chunked(recipients, async batch => {
      await withRetry(() => zite.notifications.bulkCreate({
        records: batch.map(memberId => ({
          title: n.title.slice(0, 240),
          body: n.body ? n.body.slice(0, 2000) : null,
          memberId,
          kind: n.kind,
          link: n.link ?? null,
          entityType: n.entityType ?? null,
          entityId: n.entityId ?? null,
          actorId: n.actorId ?? null,
          actorName: n.actorName ?? null,
        })),
      }));
    });
  } catch (e) {
    console.error('Notification write failed', e instanceof Error ? e.message : e);
    return 0;
  }
  return recipients.length;
}

/** `@[Name](memberId)` tokens written by the mention composer. */
export function mentionedIds(body: string) {
  const ids = new Set<string>();
  for (const m of body.matchAll(/@\[[^\]]+\]\(([^)\s]+)\)/g)) ids.add(m[1]);
  return [...ids];
}

/** Mentions rendered as plain names, for previews and emails. */
export function plainMentions(body: string) {
  return body.replace(/@\[([^\]]+)\]\([^)\s]+\)/g, '@$1');
}
