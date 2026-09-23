import { z } from 'zod';
import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { AccountSubtype, AccountType } from '@project/shared/constants';
import type { Chart } from '@project/shared/server/accounts';
import type { OrgSettings } from '@project/shared/server/settings';
import { day, iso, num, ref, str } from '@project/shared/server/sql';

/**
 * Shared pieces for the accounting endpoints (receivables, payables, banking,
 * owners, the general ledger). Reads only — every posting goes through
 * `packages/shared/server/ledger.ts`.
 */

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.');
export const Money = z.number().positive('Enter an amount greater than zero.').max(10_000_000, 'That amount is too large.');
export const Id = z.string().min(1);

export const bad = (message: string) => new ZiteError(message, 'BAD_REQUEST');

/** Which subtypes belong to which account type. */
export const SUBTYPES_BY_TYPE: Record<AccountType, AccountSubtype[]> = {
  Asset: ['Bank', 'Receivable', 'Other asset'],
  Liability: ['Payable', 'Deposits held', 'Prepaid', 'Other liability'],
  Equity: ['Owner equity', 'Contributions', 'Distributions'],
  Income: ['Operating income', 'Other income'],
  Expense: ['Operating expense', 'Other expense'],
};

export const bankIdsOf = (chart: Chart) => chart.all.filter(a => a.subtype === 'Bank').map(a => a.id);
export const depositIdsOf = (chart: Chart) => chart.all.filter(a => a.subtype === 'Deposits held').map(a => a.id);

/** Accounts a bill or a direct expense line may be booked to. */
export function isBillableAccount(chart: Chart, accountId: string) {
  const a = chart.byId.get(accountId);
  if (!a || !a.active) return false;
  return a.accountType === 'Expense' || a.subtype === 'Other asset' || a.subtype === 'Prepaid' || a.subtype === 'Other liability';
}

/** The management fee rate for a property: its own, else its owner's, else the company default. */
export function feePercent(propertyPct: unknown, ownerPct: unknown, settings: Pick<OrgSettings, 'managementFeePercent'>) {
  if (propertyPct != null && propertyPct !== '') return num(propertyPct);
  if (ownerPct != null && ownerPct !== '') return num(ownerPct);
  return settings.managementFeePercent;
}

/** Escape a search term for ILIKE. */
export const like = (q: string) => `%${q.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`;

/** A transaction row as lists show it: header plus the names of who it involved. */
export const TXN_SELECT = `
  t.id, t."number", t."kind", t."date", t."dueDate", t."description", t."amount", t."status", t."propertyId", t."unitId", t."leaseId", t."tenantId",
  t."vendorId", t."ownerId", t."workOrderId", t."accountId", t."bankAccountId", t."paymentMethod", t."reference", t."source", t."period",
  t."attachmentUrl", t."voidReason", t."voidedAt", t."createdById", t.created_at,
  l."name" AS "leaseName", tn."name" AS "tenantName", v."name" AS "vendorName", o."name" AS "ownerName", w."number" AS "workOrderNumber"`;

export const TXN_JOINS = `
  LEFT JOIN "Leases" l ON l.id::text = t."leaseId"
  LEFT JOIN "Tenants" tn ON tn.id::text = t."tenantId"
  LEFT JOIN "Vendors" v ON v.id::text = t."vendorId"
  LEFT JOIN "Owners" o ON o.id::text = t."ownerId"
  LEFT JOIN "WorkOrders" w ON w.id::text = t."workOrderId"`;

export function toTxnRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    number: num(r.number),
    kind: String(r.kind ?? ''),
    date: day(r.date) ?? '',
    dueDate: day(r.dueDate),
    description: str(r.description) ?? '',
    amount: num(r.amount),
    status: r.status === 'Void' ? ('Void' as const) : ('Posted' as const),
    propertyId: ref(r.propertyId),
    unitId: ref(r.unitId),
    leaseId: ref(r.leaseId),
    leaseName: ref(r.leaseName),
    tenantId: ref(r.tenantId),
    tenantName: ref(r.tenantName),
    vendorId: ref(r.vendorId),
    vendorName: ref(r.vendorName),
    ownerId: ref(r.ownerId),
    ownerName: ref(r.ownerName),
    workOrderId: ref(r.workOrderId),
    workOrderNumber: r.workOrderNumber == null || r.workOrderNumber === '' ? null : num(r.workOrderNumber),
    accountId: ref(r.accountId),
    bankAccountId: ref(r.bankAccountId),
    paymentMethod: ref(r.paymentMethod),
    reference: ref(r.reference),
    source: ref(r.source),
    period: ref(r.period),
    attachmentUrl: ref(r.attachmentUrl),
    voidReason: ref(r.voidReason),
    voidedAt: iso(r.voidedAt),
    createdById: ref(r.createdById),
    createdAt: iso(r.created_at),
  };
}

export type TxnRow = ReturnType<typeof toTxnRow>;

/** Who a transaction was with, for one-line lists. */
export function partyOf(t: Pick<TxnRow, 'kind' | 'tenantName' | 'leaseName' | 'vendorName' | 'ownerName'>) {
  if (t.vendorName) return t.vendorName;
  if (t.ownerName) return t.ownerName;
  if (t.tenantName) return t.tenantName;
  return t.leaseName ?? '';
}

/** Property ids that exist, for validating input. */
export async function existingProperties(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, { id: string; name: string; ownerId: string | null; bankAccountId: string | null; status: string }>();
  const { rows } = await zite.sql({ query: `SELECT id, "name", "ownerId", "bankAccountId", "status" FROM "Properties" WHERE id::text = ANY($1)`, params: [unique] });
  return new Map(rows.map(r => [String(r.id), { id: String(r.id), name: str(r.name) ?? '', ownerId: ref(r.ownerId), bankAccountId: ref(r.bankAccountId), status: str(r.status) || 'Active' }]));
}
