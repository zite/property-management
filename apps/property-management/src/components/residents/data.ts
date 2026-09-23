import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getResident, listResidents, type GetResidentOutputType, type ListResidentsInputType, type ListResidentsOutputType } from 'zitejs/api';
import { qk, retryUnlessNotFound } from '../../lib/queries';
import type { Workspace } from '../../lib/workspace';

/** Residents: list and detail queries, grouping and ordering. Keys live under `residents`. */

export type ResidentRow = ListResidentsOutputType['residents'][number];
export type ResidentDetail = GetResidentOutputType;
export type ResidentFilters = NonNullable<ListResidentsInputType['filters']>;
export type ResidentStatus = 'current' | 'future' | 'past' | 'all';

export const NAV_ORDER_KEY = 'property-management:residents:order';

export const rk = {
  list: (filters: ResidentFilters) => [...qk.residents, 'list', filters] as const,
  detail: (id: string) => [...qk.residents, 'detail', id] as const,
};

export function useResidents(filters: ResidentFilters) {
  return useQuery({ queryKey: rk.list(filters), queryFn: () => listResidents({ filters }), placeholderData: keepPreviousData, staleTime: 20_000 });
}

export function useResident(id: string | null | undefined) {
  return useQuery({ queryKey: rk.detail(id ?? ''), queryFn: () => getResident({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000 });
}

export type ResidentGrouping = 'property' | 'phase' | 'none';
export type ResidentOrdering = 'name' | 'unit' | 'balance' | 'moveIn';

export const GROUPINGS: ReadonlyArray<{ value: ResidentGrouping; label: string }> = [
  { value: 'property', label: 'Property' },
  { value: 'phase', label: 'Lease phase' },
  { value: 'none', label: 'No grouping' },
];

export const ORDERINGS: ReadonlyArray<{ value: ResidentOrdering; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'unit', label: 'Unit' },
  { value: 'balance', label: 'Balance owed' },
  { value: 'moveIn', label: 'Move-in date' },
];

export const DISPLAY_PROPERTIES = [
  { key: 'unit', label: 'Unit' },
  { key: 'phase', label: 'Lease phase' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'portal', label: 'Portal' },
  { key: 'moveIn', label: 'Move-in' },
  { key: 'balance', label: 'Balance' },
];

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function compareResidents(ordering: ResidentOrdering, ws: Workspace) {
  const unit = (r: ResidentRow) => (r.lease ? ws.unitLabel(r.lease.unitId, r.lease.propertyId) : '￿');
  const byName = (a: ResidentRow, b: ResidentRow) => collator.compare(a.name, b.name);
  switch (ordering) {
    case 'unit':
      return (a: ResidentRow, b: ResidentRow) => collator.compare(unit(a), unit(b)) || byName(a, b);
    case 'balance':
      return (a: ResidentRow, b: ResidentRow) => b.balance - a.balance || byName(a, b);
    case 'moveIn':
      return (a: ResidentRow, b: ResidentRow) => (b.lease?.moveInDate ?? '').localeCompare(a.lease?.moveInDate ?? '') || byName(a, b);
    default:
      return byName;
  }
}

export type ResidentGroup = { key: string; label: string; items: ResidentRow[]; color?: string; kind: ResidentGrouping };

export function groupResidents(rows: ResidentRow[], grouping: ResidentGrouping, ordering: ResidentOrdering, ws: Workspace): ResidentGroup[] {
  const sorted = [...rows].sort(compareResidents(ordering, ws));
  if (grouping === 'none') return [{ key: 'all', label: 'All residents', items: sorted, kind: 'none' }];
  const buckets = new Map<string, ResidentRow[]>();
  for (const r of sorted) {
    const k = grouping === 'property' ? r.lease?.propertyId ?? '__none__' : r.lease?.phase ?? '__none__';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }
  const make = (key: string, label: string, color?: string): ResidentGroup => ({ key, label, items: buckets.get(key) ?? [], color, kind: grouping });
  if (grouping === 'phase') {
    const order = ['Draft', 'Pending signature', 'Notice', 'Expiring', 'Month-to-month', 'Upcoming', 'Current', 'Ended', 'Canceled'];
    const groups = order.filter(p => buckets.has(p)).map(p => make(p, p));
    if (buckets.has('__none__')) groups.push(make('__none__', 'No lease'));
    return groups;
  }
  const groups = ws.orderedProperties.filter(p => buckets.has(p.id)).map(p => make(p.id, p.name, p.color));
  if (buckets.has('__none__')) groups.push(make('__none__', 'No lease'));
  return groups;
}
