import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { unitOccupancy } from '@project/shared/leases';
import { capabilitiesFor } from '@project/shared/roles';
import { getActor } from '@project/shared/server/actor';
import { getChart } from '@project/shared/server/accounts';
import { getSettings, isAiConfigured, rememberStaffAppUrl } from '@project/shared/server/settings';
import { ensureWorkspaceDefaults } from '@project/shared/server/setup';
import { bool, day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';

/**
 * Everything the staff app needs before its first screen: who you are, the
 * organization's settings, and the reference data every list resolves names
 * from — people, owners, properties and units (with today's occupancy),
 * accounts, vendors, saved views and templates — plus the sidebar counts.
 *
 * Lists elsewhere return ids for these; the client indexes this payload once
 * (lib/workspace.tsx) so an optimistic edit re-renders every surface from one
 * cache write.
 */

const Member = z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), status: z.string(), color: z.string(), avatarUrl: z.string().nullable(), title: z.string(), phone: z.string(), lastSeenAt: z.string().nullable() });
const Owner = z.object({ id: z.string(), name: z.string(), ownerType: z.string(), contactName: z.string(), email: z.string(), phone: z.string(), color: z.string(), status: z.string(), portalEnabled: z.boolean(), managementFeePercent: z.number().nullable(), distributionMethod: z.string() });
const Property = z.object({
  id: z.string(), name: z.string(), code: z.string(), propertyType: z.string(), status: z.string(), street: z.string(), city: z.string(), state: z.string(), postalCode: z.string(),
  ownerId: z.string().nullable(), managerId: z.string().nullable(), bankAccountId: z.string().nullable(), color: z.string(), photoUrl: z.string().nullable(),
  reserveAmount: z.number(), managementFeePercent: z.number().nullable(), unitCount: z.number(), occupied: z.number(), notice: z.number(), vacant: z.number(),
});
const Unit = z.object({
  id: z.string(), propertyId: z.string(), name: z.string(), beds: z.number(), baths: z.number(), squareFeet: z.number().nullable(), marketRent: z.number(), depositAmount: z.number(),
  readiness: z.string(), unitType: z.string(), availableOn: z.string().nullable(), archived: z.boolean(),
  occupancy: z.enum(['Occupied', 'Notice', 'Vacant']), currentLeaseId: z.string().nullable(), upcomingLeaseId: z.string().nullable(), residentNames: z.string(), currentRent: z.number().nullable(), leaseEnd: z.string().nullable(), moveOutDate: z.string().nullable(),
});
const Account = z.object({ id: z.string(), number: z.string(), name: z.string(), accountType: z.string(), subtype: z.string(), systemKey: z.string().nullable(), active: z.boolean(), tenantCharge: z.boolean(), billExpense: z.boolean(), bankName: z.string(), accountLast4: z.string(), description: z.string() });
const Vendor = z.object({ id: z.string(), name: z.string(), trade: z.string(), status: z.string(), contactName: z.string(), email: z.string(), phone: z.string(), color: z.string(), insuranceExpiresOn: z.string().nullable(), w9OnFile: z.boolean(), is1099: z.boolean(), portalEnabled: z.boolean(), defaultAccountId: z.string().nullable(), rating: z.number().nullable(), paymentTermsDays: z.number().nullable() });

export default createEndpoint({
  description: 'Load the signed-in member, settings, reference data and counts',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    today: z.string(),
    me: z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), capabilities: z.array(z.string()) }),
    settings: z.object({
      organizationName: z.string(), logoUrl: z.string().nullable(), currency: z.string(), timezone: z.string(), brandColor: z.string(), phone: z.string(), supportEmail: z.string().nullable(), emergencyPhone: z.string(),
      rentDueDay: z.number(), gracePeriodDays: z.number(), lateFeeType: z.string(), lateFeeAmount: z.number(), lateFeePercent: z.number(), lateFeeMax: z.number().nullable(),
      managementFeePercent: z.number(), ownerApprovalThreshold: z.number().nullable(), applicationFee: z.number(), incomeMultiple: z.number(), renewalNoticeDays: z.number(),
      onlinePayments: z.boolean(), maintenanceRequests: z.boolean(), applicationsOpen: z.boolean(), portalUrl: z.string().nullable(), staffAppUrl: z.string().nullable(),
      automationRanAt: z.string().nullable(), seedStatus: z.string(), seededAt: z.string().nullable(),
    }),
    seed: z.object({ needed: z.boolean(), status: z.string() }),
    integrations: z.object({ ai: z.boolean(), email: z.boolean() }),
    members: z.array(Member),
    owners: z.array(Owner),
    properties: z.array(Property),
    units: z.array(Unit),
    accounts: z.array(Account),
    vendors: z.array(Vendor),
    views: z.array(z.object({ id: z.string(), name: z.string(), scope: z.string(), config: z.string(), ownerId: z.string().nullable(), shared: z.boolean(), position: z.number() })),
    templates: z.array(z.object({ id: z.string(), name: z.string(), trigger: z.string(), audience: z.string(), enabled: z.boolean() })),
    counts: z.object({
      inboxUnread: z.number(), myTasks: z.number(), tasksOverdue: z.number(), workOrdersOpen: z.number(), workOrdersNew: z.number(), workOrdersEmergency: z.number(), approvalsPending: z.number(),
      applicationsToReview: z.number(), inquiriesNew: z.number(), messagesUnread: z.number(), billsDue: z.number(),
    }),
  }),
  execute: async ({ context }) => {
    const actor = await getActor(context);
    await ensureWorkspaceDefaults();
    let settings = await getSettings();
    settings = await rememberStaffAppUrl(settings);
    const today = todayIn(settings.timezone);
    const chart = await getChart();

    const [seedRow, members, owners, properties, units, leases, vendors, views, templates, counts] = await Promise.all([
      zite.sql({ query: `SELECT "seedStatus" FROM "Settings" WHERE id::text = $1`, params: [settings.id] }),
      zite.sql({ query: `SELECT id, "name", "email", "role", "status", "color", "avatarUrl", "title", "phone", "lastSeenAt" FROM "Members" ORDER BY "name" ASC`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "ownerType", "contactName", "email", "phone", "color", "status", "portalEnabled", "managementFeePercent", "distributionMethod" FROM "Owners" ORDER BY "name" ASC`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "code", "propertyType", "status", "street", "city", "state", "postalCode", "ownerId", "managerId", "bankAccountId", "color", "photoUrl", "reserveAmount", "managementFeePercent" FROM "Properties" ORDER BY "name" ASC`, params: [] }),
      zite.sql({ query: `SELECT id, "propertyId", "name", "beds", "baths", "squareFeet", "marketRent", "depositAmount", "readiness", "unitType", "availableOn", "archived" FROM "Units" ORDER BY "name" ASC LIMIT 2000`, params: [] }),
      zite.sql({
        query: `
          SELECT l.id, l."unitId", l."status", l."leaseType", l."startDate", l."endDate", l."noticeGivenOn", l."moveOutDate", l."rent",
            (SELECT STRING_AGG(t."name", ', ' ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END) FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = l.id::text AND lt."role" IN ('Primary', 'Co-tenant')) AS "names"
          FROM "Leases" l WHERE l."status" IN ('Active', 'Pending signature') LIMIT 2000`,
        params: [],
      }),
      zite.sql({ query: `SELECT id, "name", "trade", "status", "contactName", "email", "phone", "color", "insuranceExpiresOn", "w9OnFile", "is1099", "portalEnabled", "defaultAccountId", "rating", "paymentTermsDays" FROM "Vendors" ORDER BY "name" ASC`, params: [] }),
      zite.sql({ query: `SELECT id, "name", "scope", "config", "ownerId", "shared", "position" FROM "Views" WHERE "ownerId" = $1 OR COALESCE("shared", false) = true ORDER BY COALESCE("position", 0) ASC, created_at ASC`, params: [actor.id] }),
      zite.sql({ query: `SELECT id, "name", "trigger", "audience", "enabled" FROM "EmailTemplates" ORDER BY COALESCE("position", 0) ASC`, params: [] }),
      zite.sql({
        query: `
          SELECT
            (SELECT COUNT(*) FROM "Notifications" n WHERE n."memberId" = $1 AND n."readAt" IS NULL AND n."archivedAt" IS NULL AND (n."snoozedUntil" IS NULL OR n."snoozedUntil" <= NOW())) AS "inboxUnread",
            (SELECT COUNT(*) FROM "Tasks" t WHERE t."assigneeId" = $1 AND t."status" IN ('To do', 'In progress')) AS "myTasks",
            (SELECT COUNT(*) FROM "Tasks" t WHERE t."assigneeId" = $1 AND t."status" IN ('To do', 'In progress') AND t."dueDate" < $2::date) AS "tasksOverdue",
            (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."status" IN ('New', 'Scheduled', 'In progress', 'On hold')) AS "workOrdersOpen",
            (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."status" = 'New') AS "workOrdersNew",
            (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."status" IN ('New', 'Scheduled', 'In progress', 'On hold') AND w."priority" = 'Emergency') AS "workOrdersEmergency",
            (SELECT COUNT(*) FROM "WorkOrders" w WHERE w."ownerApproval" = 'Pending' AND w."status" NOT IN ('Completed', 'Canceled')) AS "approvalsPending",
            (SELECT COUNT(*) FROM "Applications" a WHERE a."status" IN ('Submitted', 'Screening')) AS "applicationsToReview",
            (SELECT COUNT(*) FROM "Inquiries" q WHERE q."status" = 'New') AS "inquiriesNew",
            (SELECT COUNT(*) FROM "Messages" m WHERE m."direction" = 'Inbound' AND m."readAt" IS NULL) AS "messagesUnread",
            (SELECT COUNT(*) FROM "Transactions" b WHERE b."kind" = 'Bill' AND b."status" = 'Posted' AND b."dueDate" <= ($2::date + 7)
              AND b."amount" > COALESCE((SELECT SUM(a."amount") FROM "Allocations" a WHERE a."chargeId" = b.id::text AND COALESCE(a."void", false) = false), 0)) AS "billsDue"`,
        params: [actor.id, today],
      }),
    ]);

    const leasesByUnit = new Map<string, Array<{ id: string; status: string; leaseType: string; startDate: string | null; endDate: string | null; noticeGivenOn: string | null; moveOutDate: string | null; rent: number; names: string }>>();
    for (const l of leases.rows) {
      const list = leasesByUnit.get(String(l.unitId)) ?? [];
      list.push({ id: String(l.id), status: String(l.status), leaseType: str(l.leaseType) ?? '', startDate: day(l.startDate), endDate: day(l.endDate), noticeGivenOn: day(l.noticeGivenOn), moveOutDate: day(l.moveOutDate), rent: num(l.rent), names: str(l.names) ?? '' });
      leasesByUnit.set(String(l.unitId), list);
    }
    const unitList = units.rows.map(u => {
      const ls = leasesByUnit.get(String(u.id)) ?? [];
      const occ = unitOccupancy(ls, today);
      const current = ls.find(l => l.id === occ.currentLeaseId);
      return {
        id: String(u.id), propertyId: String(u.propertyId), name: str(u.name) ?? '', beds: num(u.beds), baths: num(u.baths), squareFeet: numOrNull(u.squareFeet), marketRent: num(u.marketRent), depositAmount: num(u.depositAmount),
        readiness: str(u.readiness) || 'Ready', unitType: str(u.unitType) ?? '', availableOn: day(u.availableOn), archived: bool(u.archived),
        occupancy: occ.occupancy, currentLeaseId: occ.currentLeaseId, upcomingLeaseId: occ.upcomingLeaseId, residentNames: current?.names ?? '', currentRent: current ? current.rent : null, leaseEnd: current?.endDate ?? null, moveOutDate: current?.moveOutDate ?? null,
      };
    });
    const byProperty = new Map<string, typeof unitList>();
    for (const u of unitList) if (!u.archived) byProperty.set(u.propertyId, [...(byProperty.get(u.propertyId) ?? []), u]);

    const c = counts.rows[0] ?? {};
    const seedStatus = str(seedRow.rows[0]?.seedStatus) ?? '';
    const empty = properties.rows.length === 0;
    return {
      today,
      me: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, capabilities: capabilitiesFor(actor.role) },
      settings: {
        organizationName: settings.organizationName, logoUrl: settings.logoUrl, currency: settings.currency, timezone: settings.timezone, brandColor: settings.brandColor, phone: settings.phone, supportEmail: settings.supportEmail, emergencyPhone: settings.emergencyPhone,
        rentDueDay: settings.rentDueDay, gracePeriodDays: settings.gracePeriodDays, lateFeeType: settings.lateFeeType, lateFeeAmount: settings.lateFeeAmount, lateFeePercent: settings.lateFeePercent, lateFeeMax: settings.lateFeeMax,
        managementFeePercent: settings.managementFeePercent, ownerApprovalThreshold: settings.ownerApprovalThreshold, applicationFee: settings.applicationFee, incomeMultiple: settings.incomeMultiple, renewalNoticeDays: settings.renewalNoticeDays,
        onlinePayments: settings.onlinePayments, maintenanceRequests: settings.maintenanceRequests, applicationsOpen: settings.applicationsOpen, portalUrl: settings.portalUrl, staffAppUrl: settings.staffAppUrl,
        automationRanAt: settings.automationRanAt, seedStatus, seededAt: settings.seededAt,
      },
      // A fresh install with no portfolio gets the demo, started by its first admin. Once real data exists it never runs.
      seed: { needed: seedStatus !== 'done' && (empty || seedStatus !== ''), status: seedStatus },
      integrations: { ai: isAiConfigured(), email: true },
      members: members.rows.map(m => ({ id: String(m.id), name: str(m.name) ?? '', email: str(m.email) ?? '', role: str(m.role) ?? 'Property Manager', status: str(m.status) || 'Active', color: str(m.color) || '#64748b', avatarUrl: ref(m.avatarUrl), title: str(m.title) ?? '', phone: str(m.phone) ?? '', lastSeenAt: iso(m.lastSeenAt) })),
      owners: owners.rows.map(o => ({ id: String(o.id), name: str(o.name) ?? '', ownerType: str(o.ownerType) || 'Individual', contactName: str(o.contactName) ?? '', email: str(o.email) ?? '', phone: str(o.phone) ?? '', color: str(o.color) || '#64748b', status: str(o.status) || 'Active', portalEnabled: bool(o.portalEnabled), managementFeePercent: numOrNull(o.managementFeePercent), distributionMethod: str(o.distributionMethod) || 'ACH' })),
      properties: properties.rows.map(p => {
        const us = byProperty.get(String(p.id)) ?? [];
        return {
          id: String(p.id), name: str(p.name) ?? '', code: str(p.code) ?? '', propertyType: str(p.propertyType) || 'Multifamily', status: str(p.status) || 'Active', street: str(p.street) ?? '', city: str(p.city) ?? '', state: str(p.state) ?? '', postalCode: str(p.postalCode) ?? '',
          ownerId: ref(p.ownerId), managerId: ref(p.managerId), bankAccountId: ref(p.bankAccountId), color: str(p.color) || '#0f766e', photoUrl: ref(p.photoUrl), reserveAmount: num(p.reserveAmount), managementFeePercent: numOrNull(p.managementFeePercent),
          unitCount: us.length, occupied: us.filter(u => u.occupancy === 'Occupied').length, notice: us.filter(u => u.occupancy === 'Notice').length, vacant: us.filter(u => u.occupancy === 'Vacant').length,
        };
      }),
      units: unitList,
      accounts: chart.all.map(a => ({ id: a.id, number: a.number, name: a.name, accountType: a.accountType, subtype: a.subtype, systemKey: a.systemKey, active: a.active, tenantCharge: a.tenantCharge, billExpense: a.billExpense, bankName: a.bankName, accountLast4: a.accountLast4, description: a.description })),
      vendors: vendors.rows.map(v => ({ id: String(v.id), name: str(v.name) ?? '', trade: str(v.trade) || 'General', status: str(v.status) || 'Active', contactName: str(v.contactName) ?? '', email: str(v.email) ?? '', phone: str(v.phone) ?? '', color: str(v.color) || '#64748b', insuranceExpiresOn: day(v.insuranceExpiresOn), w9OnFile: bool(v.w9OnFile), is1099: bool(v.is1099), portalEnabled: bool(v.portalEnabled), defaultAccountId: ref(v.defaultAccountId), rating: numOrNull(v.rating), paymentTermsDays: numOrNull(v.paymentTermsDays) })),
      views: views.rows.map(v => ({ id: String(v.id), name: str(v.name) ?? '', scope: str(v.scope) ?? '', config: str(v.config) ?? '{}', ownerId: ref(v.ownerId), shared: bool(v.shared), position: num(v.position) })),
      templates: templates.rows.map(t => ({ id: String(t.id), name: str(t.name) ?? '', trigger: str(t.trigger) ?? 'Manual', audience: str(t.audience) || 'Tenant', enabled: bool(t.enabled) })),
      counts: {
        inboxUnread: num(c.inboxUnread), myTasks: num(c.myTasks), tasksOverdue: num(c.tasksOverdue), workOrdersOpen: num(c.workOrdersOpen), workOrdersNew: num(c.workOrdersNew), workOrdersEmergency: num(c.workOrdersEmergency),
        approvalsPending: num(c.approvalsPending), applicationsToReview: num(c.applicationsToReview), inquiriesNew: num(c.inquiriesNew), messagesUnread: num(c.messagesUnread), billsDue: num(c.billsDue),
      },
    };
  },
});
