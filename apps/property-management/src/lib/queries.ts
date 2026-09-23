import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { bootstrap, search } from 'zitejs/api';

/**
 * Query keys in one place, so invalidation can't drift from reads.
 *
 * Every area owns a first segment and keys everything under it
 * (`['workOrders', 'list', filters]`, `['workOrders', 'detail', number]`);
 * a write invalidates its own root and any other root it changes. The roots
 * below are the contract between areas — e.g. posting a payment invalidates
 * `ledger`, `leases`, `residents`, `accounting`, `reports` and `dashboard`.
 */
export const qk = {
  bootstrap: ['bootstrap'] as const,
  search: ['search'] as const,
  dashboard: ['dashboard'] as const,
  inbox: ['inbox'] as const,
  tasks: ['tasks'] as const,
  workOrders: ['workOrders'] as const,
  schedules: ['schedules'] as const,
  inspections: ['inspections'] as const,
  vendors: ['vendors'] as const,
  properties: ['properties'] as const,
  units: ['units'] as const,
  owners: ['owners'] as const,
  leases: ['leases'] as const,
  residents: ['residents'] as const,
  ledger: ['ledger'] as const,
  leasing: ['leasing'] as const,
  accounting: ['accounting'] as const,
  reports: ['reports'] as const,
  messages: ['messages'] as const,
  announcements: ['announcements'] as const,
  documents: ['documents'] as const,
  activity: ['activity'] as const,
  settings: ['settings'] as const,
};

export type QueryRoot = keyof typeof qk;

/** Invalidate several areas at once after a write that touches them all. */
export function invalidate(qc: QueryClient, ...roots: QueryRoot[]) {
  for (const r of roots) void qc.invalidateQueries({ queryKey: qk[r] });
}

/** Anything that changes money: a lease's ledger, balances everywhere, reports. */
export function invalidateMoney(qc: QueryClient) {
  invalidate(qc, 'ledger', 'leases', 'residents', 'accounting', 'reports', 'dashboard', 'properties', 'owners', 'vendors', 'bootstrap');
}

export function useBootstrap() {
  return useQuery({ queryKey: qk.bootstrap, queryFn: () => bootstrap({}), staleTime: 60_000, refetchOnWindowFocus: true });
}

/** A missing record won't appear on retry; everything else (network, 5xx) gets a couple more tries. */
export const retryUnlessNotFound = (count: number, error: unknown) => !/not found|\(404\)|\(403\)|permission/i.test(String((error as Error)?.message ?? '')) && count < 2;

export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: [...qk.search, query],
    queryFn: () => search({ query, limit: 8 }),
    enabled: query.length > 1,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
