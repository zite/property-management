import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  getInspection, getVendor, listInspections, listSchedules, listVendors, saveSchedule, saveVendor,
  type GetInspectionOutputType, type GetVendorOutputType, type ListInspectionsOutputType, type ListSchedulesOutputType, type ListVendorsOutputType, type SaveVendorInputType,
} from 'zitejs/api';
import type { Tone } from '@project/shared/tone';
import { errorMessage } from '../../lib/errors';
import { invalidate, qk, retryUnlessNotFound } from '../../lib/queries';

/**
 * Data for vendors, inspections and preventive maintenance: query keys, hooks
 * and the optimistic writes for the frequent actions (toggling compliance
 * flags, pausing a schedule). Inspection item autosave lives next to the
 * walkthrough in `useInspectionAutosave.ts`.
 */

export type VendorRow = ListVendorsOutputType['vendors'][number];
export type VendorDetail = GetVendorOutputType;
export type InspectionRow = ListInspectionsOutputType['inspections'][number];
export type InspectionDetail = GetInspectionOutputType;
export type ScheduleRow = ListSchedulesOutputType['schedules'][number];
export type VendorPatch = Extract<SaveVendorInputType, { action: 'update' }>['patch'];
export type InsuranceStatus = VendorRow['compliance']['insurance'];

export const mk = {
  vendorList: [...qk.vendors, 'list'] as const,
  vendor: (id: string) => [...qk.vendors, 'detail', id] as const,
  vendorDetails: [...qk.vendors, 'detail'] as const,
  inspectionLists: [...qk.inspections, 'list'] as const,
  inspectionList: (history: boolean) => [...qk.inspections, 'list', history] as const,
  inspection: (id: string) => [...qk.inspections, 'detail', id] as const,
  scheduleList: [...qk.schedules, 'list'] as const,
};

export function useVendors() {
  return useQuery({ queryKey: mk.vendorList, queryFn: () => listVendors({}), staleTime: 30_000, placeholderData: keepPreviousData });
}

export function useVendor(id: string | undefined) {
  return useQuery({ queryKey: mk.vendor(id ?? ''), queryFn: () => getVendor({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 15_000 });
}

export function useInspections(history: boolean) {
  return useQuery({ queryKey: mk.inspectionList(history), queryFn: () => listInspections({ history }), staleTime: 20_000, placeholderData: keepPreviousData });
}

export function useInspection(id: string | undefined) {
  return useQuery({ queryKey: mk.inspection(id ?? ''), queryFn: () => getInspection({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000, refetchOnWindowFocus: false });
}

export function useSchedules() {
  return useQuery({ queryKey: mk.scheduleList, queryFn: () => listSchedules({}), staleTime: 20_000, placeholderData: keepPreviousData });
}

// ─── Display helpers ────────────────────────────────────────────────────────

export const INSURANCE_LABEL: Record<InsuranceStatus, string> = { Valid: 'Valid', Expiring: 'Expires soon', Expired: 'Expired', Missing: 'Missing', 'Not required': 'Not required' };
export const INSURANCE_TONE: Record<InsuranceStatus, Tone> = { Valid: 'success', Expiring: 'warning', Expired: 'danger', Missing: 'danger', 'Not required': 'neutral' };

export const CONDITION_TONE: Record<string, Tone> = { Excellent: 'success', Good: 'success', Fair: 'warning', Poor: 'danger', Damaged: 'danger', Missing: 'danger', 'N/A': 'neutral' };
export const CONDITION_RANK: Record<string, number> = { Good: 0, Fair: 1, Poor: 2, Damaged: 3, Missing: 3 };
export const FLAGGED = ['Poor', 'Damaged', 'Missing'];
export const isFlagged = (c: string | null | undefined) => Boolean(c && FLAGGED.includes(c));

export const INSPECTION_STATUS_TONE: Record<string, Tone> = { Scheduled: 'info', 'In progress': 'warning', Completed: 'success', Canceled: 'neutral' };

// ─── Optimistic vendor edits ────────────────────────────────────────────────

type Snapshot = Array<[readonly unknown[], unknown]>;

function patchVendorCaches(qc: QueryClient, id: string, patch: Partial<VendorRow>) {
  qc.setQueryData<ListVendorsOutputType>(mk.vendorList, old => (old ? { ...old, vendors: old.vendors.map(v => (v.id === id ? { ...v, ...patch } : v)) } : old));
  qc.setQueryData<VendorDetail>(mk.vendor(id), old => (old ? { ...old, vendor: { ...old.vendor, ...patch } } : old));
}

export function useVendorActions() {
  const qc = useQueryClient();

  const update = useCallback(
    async (id: string, patch: VendorPatch, opts: { toast?: string } = {}) => {
      await qc.cancelQueries({ queryKey: qk.vendors });
      const snap: Snapshot = [...qc.getQueriesData({ queryKey: mk.vendorList }), ...qc.getQueriesData({ queryKey: mk.vendor(id) })];
      patchVendorCaches(qc, id, patch as Partial<VendorRow>);
      try {
        await saveVendor({ action: 'update', id, patch });
        if (opts.toast) toast.success(opts.toast);
      } catch (e) {
        for (const [key, data] of snap) qc.setQueryData(key, data);
        toast.error(errorMessage(e, 'Couldn’t update the vendor'));
        throw e;
      } finally {
        // Compliance and derived counts are recomputed on the server.
        invalidate(qc, 'vendors', 'bootstrap');
      }
    },
    [qc],
  );

  const setStatus = useCallback(
    async (id: string, status: 'Active' | 'Inactive') => {
      try {
        await saveVendor({ action: 'status', id, status });
        invalidate(qc, 'vendors', 'bootstrap');
      } catch (e) {
        toast.error(errorMessage(e, status === 'Inactive' ? 'Couldn’t deactivate the vendor' : 'Couldn’t reactivate the vendor'));
        throw e;
      }
    },
    [qc],
  );

  return { update, setStatus };
}

// ─── Optimistic schedule toggles ────────────────────────────────────────────

export function useScheduleActions() {
  const qc = useQueryClient();
  const setActive = useCallback(
    async (s: Pick<ScheduleRow, 'id' | 'title'>, active: boolean) => {
      await qc.cancelQueries({ queryKey: qk.schedules });
      const prev = qc.getQueryData<ListSchedulesOutputType>(mk.scheduleList);
      qc.setQueryData<ListSchedulesOutputType>(mk.scheduleList, old => (old ? { ...old, schedules: old.schedules.map(x => (x.id === s.id ? { ...x, active } : x)) } : old));
      try {
        await saveSchedule({ action: 'setActive', id: s.id, active });
        toast.success(active ? `Resumed “${s.title}”` : `Paused “${s.title}”`, {
          action: { label: 'Undo', onClick: () => void saveSchedule({ action: 'setActive', id: s.id, active: !active }).then(() => invalidate(qc, 'schedules')).catch(e => toast.error(errorMessage(e, 'Couldn’t undo'))) },
        });
      } catch (e) {
        if (prev) qc.setQueryData(mk.scheduleList, prev);
        toast.error(errorMessage(e, active ? 'Couldn’t resume the schedule' : 'Couldn’t pause the schedule'));
      } finally {
        invalidate(qc, 'schedules');
      }
    },
    [qc],
  );
  return { setActive };
}
