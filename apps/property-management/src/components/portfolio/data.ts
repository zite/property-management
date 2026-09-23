import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  getOwner, getOwnerStatementStaff, getProperty, getPropertyFinancials, getUnit, listOwners, listOwnerTransactions, listProperties, listPropertyLeases, updateUnits,
  type GetOwnerOutputType, type GetOwnerStatementStaffOutputType, type GetPropertyFinancialsOutputType, type GetPropertyOutputType, type GetUnitOutputType,
  type ListOwnersOutputType, type ListOwnerTransactionsOutputType, type ListPropertiesOutputType, type ListPropertyLeasesOutputType,
} from 'zitejs/api';
import { COLORS, type UnitReadiness } from '@project/shared/constants';
import type { Tone } from '@project/shared/tone';
import { errorMessage } from '../../lib/errors';
import { invalidate, qk, retryUnlessNotFound } from '../../lib/queries';
import type { Bootstrap, Property, Unit } from '../../lib/types';

/**
 * Portfolio data: query keys, hooks and the optimistic unit edits.
 *
 * Properties, units and owners live in bootstrap (names, occupancy, current
 * rent), so a readiness change is written into that cache first — the units
 * table, the unit page's rail and every unit picker update at once — then
 * reconciled with the server on a short debounce.
 */

export type PropertyStats = ListPropertiesOutputType['stats'][number];
export type PropertyDetail = GetPropertyOutputType;
export type PropertyLease = ListPropertyLeasesOutputType['leases'][number];
export type PropertyFinancials = GetPropertyFinancialsOutputType;
export type UnitDetail = GetUnitOutputType;
export type OwnerRow = ListOwnersOutputType['owners'][number];
export type OwnerDetail = GetOwnerOutputType;
export type OwnerStatementData = GetOwnerStatementStaffOutputType;
export type OwnerTransaction = ListOwnerTransactionsOutputType['transactions'][number];

export const pk = {
  propertyStats: [...qk.properties, 'stats'] as const,
  property: (id: string) => [...qk.properties, 'detail', id] as const,
  propertyLeases: (id: string) => [...qk.properties, 'leases', id] as const,
  financials: (id: string) => [...qk.properties, 'financials', id] as const,
  unit: (id: string) => [...qk.units, 'detail', id] as const,
  owners: [...qk.owners, 'list'] as const,
  owner: (id: string) => [...qk.owners, 'detail', id] as const,
  statement: (id: string, period: string) => [...qk.owners, 'statement', id, period] as const,
  ownerTransactions: (id: string) => [...qk.owners, 'transactions', id] as const,
};

export function usePropertyStats() {
  return useQuery({ queryKey: pk.propertyStats, queryFn: () => listProperties({}), staleTime: 30_000, placeholderData: keepPreviousData });
}

export function useProperty(id: string | null | undefined) {
  return useQuery({ queryKey: pk.property(id ?? ''), queryFn: () => getProperty({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 15_000 });
}

export function usePropertyLeases(id: string | null | undefined, enabled = true) {
  return useQuery({ queryKey: pk.propertyLeases(id ?? ''), queryFn: () => listPropertyLeases({ propertyId: id! }), enabled: Boolean(id) && enabled, staleTime: 20_000 });
}

export function usePropertyFinancials(id: string, enabled = true) {
  return useQuery({ queryKey: pk.financials(id), queryFn: () => getPropertyFinancials({ propertyId: id, months: 12 }), enabled, staleTime: 60_000 });
}

export function useUnitDetail(id: string | null | undefined) {
  return useQuery({ queryKey: pk.unit(id ?? ''), queryFn: () => getUnit({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 15_000 });
}

export function useOwners(enabled = true) {
  return useQuery({ queryKey: pk.owners, queryFn: () => listOwners({}), enabled, staleTime: 30_000, placeholderData: keepPreviousData });
}

export function useOwner(id: string | null | undefined) {
  return useQuery({ queryKey: pk.owner(id ?? ''), queryFn: () => getOwner({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 15_000 });
}

export function useOwnerStatement(ownerId: string, period: string, enabled = true) {
  return useQuery({ queryKey: pk.statement(ownerId, period), queryFn: () => getOwnerStatementStaff({ ownerId, period }), enabled, staleTime: 60_000, placeholderData: keepPreviousData });
}

export function useOwnerTransactions(ownerId: string, enabled = true) {
  return useQuery({ queryKey: pk.ownerTransactions(ownerId), queryFn: () => listOwnerTransactions({ ownerId }), enabled, staleTime: 30_000 });
}

/** Everything a property, unit or owner write can change. */
export function afterPortfolioWrite(qc: QueryClient) {
  invalidate(qc, 'bootstrap', 'properties', 'units', 'owners', 'search');
}

// ─── Readiness ──────────────────────────────────────────────────────────────

export const READINESS_META: Record<UnitReadiness, { tone: Tone; color: string; hint: string }> = {
  Ready: { tone: 'success', color: COLORS.green, hint: 'Rent-ready' },
  'Make ready': { tone: 'warning', color: COLORS.amber, hint: 'Turnover in progress' },
  Down: { tone: 'danger', color: COLORS.red, hint: 'Not habitable' },
  'Off market': { tone: 'neutral', color: COLORS.gray, hint: 'Not offered for rent' },
};

// ─── Occupancy ──────────────────────────────────────────────────────────────

export type OccupancyCounts = { total: number; occupied: number; notice: number; vacant: number; rate: number };

export function occupancyOf(units: Array<Pick<Unit, 'occupancy' | 'archived'>>): OccupancyCounts {
  const live = units.filter(u => !u.archived);
  const occupied = live.filter(u => u.occupancy === 'Occupied').length;
  const notice = live.filter(u => u.occupancy === 'Notice').length;
  const vacant = live.filter(u => u.occupancy === 'Vacant').length;
  const total = live.length;
  return { total, occupied, notice, vacant, rate: total ? (occupied + notice) / total : 0 };
}

export const propertyAddress = (p: Pick<Property, 'street' | 'city' | 'state' | 'postalCode'>) => {
  const cityLine = [p.city, [p.state, p.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [p.street, cityLine].filter(Boolean).join(', ');
};

/** Round rents read as "$1,850"; an amount with cents keeps them ("$1,234,567.89"). */
export const hasCents = (n: number | null | undefined) => n != null && Math.round(Math.abs(n) * 100) % 100 !== 0;

export const SINGLE_UNIT_TYPES = ['Single-family', 'Condo'];
export const isSingleUnitType = (type: string | null | undefined) => SINGLE_UNIT_TYPES.includes(type ?? '');

// ─── Optimistic unit edits ──────────────────────────────────────────────────

export type UnitPatch = Partial<{ readiness: UnitReadiness; marketRent: number; depositAmount: number; availableOn: string | null }>;

const timers = new Map<string, number>();
function refreshSoon(qc: QueryClient, delay = 1200) {
  window.clearTimeout(timers.get('units'));
  timers.set('units', window.setTimeout(() => { timers.delete('units'); afterPortfolioWrite(qc); }, delay));
}

export function useUnitActions() {
  const qc = useQueryClient();
  const update = useCallback(
    async (targets: Array<{ id: string; name?: string }>, patch: UnitPatch, opts: { toast?: string | false } = {}) => {
      if (!targets.length) return;
      const ids = new Set(targets.map(t => t.id));
      await qc.cancelQueries({ queryKey: qk.bootstrap });
      const snapBoot = qc.getQueryData<Bootstrap>(qk.bootstrap);
      const snapUnits = qc.getQueriesData<UnitDetail>({ queryKey: [...qk.units, 'detail'] });
      qc.setQueryData<Bootstrap>(qk.bootstrap, old => (old ? { ...old, units: old.units.map(u => (ids.has(u.id) ? { ...u, ...patch } : u)) } : old));
      qc.setQueriesData<UnitDetail>({ queryKey: [...qk.units, 'detail'] }, old => (old && ids.has(old.unit.id) ? { ...old, unit: { ...old.unit, ...patch } } : old));
      try {
        await updateUnits({ ids: [...ids], patch });
        refreshSoon(qc, targets.length > 1 ? 300 : 1200);
        if (opts.toast !== false && (opts.toast || targets.length > 1)) toast.success(opts.toast || `Updated ${targets.length} units`);
      } catch (e) {
        if (snapBoot) qc.setQueryData(qk.bootstrap, snapBoot);
        for (const [key, data] of snapUnits) qc.setQueryData(key, data);
        toast.error(errorMessage(e, targets.length === 1 ? `Couldn’t update ${targets[0].name ?? 'the unit'}` : `Couldn’t update ${targets.length} units`));
        throw e;
      }
    },
    [qc],
  );
  return { update };
}
