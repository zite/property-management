import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { formatDay } from '@project/shared/dates';
import { applicationRef, workOrderRef } from '@project/shared/leases';
import { logActivity, type ActivityInput } from '@project/shared/server/activity';
import { can, type Actor } from '@project/shared/server/actor';
import { notify } from '@project/shared/server/notify';
import { day, iso, numOrNull, ref, str, withRetry } from '@project/shared/server/sql';

/**
 * Tasks on the server: the row shape every task endpoint returns, who may see
 * and change which tasks, and the one place a change has its side effects
 * (completion timestamps, the audit trail, the assignee's inbox).
 *
 * Everyone manages their own tasks — assigned to them or created by them.
 * Managers and admins (`maintenance.manage` or `settings.manage`) see and
 * change everyone's.
 */

export const OPEN_TASK_STATUSES = ['To do', 'In progress'] as const;

export const canManageAllTasks = (actor: Pick<Actor, 'role'>) => can(actor.role, 'maintenance.manage') || can(actor.role, 'settings.manage');

export const TASK_SELECT = `
  t.id, t."title", t."description", t."status", t."priority", t."category", t."dueDate", t."assigneeId", t."propertyId", t."unitId",
  t."leaseId", t."tenantId", t."ownerId", t."vendorId", t."workOrderId", t."applicationId", t."createdById", t."completedAt",
  t."systemKey", t."openedAt", t.created_at,
  l."name" AS "leaseName", tn."name" AS "tenantName", o."name" AS "ownerName", v."name" AS "vendorName",
  w."number" AS "workOrderNumber", w."title" AS "workOrderTitle", ap."number" AS "applicationNumber", ap."applicantName" AS "applicationName"`;

export const TASK_FROM = `
  "Tasks" t
  LEFT JOIN "Leases" l ON l.id::text = t."leaseId"
  LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
  LEFT JOIN "Owners" o ON o.id::text = t."ownerId"
  LEFT JOIN "Vendors" v ON v.id::text = t."vendorId"
  LEFT JOIN "WorkOrders" w ON w.id::text = t."workOrderId"
  LEFT JOIN "Applications" ap ON ap.id::text = t."applicationId"`;

export type TaskRow = ReturnType<typeof toTask>;

export function toTask(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    title: str(r.title) ?? '',
    description: str(r.description) ?? '',
    status: str(r.status) || 'To do',
    priority: str(r.priority) || 'Normal',
    category: str(r.category) || 'General',
    dueDate: day(r.dueDate),
    assigneeId: ref(r.assigneeId),
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    leaseId: ref(r.leaseId),
    tenantId: ref(r.tenantId),
    ownerId: ref(r.ownerId),
    vendorId: ref(r.vendorId),
    workOrderId: ref(r.workOrderId),
    applicationId: ref(r.applicationId),
    createdById: ref(r.createdById),
    completedAt: iso(r.completedAt),
    systemKey: ref(r.systemKey),
    openedAt: iso(r.openedAt) ?? iso(r.created_at),
    leaseName: ref(r.leaseName),
    tenantName: ref(r.tenantName),
    ownerName: ref(r.ownerName),
    vendorName: ref(r.vendorName),
    workOrderNumber: numOrNull(r.workOrderNumber),
    workOrderTitle: ref(r.workOrderTitle),
    applicationNumber: numOrNull(r.applicationNumber),
    applicationName: ref(r.applicationName),
  };
}

export async function loadTask(id: string) {
  const { rows } = await zite.sql({ query: `SELECT ${TASK_SELECT} FROM ${TASK_FROM} WHERE t.id::text = $1 LIMIT 1`, params: [id] });
  if (!rows[0]) throw new ZiteError('That task no longer exists.', 'NOT_FOUND');
  return toTask(rows[0]);
}

/** Many tasks in one read, in the order asked for. Any id that doesn't exist fails the whole request. */
export async function loadTasks(ids: string[]) {
  const unique = [...new Set(ids)];
  const { rows } = await zite.sql({ query: `SELECT ${TASK_SELECT} FROM ${TASK_FROM} WHERE t.id::text = ANY($1)`, params: [unique] });
  const byId = new Map(rows.map(r => [String(r.id), toTask(r)]));
  if (byId.size !== unique.length) throw new ZiteError(unique.length === 1 ? 'That task no longer exists.' : 'Some of those tasks no longer exist. Reload and try again.', 'NOT_FOUND');
  return unique.map(id => byId.get(id)!);
}

/** Missing and not-yours read the same, so a task id reveals nothing. */
export function assertCanSeeTask(actor: Actor, task: TaskRow) {
  if (canManageAllTasks(actor) || task.assigneeId === actor.id || task.createdById === actor.id) return;
  throw new ZiteError('That task no longer exists.', 'NOT_FOUND');
}

export type TaskLinks = {
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  tenantId?: string | null;
  ownerId?: string | null;
  vendorId?: string | null;
  workOrderId?: string | null;
  applicationId?: string | null;
};

const LINK_TABLES: Record<keyof TaskLinks, { table: string; noun: string }> = {
  propertyId: { table: 'Properties', noun: 'property' },
  unitId: { table: 'Units', noun: 'unit' },
  leaseId: { table: 'Leases', noun: 'lease' },
  tenantId: { table: 'Tenants', noun: 'resident' },
  ownerId: { table: 'Owners', noun: 'owner' },
  vendorId: { table: 'Vendors', noun: 'vendor' },
  workOrderId: { table: 'WorkOrders', noun: 'work order' },
  applicationId: { table: 'Applications', noun: 'application' },
};

/**
 * Check every linked record exists and fill in where it is: a lease, work
 * order or application brings its property and unit, a unit its property — so
 * a task linked to a lease still groups under its building.
 */
export async function resolveLinks(links: TaskLinks): Promise<Required<TaskLinks>> {
  const out: Required<TaskLinks> = { propertyId: null, unitId: null, leaseId: null, tenantId: null, ownerId: null, vendorId: null, workOrderId: null, applicationId: null };
  for (const key of Object.keys(LINK_TABLES) as Array<keyof TaskLinks>) out[key] = links[key] || null;
  const located = async (table: string, id: string, noun: string) => {
    const hasUnit = table !== 'Properties' && table !== 'Tenants' && table !== 'Owners' && table !== 'Vendors';
    const cols = table === 'Units' ? `"propertyId", '' AS "unitId"` : hasUnit ? `"propertyId", "unitId"` : `'' AS "propertyId", '' AS "unitId"`;
    const { rows } = await zite.sql({ query: `SELECT id, ${cols} FROM "${table}" WHERE id::text = $1 LIMIT 1`, params: [id] });
    if (!rows[0]) throw new ZiteError(`That ${noun} no longer exists. Choose another.`, 'NOT_FOUND');
    return { propertyId: ref(rows[0].propertyId), unitId: table === 'Units' ? id : ref(rows[0].unitId) };
  };
  for (const key of ['workOrderId', 'leaseId', 'applicationId', 'unitId', 'propertyId', 'tenantId', 'ownerId', 'vendorId'] as const) {
    const id = out[key];
    if (!id) continue;
    const { table, noun } = LINK_TABLES[key];
    const where = await located(table, id, noun);
    if (!out.unitId && where.unitId) out.unitId = where.unitId;
    if (!out.propertyId && where.propertyId) out.propertyId = where.propertyId;
  }
  return out;
}

export async function assertActiveMember(id: string) {
  const { rows } = await zite.sql({ query: `SELECT id, "name", "status" FROM "Members" WHERE id::text = $1 LIMIT 1`, params: [id] });
  const m = rows[0];
  if (!m || m.status === 'Deactivated') throw new ZiteError('That teammate isn’t active. Choose someone else.', 'BAD_REQUEST');
  return { id: String(m.id), name: str(m.name) ?? 'a teammate' };
}

/** What the task is about, for activity summaries and notification bodies. */
export function taskContext(t: TaskRow) {
  if (t.workOrderNumber) return `${workOrderRef(t.workOrderNumber)} ${t.workOrderTitle ?? ''}`.trim();
  if (t.leaseName) return t.leaseName;
  if (t.applicationNumber) return `${applicationRef(t.applicationNumber)} ${t.applicationName ?? ''}`.trim();
  return t.tenantName ?? t.vendorName ?? t.ownerName ?? null;
}

export function activityTags(t: Pick<TaskRow, 'propertyId' | 'unitId' | 'leaseId' | 'tenantId' | 'ownerId' | 'vendorId' | 'workOrderId' | 'applicationId'>) {
  return { propertyId: t.propertyId, unitId: t.unitId, leaseId: t.leaseId, tenantId: t.tenantId, ownerId: t.ownerId, vendorId: t.vendorId, workOrderId: t.workOrderId, applicationId: t.applicationId };
}

export type TaskPatch = Partial<{
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  dueDate: string | null;
  assigneeId: string | null;
}> &
  TaskLinks;

const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 77)}…` : s}”`;

/**
 * Apply a patch to one task: write only what changed, then describe each
 * change once in the audit trail. Returns the activity entries and who needs
 * telling, so a bulk edit can batch both.
 */
export async function applyTaskPatch(actor: Actor, before: TaskRow, patch: TaskPatch, names: { member: (id: string | null) => string }) {
  const record: Record<string, unknown> = {};
  const entries: ActivityInput[] = [];
  const now = new Date().toISOString();
  const base = { entityType: 'task' as const, entityId: before.id, actorId: actor.id, actorName: actor.name };
  const title = patch.title !== undefined ? patch.title : before.title;
  const tags = activityTags(before);
  const log = (action: string, summary: string, data?: Record<string, unknown>) => entries.push({ ...base, ...tags, action, summary, data });

  if (patch.title !== undefined && patch.title !== before.title) {
    record.title = patch.title;
    log('renamed', `renamed a task to ${quote(patch.title)}`, { from: before.title, to: patch.title });
  }
  if (patch.description !== undefined && patch.description !== before.description) {
    record.description = patch.description || null;
    log('description_changed', `updated the description of ${quote(title)}`);
  }
  if (patch.status !== undefined && patch.status !== before.status) {
    record.status = patch.status;
    if (patch.status === 'Done') record.completedAt = now;
    else if (before.status === 'Done' || before.completedAt) record.completedAt = null;
    const summary =
      patch.status === 'Done' ? `completed ${quote(title)}` :
      patch.status === 'Canceled' ? `canceled ${quote(title)}` :
      before.status === 'Done' || before.status === 'Canceled' ? `reopened ${quote(title)}` :
      `moved ${quote(title)} to ${patch.status}`;
    log('status_changed', summary, { from: before.status, to: patch.status });
  }
  if (patch.priority !== undefined && patch.priority !== before.priority) {
    record.priority = patch.priority;
    log('priority_changed', `set ${quote(title)} to ${patch.priority.toLowerCase()} priority`, { from: before.priority, to: patch.priority });
  }
  if (patch.category !== undefined && patch.category !== before.category) {
    record.category = patch.category;
    log('category_changed', `moved ${quote(title)} to ${patch.category}`, { from: before.category, to: patch.category });
  }
  if (patch.dueDate !== undefined && (patch.dueDate ?? null) !== before.dueDate) {
    record.dueDate = patch.dueDate;
    log('due_changed', patch.dueDate ? `set ${quote(title)} due ${formatDay(patch.dueDate)}` : `removed the due date from ${quote(title)}`, { from: before.dueDate, to: patch.dueDate });
  }
  let newAssignee: string | null = null;
  if (patch.assigneeId !== undefined && (patch.assigneeId ?? null) !== before.assigneeId) {
    if (patch.assigneeId) await assertActiveMember(patch.assigneeId);
    record.assigneeId = patch.assigneeId;
    newAssignee = patch.assigneeId ?? null;
    const who = patch.assigneeId === actor.id ? 'themselves' : patch.assigneeId ? names.member(patch.assigneeId) : null;
    log('assigned', who ? `assigned ${quote(title)} to ${who}` : `unassigned ${quote(title)}`, { from: before.assigneeId, to: patch.assigneeId });
  }
  const linkKeys = Object.keys(LINK_TABLES) as Array<keyof TaskLinks>;
  if (linkKeys.some(k => patch[k] !== undefined)) {
    const next = await resolveLinks(Object.fromEntries(linkKeys.map(k => [k, patch[k] !== undefined ? patch[k] : before[k]])) as TaskLinks);
    const changed = linkKeys.filter(k => (next[k] ?? null) !== (before[k] ?? null));
    for (const k of changed) record[k] = next[k];
    if (changed.length) log('links_changed', `changed what ${quote(title)} is linked to`);
  }

  if (!Object.keys(record).length) return { changed: false, entries, notifyAssignee: null as string | null };
  await withRetry(() => zite.tasks.update({ id: before.id, record: record as never }));
  return { changed: true, entries, notifyAssignee: newAssignee && newAssignee !== actor.id ? newAssignee : null };
}

export async function memberNames() {
  const { rows } = await zite.sql({ query: `SELECT id, "name" FROM "Members"`, params: [] });
  const map = new Map(rows.map(r => [String(r.id), str(r.name) ?? '']));
  return { member: (id: string | null) => (id ? map.get(id) || 'a former teammate' : 'nobody') };
}

export async function notifyAssigned(actor: Actor, assigneeId: string, tasks: TaskRow[]) {
  if (!tasks.length || assigneeId === actor.id) return;
  const one = tasks.length === 1 ? tasks[0] : null;
  const due = one?.dueDate ? `Due ${formatDay(one.dueDate)}.` : '';
  const sentence = (s: string) => (s && !/[.!?…]$/.test(s) ? `${s}.` : s);
  await notify({
    recipientIds: [assigneeId],
    kind: 'task_assigned',
    title: one ? `${actor.name} assigned you: ${one.title}` : `${actor.name} assigned you ${tasks.length} tasks`,
    body: one ? [sentence(one.description.trim().slice(0, 280)), due].filter(Boolean).join(' ') || taskContext(one) : tasks.slice(0, 5).map(t => t.title).join(' · '),
    link: one ? `/tasks?task=${one.id}` : '/tasks',
    entityType: 'task',
    entityId: one?.id ?? null,
    actorId: actor.id,
    actorName: actor.name,
  });
}

export { logActivity };
