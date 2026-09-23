import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { OPEN_WORK_ORDER_STATUSES } from '@project/shared/constants';
import { can } from '@project/shared/roles';
import { assertCan, getActor } from '@project/shared/server/actor';
import { leaseBalances } from '@project/shared/server/ledger';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { isEmail, requireThread, threadSql, toThreadMessage, workOrderResidentId } from '../server/comms';

/**
 * One conversation: every message in it (the latest 400, oldest first —
 * outbound, inbound, internal notes and announcement copies), who it's with,
 * and the context a reply needs — their lease and balance, their open work,
 * the work order itself.
 */

const Input = z.object({ thread: z.string().min(3).max(100) });

const WorkOrderLine = z.object({ id: z.string(), number: z.number(), title: z.string(), status: z.string(), priority: z.string(), unitId: z.string().nullable(), propertyId: z.string().nullable(), estimateAmount: z.number().nullable() });
const Party = z.object({ kind: z.enum(['tenant', 'owner', 'vendor', 'applicant']), id: z.string(), name: z.string(), label: z.string(), email: z.string(), phone: z.string(), hasEmail: z.boolean() });

export default createEndpoint({
  description: 'Get a message thread with its messages and context',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    thread: z.string(),
    kind: z.enum(['tenant', 'owner', 'vendor', 'applicant', 'work_order']),
    refId: z.string(),
    title: z.string(),
    /** People a reply can go to: the person, or a work order's resident and vendor. */
    parties: z.array(Party),
    messages: z.array(z.object({
      id: z.string(), subject: z.string(), body: z.string(), direction: z.string(), channel: z.string(), senderMemberId: z.string().nullable(), senderName: z.string().nullable(),
      delivery: z.string().nullable(), sentAt: z.string(), attachments: z.array(z.object({ name: z.string(), url: z.string() })), counterpart: z.string().nullable(),
      tenantId: z.string().nullable(), ownerId: z.string().nullable(), vendorId: z.string().nullable(), applicationId: z.string().nullable(), readAt: z.string().nullable(),
      announcementId: z.string().nullable(), announcementTitle: z.string().nullable(), workOrderId: z.string().nullable(), templateId: z.string().nullable(),
    })),
    truncated: z.boolean(),
    tenant: z.object({
      id: z.string(), name: z.string(), email: z.string(), phone: z.string(), company: z.string(), portalSeenAt: z.string().nullable(), archived: z.boolean(),
      leases: z.array(z.object({ id: z.string(), name: z.string(), number: z.number().nullable(), status: z.string(), unitId: z.string().nullable(), propertyId: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable(), rent: z.number(), balance: z.number().nullable() })),
    }).nullable(),
    owner: z.object({ id: z.string(), name: z.string(), contactName: z.string(), email: z.string(), phone: z.string(), portalEnabled: z.boolean() }).nullable(),
    vendor: z.object({ id: z.string(), name: z.string(), contactName: z.string(), email: z.string(), phone: z.string(), trade: z.string(), status: z.string(), insuranceExpiresOn: z.string().nullable(), w9OnFile: z.boolean() }).nullable(),
    application: z.object({ id: z.string(), number: z.number().nullable(), applicantName: z.string(), email: z.string(), phone: z.string(), status: z.string(), submittedAt: z.string().nullable(), desiredMoveIn: z.string().nullable(), unitId: z.string().nullable(), propertyId: z.string().nullable(), listingTitle: z.string() }).nullable(),
    workOrder: z.object({ id: z.string(), number: z.number(), title: z.string(), description: z.string(), status: z.string(), priority: z.string(), category: z.string(), unitId: z.string().nullable(), propertyId: z.string().nullable(), assigneeId: z.string().nullable(), vendorId: z.string().nullable(), tenantId: z.string().nullable(), scheduledFor: z.string().nullable(), dueDate: z.string().nullable() }).nullable(),
    /** Open work for the person (resident, vendor) or awaiting their approval (owner). */
    workOrders: z.array(WorkOrderLine),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'communications.send');
    const t = requireThread(parseInput(Input, input).thread);
    const none = { rows: [] as Array<Record<string, unknown>> };
    const open = OPEN_WORK_ORDER_STATUSES;

    const [msgs, tenant, leases, owner, vendor, application, workOrder, work] = await Promise.all([
      zite.sql({
        query: `
          SELECT * FROM (
            SELECT m.*, an."title" AS "announcementTitle",
              COALESCE(NULLIF(te."name", ''), NULLIF(ow."name", ''), NULLIF(ve."name", ''), NULLIF(ap."applicantName", '')) AS "counterpart"
            FROM "Messages" m
            LEFT JOIN "Announcements" an ON an.id::text = m."announcementId"
            LEFT JOIN "Tenants" te ON te.id::text = m."tenantId"
            LEFT JOIN "Owners" ow ON ow.id::text = m."ownerId"
            LEFT JOIN "Vendors" ve ON ve.id::text = m."vendorId"
            LEFT JOIN "Applications" ap ON ap.id::text = m."applicationId"
            WHERE ${threadSql('m')} = $1
            ORDER BY COALESCE(m."sentAt", m.created_at) DESC, m.created_at DESC
            LIMIT 401
          ) recent ORDER BY COALESCE("sentAt", created_at) ASC, created_at ASC`,
        params: [t.key],
      }),
      t.kind === 'tenant' ? zite.sql({ query: `SELECT id, "name", "email", "phone", "company", "portalSeenAt", "archived" FROM "Tenants" WHERE id::text = $1`, params: [t.id] }) : none,
      t.kind === 'tenant'
        ? zite.sql({
            query: `
              SELECT l.id, l."name", l."number", l."status", l."unitId", l."propertyId", l."startDate", l."endDate", l."rent"
              FROM "LeaseTenants" lt JOIN "Leases" l ON l.id::text = lt."leaseId"
              WHERE lt."tenantId" = $1
              ORDER BY CASE l."status" WHEN 'Active' THEN 0 WHEN 'Pending signature' THEN 1 WHEN 'Draft' THEN 2 ELSE 3 END, l."startDate" DESC NULLS LAST
              LIMIT 6`,
            params: [t.id],
          })
        : none,
      t.kind === 'owner' ? zite.sql({ query: `SELECT id, "name", "contactName", "email", "phone", "portalEnabled" FROM "Owners" WHERE id::text = $1`, params: [t.id] }) : none,
      t.kind === 'vendor' ? zite.sql({ query: `SELECT id, "name", "contactName", "email", "phone", "trade", "status", "insuranceExpiresOn", "w9OnFile" FROM "Vendors" WHERE id::text = $1`, params: [t.id] }) : none,
      t.kind === 'applicant'
        ? zite.sql({ query: `SELECT a.id, a."number", a."applicantName", a."email", a."portalEmail", a."phone", a."status", a."submittedAt", a."desiredMoveIn", a."unitId", a."propertyId", li."title" AS "listingTitle" FROM "Applications" a LEFT JOIN "Listings" li ON li.id::text = a."listingId" WHERE a.id::text = $1`, params: [t.id] })
        : none,
      t.kind === 'work_order'
        ? zite.sql({
            query: `
              SELECT w.id, w."number", w."title", w."description", w."status", w."priority", w."category", w."unitId", w."propertyId", w."assigneeId", w."vendorId", w."tenantId", w."leaseId", w."scheduledFor", w."dueDate",
                ve."name" AS "vendorName", ve."contactName" AS "vendorContact", ve."email" AS "vendorEmail", ve."phone" AS "vendorPhone"
              FROM "WorkOrders" w LEFT JOIN "Vendors" ve ON ve.id::text = w."vendorId"
              WHERE w.id::text = $1`,
            params: [t.id],
          })
        : none,
      t.kind === 'tenant' || t.kind === 'vendor'
        ? zite.sql({
            query: `
              SELECT w.id, w."number", w."title", w."status", w."priority", w."unitId", w."propertyId", w."estimateAmount" FROM "WorkOrders" w
              WHERE ${t.kind === 'tenant' ? `(w."tenantId" = $1 OR w."leaseId" IN (SELECT lt."leaseId" FROM "LeaseTenants" lt WHERE lt."tenantId" = $1))` : `w."vendorId" = $1`}
                AND w."status" = ANY($2)
              ORDER BY w."number" DESC LIMIT 8`,
            params: [t.id, open],
          })
        : t.kind === 'owner'
          ? zite.sql({
              query: `
                SELECT w.id, w."number", w."title", w."status", w."priority", w."unitId", w."propertyId", w."estimateAmount" FROM "WorkOrders" w
                JOIN "Properties" p ON p.id::text = w."propertyId"
                WHERE p."ownerId" = $1 AND w."ownerApproval" = 'Pending' AND w."status" = ANY($2)
                ORDER BY w."number" DESC LIMIT 8`,
              params: [t.id, open],
            })
          : none,
    ]);

    const parties: z.infer<typeof Party>[] = [];
    let title = '';
    const tr = tenant.rows[0];
    const orow = owner.rows[0];
    const vrow = vendor.rows[0];
    const arow = application.rows[0];
    const wrow = workOrder.rows[0];

    if (t.kind === 'tenant') {
      if (!tr && !msgs.rows.length) throw new ZiteError('That conversation no longer exists.', 'NOT_FOUND');
      title = str(tr?.name) || 'Former resident';
      if (tr) parties.push({ kind: 'tenant', id: t.id, name: title, label: title, email: str(tr.email) ?? '', phone: str(tr.phone) ?? '', hasEmail: isEmail(str(tr.email)) });
    } else if (t.kind === 'owner') {
      if (!orow && !msgs.rows.length) throw new ZiteError('That conversation no longer exists.', 'NOT_FOUND');
      title = str(orow?.name) || 'Former owner';
      if (orow) parties.push({ kind: 'owner', id: t.id, name: str(orow.contactName) || title, label: title, email: str(orow.email) ?? '', phone: str(orow.phone) ?? '', hasEmail: isEmail(str(orow.email)) });
    } else if (t.kind === 'vendor') {
      if (!vrow && !msgs.rows.length) throw new ZiteError('That conversation no longer exists.', 'NOT_FOUND');
      title = str(vrow?.name) || 'Former vendor';
      if (vrow) parties.push({ kind: 'vendor', id: t.id, name: str(vrow.contactName) || title, label: title, email: str(vrow.email) ?? '', phone: str(vrow.phone) ?? '', hasEmail: isEmail(str(vrow.email)) });
    } else if (t.kind === 'applicant') {
      if (!arow && !msgs.rows.length) throw new ZiteError('That conversation no longer exists.', 'NOT_FOUND');
      title = str(arow?.applicantName) || 'Applicant';
      const email = str(arow?.email) || str(arow?.portalEmail) || '';
      if (arow) parties.push({ kind: 'applicant', id: t.id, name: title, label: title, email, phone: str(arow.phone) ?? '', hasEmail: isEmail(email) });
    } else {
      if (!wrow) throw new ZiteError('That work order no longer exists.', 'NOT_FOUND');
      title = str(wrow.title) || 'Work order';
      const residentId = await workOrderResidentId({ id: String(wrow.id), tenantId: ref(wrow.tenantId), leaseId: ref(wrow.leaseId) });
      if (residentId) {
        const { rows } = await zite.sql({ query: `SELECT id, "name", "email", "phone" FROM "Tenants" WHERE id::text = $1`, params: [residentId] });
        const r = rows[0];
        if (r) parties.push({ kind: 'tenant', id: residentId, name: str(r.name) || 'Resident', label: str(r.name) || 'Resident', email: str(r.email) ?? '', phone: str(r.phone) ?? '', hasEmail: isEmail(str(r.email)) });
      }
      if (ref(wrow.vendorId) && str(wrow.vendorName)) parties.push({ kind: 'vendor', id: String(wrow.vendorId), name: str(wrow.vendorContact) || String(wrow.vendorName), label: String(wrow.vendorName), email: str(wrow.vendorEmail) ?? '', phone: str(wrow.vendorPhone) ?? '', hasEmail: isEmail(str(wrow.vendorEmail)) });
    }

    const showBalances = can(actor.role, 'accounting.view');
    const balances = showBalances && leases.rows.length ? await leaseBalances(leases.rows.map(r => String(r.id))) : new Map<string, { balance: number }>();

    return {
      thread: t.key,
      kind: t.kind,
      refId: t.id,
      title,
      parties,
      messages: msgs.rows.slice(-400).map(toThreadMessage),
      truncated: msgs.rows.length > 400,
      tenant: tr
        ? {
            id: String(tr.id), name: str(tr.name) ?? '', email: str(tr.email) ?? '', phone: str(tr.phone) ?? '', company: str(tr.company) ?? '', portalSeenAt: iso(tr.portalSeenAt), archived: bool(tr.archived),
            leases: leases.rows.map(l => ({
              id: String(l.id), name: str(l.name) ?? '', number: numOrNull(l.number), status: str(l.status) ?? '', unitId: ref(l.unitId), propertyId: ref(l.propertyId), startDate: day(l.startDate), endDate: day(l.endDate), rent: num(l.rent),
              balance: showBalances ? balances.get(String(l.id))?.balance ?? 0 : null,
            })),
          }
        : null,
      owner: orow ? { id: String(orow.id), name: str(orow.name) ?? '', contactName: str(orow.contactName) ?? '', email: str(orow.email) ?? '', phone: str(orow.phone) ?? '', portalEnabled: bool(orow.portalEnabled) } : null,
      vendor: vrow ? { id: String(vrow.id), name: str(vrow.name) ?? '', contactName: str(vrow.contactName) ?? '', email: str(vrow.email) ?? '', phone: str(vrow.phone) ?? '', trade: str(vrow.trade) || 'General', status: str(vrow.status) || 'Active', insuranceExpiresOn: day(vrow.insuranceExpiresOn), w9OnFile: bool(vrow.w9OnFile) } : null,
      application: arow
        ? { id: String(arow.id), number: numOrNull(arow.number), applicantName: str(arow.applicantName) ?? '', email: str(arow.email) || str(arow.portalEmail) || '', phone: str(arow.phone) ?? '', status: str(arow.status) ?? '', submittedAt: iso(arow.submittedAt), desiredMoveIn: day(arow.desiredMoveIn), unitId: ref(arow.unitId), propertyId: ref(arow.propertyId), listingTitle: str(arow.listingTitle) ?? '' }
        : null,
      workOrder: wrow
        ? { id: String(wrow.id), number: num(wrow.number), title: str(wrow.title) ?? '', description: str(wrow.description) ?? '', status: str(wrow.status) || 'New', priority: str(wrow.priority) || 'Normal', category: str(wrow.category) || 'General', unitId: ref(wrow.unitId), propertyId: ref(wrow.propertyId), assigneeId: ref(wrow.assigneeId), vendorId: ref(wrow.vendorId), tenantId: parties.find(p => p.kind === 'tenant')?.id ?? ref(wrow.tenantId), scheduledFor: iso(wrow.scheduledFor), dueDate: day(wrow.dueDate) }
        : null,
      workOrders: work.rows.map(w => ({ id: String(w.id), number: num(w.number), title: str(w.title) ?? '', status: str(w.status) ?? '', priority: str(w.priority) ?? '', unitId: ref(w.unitId), propertyId: ref(w.propertyId), estimateAmount: numOrNull(w.estimateAmount) })),
    };
  },
});
