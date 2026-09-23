import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { applicationRef, workOrderRef } from '@project/shared/leases';
import { MERGE_TAGS, firstName, formatAddress, joinNames, ordinal, renderMerge, type MergeContext } from '@project/shared/merge';
import { formatMoney } from '@project/shared/money';
import { orgMergeContext, sendEmail, threadKey, type MessageLinks, type PersonKind, type Recipient } from '@project/shared/server/email';
import { leaseBalances } from '@project/shared/server/ledger';
import { lateFeeFor, portalLink, type OrgSettings } from '@project/shared/server/settings';
import { json, num, numOrNull, ref, str, withRetry } from '@project/shared/server/sql';
import { toTimelineMessage } from './timeline';

/**
 * Conversations on the server: thread keys, the people on the other end
 * (looked up by id — a client never supplies an email address), merge tags
 * rendered per person, and the one writer for outbound messages.
 *
 * A thread is `tenant:<id>`, `owner:<id>`, `vendor:<id>`, `applicant:<applicationId>`
 * or `work_order:<id>` — the same keys the portal reads, so a resident's
 * portal conversation and the staff thread are one conversation.
 */

export const PERSON_KINDS = ['tenant', 'owner', 'vendor', 'applicant'] as const;
export const THREAD_KINDS = ['tenant', 'owner', 'vendor', 'applicant', 'work_order'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

const THREAD_RE = /^(tenant|owner|vendor|applicant|work_order):([A-Za-z0-9-]{1,64})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseThread(key: string | null | undefined): { kind: ThreadKind; id: string; key: string } | null {
  const m = THREAD_RE.exec((key ?? '').trim());
  return m ? { kind: m[1] as ThreadKind, id: m[2], key: `${m[1]}:${m[2]}` } : null;
}

export function requireThread(key: string | null | undefined) {
  const t = parseThread(key);
  if (!t) throw new ZiteError('That conversation link isn’t valid.', 'NOT_FOUND');
  return t;
}

/**
 * The thread a message belongs to. Rows written without a thread key (older
 * code paths) still land in the right conversation by their links.
 */
export const threadSql = (m = 'm') => `COALESCE(NULLIF(${m}."thread", ''), CASE
  WHEN COALESCE(${m}."workOrderId", '') <> '' THEN 'work_order:' || ${m}."workOrderId"
  WHEN COALESCE(${m}."tenantId", '') <> '' THEN 'tenant:' || ${m}."tenantId"
  WHEN COALESCE(${m}."ownerId", '') <> '' THEN 'owner:' || ${m}."ownerId"
  WHEN COALESCE(${m}."vendorId", '') <> '' THEN 'vendor:' || ${m}."vendorId"
  WHEN COALESCE(${m}."applicationId", '') <> '' THEN 'applicant:' || ${m}."applicationId"
  ELSE '' END)`;

export const isEmail = (v: string | null | undefined) => EMAIL_RE.test((v ?? '').trim());

// ── People ──────────────────────────────────────────────────────────────────

export type Person = Recipient & {
  /** What staff see: "Maya Chen", "Ridgeview Holdings LLC". */
  label: string;
  hasEmail: boolean;
  leaseId: string | null;
  unitId: string | null;
  propertyId: string | null;
  /** Vendor trade, applicant reference — a short hint for chips. */
  hint: string;
};

export const personKey = (kind: PersonKind, id: string) => `${kind}:${id}`;

const uniq = (list: Array<string | null | undefined>) => [...new Set(list.filter(Boolean) as string[])];

/** Look people up by id. Missing ids are simply absent from the map. */
export async function loadPeople(refs: Array<{ kind: PersonKind; id: string }>): Promise<Map<string, Person>> {
  const ids = (k: PersonKind) => uniq(refs.filter(r => r.kind === k).map(r => r.id));
  const tenantIds = ids('tenant');
  const ownerIds = ids('owner');
  const vendorIds = ids('vendor');
  const appIds = ids('applicant');
  const none = { rows: [] as Array<Record<string, unknown>> };
  const [tenants, owners, vendors, apps] = await Promise.all([
    tenantIds.length
      ? zite.sql({
          query: `
            SELECT t.id, t."name", t."email", cl."leaseId", l."unitId", l."propertyId"
            FROM "Tenants" t
            LEFT JOIN (
              SELECT DISTINCT ON (lt."tenantId") lt."tenantId", l2.id::text AS "leaseId"
              FROM "LeaseTenants" lt JOIN "Leases" l2 ON l2.id::text = lt."leaseId"
              WHERE lt."tenantId" = ANY($1)
              ORDER BY lt."tenantId", CASE l2."status" WHEN 'Active' THEN 0 WHEN 'Pending signature' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END, l2."endDate" DESC NULLS LAST
            ) cl ON cl."tenantId" = t.id::text
            LEFT JOIN "Leases" l ON l.id::text = cl."leaseId"
            WHERE t.id::text = ANY($1)`,
          params: [tenantIds],
        })
      : none,
    ownerIds.length ? zite.sql({ query: `SELECT id, "name", "contactName", "email" FROM "Owners" WHERE id::text = ANY($1)`, params: [ownerIds] }) : none,
    vendorIds.length ? zite.sql({ query: `SELECT id, "name", "contactName", "email", "trade" FROM "Vendors" WHERE id::text = ANY($1)`, params: [vendorIds] }) : none,
    appIds.length ? zite.sql({ query: `SELECT id, "applicantName", "email", "portalEmail", "number", "unitId", "propertyId", "leaseId" FROM "Applications" WHERE id::text = ANY($1)`, params: [appIds] }) : none,
  ]);
  const out = new Map<string, Person>();
  for (const r of tenants.rows) {
    const name = str(r.name) || 'Resident';
    const email = str(r.email)?.trim() || null;
    out.set(personKey('tenant', String(r.id)), { kind: 'tenant', id: String(r.id), name, label: name, email, hasEmail: isEmail(email), leaseId: ref(r.leaseId), unitId: ref(r.unitId), propertyId: ref(r.propertyId), hint: '' });
  }
  for (const r of owners.rows) {
    const label = str(r.name) || 'Owner';
    const email = str(r.email)?.trim() || null;
    out.set(personKey('owner', String(r.id)), { kind: 'owner', id: String(r.id), name: str(r.contactName) || label, label, email, hasEmail: isEmail(email), leaseId: null, unitId: null, propertyId: null, hint: str(r.contactName) ?? '' });
  }
  for (const r of vendors.rows) {
    const label = str(r.name) || 'Vendor';
    const email = str(r.email)?.trim() || null;
    out.set(personKey('vendor', String(r.id)), { kind: 'vendor', id: String(r.id), name: str(r.contactName) || label, label, email, hasEmail: isEmail(email), leaseId: null, unitId: null, propertyId: null, hint: str(r.trade) ?? '' });
  }
  for (const r of apps.rows) {
    const name = str(r.applicantName) || 'Applicant';
    const email = str(r.email)?.trim() || str(r.portalEmail)?.trim() || null;
    out.set(personKey('applicant', String(r.id)), { kind: 'applicant', id: String(r.id), name, label: name, email, hasEmail: isEmail(email), leaseId: null, unitId: ref(r.unitId), propertyId: ref(r.propertyId), hint: applicationRef(num(r.number)) });
  }
  return out;
}

// ── Merge tags ──────────────────────────────────────────────────────────────

export type MergeLinks = { workOrderId?: string | null; propertyId?: string | null; propertyIds?: string[] | null };

/** Merge values for each person, keyed by `personKey`. Batched: a handful of reads however many people. */
export async function mergeContexts(people: Person[], settings: OrgSettings, links: MergeLinks = {}): Promise<Map<string, MergeContext>> {
  const leaseIds = uniq(people.filter(p => p.kind === 'tenant').map(p => p.leaseId));
  const appIds = uniq(people.filter(p => p.kind === 'applicant').map(p => p.id));
  const ownerIds = uniq(people.filter(p => p.kind === 'owner').map(p => p.id));
  const none = { rows: [] as Array<Record<string, unknown>> };
  const [leases, balances, apps, ownerProps, workOrder, property] = await Promise.all([
    leaseIds.length
      ? zite.sql({
          query: `
            SELECT l.id, l."startDate", l."endDate", l."rent", l."deposit", l."rentDueDay", p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", u."name" AS "unitName",
              (SELECT STRING_AGG(t."name", '|' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END) FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = l.id::text AND lt."role" IN ('Primary', 'Co-tenant')) AS "names"
            FROM "Leases" l LEFT JOIN "Properties" p ON p.id::text = l."propertyId" LEFT JOIN "Units" u ON u.id::text = l."unitId"
            WHERE l.id::text = ANY($1)`,
          params: [leaseIds],
        })
      : none,
    leaseIds.length ? leaseBalances(leaseIds) : Promise.resolve(new Map<string, { balance: number; depositHeld: number }>()),
    appIds.length
      ? zite.sql({
          query: `
            SELECT a.id, a."number", li."title" AS "listingTitle", p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", u."name" AS "unitName"
            FROM "Applications" a LEFT JOIN "Listings" li ON li.id::text = a."listingId" LEFT JOIN "Properties" p ON p.id::text = a."propertyId" LEFT JOIN "Units" u ON u.id::text = a."unitId"
            WHERE a.id::text = ANY($1)`,
          params: [appIds],
        })
      : none,
    ownerIds.length ? zite.sql({ query: `SELECT id, "name", "ownerId" FROM "Properties" WHERE "ownerId" = ANY($1) AND COALESCE("status", '') <> 'Archived' ORDER BY "name"`, params: [ownerIds] }) : none,
    links.workOrderId
      ? zite.sql({
          query: `
            SELECT w."number", w."title", w."status", w."scheduledFor", w."estimateAmount", v."name" AS "vendorName", p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", u."name" AS "unitName"
            FROM "WorkOrders" w LEFT JOIN "Vendors" v ON v.id::text = w."vendorId" LEFT JOIN "Properties" p ON p.id::text = w."propertyId" LEFT JOIN "Units" u ON u.id::text = w."unitId"
            WHERE w.id::text = $1`,
          params: [links.workOrderId],
        })
      : none,
    links.propertyId ? zite.sql({ query: `SELECT "name" FROM "Properties" WHERE id::text = $1`, params: [links.propertyId] }) : none,
  ]);

  const leaseById = new Map(leases.rows.map(r => [String(r.id), r]));
  const appById = new Map(apps.rows.map(r => [String(r.id), r]));
  const money = (n: number | null | undefined) => formatMoney(n ?? 0, settings.currency);
  const base = orgMergeContext(settings);
  const addr = (r: Record<string, unknown>) => formatAddress({ street: str(r.street), city: str(r.city), state: str(r.state), postalCode: str(r.postalCode) }, str(r.unitName));
  const selection = links.propertyIds?.length ? new Set(links.propertyIds) : null;

  const wo = workOrder.rows[0];
  const woCtx: MergeContext = wo
    ? {
        work_order_number: workOrderRef(num(wo.number)),
        work_order_title: str(wo.title) ?? '',
        work_order_status: str(wo.status) ?? '',
        scheduled_for: wo.scheduledFor ? new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(new Date(String(wo.scheduledFor))) : 'to be confirmed',
        vendor_name: str(wo.vendorName) || 'our maintenance team',
        estimate_amount: numOrNull(wo.estimateAmount) != null ? money(num(wo.estimateAmount)) : '',
        property_name: str(wo.propertyName) ?? '',
        unit_name: str(wo.unitName) ?? '',
        unit_address: addr(wo),
      }
    : {};

  const out = new Map<string, MergeContext>();
  for (const p of people) {
    const ctx: MergeContext = {
      ...base,
      recipient_name: p.name,
      recipient_first_name: firstName(p.name) || 'there',
      ...(property.rows[0] ? { property_name: str(property.rows[0].name) ?? '' } : {}),
      ...woCtx,
    };
    if (p.kind === 'tenant' && p.leaseId && leaseById.has(p.leaseId)) {
      const l = leaseById.get(p.leaseId)!;
      const rent = num(l.rent);
      const balance = balances.get(p.leaseId)?.balance ?? 0;
      Object.assign(ctx, {
        property_name: str(l.propertyName) ?? '',
        unit_name: str(l.unitName) ?? '',
        unit_address: addr(l),
        lease_start_date: formatDay(l.startDate ? String(l.startDate).slice(0, 10) : null, 'long'),
        lease_end_date: l.endDate ? formatDay(String(l.endDate).slice(0, 10), 'long') : 'month to month',
        rent_amount: money(rent),
        rent_due_day: ordinal(num(l.rentDueDay, settings.rentDueDay) || settings.rentDueDay),
        deposit_amount: money(num(l.deposit)),
        balance_due: money(Math.max(0, balance)),
        tenant_names: joinNames((str(l.names) ?? '').split('|')),
        late_fee: money(lateFeeFor(settings, rent)),
        grace_period_days: String(settings.gracePeriodDays),
      } as MergeContext);
    }
    if (p.kind === 'applicant' && appById.has(p.id)) {
      const a = appById.get(p.id)!;
      Object.assign(ctx, {
        applicant_name: p.name,
        application_number: applicationRef(num(a.number)),
        listing_title: str(a.listingTitle) || [str(a.propertyName), str(a.unitName)].filter(Boolean).join(' ') || 'your new home',
        property_name: str(a.propertyName) ?? '',
        unit_name: str(a.unitName) ?? '',
        unit_address: str(a.propertyName) ? addr(a) : '',
      } as MergeContext);
    }
    if (p.kind === 'owner') {
      const mine = ownerProps.rows.filter(r => String(r.ownerId) === p.id && (!selection || selection.has(String(r.id))));
      if (mine.length) ctx.property_name = joinNames(mine.map(r => str(r.name)));
    }
    if (p.kind === 'vendor' && !ctx.vendor_name) ctx.vendor_name = p.label;
    out.set(personKey(p.kind, p.id), ctx);
  }
  return out;
}

/** Tags used in the text that have no value for this person — shown as a warning in previews. */
export function missingTags(text: string, ctx: MergeContext) {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    const tag = m[1].toLowerCase();
    const v = (ctx as Record<string, string | undefined>)[tag];
    if (v == null || v === '') found.add(tag);
  }
  return [...found].map(tag => MERGE_TAGS.find(t => t.tag === tag)?.label ?? tag);
}

export const render = (text: string, ctx: MergeContext) => renderMerge(text, ctx);

/** Fill the tags that have a value and leave the rest as `{{tag}}`, for a person to complete before sending. */
export const renderKnown = (text: string, ctx: MergeContext) =>
  (text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, tag: string) => {
    const v = (ctx as Record<string, string | undefined>)[tag.toLowerCase()];
    return v == null || v === '' ? whole : String(v);
  });

// ── Writing ─────────────────────────────────────────────────────────────────

export type Attachment = { name: string; url: string };

/**
 * Email (when asked and possible) then record one outbound message — the same
 * row `messagePerson` writes, with the create retried when the platform rate
 * limits. The email goes first so a failed write can't leave a phantom
 * "Sent" row; the attachments are linked in the email body.
 */
export async function deliverMessage(input: MessageLinks & {
  settings: OrgSettings;
  person: Person;
  subject: string;
  body: string;
  byEmail: boolean;
  senderMemberId: string | null;
  senderName: string | null;
  templateId?: string | null;
  attachments?: Attachment[];
  thread?: string;
  button?: { label: string; href: string } | null;
}) {
  const p = input.person;
  const emailing = input.byEmail && p.hasEmail;
  const files = input.attachments ?? [];
  let delivery: 'Sent' | 'Failed' | 'Portal only' = 'Portal only';
  if (emailing) {
    const home = portalLink(input.settings);
    const text = files.length ? `${input.body}\n\n${files.map(f => `${f.name}: ${f.url}`).join('\n')}` : input.body;
    delivery = await sendEmail({ to: p.email, subject: input.subject, text, settings: input.settings, button: input.button ?? (home ? { label: 'Open the portal', href: home } : null) });
  }
  const now = new Date().toISOString();
  const created = await withRetry(() =>
    zite.messages.create({
      record: {
        subject: input.subject.slice(0, 240),
        body: input.body,
        thread: input.thread ?? threadKey(p.kind, p.id),
        direction: 'Outbound',
        channel: emailing ? 'Email' : 'Portal',
        tenantId: p.kind === 'tenant' ? p.id : null,
        ownerId: p.kind === 'owner' ? p.id : null,
        vendorId: p.kind === 'vendor' ? p.id : null,
        // The applicant portal lists every message carrying its application id, so only messages to the applicant may carry it.
        applicationId: p.kind === 'applicant' ? p.id : null,
        leaseId: input.leaseId ?? (p.kind === 'tenant' ? p.leaseId : null),
        workOrderId: input.workOrderId ?? null,
        propertyId: input.propertyId ?? p.propertyId ?? null,
        announcementId: input.announcementId ?? null,
        senderMemberId: input.senderMemberId,
        senderName: input.senderName ?? input.settings.organizationName,
        delivery,
        templateId: input.templateId ?? null,
        attachments: files.length ? JSON.stringify(files) : null,
        sentAt: now,
      },
    }),
  );
  return { id: created.id, delivery, sentAt: now, thread: input.thread ?? threadKey(p.kind, p.id) };
}

// ── Reading ─────────────────────────────────────────────────────────────────

export type ThreadMessageDto = ReturnType<typeof toThreadMessage>;

export function toThreadMessage(r: Record<string, unknown>) {
  return {
    ...toTimelineMessage(r),
    announcementId: ref(r.announcementId),
    announcementTitle: ref(r.announcementTitle),
    workOrderId: ref(r.workOrderId),
    templateId: ref(r.templateId),
  };
}

export const attachmentsOf = (v: unknown) => json<Attachment[]>(v, []).filter(a => a && typeof a.url === 'string');

/**
 * The resident a work order's messages go to: its own tenant, else the primary
 * tenant on its lease, else whoever from the lease last wrote in its thread.
 * Requests logged against a lease often don't name the tenant.
 */
export async function workOrderResidentId(wo: { id: string; tenantId: string | null; leaseId: string | null }): Promise<string | null> {
  if (wo.tenantId) return wo.tenantId;
  const { rows } = await zite.sql({
    query: `
      SELECT id FROM (
        SELECT lt."tenantId" AS id, 0 AS rank, lt.created_at AS at FROM "LeaseTenants" lt WHERE $2 <> '' AND lt."leaseId" = $2 AND lt."role" = 'Primary'
        UNION ALL
        SELECT m."tenantId" AS id, 1 AS rank, m.created_at AS at FROM "Messages" m WHERE m."thread" = $1 AND COALESCE(m."tenantId", '') <> ''
      ) candidates ORDER BY rank ASC, at DESC LIMIT 1`,
    params: [threadKey('work_order', wo.id), wo.leaseId ?? ''],
  });
  return ref(rows[0]?.id);
}
