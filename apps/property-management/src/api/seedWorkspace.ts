import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { PRIORITY_DUE_DAYS, SCREENING_CHECKS } from '@project/shared/constants';
import { addDays, addMonths, addPeriods, formatDay, periodOf, periodStart, todayIn } from '@project/shared/dates';
import { renderLeaseTerms } from '@project/shared/leaseDocument';
import { leaseLabel, workOrderRef, applicationRef } from '@project/shared/leases';
import { activityRecord, type ActivityInput } from '@project/shared/server/activity';
import { colorFor, getActor } from '@project/shared/server/actor';
import { getChart, type SystemKey } from '@project/shared/server/accounts';
import { insertAllocations, insertTransactions } from '@project/shared/server/ledger';
import { DEFAULT_LEASE_TEMPLATE, getSettings } from '@project/shared/server/settings';
import { ensureWorkspaceDefaults } from '@project/shared/server/setup';
import { chunked, num, str } from '@project/shared/server/sql';
import {
  ANNOUNCEMENTS, APPLICATIONS, DOCUMENTS, INQUIRIES, OWNER_THREADS, SAVED_VIEWS, TASKS, TENANT_THREADS, VENDOR_THREADS, WORK_ORDER_COMMENTS, at, type ThreadMessage,
} from '../seed/comms';
import { simulateLedger } from '../seed/ledger';
import {
  MEMBERS, ORG, PROPERTIES, SAMPLE_PDF, SCHEDULES, SEED_TIMEZONE, VACANCIES, VENDORS, img, inspectionPlans, leasePlans, listingPlans, owners, workOrderPlans, type LeasePlan, type SeedActor,
} from '../seed/model';

/**
 * Build the demo company the first time an admin opens the app.
 *
 * The seed runs in phases — portfolio and people, then the ledger, then its
 * allocations, then conversations — one per call, and the ledger phases stop
 * themselves well inside the platform's time limit and resume where they left
 * off. The app shows progress and calls again until `done`.
 *
 * Seed Status in Settings records the last finished phase. Every phase
 * rebuilds the same model from a fixed seed and finds earlier phases' rows by
 * natural key, so a retry never duplicates anything.
 */

const PHASES = ['', 'org', 'ledger', 'allocations', 'done'] as const;
const MESSAGE: Record<string, string> = {
  '': 'Adding properties, units, owners and residents',
  org: 'Posting eight months of rent, bills and distributions',
  ledger: 'Matching payments to charges',
  allocations: 'Adding conversations, applications and tasks',
  done: 'Ready',
};

export default createEndpoint({
  description: 'Create the demo property management company, one phase per call',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ done: z.boolean(), phase: z.string(), progress: z.number(), message: z.string() }),
  execute: async ({ context }) => {
    const started = Date.now();
    const deadline = started + 95_000;
    const actor = await getActor(context);
    if (actor.role !== 'Admin') throw new ZiteError('Only an admin can set up the demo', 'FORBIDDEN');
    const settings = await getSettings();
    const { rows } = await zite.sql({ query: `SELECT "seedStatus", "seededAt" FROM "Settings" WHERE id::text = $1`, params: [settings.id] });
    const status = String(rows[0]?.seedStatus ?? '');
    const seededAt = rows[0]?.seededAt ? Date.parse(String(rows[0].seededAt)) : 0;
    const today = todayIn(SEED_TIMEZONE);
    const me: SeedActor = { id: actor.id, name: actor.name, email: actor.email };

    if (status === 'done') return { done: true, phase: 'done', progress: 1, message: MESSAGE.done };
    if (status.endsWith(':running')) {
      // Another tab is on it; a phase left "running" for ten minutes died and is retried.
      if (Date.now() - seededAt < 10 * 60_000) return { done: false, phase: status, progress: 0, message: 'Setting up in another tab…' };
    }
    if (!status || status === 'org:running') {
      const { rows: existing } = await zite.sql({ query: `SELECT (SELECT COUNT(*) FROM "Properties") AS p, (SELECT COUNT(*) FROM "Leases") AS l`, params: [] });
      if (num(existing[0]?.p) > 0 || num(existing[0]?.l) > 0) {
        // Real data already here: never mix a demo into it.
        await zite.settings.update({ id: settings.id, record: { seedStatus: 'done' } });
        return { done: true, phase: 'done', progress: 1, message: MESSAGE.done };
      }
      await zite.settings.update({ id: settings.id, record: { seedStatus: 'org:running', seededAt: new Date().toISOString() } });
      await phaseOrg(me, settings.id, today);
      await zite.settings.update({ id: settings.id, record: { seedStatus: 'org' } });
      return { done: false, phase: 'org', progress: 0.3, message: MESSAGE.org };
    }
    if (status === 'org' || status === 'ledger:running') {
      await zite.settings.update({ id: settings.id, record: { seedStatus: 'ledger:running', seededAt: new Date().toISOString() } });
      const res = await phaseLedger(me, today, deadline);
      await zite.settings.update({ id: settings.id, record: { seedStatus: res.complete ? 'ledger' : 'org' } });
      return { done: false, phase: res.complete ? 'ledger' : 'org', progress: 0.3 + res.progress * 0.4, message: res.complete ? MESSAGE.ledger : MESSAGE.org };
    }
    if (status === 'ledger' || status === 'allocations:running') {
      await zite.settings.update({ id: settings.id, record: { seedStatus: 'allocations:running', seededAt: new Date().toISOString() } });
      const res = await phaseAllocations(me, today, deadline);
      await zite.settings.update({ id: settings.id, record: { seedStatus: res.complete ? 'allocations' : 'ledger' } });
      return { done: false, phase: res.complete ? 'allocations' : 'ledger', progress: 0.7 + res.progress * 0.15, message: res.complete ? MESSAGE.allocations : MESSAGE.ledger };
    }
    if (status === 'allocations' || status === 'comms:running') {
      await zite.settings.update({ id: settings.id, record: { seedStatus: 'comms:running', seededAt: new Date().toISOString() } });
      await phaseComms(me, today);
      await zite.settings.update({ id: settings.id, record: { seedStatus: 'done' } });
      return { done: true, phase: 'done', progress: 1, message: MESSAGE.done };
    }
    void PHASES;
    return { done: true, phase: status, progress: 1, message: MESSAGE.done };
  },
});

// ── Lookups shared by every phase ─────────────────────────────────────────

type Ctx = Awaited<ReturnType<typeof loadContext>>;

async function loadContext(actor: SeedActor, today: string) {
  const [members, ownerRows, props, units, vendors, tenants, leases, leaseTenants, recurring, workOrders, listings, applications] = await Promise.all([
    zite.sql({ query: `SELECT id, "email" FROM "Members"`, params: [] }),
    zite.sql({ query: `SELECT id, "email", "managementFeePercent", "distributionMethod" FROM "Owners"`, params: [] }),
    zite.sql({ query: `SELECT id, "code", "name", "ownerId", "reserveAmount", "managementFeePercent", "managerId" FROM "Properties"`, params: [] }),
    zite.sql({ query: `SELECT u.id, u."name", u."propertyId", p."code" FROM "Units" u JOIN "Properties" p ON p.id::text = u."propertyId"`, params: [] }),
    zite.sql({ query: `SELECT id, "name" FROM "Vendors"`, params: [] }),
    zite.sql({ query: `SELECT id, "email", "name" FROM "Tenants"`, params: [] }),
    zite.sql({ query: `SELECT id, "number" FROM "Leases"`, params: [] }),
    zite.sql({ query: `SELECT "leaseId", "tenantId", "role" FROM "LeaseTenants"`, params: [] }),
    zite.sql({ query: `SELECT id, "leaseId", "description" FROM "RecurringCharges"`, params: [] }),
    zite.sql({ query: `SELECT id, "number", "propertyId", "unitId", "title" FROM "WorkOrders"`, params: [] }),
    zite.sql({ query: `SELECT id, "slug", "propertyId", "unitId", "title" FROM "Listings"`, params: [] }),
    zite.sql({ query: `SELECT id, "number" FROM "Applications"`, params: [] }),
  ]);
  const byEmail = new Map(members.rows.map(r => [String(r.email).toLowerCase(), String(r.id)]));
  const member = {
    me: actor.id,
    renata: byEmail.get('renata.ortiz@example.com') ?? actor.id,
    priya: byEmail.get('priya.raman@example.com') ?? actor.id,
    theo: byEmail.get('theo.nakamura@example.com') ?? actor.id,
    grace: byEmail.get('grace.adeyemi@example.com') ?? actor.id,
    luis: byEmail.get('luis.fernandez@example.com') ?? actor.id,
  };
  const ownerByEmail = new Map(ownerRows.rows.map(r => [String(r.email).toLowerCase(), r]));
  const ownerDefs = owners(actor);
  const ownerId = new Map(ownerDefs.map(o => [o.key, String(ownerByEmail.get(o.email.toLowerCase())?.id ?? '')]));
  const leaseIdByNumber = new Map(leases.rows.map(r => [num(r.number), String(r.id)]));
  const primaryTenant = new Map<number, string>();
  const numberByLeaseId = new Map(leases.rows.map(r => [String(r.id), num(r.number)]));
  for (const lt of leaseTenants.rows) if (lt.role === 'Primary') primaryTenant.set(numberByLeaseId.get(String(lt.leaseId)) ?? 0, String(lt.tenantId));
  const propByCode = new Map(props.rows.map(r => [String(r.code), r]));
  return {
    today,
    member,
    ownerId,
    property: new Map(PROPERTIES.map(def => {
      const r = propByCode.get(def.code)!;
      const owner = ownerDefs.find(o => o.key === def.owner)!;
      const ownerRow = ownerByEmail.get(owner.email.toLowerCase());
      const feePct = r?.managementFeePercent != null && r.managementFeePercent !== '' ? num(r.managementFeePercent) : ownerRow?.managementFeePercent != null && ownerRow.managementFeePercent !== '' ? num(ownerRow.managementFeePercent) : ORG.managementFeePercent;
      return [def.code, { id: String(r?.id ?? ''), ownerId: String(r?.ownerId ?? ''), reserve: num(r?.reserveAmount), feePct, distributionMethod: String(ownerRow?.distributionMethod ?? 'ACH'), name: def.name, managerId: String(r?.managerId ?? actor.id) }];
    })),
    unit: new Map(units.rows.map(r => [`${r.code}-${r.name}`, { id: String(r.id), propertyId: String(r.propertyId) }])),
    vendor: new Map(vendors.rows.map(r => [String(r.name), String(r.id)])),
    tenant: new Map(tenants.rows.map(r => [String(r.email).toLowerCase(), String(r.id)])),
    leaseId: leaseIdByNumber,
    primaryTenant,
    recurring: new Map(recurring.rows.map(r => [`${r.leaseId}|${r.description}`, String(r.id)])),
    workOrder: new Map(workOrders.rows.map(r => [num(r.number), { id: String(r.id), propertyId: String(r.propertyId), unitId: r.unitId ? String(r.unitId) : null, title: String(r.title) }])),
    listing: new Map(listings.rows.map(r => [String(r.slug), { id: String(r.id), propertyId: String(r.propertyId), unitId: String(r.unitId), title: String(r.title) }])),
    application: new Map(applications.rows.map(r => [num(r.number), String(r.id)])),
  };
}

const tenantEmail = (t: { email?: string; name: string }) => (t.email ?? '').toLowerCase();

/** The lease whose tenants lived in a unit on a given day. */
function leaseOn(plans: LeasePlan[], unit: string, day: string) {
  return plans.find(p => p.unit === unit && p.status !== 'Pending signature' && p.start <= day && (p.moveOut ?? p.end ?? '9999-12-31') >= day) ?? null;
}

// ── Phase 1: portfolio, people, work and leasing ─────────────────────────

async function phaseOrg(actor: SeedActor, settingsId: string, today: string) {
  await ensureWorkspaceDefaults();
  const chart = await getChart({ fresh: true });
  const now = new Date().toISOString();
  await zite.settings.update({ id: settingsId, record: { ...ORG, onlinePayments: true, allowPartialPayments: true, maintenanceRequests: true, applicationsOpen: true, leaseTemplate: DEFAULT_LEASE_TEMPLATE, defaultRole: 'Property Manager' } });
  await zite.accounts.update({ id: chart.key('operating_bank').id, record: { name: 'Operating — Front Range Community Bank', bankName: 'Front Range Community Bank', accountLast4: '4821' } });
  await zite.accounts.update({ id: chart.key('deposit_bank').id, record: { name: 'Deposit Trust — Front Range Community Bank', bankName: 'Front Range Community Bank', accountLast4: '7730' } });

  const { rows: meRow } = await zite.sql({ query: `SELECT "title" FROM "Members" WHERE id::text = $1`, params: [actor.id] });
  if (!str(meRow[0]?.title)) await zite.members.update({ id: actor.id, record: { title: 'Director of Property Management', phone: '(303) 555-0140' } });
  await zite.members.bulkCreate({
    records: MEMBERS.map((m, i) => ({ name: m.name, email: m.email, role: m.role, status: 'Active', color: colorFor(m.email), title: m.title, phone: m.phone, lastSeenAt: at(today, i % 3, 15 + i) })),
  });

  const ownerDefs = owners(actor);
  await zite.owners.bulkCreate({
    records: ownerDefs.map(o => ({ name: o.name, ownerType: o.ownerType, contactName: o.contactName, email: o.email, phone: o.phone, mailingAddress: o.mailingAddress || null, taxIdLast4: o.taxIdLast4 || null, managementFeePercent: o.managementFeePercent, distributionMethod: o.distributionMethod, portalEnabled: true, status: 'Active', color: o.color, notes: o.notes })),
  });
  let ctx = await loadContext(actor, today);

  await zite.properties.bulkCreate({
    records: PROPERTIES.map(p => ({
      name: p.name, code: p.code, propertyType: p.propertyType, status: 'Active', street: p.street, city: p.city, state: p.state, postalCode: p.postalCode,
      ownerId: ctx.ownerId.get(p.owner), managerId: ctx.member[p.manager], bankAccountId: chart.key('operating_bank').id, yearBuilt: p.yearBuilt, photoUrl: p.photoUrl,
      description: p.description, amenities: JSON.stringify(p.amenities), reserveAmount: p.reserveAmount, petPolicy: p.petPolicy, parking: p.parking, acquiredOn: p.acquiredOn, color: p.color,
    })),
  });
  const { rows: propRows } = await zite.sql({ query: `SELECT id, "code" FROM "Properties"`, params: [] });
  const propId = new Map(propRows.map(r => [String(r.code), String(r.id)]));
  const listings = listingPlans(today);
  const unitRecords = PROPERTIES.flatMap(p => p.units.map(u => {
    const key = `${p.code}-${u.name}`;
    const vacancy = VACANCIES[key];
    const listing = listings.find(l => l.unit === key);
    return {
      name: u.name, propertyId: propId.get(p.code), beds: u.beds, baths: u.baths, squareFeet: u.sqft, marketRent: u.rent, depositAmount: u.rent, readiness: vacancy?.readiness ?? 'Ready',
      floor: u.floor ?? null, unitType: u.type ?? null, features: JSON.stringify(u.features ?? []), photoUrls: JSON.stringify(listing ? listing.photos.map(id => img(id)) : []),
      availableOn: vacancy ? addDays(today, vacancy.availableInDays) : key === 'JUN-B3' ? addDays(periodStart(addPeriods(periodOf(today), 1)), 0) : null,
      archived: false,
    };
  }));
  await chunked(unitRecords, async batch => { await zite.units.bulkCreate({ records: batch as never }); });

  await zite.vendors.bulkCreate({
    records: VENDORS.map(v => ({
      name: v.name, trade: v.trade, contactName: v.contactName === '__actor__' ? actor.name : v.contactName || null, email: v.email === '__actor__' ? actor.email : v.email, phone: v.phone,
      is1099: v.is1099, w9OnFile: v.w9, taxIdLast4: v.is1099 && v.w9 ? String(1000 + ([...v.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9000, 7))) : null, insuranceExpiresOn: v.insuranceDays == null ? null : addDays(today, v.insuranceDays), hourlyRate: v.rate || null, rating: v.rating,
      status: 'Active', portalEnabled: v.is1099, defaultAccountId: chart.key(v.account as SystemKey).id, paymentTermsDays: v.terms, color: colorFor(v.name),
      notes: v.email === '__actor__' ? 'Demo: this vendor is linked to your sign-in, so you can preview the vendor portal.' : !v.w9 && v.is1099 ? 'W-9 missing — needed before year-end 1099s.' : null,
    })),
  });

  const plans = leasePlans(today, actor);
  const seen = new Map<string, LeasePlan['tenants'][number] & { since: string; current: boolean }>();
  for (const p of plans) for (const t of p.tenants) {
    const e = tenantEmail(t);
    const prev = seen.get(e);
    if (!prev) seen.set(e, { ...t, since: p.start, current: p.status !== 'Ended' });
  }
  const tenantRecords = [...seen.values()].map((t, i) => ({
    name: t.name, email: t.email ?? null, phone: t.phone, company: t.company ?? null, pets: t.pets ?? null, vehicles: t.vehicles ?? null,
    emergencyContact: t.emergency?.[0] ?? null, emergencyPhone: t.emergency?.[1] ?? null, color: colorFor(t.email ?? t.name),
    portalInvitedAt: t.current ? `${t.since}T16:00:00.000Z` : null, portalSeenAt: t.current && i % 3 !== 2 ? at(today, i % 9, 18) : null, archived: false,
  }));
  await chunked(tenantRecords, async batch => { await zite.tenants.bulkCreate({ records: batch }); });
  ctx = await loadContext(actor, today);
  const tenantNameByEmail = new Map([...seen.values()].map(t => [tenantEmail(t), t.name]));

  const leaseRecords = plans.map(p => {
    const [code, unitName] = p.unit.split('-');
    const prop = ctx.property.get(code)!;
    const unit = ctx.unit.get(p.unit)!;
    const def = PROPERTIES.find(x => x.code === code)!;
    const names = p.tenants.filter(t => t.role !== 'Guarantor').map(t => t.name);
    const signedOn = addDays(p.start, -9);
    const pending = p.status === 'Pending signature';
    const signatures = pending
      ? [{ tenantId: ctx.tenant.get(tenantEmail(p.tenants[0])), name: p.tenants[0].name, signedAt: at(today, 10, 22) }]
      : p.tenants.filter(t => t.role !== 'Occupant').map(t => ({ tenantId: ctx.tenant.get(tenantEmail(t)), name: t.name, signedAt: `${signedOn}T19:30:00.000Z` }));
    const terms = p.isActor || pending ? renderLeaseTerms(DEFAULT_LEASE_TEMPLATE, { organizationName: ORG.organizationName, currency: 'USD', gracePeriodDays: ORG.gracePeriodDays, lateFee: ORG.lateFeeAmount, property: def, unitName, tenantNames: names, startDate: p.start, endDate: p.end, rent: p.rent, deposit: p.deposit, rentDueDay: 1 }) : null;
    return {
      name: leaseLabel(def.name, unitName, names), number: p.number, propertyId: prop.id, unitId: unit.id, status: p.status, leaseType: p.leaseType,
      startDate: p.start, endDate: p.renewal?.status === 'Accepted' && p.end ? addDays(addMonths(addDays(p.end, 1), p.renewal.termMonths), -1) : p.end, moveInDate: p.start, moveOutDate: p.moveOut ?? null, noticeGivenOn: p.noticeGivenOn ?? null, rent: p.rent, deposit: p.deposit, rentDueDay: 1, lateFeeExempt: false,
      renewalStatus: p.renewal?.status ?? 'None', renewalRent: p.renewal?.rent ?? null, renewalTermMonths: p.renewal?.termMonths ?? null,
      renewalOfferedAt: p.renewal ? `${p.renewal.offeredOn}T16:00:00.000Z` : null, renewalExpiresOn: p.renewal?.expiresOn ?? null,
      renewalRespondedAt: p.renewal?.status === 'Accepted' ? `${addDays(p.renewal.offeredOn, 4)}T02:10:00.000Z` : null,
      terms, sentForSignatureAt: pending ? at(today, 12, 17) : `${addDays(p.start, -12)}T17:00:00.000Z`, signatures: JSON.stringify(signatures),
      signedAt: pending ? null : `${signedOn}T19:30:00.000Z`, countersignedAt: pending ? null : `${addDays(signedOn, 1)}T15:00:00.000Z`, countersignedById: pending ? null : prop.managerId,
      documentUrl: pending ? null : `${SAMPLE_PDF}?lease=${p.number}`, moveOutReason: p.moveOutReason ?? null,
      depositSettledAt: p.status === 'Ended' && p.depositSettled && p.moveOut ? `${addDays(p.moveOut, 14)}T17:00:00.000Z` : null,
      createdById: prop.managerId, notes: p.isActor ? 'Demo: this lease is linked to your sign-in, so you can preview the resident portal.' : null,
    };
  });
  await chunked(leaseRecords, async batch => { await zite.leases.bulkCreate({ records: batch as never }); });
  ctx = await loadContext(actor, today);

  await chunked(plans.flatMap(p => p.tenants.map(t => ({ leaseId: ctx.leaseId.get(p.number)!, tenantId: ctx.tenant.get(tenantEmail(t))!, role: t.role, signedAt: p.status === 'Pending signature' ? (t.role === 'Primary' ? at(today, 10, 22) : null) : `${addDays(p.start, -9)}T19:30:00.000Z` }))), async batch => {
    await zite.leaseTenants.bulkCreate({ records: batch });
  });

  const M0 = periodOf(today);
  await chunked(plans.flatMap(p => {
    const leaseId = ctx.leaseId.get(p.number)!;
    const firstFull = Number(p.start.slice(8, 10)) === 1 ? p.start : periodStart(addPeriods(periodOf(p.start), 1));
    const ended = p.status === 'Ended';
    const pending = p.status === 'Pending signature';
    const base = { leaseId, frequency: 'Monthly', dayOfMonth: 1, startDate: firstFull, endDate: ended ? p.moveOut ?? p.end : null, lastPostedPeriod: pending ? null : ended ? periodOf(p.moveOut ?? p.end ?? today) : M0, active: !ended };
    // An accepted renewal extends the same lease: today's rent runs to the old end date, the renewal rent after it.
    const renewed = p.renewal?.status === 'Accepted' && p.end ? addDays(p.end, 1) : null;
    return [
      { ...base, description: 'Rent', accountId: chart.key('rent_income').id, amount: p.rent, endDate: renewed ? p.end : base.endDate },
      ...(renewed && p.renewal ? [{ ...base, description: 'Rent', accountId: chart.key('rent_income').id, amount: p.renewal.rent, startDate: renewed, lastPostedPeriod: null }] : []),
      ...p.extras.map(x => ({ ...base, description: x.description, accountId: chart.key(x.key).id, amount: x.amount })),
    ];
  }), async batch => { await zite.recurringCharges.bulkCreate({ records: batch }); });

  await zite.listings.bulkCreate({
    records: listings.map(l => {
      const unit = ctx.unit.get(l.unit)!;
      return {
        title: l.title, slug: l.slug, propertyId: unit.propertyId, unitId: unit.id, status: l.status, rent: l.rent, deposit: l.deposit, availableOn: l.availableOn,
        description: l.description, photos: JSON.stringify(l.photos.map(id => img(id))), amenities: JSON.stringify(l.amenities), leaseTerm: l.leaseTerm, petPolicy: l.petPolicy,
        applicationFee: ORG.applicationFee, showingInstructions: l.showing, contactMemberId: ctx.member.theo, publishedAt: l.status === 'Published' ? at(today, l.views > 150 ? 24 : 12, 16) : null, views: l.views,
      };
    }),
  });

  await zite.maintenanceSchedules.bulkCreate({
    records: SCHEDULES.map(s => ({
      title: s.title, description: s.description, propertyId: ctx.property.get(s.property)!.id, category: s.category, priority: s.priority, frequency: s.frequency,
      nextDueOn: addDays(today, s.dueInDays + (s.title === 'Quarterly pest control — common areas' || s.title === 'Gutter cleaning' ? 90 : 0)),
      leadDays: s.leadDays, vendorId: ctx.vendor.get(s.vendor) ?? null, assigneeId: ctx.member[s.assignee as keyof Ctx['member']], estimateAmount: s.estimate, active: true,
      lastGeneratedOn: s.title === 'Quarterly pest control — common areas' || s.title === 'Gutter cleaning' ? addDays(today, -1) : null,
    })),
  });
  const { rows: scheduleRows } = await zite.sql({ query: `SELECT id, "title" FROM "MaintenanceSchedules"`, params: [] });
  const scheduleId = new Map(scheduleRows.map(r => [String(r.title), String(r.id)]));

  const woPlans = workOrderPlans();
  const woRecords = woPlans.map((w, i) => {
    const [code] = w.unit.split('-');
    const prop = ctx.property.get(code)!;
    const unit = w.unit.includes('-') ? ctx.unit.get(w.unit) : null;
    const reportedDay = addDays(today, -w.createdDaysAgo);
    const lease = w.fromTenant && w.unit.includes('-') ? leaseOn(plans, w.unit, reportedDay) : null;
    const reportedAt = at(today, w.createdDaysAgo, w.createdDaysAgo === 0 ? 13 + (i % 3) : 14 + (i % 6), (i * 17) % 60);
    const completedAt = w.completedDaysAgo != null ? at(today, w.completedDaysAgo, 22, (i * 7) % 60) : null;
    return {
      title: w.title, number: w.number, description: w.description, propertyId: prop.id, unitId: unit?.id ?? null,
      leaseId: lease ? ctx.leaseId.get(lease.number) : null, tenantId: lease ? ctx.primaryTenant.get(lease.number) ?? null : null,
      category: w.category, priority: w.priority, status: w.status, source: w.source,
      assigneeId: w.assignee ? ctx.member[w.assignee] : null, vendorId: w.vendor ? ctx.vendor.get(w.vendor) ?? null : null,
      scheduledFor: w.scheduledInDays != null ? `${addDays(today, w.scheduledInDays)}T15:00:00.000Z` : completedAt ? at(today, w.completedDaysAgo!, 15) : null,
      dueDate: addDays(reportedDay, PRIORITY_DUE_DAYS[w.priority]),
      startedAt: w.status === 'In progress' ? at(today, Math.max(0, w.createdDaysAgo - 1), 16) : completedAt ? at(today, w.completedDaysAgo!, 15, 30) : null,
      completedAt, permissionToEnter: Boolean(w.permissionToEnter), entryNotes: w.entryNotes ?? null,
      estimateAmount: w.estimate ?? null, actualCost: w.status === 'Completed' ? w.cost ?? 0 : null,
      ownerApproval: w.approval ?? 'Not required', ownerApprovalNote: w.approval === 'Approved' ? 'Approved — please proceed.' : null,
      ownerRespondedAt: w.approval === 'Approved' ? at(today, Math.max(0, w.createdDaysAgo - 1), 20) : null,
      photos: JSON.stringify(w.title.startsWith('No heat') ? [{ url: img('photo-1545259741-2ea3ebf61fa3', 900, 900), name: 'thermostat.jpg' }] : w.title.startsWith('Water stain') ? [{ url: img('photo-1584622781564-1d987f7333c1', 900, 900), name: 'ceiling.jpg' }] : []),
      completionNotes: w.completionNotes ?? null, tenantRating: w.rating ?? null, tenantFeedback: w.feedback ?? null,
      scheduleId: w.schedule ? scheduleId.get(w.schedule) ?? null : null, createdById: w.source === 'Portal' ? null : w.assignee ? ctx.member[w.assignee] : actor.id,
      reportedAt, lastActivityAt: completedAt ?? at(today, Math.max(0, w.createdDaysAgo - 1), 18),
    };
  });
  await chunked(woRecords, async batch => { await zite.workOrders.bulkCreate({ records: batch as never }); });

  await zite.inspections.bulkCreate({
    records: inspectionPlans(today).map(ins => {
      const unit = ctx.unit.get(ins.unit)!;
      const day = ins.scheduledFor.slice(0, 10);
      const lease = ins.type === 'Move-out' ? plans.find(p => p.unit === ins.unit && p.moveOut && Math.abs(Date.parse(p.moveOut) - Date.parse(day)) < 30 * 86_400_000) : leaseOn(plans, ins.unit, day) ?? plans.find(p => p.unit === ins.unit && p.status === 'Active');
      return {
        title: ins.title, propertyId: unit.propertyId, unitId: unit.id, leaseId: lease ? ctx.leaseId.get(lease.number) : null, inspectionType: ins.type, status: ins.status,
        scheduledFor: ins.scheduledFor, completedAt: ins.status === 'Completed' ? ins.scheduledFor.replace('T16', 'T18') : null, inspectorId: ctx.member[ins.inspector as keyof Ctx['member']],
        areas: JSON.stringify(ins.areas), summary: ins.summary || null, overallCondition: ins.overall, sharedWithTenant: ins.shared, tenantAcknowledgedAt: ins.acknowledged ? ins.scheduledFor.replace('T16', 'T23') : null,
        reportUrl: ins.status === 'Completed' ? `${SAMPLE_PDF}?inspection=${encodeURIComponent(ins.title)}` : null,
      };
    }),
  });
  void now;
}

// ── Phase 2: transactions and journal lines ─────────────────────────────

async function simulate(actor: SeedActor, today: string) {
  const chart = await getChart({ fresh: true });
  const ctx = await loadContext(actor, today);
  return simulateLedger(today, chart, leasePlans(today, actor), workOrderPlans(), {
    leaseId: ctx.leaseId,
    primaryTenant: ctx.primaryTenant,
    unit: ctx.unit,
    property: ctx.property,
    vendor: ctx.vendor,
    recurring: ctx.recurring,
    workOrder: ctx.workOrder,
  });
}

async function phaseLedger(actor: SeedActor, today: string, deadline: number) {
  const sim = await simulate(actor, today);
  const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS n FROM "Transactions"`, params: [] });
  let done = num(rows[0]?.n);
  while (done < sim.txns.length && Date.now() < deadline) {
    const batch = sim.txns.slice(done, done + 100);
    await insertTransactions(batch, { startNumber: 1001 + done });
    done += batch.length;
  }
  return { complete: done >= sim.txns.length, progress: sim.txns.length ? done / sim.txns.length : 1 };
}

async function phaseAllocations(actor: SeedActor, today: string, deadline: number) {
  const sim = await simulate(actor, today);
  const numberByKey = new Map(sim.txns.map((t, i) => [t.key, 1001 + i]));
  const idByNumber = new Map<number, string>();
  for (let from = 1001; from < 1001 + sim.txns.length; from += 1500) {
    const { rows } = await zite.sql({ query: `SELECT id, "number" FROM "Transactions" WHERE "number" >= $1 AND "number" < $2`, params: [from, from + 1500] });
    for (const r of rows) idByNumber.set(num(r.number), String(r.id));
  }
  const all = sim.allocations
    .map(a => ({ paymentId: idByNumber.get(numberByKey.get(a.paymentKey) ?? 0) ?? '', chargeId: idByNumber.get(numberByKey.get(a.chargeKey) ?? 0) ?? '', amount: a.amount, date: a.date }))
    .filter(a => a.paymentId && a.chargeId);
  const { rows } = await zite.sql({ query: `SELECT COUNT(*) AS n FROM "Allocations"`, params: [] });
  let done = num(rows[0]?.n);
  while (done < all.length && Date.now() < deadline) {
    await insertAllocations(all.slice(done, done + 100));
    done += 100;
  }
  return { complete: done >= all.length, progress: all.length ? Math.min(1, done / all.length) : 1 };
}

// ── Phase 4: conversations, leasing pipeline, tasks and the inbox ────────

async function phaseComms(actor: SeedActor, today: string) {
  const ctx = await loadContext(actor, today);
  const plans = leasePlans(today, actor);
  const woPlans = workOrderPlans();
  const memberName: Record<string, string> = { me: actor.name, renata: 'Renata Ortiz', priya: 'Priya Raman', theo: 'Theo Nakamura', grace: 'Grace Adeyemi', luis: 'Luis Fernández' };
  const planByUnit = (unit: string) => plans.find(p => p.unit === unit && p.status === 'Active') ?? plans.find(p => p.unit === unit)!;
  const messages: Array<Record<string, unknown>> = [];
  const msg = (m: ThreadMessage, links: Record<string, unknown>, fallbackSender: string) => ({
    subject: m.subject, body: m.body.replace(/\(luis\)/g, `(${ctx.member.luis})`), direction: m.direction, channel: m.channel,
    senderMemberId: m.from ? ctx.member[m.from] : null, senderName: m.from ? memberName[m.from] : fallbackSender,
    delivery: m.direction === 'Inbound' ? 'Received' : m.channel === 'Email' ? 'Sent' : m.channel === 'Portal' ? 'Portal only' : null,
    readAt: m.direction === 'Inbound' && m.read === false ? null : at(today, m.daysAgo, m.hour + 1), sentAt: at(today, m.daysAgo, m.hour, (m.body.length * 7) % 60),
    ...links,
  });

  for (const th of TENANT_THREADS) {
    const p = planByUnit(th.unit);
    const tenantId = ctx.primaryTenant.get(p.number)!;
    const leaseId = ctx.leaseId.get(p.number)!;
    const unit = ctx.unit.get(th.unit)!;
    for (const m of th.messages) messages.push(msg(m, { thread: `tenant:${tenantId}`, tenantId, leaseId, propertyId: unit.propertyId }, p.tenants[0].name));
  }
  const ownerDefs = owners(actor);
  for (const th of OWNER_THREADS) {
    const ownerId = ctx.ownerId.get(th.owner)!;
    const name = ownerDefs.find(o => o.key === th.owner)!.contactName;
    for (const m of th.messages) messages.push(msg(m, { thread: `owner:${ownerId}`, ownerId }, name));
  }
  for (const th of VENDOR_THREADS) {
    const vendorId = ctx.vendor.get(th.vendor)!;
    for (const m of th.messages) messages.push(msg(m, { thread: `vendor:${vendorId}`, vendorId }, th.vendor));
  }
  for (const th of WORK_ORDER_COMMENTS) {
    const plan = woPlans.find(w => w.title === th.title)!;
    const wo = ctx.workOrder.get(plan.number)!;
    const lease = plan.unit.includes('-') ? leaseOn(plans, plan.unit, today) : null;
    const tenantId = lease ? ctx.primaryTenant.get(lease.number) ?? null : null;
    const vendorId = plan.vendor ? ctx.vendor.get(plan.vendor) ?? null : null;
    for (const m of th.messages) {
      const external = m.to === 'tenant' ? { tenantId } : m.to === 'vendor' ? { vendorId } : {};
      const sender = m.direction === 'Inbound' ? (m.to === 'vendor' ? plan.vendor ?? 'Vendor' : lease?.tenants[0].name ?? 'Resident') : 'System';
      messages.push(msg(m, { thread: `work_order:${wo.id}`, workOrderId: wo.id, propertyId: wo.propertyId, leaseId: lease ? ctx.leaseId.get(lease.number) : null, ...external }, sender));
    }
  }

  const apps = APPLICATIONS(today);
  const inquiries = INQUIRIES(today);
  await zite.inquiries.bulkCreate({
    records: inquiries.map(q => {
      const listing = ctx.listing.get(q.listing)!;
      return {
        name: q.name, email: q.email, phone: q.phone, message: q.message, listingId: listing.id, propertyId: listing.propertyId, unitId: listing.unitId, status: q.status, source: q.source,
        showingAt: q.showingDaysAgo == null ? null : at(today, q.showingDaysAgo, q.showingDaysAgo < 0 ? 23 : 0), desiredMoveIn: q.desiredMoveIn, assigneeId: q.assignee ? ctx.member[q.assignee as 'theo'] : null,
        lastContactedAt: q.status === 'New' ? null : at(today, Math.max(0, q.daysAgo - 1), 17), notes: q.notes || null, receivedAt: at(today, q.daysAgo, q.daysAgo === 0 ? 14 : 19, 12),
      };
    }),
  });
  await zite.applications.bulkCreate({
    records: apps.map(a => {
      const listing = ctx.listing.get(a.listing)!;
      return {
        applicantName: a.applicantName, number: a.number, listingId: listing.id, propertyId: listing.propertyId, unitId: listing.unitId, status: a.status, email: a.email, phone: a.phone,
        portalEmail: a.email, desiredMoveIn: a.desiredMoveIn, monthlyIncome: a.monthlyIncome, employer: a.employer, jobTitle: a.jobTitle, employmentMonths: a.employmentMonths,
        currentAddress: a.currentAddress, currentRent: a.currentRent, currentLandlord: a.currentLandlord, landlordPhone: a.landlordPhone, residenceMonths: a.residenceMonths,
        reasonForMoving: a.reasonForMoving, occupants: a.occupants, pets: a.pets, vehicles: a.vehicles || null, priorEviction: false, coApplicants: JSON.stringify(a.coApplicants),
        details: JSON.stringify({ references: [{ name: 'Personal reference', relationship: 'Former coworker', phone: '(303) 555-0196' }], emergencyContact: { name: 'Family member', phone: '(720) 555-0197' } }),
        screening: JSON.stringify(a.screening), screeningNotes: a.screeningNotes || null, consentAt: at(today, a.submittedDaysAgo, 20), signature: a.applicantName,
        feeAmount: ORG.applicationFee, feePaidAt: at(today, a.feePaidDaysAgo, 20, 5), decisionReason: a.decisionReason || null, decidedById: a.decidedBy ? ctx.member[a.decidedBy as 'theo'] : null,
        decidedAt: a.decidedDaysAgo != null ? at(today, a.decidedDaysAgo, 17) : null, submittedAt: at(today, a.submittedDaysAgo, 20), source: a.source,
        assigneeId: a.assignee ? ctx.member[a.assignee as 'theo'] : null, lastActivityAt: at(today, a.decidedDaysAgo ?? a.submittedDaysAgo, 18),
      };
    }),
  });
  const ctx2 = await loadContext(actor, today);
  const { rows: inquiryRows } = await zite.sql({ query: `SELECT id, "email" FROM "Inquiries"`, params: [] });
  const inquiryByEmail = new Map(inquiryRows.map(r => [String(r.email), String(r.id)]));
  for (const a of apps) {
    const appId = ctx2.application.get(a.number)!;
    const inquiryId = inquiryByEmail.get(a.email);
    if (inquiryId) {
      await zite.applications.update({ id: appId, record: { inquiryId } });
      await zite.inquiries.update({ id: inquiryId, record: { applicationId: appId } });
    }
    if (a.status === 'Approved') {
      const pending = plans.find(p => p.status === 'Pending signature')!;
      const leaseId = ctx2.leaseId.get(pending.number)!;
      await zite.applications.update({ id: appId, record: { leaseId } });
      await zite.leases.update({ id: leaseId, record: { applicationId: appId } });
    }
    const listing = ctx2.listing.get(a.listing)!;
    const outbound = a.status === 'Approved' ? 'Good news about your application' : a.status === 'Denied' ? 'An update on your application' : 'We received your application';
    messages.push({ subject: `We received your application (${applicationRef(a.number)})`, body: `Hi ${a.applicantName.split(' ')[0]},\n\nThanks for applying for ${listing.title}. We review applications in the order they're received, usually within two business days.`, thread: `applicant:${appId}`, applicationId: appId, direction: 'Outbound', channel: 'Email', delivery: 'Sent', senderName: ORG.organizationName, sentAt: at(today, a.submittedDaysAgo, 20, 6), readAt: at(today, a.submittedDaysAgo, 21) });
    if (a.status === 'Approved' || a.status === 'Denied') {
      messages.push({ subject: outbound, body: a.status === 'Approved' ? `Hi ${a.applicantName.split(' ')[0]},\n\nYour application for ${listing.title} has been approved! We'll send your lease for electronic signature shortly.` : `Hi ${a.applicantName.split(' ')[0]},\n\nThank you for your interest in ${listing.title}. After reviewing your application, we're unable to approve it at this time.`, thread: `applicant:${appId}`, applicationId: appId, direction: 'Outbound', channel: 'Email', delivery: 'Sent', senderMemberId: ctx2.member.theo, senderName: 'Theo Nakamura', sentAt: at(today, a.decidedDaysAgo!, 17, 30), readAt: at(today, a.decidedDaysAgo!, 18) });
    }
  }
  await chunked(messages, async batch => { await zite.messages.bulkCreate({ records: batch as never }); });

  await zite.announcements.bulkCreate({
    records: ANNOUNCEMENTS(today).map(a => ({
      title: a.title, body: a.body, audience: a.audience, propertyIds: JSON.stringify(a.properties.map(code => ctx2.property.get(code)!.id)), channel: a.channel, status: a.status,
      sentAt: a.sentDaysAgo != null ? at(today, a.sentDaysAgo, 16) : null, sentById: a.status === 'Sent' ? ctx2.member.renata : null, recipientCount: a.recipients, pinnedUntil: a.pinnedUntil,
    })),
  });

  await zite.tasks.bulkCreate({
    records: TASKS(today).map((t, i) => {
      const unit = t.unit ? ctx2.unit.get(t.unit) : null;
      const plan = t.unit ? planByUnit(t.unit) : null;
      return {
        title: t.title, description: t.description, status: t.status, priority: t.priority, category: t.category, dueDate: addDays(today, t.dueIn), assigneeId: ctx2.member[t.assignee as 'me'],
        propertyId: unit?.propertyId ?? null, unitId: unit?.id ?? null, leaseId: plan && t.unit ? ctx2.leaseId.get(plan.number) ?? null : null,
        vendorId: 'vendor' in t && t.vendor ? ctx2.vendor.get(t.vendor as string) ?? null : null, createdById: i % 2 === 0 ? actor.id : ctx2.member.renata,
        completedAt: 'completedDaysAgo' in t && t.completedDaysAgo != null ? at(today, t.completedDaysAgo as number, 18) : null, openedAt: at(today, Math.max(1, -t.dueIn + 5), 15),
      };
    }),
  });

  await chunked(DOCUMENTS(today), async batch => {
    await zite.documents.bulkCreate({
      records: batch.map(d => {
        const plan = d.lease ? planByUnit(d.lease) : null;
        const unit = d.lease ? ctx2.unit.get(d.lease) : d.unit ? ctx2.unit.get(d.unit) : null;
        const wo = d.workOrder ? ctx2.workOrder.get(woPlans.find(w => w.title === d.workOrder)!.number) : null;
        return {
          name: d.name, url: d.url, category: d.category, propertyId: unit?.propertyId ?? (d.property ? ctx2.property.get(d.property)!.id : wo?.propertyId ?? null), unitId: unit?.id ?? wo?.unitId ?? null,
          leaseId: plan ? ctx2.leaseId.get(plan.number) ?? null : null, tenantId: plan ? ctx2.primaryTenant.get(plan.number) ?? null : null,
          ownerId: d.owner ? ctx2.ownerId.get(d.owner as 'me') ?? null : null, vendorId: d.vendor ? ctx2.vendor.get(d.vendor) ?? null : null, workOrderId: wo?.id ?? null,
          sharedWithTenant: Boolean(d.sharedWithTenant), sharedWithOwner: Boolean(d.sharedWithOwner), uploadedById: actor.id, uploadedByName: actor.name, size: 13264, mimeType: 'application/pdf',
          expiresOn: d.expiresIn != null ? addDays(today, d.expiresIn) : null, uploadedAt: at(today, d.daysAgo, 17),
        };
      }),
    });
  });

  // ── The inbox ─────────────────────────────────────────────────────────
  const wo = (title: string) => {
    const p = woPlans.find(w => w.title === title)!;
    return { number: p.number, id: ctx2.workOrder.get(p.number)!.id };
  };
  const heat = wo('No heat — thermostat blank');
  const heater = wo('Replace water heater (18 years old, rusting at base)');
  const smoke = wo('Smoke detector chirping in hallway');
  const garage = wo('Garage door opener stopped working');
  const actorLease = plans.find(p => p.isActor)!;
  const ctwLease = plans.find(p => p.unit === 'CTW-Main' && p.status === 'Active')!;
  const notifications = [
    { title: `${workOrderRef(heat.number)} No heat — thermostat blank`, body: 'Emergency · The Alder · 402 · Grace Kim', kind: 'work_order_created', link: `/work-orders/${heat.number}`, entityType: 'work_order', entityId: heat.id, actorName: 'Grace Kim', hoursAgo: 2, read: false },
    { title: `Grace Kim added a photo to ${workOrderRef(heat.number)}`, body: 'Here’s the thermostat — completely blank. I tried new batteries.', kind: 'work_order_message', link: `/work-orders/${heat.number}`, entityType: 'work_order', entityId: heat.id, actorName: 'Grace Kim', hoursAgo: 1, read: false },
    { title: `${workOrderRef(smoke.number)} Smoke detector chirping in hallway`, body: 'High · 48 Cottonwood Lane · Colin Hartley', kind: 'work_order_created', link: `/work-orders/${smoke.number}`, entityType: 'work_order', entityId: smoke.id, actorName: 'Colin Hartley', hoursAgo: 3, read: false },
    { title: 'Marcus Johnson applied for Larkspur Lofts 3B', body: `${applicationRef(204)} · Household income $8,700/mo (4.8× rent)`, kind: 'application_submitted', link: '/applications/204', entityType: 'application', entityId: ctx2.application.get(204), actorName: 'Marcus Johnson', hoursAgo: 5, read: false },
    { title: 'Anika Shah replied about the Elm Street water heater', body: 'Could you get a second quote? $1,850 seems high. If it’s within $200 go ahead.', kind: 'message_received', link: `/work-orders/${heater.number}`, entityType: 'work_order', entityId: heater.id, actorName: 'Anika Shah', hoursAgo: 30, read: false },
    { title: '48 Cottonwood Lane lease ends in 54 days', body: 'Decide whether to offer the Hartleys a renewal.', kind: 'lease_expiring', link: `/leases/${ctx2.leaseId.get(ctwLease.number)}`, entityType: 'lease', entityId: ctx2.leaseId.get(ctwLease.number), actorName: null, hoursAgo: 20, read: false },
    { title: 'Emily Watson asked about Larkspur Lofts 3B', body: 'Hi! Is the rooftop deck shared with the café? And is there bike storage?', kind: 'inquiry_received', link: '/leasing/inquiries', entityType: 'inquiry', entityId: null, actorName: 'Emily Watson', hoursAgo: 4, read: false },
    { title: '3 bills due this week', body: 'Clearwater Utilities, Front Range Waste Services and Evergreen Grounds Co. — $1,402.00 total.', kind: 'bill_due', link: '/accounting/payables', entityType: null, entityId: null, actorName: null, hoursAgo: 9, read: true },
    { title: 'Brightline Electric’s insurance has expired', body: 'Request an updated certificate before assigning more work.', kind: 'insurance_expiring', link: `/vendors/${ctx2.vendor.get('Brightline Electric')}`, entityType: 'vendor', entityId: ctx2.vendor.get('Brightline Electric'), actorName: null, hoursAgo: 80, read: true },
    { title: 'Renata assigned you: Review and send owner statements', body: 'Check last month’s statements for all four owners before they post on the 10th.', kind: 'task_assigned', link: '/tasks', entityType: 'task', entityId: null, actorName: 'Renata Ortiz', actorId: ctx2.member.renata, hoursAgo: 50, read: true },
    { title: `Summit Appliance Repair completed ${workOrderRef(garage.number)}`, body: 'Replaced drive gear and sprocket. $310.00', kind: 'work_order_updated', link: `/work-orders/${garage.number}`, entityType: 'work_order', entityId: garage.id, actorName: 'Summit Appliance Repair', hoursAgo: 19 * 24, read: true },
    { title: `Online payment received — The Alder · 201`, body: `${actor.name} paid $1,875.00`, kind: 'payment_received', link: `/leases/${ctx2.leaseId.get(actorLease.number)}`, entityType: 'lease', entityId: ctx2.leaseId.get(actorLease.number), actorName: actor.name, hoursAgo: (Number(today.slice(8, 10)) - 1) * 24 + 6, read: true },
  ];
  await zite.notifications.bulkCreate({
    records: notifications.map(n => ({
      title: n.title, body: n.body, memberId: actor.id, kind: n.kind, link: n.link, entityType: n.entityType, entityId: n.entityId ?? null, actorName: n.actorName, actorId: ('actorId' in n ? (n as { actorId?: string }).actorId : null) ?? null,
      readAt: n.read ? new Date(Date.now() - (n.hoursAgo - 1) * 3_600_000).toISOString() : null, occurredAt: new Date(Date.now() - n.hoursAgo * 3_600_000).toISOString(),
    })),
  });

  // ── Activity: the history behind every record ─────────────────────────
  const acts: ActivityInput[] = [];
  for (const w of woPlans) {
    const info = ctx2.workOrder.get(w.number)!;
    const base = { entityType: 'work_order' as const, entityId: info.id, workOrderId: info.id, propertyId: info.propertyId, unitId: info.unitId };
    const reporter = w.fromTenant ? (leaseOn(plans, w.unit, addDays(today, -w.createdDaysAgo))?.tenants[0].name ?? 'Resident') : w.assignee ? memberName[w.assignee] : actor.name;
    acts.push({ ...base, action: 'created', summary: w.source === 'Portal' ? 'submitted the request in the resident portal' : w.source === 'Recurring' ? 'created from a preventive maintenance schedule' : 'created the work order', actorName: reporter, occurredAt: at(today, w.createdDaysAgo, 14) });
    if (w.vendor) acts.push({ ...base, action: 'vendor_assigned', summary: `assigned ${w.vendor}`, actorId: w.assignee ? ctx2.member[w.assignee] : null, actorName: w.assignee ? memberName[w.assignee] : null, occurredAt: at(today, w.createdDaysAgo, 16) });
    if (w.approval) acts.push({ ...base, action: 'approval_requested', summary: `requested owner approval for ${w.estimate ? `$${w.estimate.toLocaleString()}` : 'the estimate'}`, actorName: w.assignee ? memberName[w.assignee] : null, occurredAt: at(today, w.createdDaysAgo, 17) });
    if (w.approval === 'Approved') acts.push({ ...base, action: 'approval_granted', summary: 'owner approved the estimate', actorName: 'Owner', occurredAt: at(today, Math.max(0, w.createdDaysAgo - 1), 20) });
    if (w.status === 'Scheduled' || w.status === 'In progress' || w.status === 'Completed') acts.push({ ...base, action: 'status_changed', summary: 'moved to Scheduled', actorName: w.assignee ? memberName[w.assignee] : null, data: { from: 'New', to: 'Scheduled' }, occurredAt: at(today, w.createdDaysAgo, 18) });
    if (w.status === 'In progress' || w.status === 'Completed') acts.push({ ...base, action: 'status_changed', summary: 'moved to In progress', actorName: w.vendor ?? memberName[w.assignee ?? 'luis'], data: { from: 'Scheduled', to: 'In progress' }, occurredAt: at(today, Math.max(0, (w.completedDaysAgo ?? w.createdDaysAgo) - 0), 15, 30) });
    if (w.status === 'On hold') acts.push({ ...base, action: 'status_changed', summary: 'put on hold', actorName: w.assignee ? memberName[w.assignee] : null, data: { from: 'New', to: 'On hold' }, occurredAt: at(today, Math.max(0, w.createdDaysAgo - 1), 16) });
    if (w.status === 'Completed') acts.push({ ...base, action: 'status_changed', summary: `completed the work${w.cost ? ` ($${w.cost.toLocaleString()})` : ''}`, actorName: w.vendor ?? memberName[w.assignee ?? 'luis'], data: { from: 'In progress', to: 'Completed' }, occurredAt: at(today, w.completedDaysAgo!, 22) });
    if (w.status === 'Canceled') acts.push({ ...base, action: 'status_changed', summary: 'canceled — not a maintenance issue', actorName: memberName[w.assignee ?? 'renata'], data: { from: 'New', to: 'Canceled' }, occurredAt: at(today, Math.max(0, w.createdDaysAgo - 1), 15) });
    if (w.rating) acts.push({ ...base, action: 'rated', summary: `rated the work ${w.rating}/5`, actorName: reporter, occurredAt: at(today, Math.max(0, (w.completedDaysAgo ?? 0) - 1), 23) });
  }
  for (const p of plans) {
    const leaseId = ctx2.leaseId.get(p.number)!;
    const unit = ctx2.unit.get(p.unit)!;
    const [code] = p.unit.split('-');
    const manager = ctx2.property.get(code)!.managerId;
    const base = { entityType: 'lease' as const, entityId: leaseId, leaseId, propertyId: unit.propertyId, unitId: unit.id, tenantId: ctx2.primaryTenant.get(p.number) ?? null };
    const pending = p.status === 'Pending signature';
    acts.push({ ...base, action: 'created', summary: 'created the lease', actorId: manager, occurredAt: pending ? at(today, 13, 16) : `${addDays(p.start, -14)}T16:00:00.000Z` });
    acts.push({ ...base, action: 'sent_for_signature', summary: 'sent the lease for signature', actorId: manager, occurredAt: pending ? at(today, 12, 17) : `${addDays(p.start, -12)}T17:00:00.000Z` });
    if (pending) {
      acts.push({ ...base, action: 'signed', summary: `${p.tenants[0].name} signed`, actorName: p.tenants[0].name, occurredAt: at(today, 10, 22) });
      continue;
    }
    acts.push({ ...base, action: 'signed', summary: 'all residents signed', actorName: p.tenants[0].name, occurredAt: `${addDays(p.start, -9)}T19:30:00.000Z` });
    acts.push({ ...base, action: 'activated', summary: 'moved in — lease is active', actorId: manager, occurredAt: `${p.start}T17:00:00.000Z` });
    if (p.renewal) acts.push({ ...base, action: 'renewal_offered', summary: `offered a renewal at $${p.renewal.rent.toLocaleString()}/mo for ${p.renewal.termMonths} months`, actorId: manager, occurredAt: `${p.renewal.offeredOn}T16:00:00.000Z` });
    if (p.renewal?.status === 'Accepted') acts.push({ ...base, action: 'renewal_accepted', summary: 'accepted the renewal offer', actorName: p.tenants[0].name, occurredAt: `${addDays(p.renewal.offeredOn, 4)}T02:10:00.000Z` });
    if (p.noticeGivenOn) acts.push({ ...base, action: 'notice_given', summary: `gave notice — moving out ${formatDay(p.moveOut)}`, actorName: p.tenants[0].name, occurredAt: `${p.noticeGivenOn}T18:00:00.000Z` });
    if (p.status === 'Ended') {
      acts.push({ ...base, action: 'moved_out', summary: `moved out${p.moveOutReason ? ` (${p.moveOutReason.toLowerCase()})` : ''}`, actorId: manager, occurredAt: `${p.moveOut}T20:00:00.000Z` });
      if (p.depositSettled) acts.push({ ...base, action: 'deposit_settled', summary: 'settled the security deposit', actorId: manager, occurredAt: `${addDays(p.moveOut!, 14)}T17:00:00.000Z` });
    }
  }
  for (const a of apps) {
    const appId = ctx2.application.get(a.number)!;
    const listing = ctx2.listing.get(a.listing)!;
    const base = { entityType: 'application' as const, entityId: appId, applicationId: appId, propertyId: listing.propertyId, unitId: listing.unitId };
    acts.push({ ...base, action: 'submitted', summary: `applied for ${listing.title}`, actorName: a.applicantName, occurredAt: at(today, a.submittedDaysAgo, 20) });
    if (a.status !== 'Submitted') acts.push({ ...base, action: 'status_changed', summary: 'started screening', actorId: ctx2.member.theo, data: { from: 'Submitted', to: 'Screening' }, occurredAt: at(today, Math.max(0, a.submittedDaysAgo - 1), 16) });
    if (a.status === 'Approved' || a.status === 'Denied') acts.push({ ...base, action: 'decided', summary: a.status === 'Approved' ? 'approved the application' : `denied the application — ${a.decisionReason}`, actorId: ctx2.member.theo, data: { to: a.status }, occurredAt: at(today, a.decidedDaysAgo!, 17) });
    if (a.status === 'Withdrawn') acts.push({ ...base, action: 'withdrawn', summary: 'withdrew the application', actorName: a.applicantName, occurredAt: at(today, a.decidedDaysAgo!, 18) });
  }
  const withNames = acts.map(a => ({ ...a, actorName: a.actorName ?? (a.actorId ? Object.entries(ctx2.member).find(([, id]) => id === a.actorId)?.[0] : null) }));
  const nameFor = (key: string | null | undefined) => (key && key in memberName ? memberName[key] : key ?? null);
  await chunked(withNames.map(a => activityRecord({ ...a, actorName: nameFor(a.actorName) })), async batch => { await zite.activity.bulkCreate({ records: batch }); });

  // clearDemoData dates the end of the seed window from these views' created_at — keep them the seed's last write.
  await zite.views.bulkCreate({ records: SAVED_VIEWS.map((v, i) => ({ name: v.name, scope: v.scope, config: JSON.stringify(v.config), ownerId: actor.id, shared: v.shared, position: i })) });
  void SCREENING_CHECKS;
}
