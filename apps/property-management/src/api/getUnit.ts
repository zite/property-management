import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { todayIn } from '@project/shared/dates';
import { isOccupying } from '@project/shared/leases';
import { can, canAny, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { day, iso, num, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { canSeeMoney, leaseSummaries, loadProperty, loadUnit, type LeaseSummary } from '../server/portfolio';
import { timelineActivity } from '../server/timeline';

/**
 * One unit: the record, its property, the lease living in it today (and the
 * one coming next), its lease history, inspections, listings and history.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get a unit with its current lease, history, inspections and listing',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const { id } = parseInput(Input, input);
    const unit = await loadUnit(id);
    if (!unit) throw new ZiteError('That unit doesn’t exist, or it was deleted.', 'NOT_FOUND');
    const settings = await getSettings();
    const today = todayIn(settings.timezone);
    const money = canSeeMoney(actor);
    const seeLeases = canAny(actor, 'residents.manage', 'portfolio.manage', 'accounting.view');

    const [property, leases, inspections, listings, activity, docCount] = await Promise.all([
      loadProperty(unit.propertyId),
      // Maintenance still needs to know who lives there; contact details come without money.
      leaseSummaries(`l."unitId" = $1`, [id], { today, money }),
      zite.sql({
        query: `SELECT id, "title", "inspectionType", "status", "scheduledFor", "completedAt", "overallCondition", "inspectorId" FROM "Inspections" WHERE "unitId" = $1 ORDER BY COALESCE("completedAt", "scheduledFor", created_at) DESC LIMIT 50`,
        params: [id],
      }),
      zite.sql({ query: `SELECT id, "title", "status", "rent", "availableOn", "publishedAt", "views" FROM "Listings" WHERE "unitId" = $1 ORDER BY created_at DESC LIMIT 10`, params: [id] }),
      timelineActivity('unitId', id, 150),
      zite.sql({ query: `SELECT COUNT(*) AS n FROM "Documents" WHERE "unitId" = $1`, params: [id] }),
    ]);

    const current = leases.find(l => isOccupying(l, today)) ?? null;
    const upcoming = leases.filter(l => (l.status === 'Active' || l.status === 'Pending signature') && l.startDate && l.startDate > today && l.id !== current?.id).sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0] ?? null;
    const live = leases.filter(l => l.status === 'Active' || l.status === 'Pending signature').length;
    const strip = (l: LeaseSummary): LeaseSummary => (seeLeases ? l : { ...l, residents: l.residents.map(r => ({ ...r, email: '', phone: '' })) });

    return {
      today,
      money,
      canManage: can(actor.role, 'portfolio.manage'),
      seeLeases,
      unit,
      property: property ? { id: property.id, name: property.name, code: property.code, propertyType: property.propertyType, status: property.status, color: property.color, street: property.street, city: property.city, state: property.state, postalCode: property.postalCode, photoUrl: property.photoUrl, managerId: property.managerId, ownerId: property.ownerId } : null,
      currentLease: current ? strip(current) : null,
      upcomingLease: upcoming ? strip(upcoming) : null,
      liveLeaseCount: live,
      leases: seeLeases ? leases : [],
      inspections: inspections.rows.map(r => ({ id: String(r.id), title: str(r.title) ?? '', inspectionType: str(r.inspectionType) ?? '', status: str(r.status) ?? '', scheduledFor: iso(r.scheduledFor), completedAt: iso(r.completedAt), overallCondition: str(r.overallCondition) ?? '', inspectorId: ref(r.inspectorId) })),
      listings: listings.rows.map(r => ({ id: String(r.id), title: str(r.title) ?? '', status: str(r.status) ?? 'Draft', rent: num(r.rent), availableOn: day(r.availableOn), publishedAt: iso(r.publishedAt), views: num(r.views) })),
      documentCount: num(docCount.rows[0]?.n),
      activity,
    };
  },
});
