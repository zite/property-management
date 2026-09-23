import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { parseAreas } from '@project/shared/inspections';
import { getActor } from '@project/shared/server/actor';
import { getSettings, portalLink } from '@project/shared/server/settings';
import { day, iso, num, numOrNull, ref, str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { assertMaintenance, loadInspectionRow } from '../server/maintenance';
import { timelineActivity } from '../server/timeline';

/**
 * One inspection with its checklist, the lease and residents it's for, the
 * work orders raised from it, and — for a move-out — the move-in inspection
 * to compare against: the same lease's if there is one, otherwise the unit's
 * most recent completed move-in before this inspection.
 */

const Input = z.object({ id: z.string().min(1) });

export default createEndpoint({
  description: 'Get an inspection with its checklist, lease, work orders and move-in comparison',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'inspections');
    const { id } = parseInput(Input, input);
    const { inspection, areas } = await loadInspectionRow(id);
    const settings = await getSettings();

    const [lease, residents, workOrders, baseline, related, activity] = await Promise.all([
      inspection.leaseId
        ? zite.sql({ query: `SELECT id, "name", "number", "status", "startDate", "endDate", "moveOutDate", "deposit" FROM "Leases" WHERE id::text = $1`, params: [inspection.leaseId] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      inspection.leaseId
        ? zite.sql({
            query: `SELECT t.id, t."name", t."email", lt."role" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END, t."name" ASC`,
            params: [inspection.leaseId],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      // Work orders raised from this inspection. Until createWorkOrder records `inspectionId`, work orders
      // on the same unit since the inspection that came from the walkthrough (source Inspection, or the
      // "Item — Room" title the walkthrough gives them) stand in.
      zite.sql({
        query: `
          SELECT "number", "title", "status", "priority", "category", "inspectionId", "reportedAt", created_at FROM "WorkOrders"
          WHERE "inspectionId" = $1
             OR (COALESCE("inspectionId", '') = '' AND "unitId" = $2 AND $2 <> '' AND COALESCE("reportedAt", created_at) >= $3::timestamptz
                 AND ("source" = 'Inspection' OR "title" = ANY($4)))
          ORDER BY "number" ASC LIMIT 100`,
        params: [
          id,
          inspection.unitId ?? '',
          inspection.scheduledFor ? new Date(Date.parse(inspection.scheduledFor) - 86_400_000).toISOString() : inspection.createdAt ?? new Date().toISOString(),
          areas.flatMap(a => a.items.map(it => `${it.name} — ${a.name}`)),
        ],
      }),
      inspection.type === 'Move-out' && inspection.unitId
        ? zite.sql({
            query: `
              SELECT id, "title", "leaseId", "completedAt", "scheduledFor", "overallCondition", "areas" FROM "Inspections"
              WHERE id::text <> $1 AND "inspectionType" = 'Move-in' AND "status" = 'Completed' AND "unitId" = $2
                AND ("leaseId" = $3 OR COALESCE("completedAt", "scheduledFor") <= $4::timestamptz)
              ORDER BY CASE WHEN "leaseId" = $3 THEN 0 ELSE 1 END, "completedAt" DESC NULLS LAST LIMIT 1`,
            params: [id, inspection.unitId, inspection.leaseId ?? '__none__', inspection.scheduledFor ?? new Date().toISOString()],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      // The other half of a move-in/move-out pair on the same lease, for a link between them.
      inspection.leaseId && (inspection.type === 'Move-in' || inspection.type === 'Move-out')
        ? zite.sql({ query: `SELECT id, "title", "status", "inspectionType" FROM "Inspections" WHERE "leaseId" = $1 AND id::text <> $2 AND "inspectionType" = $3 AND "status" <> 'Canceled' ORDER BY COALESCE("scheduledFor", created_at) DESC LIMIT 1`, params: [inspection.leaseId, id, inspection.type === 'Move-in' ? 'Move-out' : 'Move-in'] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      timelineActivity('entityId', id),
    ]);

    const l = lease.rows[0];
    const b = baseline.rows[0];
    const r = related.rows[0];
    return {
      inspection,
      areas,
      lease: l ? { id: String(l.id), name: str(l.name) ?? '', number: numOrNull(l.number), status: str(l.status) ?? '', startDate: day(l.startDate), endDate: day(l.endDate), moveOutDate: day(l.moveOutDate), depositAmount: num(l.deposit) } : null,
      residents: residents.rows.map(t => ({ id: String(t.id), name: str(t.name) ?? 'Resident', email: str(t.email) ?? '', role: str(t.role) ?? 'Primary' })),
      workOrders: workOrders.rows.map(w => ({ number: num(w.number), title: str(w.title) ?? '', status: str(w.status) || 'New', priority: str(w.priority) || 'Normal', category: str(w.category) || 'General', linked: Boolean(ref(w.inspectionId)) })),
      baseline: b ? { id: String(b.id), title: str(b.title) ?? 'Move-in inspection', sameLease: Boolean(inspection.leaseId && String(b.leaseId) === inspection.leaseId), completedAt: iso(b.completedAt) ?? iso(b.scheduledFor), overallCondition: ref(b.overallCondition), areas: parseAreas(b.areas) } : null,
      related: r ? { id: String(r.id), title: str(r.title) ?? '', status: str(r.status) ?? '', type: str(r.inspectionType) ?? '' } : null,
      portalLinked: Boolean(portalLink(settings)),
      activity,
    };
  },
});
