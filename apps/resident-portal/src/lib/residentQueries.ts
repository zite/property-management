import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getPaymentReceipt,
  getResidentHome,
  getResidentLease,
  getResidentRequest,
  listResidentDocuments,
  listResidentLedger,
  listResidentMessages,
  listResidentRequests,
  type GetResidentHomeOutputType,
  type GetResidentLeaseOutputType,
  type GetResidentRequestOutputType,
  type ListResidentDocumentsOutputType,
  type ListResidentLedgerOutputType,
  type ListResidentMessagesOutputType,
  type ListResidentRequestsOutputType,
} from 'zitejs/api';
import { qk, retry } from './queries';

/**
 * Resident-area queries. Keys live under ['portal', 'resident', leaseId, …],
 * so switching leases never shows one home's data under another, and a write
 * invalidates the whole area (plus the nav badges in `me`) with one prefix.
 */

export type ResidentHome = GetResidentHomeOutputType;
export type ResidentLedger = ListResidentLedgerOutputType;
export type LedgerRow = ResidentLedger['entries'][number];
export type ResidentRequests = ListResidentRequestsOutputType;
export type RequestRow = ResidentRequests['open'][number];
export type ResidentRequestDetail = GetResidentRequestOutputType;
export type ResidentLeaseDetail = GetResidentLeaseOutputType;
export type ResidentDocuments = ListResidentDocumentsOutputType;
export type ResidentDocument = ResidentDocuments['documents'][number];
export type ResidentMessages = ListResidentMessagesOutputType;
export type ThreadMessage = ResidentMessages['messages'][number];

export const rk = {
  all: qk.resident,
  lease: (leaseId: string | null) => [...qk.resident, leaseId ?? 'none'] as const,
  home: (leaseId: string | null) => [...rk.lease(leaseId), 'home'] as const,
  ledger: (leaseId: string | null) => [...rk.lease(leaseId), 'ledger'] as const,
  receipt: (leaseId: string | null, id: string) => [...rk.lease(leaseId), 'receipt', id] as const,
  requests: (leaseId: string | null) => [...rk.lease(leaseId), 'requests'] as const,
  request: (leaseId: string | null, number: number) => [...rk.lease(leaseId), 'request', number] as const,
  leaseDetail: (leaseId: string | null) => [...rk.lease(leaseId), 'lease'] as const,
  documents: (leaseId: string | null) => [...rk.lease(leaseId), 'documents'] as const,
  messages: (leaseId: string | null) => [...rk.lease(leaseId), 'messages'] as const,
};

export function useResidentHome(leaseId: string | null) {
  return useQuery({ queryKey: rk.home(leaseId), queryFn: () => getResidentHome({ leaseId }), enabled: Boolean(leaseId), retry, staleTime: 15_000 });
}

export function useResidentLedger(leaseId: string | null) {
  return useQuery({ queryKey: rk.ledger(leaseId), queryFn: () => listResidentLedger({ leaseId }), enabled: Boolean(leaseId), retry, staleTime: 30_000 });
}

export function useReceipt(leaseId: string | null, transactionId: string | null) {
  return useQuery({
    queryKey: rk.receipt(leaseId, transactionId ?? ''),
    queryFn: () => getPaymentReceipt({ leaseId, transactionId: transactionId! }),
    enabled: Boolean(leaseId && transactionId),
    retry,
    staleTime: 60_000,
  });
}

export function useResidentRequests(leaseId: string | null) {
  return useQuery({ queryKey: rk.requests(leaseId), queryFn: () => listResidentRequests({ leaseId }), enabled: Boolean(leaseId), retry, staleTime: 15_000 });
}

export function useResidentRequest(leaseId: string | null, number: number) {
  return useQuery({
    queryKey: rk.request(leaseId, number),
    queryFn: () => getResidentRequest({ leaseId, number }),
    enabled: Boolean(leaseId) && Number.isInteger(number) && number > 0,
    retry,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });
}

export function useResidentLeaseDetail(leaseId: string | null) {
  return useQuery({ queryKey: rk.leaseDetail(leaseId), queryFn: () => getResidentLease({ leaseId }), enabled: Boolean(leaseId), retry, staleTime: 30_000 });
}

export function useResidentDocuments(leaseId: string | null) {
  return useQuery({ queryKey: rk.documents(leaseId), queryFn: () => listResidentDocuments({ leaseId }), enabled: Boolean(leaseId), retry, staleTime: 30_000 });
}

export function useResidentMessages(leaseId: string | null) {
  return useQuery({ queryKey: rk.messages(leaseId), queryFn: () => listResidentMessages({ leaseId }), enabled: Boolean(leaseId), retry, staleTime: 10_000, refetchInterval: 45_000 });
}

/** After any resident write: refresh the area and the nav badges. */
export function useRefreshResident() {
  const qc = useQueryClient();
  return useCallback(() => Promise.all([qc.invalidateQueries({ queryKey: rk.all }), qc.invalidateQueries({ queryKey: qk.me })]), [qc]);
}
