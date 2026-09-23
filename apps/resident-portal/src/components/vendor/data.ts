import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getVendorProfile,
  getVendorWorkOrder,
  listVendorBills,
  listVendorWorkOrders,
  updateVendorWorkOrder,
  type GetVendorProfileOutputType,
  type GetVendorWorkOrderOutputType,
  type ListVendorBillsOutputType,
  type ListVendorWorkOrdersOutputType,
  type UpdateVendorWorkOrderInputType,
} from 'zitejs/api';
import { errorMessage } from '../../lib/errors';
import { qk, retry } from '../../lib/queries';

/** The vendor area's queries, all under ['portal', 'vendor']. */

export type VendorWorkOrders = ListVendorWorkOrdersOutputType;
export type VendorRow = VendorWorkOrders['workOrders'][number];
export type VendorWorkOrderDetail = GetVendorWorkOrderOutputType;
export type VendorBills = ListVendorBillsOutputType;
export type VendorProfile = GetVendorProfileOutputType;

export const vendorKeys = {
  all: qk.vendor,
  workOrders: [...qk.vendor, 'work-orders'] as const,
  workOrder: (number: number) => [...qk.vendor, 'work-order', number] as const,
  bills: [...qk.vendor, 'bills'] as const,
  profile: [...qk.vendor, 'profile'] as const,
};

export const useVendorWorkOrders = () => useQuery({ queryKey: vendorKeys.workOrders, queryFn: () => listVendorWorkOrders({}), retry, staleTime: 15_000 });
export const useVendorWorkOrder = (number: number) =>
  useQuery({ queryKey: vendorKeys.workOrder(number), queryFn: () => getVendorWorkOrder({ number }), retry, staleTime: 15_000, enabled: Number.isInteger(number) && number > 0 });
export const useVendorBills = () => useQuery({ queryKey: vendorKeys.bills, queryFn: () => listVendorBills({}), retry, staleTime: 60_000 });
export const useVendorProfile = () => useQuery({ queryKey: vendorKeys.profile, queryFn: () => getVendorProfile({}), retry, staleTime: 60_000 });

const SUCCESS: Record<UpdateVendorWorkOrderInputType['action'], (ref: string) => string> = {
  schedule: ref => `${ref} is scheduled. The resident has been told when to expect you.`,
  start: ref => `${ref} is in progress.`,
  complete: ref => `${ref} is marked complete. Thanks — send your invoice when it’s ready.`,
  hold: ref => `${ref} is on hold. The office has your reason.`,
};

/**
 * Move a job along. The list and the job page update at once; if the server
 * refuses, both roll back and the reason is shown.
 */
export function useVendorUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateVendorWorkOrderInputType) => updateVendorWorkOrder(input),
    onMutate: async input => {
      const optimistic: Partial<VendorRow> =
        input.action === 'start'
          ? { status: 'In progress', startedAt: new Date().toISOString() }
          : input.action === 'schedule'
            ? { scheduledFor: new Date(input.scheduledFor).toISOString() }
            : input.action === 'hold'
              ? { status: 'On hold' }
              : { status: 'Completed', open: false, completedAt: new Date().toISOString(), actualCost: input.actualCost };
      await Promise.all([qc.cancelQueries({ queryKey: vendorKeys.workOrders }), qc.cancelQueries({ queryKey: vendorKeys.workOrder(input.number) })]);
      const prevList = qc.getQueryData<VendorWorkOrders>(vendorKeys.workOrders);
      const prevDetail = qc.getQueryData<VendorWorkOrderDetail>(vendorKeys.workOrder(input.number));
      qc.setQueryData<VendorWorkOrders>(vendorKeys.workOrders, old => (old ? { ...old, workOrders: old.workOrders.map(w => (w.number === input.number ? { ...w, ...optimistic } : w)) } : old));
      qc.setQueryData<VendorWorkOrderDetail>(vendorKeys.workOrder(input.number), old => (old ? { ...old, workOrder: { ...old.workOrder, ...optimistic } } : old));
      return { prevList, prevDetail };
    },
    onError: (e, input, ctx) => {
      if (ctx?.prevList) qc.setQueryData(vendorKeys.workOrders, ctx.prevList);
      if (ctx?.prevDetail) qc.setQueryData(vendorKeys.workOrder(input.number), ctx.prevDetail);
      toast.error(errorMessage(e, 'That update didn’t save. Try again.'));
    },
    onSuccess: (row, input) => {
      qc.setQueryData<VendorWorkOrders>(vendorKeys.workOrders, old => (old ? { ...old, workOrders: old.workOrders.map(w => (w.number === row.number ? row : w)) } : old));
      qc.setQueryData<VendorWorkOrderDetail>(vendorKeys.workOrder(input.number), old => (old ? { ...old, workOrder: { ...old.workOrder, ...row } } : old));
      toast.success(SUCCESS[input.action](row.ref));
    },
    onSettled: (_r, _e, input) => {
      qc.invalidateQueries({ queryKey: vendorKeys.workOrder(input.number) });
      qc.invalidateQueries({ queryKey: vendorKeys.workOrders });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
