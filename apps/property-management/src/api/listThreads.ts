import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { assertCan, getActor } from '@project/shared/server/actor';
import { iso, json, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { threadSql } from '../server/comms';

/**
 * The Messages inbox: one row per conversation — a resident, owner, vendor or
 * applicant, or a work order — newest activity first, with its unread count,
 * the last message and who it's with. Aggregated in SQL and paged by cursor.
 *
 * Announcement copies don't make a thread jump to the top (a notice to 80
 * residents isn't 80 conversations); a reply to one does. Threads with only
 * internal notes aren't conversations and stay on their record.
 */

const FILTERS = ['all', 'unread', 'tenant', 'owner', 'vendor', 'applicant', 'work_order'] as const;

const Input = z.object({
  filter: z.enum(FILTERS).default('all'),
  search: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(200).default(60),
  cursor: z.object({ lastAt: z.string().max(40), thread: z.string().max(100) }).nullish(),
});

const Thread = z.object({
  thread: z.string(),
  kind: z.enum(['tenant', 'owner', 'vendor', 'applicant', 'work_order']),
  refId: z.string(),
  name: z.string(),
  subtitle: z.string(),
  unitId: z.string().nullable(),
  propertyId: z.string().nullable(),
  workOrderNumber: z.number().nullable(),
  workOrderStatus: z.string().nullable(),
  workOrderPriority: z.string().nullable(),
  applicationNumber: z.number().nullable(),
  unread: z.number(),
  messageCount: z.number(),
  lastAt: z.string(),
  last: z.object({
    id: z.string(),
    subject: z.string(),
    snippet: z.string(),
    direction: z.string(),
    channel: z.string(),
    delivery: z.string().nullable(),
    senderName: z.string().nullable(),
    senderMemberId: z.string().nullable(),
    attachments: z.number(),
  }),
  failed: z.number(),
});

export default createEndpoint({
  description: 'List message threads with unread counts and the latest message',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    threads: z.array(Thread),
    nextCursor: z.object({ lastAt: z.string(), thread: z.string() }).nullable(),
    counts: z.object({ all: z.number(), unread: z.number(), tenant: z.number(), owner: z.number(), vendor: z.number(), applicant: z.number(), work_order: z.number() }),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'communications.send');
    const { filter, search, limit, cursor } = parseInput(Input, input);
    const q = (search ?? '').trim();

    // Conversation stats per thread, shared by the page and the tab counts.
    const stats = `
      thread_messages AS (
        SELECT m.*, ${threadSql('m')} AS "threadKey" FROM "Messages" m WHERE COALESCE(m."announcementId", '') = ''
      ),
      thread_stats AS (
        SELECT tm."threadKey",
          split_part(tm."threadKey", ':', 1) AS "kind",
          split_part(tm."threadKey", ':', 2) AS "refId",
          date_trunc('milliseconds', MAX(COALESCE(tm."sentAt", tm.created_at))) AS "lastAt",
          COUNT(*) AS "messageCount",
          SUM(CASE WHEN tm."direction" = 'Inbound' AND tm."readAt" IS NULL THEN 1 ELSE 0 END) AS "unread",
          SUM(CASE WHEN tm."direction" = 'Outbound' AND tm."delivery" = 'Failed' THEN 1 ELSE 0 END) AS "failed"
        FROM thread_messages tm
        WHERE split_part(tm."threadKey", ':', 1) IN ('tenant', 'owner', 'vendor', 'applicant', 'work_order')
        GROUP BY tm."threadKey"
        HAVING SUM(CASE WHEN tm."direction" IN ('Inbound', 'Outbound') THEN 1 ELSE 0 END) > 0
      )`;

    const params: unknown[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where: string[] = [];
    if (filter === 'unread') where.push(`ts."unread" > 0`);
    else if (filter !== 'all') where.push(`ts."kind" = ${add(filter)}`);
    if (q) {
      const like = add(`%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`);
      const woNumber = /^(wo-?)?\s*\d+$/i.test(q) ? Number(q.replace(/\D/g, '')) : -1;
      const n = add(woNumber);
      where.push(`(
        t."name" ILIKE ${like} OR t."email" ILIKE ${like} OR o."name" ILIKE ${like} OR o."contactName" ILIKE ${like}
        OR v."name" ILIKE ${like} OR v."contactName" ILIKE ${like} OR a."applicantName" ILIKE ${like}
        OR w."title" ILIKE ${like} OR w."number" = ${n} OR a."number" = ${n}
        OR EXISTS (SELECT 1 FROM thread_messages s WHERE s."threadKey" = ts."threadKey" AND (s."subject" ILIKE ${like} OR s."body" ILIKE ${like}))
      )`);
    }
    if (cursor) where.push(`(ts."lastAt", ts."threadKey") < (${add(cursor.lastAt)}::timestamptz, ${add(cursor.thread)})`);

    const joins = `
      LEFT JOIN "Tenants" t ON ts."kind" = 'tenant' AND t.id::text = ts."refId"
      LEFT JOIN "Owners" o ON ts."kind" = 'owner' AND o.id::text = ts."refId"
      LEFT JOIN "Vendors" v ON ts."kind" = 'vendor' AND v.id::text = ts."refId"
      LEFT JOIN "Applications" a ON ts."kind" = 'applicant' AND a.id::text = ts."refId"
      LEFT JOIN "WorkOrders" w ON ts."kind" = 'work_order' AND w.id::text = ts."refId"`;

    const [page, counts] = await Promise.all([
      zite.sql({
        query: `
          WITH ${stats},
          page_threads AS (
            SELECT ts.*, t."name" AS "tenantName", o."name" AS "ownerName", o."contactName" AS "ownerContact", v."name" AS "vendorName", v."trade" AS "vendorTrade",
              a."applicantName", a."number" AS "applicationNumber", a."status" AS "applicationStatus", a."unitId" AS "applicationUnitId", a."propertyId" AS "applicationPropertyId",
              w."number" AS "workOrderNumber", w."title" AS "workOrderTitle", w."status" AS "workOrderStatus", w."priority" AS "workOrderPriority", w."unitId" AS "workOrderUnitId", w."propertyId" AS "workOrderPropertyId"
            FROM thread_stats ts ${joins}
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY ts."lastAt" DESC, ts."threadKey" DESC
            LIMIT ${limit + 1}
          ),
          last_messages AS (
            SELECT DISTINCT ON (tm."threadKey") tm."threadKey", tm.id, tm."subject", LEFT(tm."body", 280) AS "snippet", tm."direction", tm."channel", tm."delivery", tm."senderName", tm."senderMemberId", tm."attachments"
            FROM thread_messages tm
            WHERE tm."threadKey" IN (SELECT "threadKey" FROM page_threads)
            ORDER BY tm."threadKey", COALESCE(tm."sentAt", tm.created_at) DESC, tm.created_at DESC
          ),
          tenant_leases AS (
            SELECT DISTINCT ON (lt."tenantId") lt."tenantId", l."unitId", l."propertyId"
            FROM "LeaseTenants" lt JOIN "Leases" l ON l.id::text = lt."leaseId"
            WHERE lt."tenantId" IN (SELECT "refId" FROM page_threads WHERE "kind" = 'tenant')
            ORDER BY lt."tenantId", CASE l."status" WHEN 'Active' THEN 0 WHEN 'Pending signature' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END, l."endDate" DESC NULLS LAST
          )
          SELECT pt.*, lm.id AS "lastId", lm."subject" AS "lastSubject", lm."snippet", lm."direction" AS "lastDirection", lm."channel" AS "lastChannel", lm."delivery" AS "lastDelivery",
            lm."senderName" AS "lastSenderName", lm."senderMemberId" AS "lastSenderMemberId", lm."attachments" AS "lastAttachments",
            tl."unitId" AS "tenantUnitId", tl."propertyId" AS "tenantPropertyId"
          FROM page_threads pt
          JOIN last_messages lm ON lm."threadKey" = pt."threadKey"
          LEFT JOIN tenant_leases tl ON pt."kind" = 'tenant' AND tl."tenantId" = pt."refId"
          ORDER BY pt."lastAt" DESC, pt."threadKey" DESC`,
        params,
      }),
      zite.sql({
        query: `
          WITH ${stats}
          SELECT ts."kind", COUNT(*) AS "threads", SUM(CASE WHEN ts."unread" > 0 THEN 1 ELSE 0 END) AS "unreadThreads", SUM(ts."unread") AS "unread"
          FROM thread_stats ts GROUP BY ts."kind"`,
        params: [],
      }),
    ]);

    const rows = page.rows.slice(0, limit);
    const threads = rows.map(r => {
      const kind = String(r.kind) as z.infer<typeof Thread>['kind'];
      const woNumber = r.workOrderNumber == null ? null : num(r.workOrderNumber);
      let name = '';
      let subtitle = '';
      let unitId: string | null = null;
      let propertyId: string | null = null;
      if (kind === 'tenant') {
        name = str(r.tenantName) || 'Former resident';
        unitId = ref(r.tenantUnitId);
        propertyId = ref(r.tenantPropertyId);
      } else if (kind === 'owner') {
        name = str(r.ownerName) || 'Former owner';
        subtitle = str(r.ownerContact) && str(r.ownerContact) !== name ? String(r.ownerContact) : '';
      } else if (kind === 'vendor') {
        name = str(r.vendorName) || 'Former vendor';
        subtitle = str(r.vendorTrade) ?? '';
      } else if (kind === 'applicant') {
        name = str(r.applicantName) || 'Applicant';
        subtitle = str(r.applicationStatus) ?? '';
        unitId = ref(r.applicationUnitId);
        propertyId = ref(r.applicationPropertyId);
      } else {
        name = str(r.workOrderTitle) || 'Work order';
        unitId = ref(r.workOrderUnitId);
        propertyId = ref(r.workOrderPropertyId);
      }
      return {
        thread: String(r.threadKey),
        kind,
        refId: String(r.refId),
        name,
        subtitle,
        unitId,
        propertyId,
        workOrderNumber: woNumber,
        workOrderStatus: ref(r.workOrderStatus),
        workOrderPriority: ref(r.workOrderPriority),
        applicationNumber: r.applicationNumber == null ? null : num(r.applicationNumber),
        unread: num(r.unread),
        messageCount: num(r.messageCount),
        lastAt: iso(r.lastAt) ?? new Date(0).toISOString(),
        last: {
          id: String(r.lastId),
          subject: str(r.lastSubject) ?? '',
          snippet: (str(r.snippet) ?? '').replace(/@\[([^\]]+)\]\([^)\s]+\)/g, '@$1').replace(/\s+/g, ' ').trim(),
          direction: str(r.lastDirection) || 'Outbound',
          channel: str(r.lastChannel) || 'Email',
          delivery: ref(r.lastDelivery),
          senderName: ref(r.lastSenderName),
          senderMemberId: ref(r.lastSenderMemberId),
          attachments: json<unknown[]>(r.lastAttachments, []).length,
        },
        failed: num(r.failed),
      };
    });

    const c = { all: 0, unread: 0, tenant: 0, owner: 0, vendor: 0, applicant: 0, work_order: 0 };
    for (const r of counts.rows) {
      const k = String(r.kind) as keyof typeof c;
      c.all += num(r.threads);
      c.unread += num(r.unreadThreads);
      if (k in c) c[k] = num(r.unreadThreads);
    }
    const last = threads[threads.length - 1];
    return { threads, nextCursor: page.rows.length > limit && last ? { lastAt: last.lastAt, thread: last.thread } : null, counts: c };
  },
});
