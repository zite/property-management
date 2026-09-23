import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getLeaseLedger, type GetLeaseLedgerOutputType } from 'zitejs/api';
import { invalidateMoney, qk, retryUnlessNotFound } from '../../lib/queries';

/**
 * A lease's ledger, shared by the lease page, the resident page, accounting
 * and the payment dialogs. Keyed under `ledger` so every money write
 * (`invalidateMoney`) refreshes it wherever it's open.
 */

export type LeaseLedgerData = GetLeaseLedgerOutputType;
export type LedgerEntry = LeaseLedgerData['entries'][number];
export type OpenCharge = LeaseLedgerData['openCharges'][number];
export type RecurringCharge = LeaseLedgerData['recurring'][number];

export const ledgerKey = (leaseId: string) => [...qk.ledger, leaseId] as const;

export function useLeaseLedger(leaseId: string | null | undefined) {
  return useQuery({
    queryKey: ledgerKey(leaseId ?? ''),
    queryFn: () => getLeaseLedger({ leaseId: leaseId! }),
    enabled: Boolean(leaseId),
    retry: retryUnlessNotFound,
    staleTime: 15_000,
  });
}

/** After any posting: the ledger itself, balances everywhere, reports, and the lease/resident/work order that show them. */
export function afterPosting(qc: QueryClient) {
  invalidateMoney(qc);
  void qc.invalidateQueries({ queryKey: qk.workOrders });
  void qc.invalidateQueries({ queryKey: qk.activity });
}

export const KIND_LABEL: Record<string, string> = {
  Charge: 'Charge',
  Payment: 'Payment',
  Credit: 'Credit',
  Refund: 'Refund',
  'Deposit application': 'Deposit applied',
  'Journal entry': 'Adjustment',
};
