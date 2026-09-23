import { Email } from 'zitejs/email';
import { zite } from 'zitejs/db';
import type { TemplateTrigger } from '../constants';
import { renderMerge, type MergeContext } from '../merge';
import { portalLink, staffLink, type OrgSettings } from './settings';
import { str, withRetry } from './sql';

/**
 * Email and the conversation record.
 *
 * Every message to a tenant, owner, vendor or applicant is also a row in
 * Messages, so the staff app and the portal show the same conversation whether
 * or not the email was delivered. A failed send is recorded as Failed rather
 * than thrown: the payment, work order or decision it accompanied still happened.
 */

export type PersonKind = 'tenant' | 'owner' | 'vendor' | 'applicant';

export type Recipient = { kind: PersonKind; id: string; name: string; email: string | null };

/** Conversations group by person, except work orders, which have their own thread with everyone involved. */
export const threadKey = (kind: PersonKind | 'work_order' | 'inquiry', id: string) => `${kind}:${id}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Block = { type: 'text'; content: string } | { type: 'button'; label: string; href: string; alignment?: 'left' } | { type: 'divider' } | { type: 'spacer'; height: number };

function toBlocks(text: string, settings: OrgSettings, button?: { label: string; href: string } | null, signature = true): Block[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const blocks: Block[] = paragraphs.map(p => ({ type: 'text', content: p }));
  if (button?.href && /^https:\/\//.test(button.href)) blocks.push({ type: 'spacer', height: 4 }, { type: 'button', label: button.label, href: button.href, alignment: 'left' });
  const sig = signature ? settings.emailSignature.trim() : '';
  if (sig) blocks.push({ type: 'divider' }, { type: 'text', content: sig });
  return blocks;
}

export async function sendEmail(input: { to: string | null | undefined; subject: string; text: string; settings: OrgSettings; button?: { label: string; href: string } | null; signature?: boolean }): Promise<'Sent' | 'Failed'> {
  const to = (input.to ?? '').trim();
  if (!EMAIL_RE.test(to)) return 'Failed';
  try {
    const res = await Email.send({
      to,
      subject: input.subject.slice(0, 200),
      body: toBlocks(input.text, input.settings, input.button, input.signature ?? true) as never,
      ...(input.settings.supportEmail ? { replyTo: input.settings.supportEmail } : {}),
      ...(input.settings.logoUrl && /^https:\/\//.test(input.settings.logoUrl) ? { logo: { url: input.settings.logoUrl, height: 36 } } : {}),
    } as never);
    return (res as { success?: boolean })?.success === false ? 'Failed' : 'Sent';
  } catch (e) {
    console.error('Email send failed', e instanceof Error ? e.message : e);
    return 'Failed';
  }
}

export type MessageLinks = {
  leaseId?: string | null;
  workOrderId?: string | null;
  propertyId?: string | null;
  applicationId?: string | null;
  announcementId?: string | null;
};

/**
 * Write a message to someone's conversation and, when asked, email it. With
 * `deliver: false` it is portal-only — they see it next time they sign in.
 */
export async function messagePerson(input: MessageLinks & {
  settings: OrgSettings;
  recipient: Recipient;
  subject: string;
  body: string;
  deliver: boolean;
  senderMemberId?: string | null;
  senderName?: string | null;
  templateId?: string | null;
  button?: { label: string; href: string } | null;
  attachments?: Array<{ name: string; url: string }>;
  /** Defaults to the person's own thread; work order messages pass the work order's. */
  thread?: string;
}) {
  const r = input.recipient;
  const portalHome = portalLink(input.settings);
  const delivery = input.deliver
    ? await sendEmail({
        to: r.email,
        subject: input.subject,
        text: input.body,
        settings: input.settings,
        button: input.button ?? (portalHome ? { label: 'Open the portal', href: portalHome } : null),
      })
    : 'Portal only';
  const now = new Date().toISOString();
  const created = await withRetry(() => zite.messages.create({
    record: {
      subject: input.subject.slice(0, 240),
      body: input.body,
      thread: input.thread ?? threadKey(r.kind, r.id),
      direction: 'Outbound',
      channel: input.deliver ? 'Email' : 'Portal',
      tenantId: r.kind === 'tenant' ? r.id : null,
      ownerId: r.kind === 'owner' ? r.id : null,
      vendorId: r.kind === 'vendor' ? r.id : null,
      // Only an applicant's own messages carry an application id: the applicant portal lists every message that does.
      applicationId: r.kind === 'applicant' ? r.id : null,
      leaseId: input.leaseId ?? null,
      workOrderId: input.workOrderId ?? null,
      propertyId: input.propertyId ?? null,
      announcementId: input.announcementId ?? null,
      senderMemberId: input.senderMemberId ?? null,
      senderName: input.senderName ?? input.settings.organizationName,
      delivery,
      templateId: input.templateId ?? null,
      attachments: input.attachments?.length ? JSON.stringify(input.attachments) : null,
      sentAt: now,
    },
  }));
  return { id: created.id, delivery, sentAt: now };
}

export type TemplateRow = { id: string; name: string; trigger: TemplateTrigger; audience: string; subject: string; body: string; enabled: boolean };

export async function findTemplate(trigger: TemplateTrigger, opts: { requireEnabled?: boolean } = { requireEnabled: true }): Promise<TemplateRow | null> {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "EmailTemplates" WHERE "trigger" = $1 ${opts.requireEnabled ? 'AND COALESCE("enabled", false) = true' : ''} ORDER BY COALESCE("position", 0) ASC, created_at ASC LIMIT 1`,
    params: [trigger],
  });
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    trigger: String(r.trigger) as TemplateTrigger,
    audience: str(r.audience) ?? 'Tenant',
    subject: str(r.subject) ?? '',
    body: str(r.body) ?? '',
    enabled: r.enabled === true,
  };
}

/** The organization-level merge values every email can use. */
export function orgMergeContext(settings: OrgSettings): MergeContext {
  return {
    organization_name: settings.organizationName,
    office_phone: settings.phone,
    support_email: settings.supportEmail ?? '',
    emergency_phone: settings.emergencyPhone || settings.phone,
    portal_link: portalLink(settings),
  };
}

/**
 * Send the organization's template for an event, if it has one switched on.
 * Returns null when there is nothing to send — callers never need to check first.
 */
export async function sendTriggered(input: MessageLinks & {
  trigger: TemplateTrigger;
  settings: OrgSettings;
  recipient: Recipient;
  context: MergeContext;
  senderMemberId?: string | null;
  button?: { label: string; href: string } | null;
  thread?: string;
  deliver?: boolean;
}) {
  const template = await findTemplate(input.trigger);
  if (!template) return null;
  const ctx: MergeContext = {
    ...orgMergeContext(input.settings),
    recipient_name: input.recipient.name,
    recipient_first_name: input.recipient.name.trim().split(/\s+/)[0] || 'there',
    ...input.context,
  };
  return messagePerson({
    settings: input.settings,
    recipient: input.recipient,
    subject: renderMerge(template.subject, ctx),
    body: renderMerge(template.body, ctx),
    deliver: input.deliver ?? true,
    senderMemberId: input.senderMemberId ?? null,
    templateId: template.id,
    button: input.button,
    thread: input.thread,
    leaseId: input.leaseId,
    workOrderId: input.workOrderId,
    propertyId: input.propertyId,
    applicationId: input.applicationId,
    announcementId: input.announcementId,
  });
}

/** Email a staff member (assignments, approvals, digests). Best-effort, no conversation record. */
export async function emailMember(input: { settings: OrgSettings; to: string; subject: string; text: string; hashPath?: string | null; linkLabel?: string }) {
  const href = input.hashPath ? staffLink(input.settings, input.hashPath) : '';
  return sendEmail({
    to: input.to,
    subject: input.subject,
    text: input.text,
    settings: input.settings,
    signature: false,
    button: href ? { label: input.linkLabel ?? 'Open in your workspace', href } : null,
  });
}

/** Tenants on a lease who can receive email, primary first. */
export async function leaseRecipients(leaseId: string): Promise<Recipient[]> {
  const { rows } = await zite.sql({
    query: `
      SELECT t.id, t."name", t."email", lt."role" FROM "LeaseTenants" lt
      JOIN "Tenants" t ON t.id::text = lt."tenantId"
      WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant')
      ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, lt.created_at ASC`,
    params: [leaseId],
  });
  return rows.map(r => ({ kind: 'tenant' as const, id: String(r.id), name: str(r.name) ?? 'Resident', email: str(r.email) || null }));
}
