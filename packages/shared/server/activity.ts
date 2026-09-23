import { zite } from 'zitejs/db';
import { chunked, withRetry } from './sql';

/**
 * The audit trail. Anything a person would later ask "who did that, and
 * when?" about writes one row: a payment voided, a lease signed, a work order
 * reassigned, an application denied. Timelines on every record read from it.
 *
 * `summary` is a finished sentence fragment ("moved WO-1042 to Scheduled"),
 * written at the time, so the timeline never has to reconstruct history from
 * ids that may since have been renamed or deleted.
 */

export type EntityType = 'property' | 'unit' | 'owner' | 'tenant' | 'lease' | 'application' | 'inquiry' | 'listing' | 'work_order' | 'vendor' | 'inspection' | 'transaction' | 'task' | 'announcement' | 'settings' | 'member' | 'schedule';

export type ActivityInput = {
  entityType: EntityType;
  entityId: string;
  action: string;
  summary: string;
  actorId?: string | null;
  actorName?: string | null;
  data?: Record<string, unknown> | null;
  occurredAt?: string;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  tenantId?: string | null;
  ownerId?: string | null;
  vendorId?: string | null;
  workOrderId?: string | null;
  applicationId?: string | null;
};

export function activityRecord(e: ActivityInput, now = new Date().toISOString()) {
  return {
    summary: e.summary.slice(0, 250),
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    actorId: e.actorId ?? null,
    actorName: e.actorName ?? (e.actorId ? null : 'System'),
    data: e.data ? JSON.stringify(e.data) : null,
    occurredAt: e.occurredAt ?? now,
    propertyId: e.propertyId ?? null,
    unitId: e.unitId ?? null,
    leaseId: e.leaseId ?? null,
    tenantId: e.tenantId ?? null,
    ownerId: e.ownerId ?? null,
    vendorId: e.vendorId ?? null,
    workOrderId: e.workOrderId ?? null,
    applicationId: e.applicationId ?? null,
  };
}

/** Best-effort: an audit write failing must never undo the change it describes. */
export async function logActivity(entries: ActivityInput | ActivityInput[]) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  const now = new Date().toISOString();
  try {
    await chunked(list, async batch => {
      // A millisecond apart, so a batch reads in the order it was written.
      await withRetry(() => zite.activity.bulkCreate({ records: batch.map((e, i) => activityRecord({ ...e, occurredAt: e.occurredAt ?? new Date(Date.parse(now) + i).toISOString() }, now)) }));
    });
  } catch (e) {
    console.error('Activity write failed', e instanceof Error ? e.message : e);
  }
}

export type ActivityRow = {
  id: string;
  summary: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  data: Record<string, unknown>;
  occurredAt: string;
};

export function toActivityRow(r: Record<string, unknown>): ActivityRow {
  let data: Record<string, unknown> = {};
  try {
    data = r.data ? JSON.parse(String(r.data)) : {};
  } catch {
    data = {};
  }
  return {
    id: String(r.id),
    summary: String(r.summary ?? ''),
    entityType: String(r.entityType ?? ''),
    entityId: String(r.entityId ?? ''),
    action: String(r.action ?? ''),
    actorId: r.actorId ? String(r.actorId) : null,
    actorName: r.actorName ? String(r.actorName) : null,
    data,
    occurredAt: r.occurredAt ? new Date(String(r.occurredAt)).toISOString() : new Date(String(r.created_at ?? Date.now())).toISOString(),
  };
}

/**
 * The timeline for a record: everything logged against it, or tagged with it
 * (a lease's timeline includes its payments and work orders).
 */
export async function activityFor(column: 'entityId' | 'propertyId' | 'unitId' | 'leaseId' | 'tenantId' | 'ownerId' | 'vendorId' | 'workOrderId' | 'applicationId', id: string, limit = 100) {
  const { rows } = await zite.sql({
    query: `SELECT * FROM "Activity" WHERE "${column}" = $1 OR "entityId" = $1 ORDER BY "occurredAt" DESC NULLS LAST, created_at DESC LIMIT ${Math.min(500, Math.max(1, limit))}`,
    params: [id],
  });
  return rows.map(toActivityRow);
}
