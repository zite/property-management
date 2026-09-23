import { useQuery } from '@tanstack/react-query';
import {
  getOwnerOverview,
  getOwnerProperty,
  getOwnerStatement,
  listOwnerApprovals,
  listOwnerDocuments,
  listOwnerMessages,
  type GetOwnerOverviewOutputType,
  type GetOwnerPropertyOutputType,
  type GetOwnerStatementOutputType,
  type ListOwnerApprovalsOutputType,
  type ListOwnerDocumentsOutputType,
  type ListOwnerMessagesOutputType,
} from 'zitejs/api';
import { qk, retry } from '../../lib/queries';

/** The owner area's queries. Every key sits under ['portal', 'owner'], so a write invalidates the whole area with one prefix. */

export type OwnerOverview = GetOwnerOverviewOutputType;
export type OwnerProperty = GetOwnerPropertyOutputType;
export type OwnerStatementData = GetOwnerStatementOutputType;
export type Statement = OwnerStatementData['statement'];
export type StatementFigures = Statement['combined'];
export type OwnerApprovals = ListOwnerApprovalsOutputType;
export type Approval = OwnerApprovals['pending'][number];
export type OwnerDocuments = ListOwnerDocumentsOutputType;
export type OwnerMessages = ListOwnerMessagesOutputType;

export const ownerKeys = {
  all: qk.owner,
  overview: [...qk.owner, 'overview'] as const,
  property: (id: string) => [...qk.owner, 'property', id] as const,
  statement: (period: string, propertyId: string | null) => [...qk.owner, 'statement', period, propertyId ?? 'all'] as const,
  approvals: [...qk.owner, 'approvals'] as const,
  documents: [...qk.owner, 'documents'] as const,
  messages: [...qk.owner, 'messages'] as const,
};

export const useOwnerOverview = () => useQuery({ queryKey: ownerKeys.overview, queryFn: () => getOwnerOverview({}), retry, staleTime: 30_000 });
export const useOwnerProperty = (id: string) => useQuery({ queryKey: ownerKeys.property(id), queryFn: () => getOwnerProperty({ id }), retry, staleTime: 30_000, enabled: Boolean(id) });
export const useOwnerStatement = (period: string, propertyId: string | null) =>
  useQuery({ queryKey: ownerKeys.statement(period, propertyId), queryFn: () => getOwnerStatement({ period, propertyId }), retry, staleTime: 60_000, placeholderData: prev => prev });
export const useOwnerApprovals = () => useQuery({ queryKey: ownerKeys.approvals, queryFn: () => listOwnerApprovals({}), retry, staleTime: 20_000 });
export const useOwnerDocuments = () => useQuery({ queryKey: ownerKeys.documents, queryFn: () => listOwnerDocuments({}), retry, staleTime: 60_000 });
export const useOwnerMessages = () => useQuery({ queryKey: ownerKeys.messages, queryFn: () => listOwnerMessages({}), retry, staleTime: 15_000 });
