import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getAccountRegister, getBanking, getChartBalances, getOwnerFunds, getReceivables, getReconciliation, getTransaction, listBillPayments, listBills, listPayments, listTransactions, runManagementFees,
  type GetAccountRegisterInputType, type GetAccountRegisterOutputType, type GetBankingOutputType, type GetChartBalancesOutputType, type GetOwnerFundsOutputType, type GetReceivablesOutputType,
  type GetReconciliationOutputType, type GetTransactionOutputType, type ListBillPaymentsInputType, type ListBillPaymentsOutputType, type ListBillsInputType, type ListBillsOutputType,
  type ListPaymentsInputType, type ListPaymentsOutputType, type ListTransactionsInputType, type ListTransactionsOutputType, type RunManagementFeesOutputType,
} from 'zitejs/api';
import { qk, retryUnlessNotFound } from '../../lib/queries';

/**
 * Accounting queries. Everything lives under the `accounting` root, so any
 * money write (`invalidateMoney` / `afterPosting`) refreshes every open view
 * — receivables, payables, banking, owners, the ledger and the chart.
 */

export type ReceivableLease = GetReceivablesOutputType['leases'][number];
export type PaymentRow = ListPaymentsOutputType['payments'][number];
export type BillRow = ListBillsOutputType['bills'][number];
export type BillPaymentRow = ListBillPaymentsOutputType['payments'][number];
export type BankAccountSummary = GetBankingOutputType['accounts'][number];
export type RegisterData = GetAccountRegisterOutputType;
export type RegisterEntry = RegisterData['entries'][number];
export type ReconciliationData = GetReconciliationOutputType;
export type OwnerFundsRow = GetOwnerFundsOutputType['properties'][number];
export type FeeRow = RunManagementFeesOutputType['rows'][number];
export type TxnListRow = ListTransactionsOutputType['transactions'][number];
export type TransactionDetail = GetTransactionOutputType;
export type ChartAccount = GetChartBalancesOutputType['accounts'][number];
export type BillStatus = NonNullable<ListBillsInputType['status']>;

export const ak = {
  receivables: [...qk.accounting, 'receivables'] as const,
  payments: (f: ListPaymentsInputType) => [...qk.accounting, 'payments', f] as const,
  bills: (f: ListBillsInputType) => [...qk.accounting, 'bills', f] as const,
  billPayments: (f: ListBillPaymentsInputType) => [...qk.accounting, 'billPayments', f] as const,
  banking: [...qk.accounting, 'banking'] as const,
  register: (f: GetAccountRegisterInputType) => [...qk.accounting, 'register', f] as const,
  reconciliation: (accountId: string) => [...qk.accounting, 'reconciliation', accountId] as const,
  owners: [...qk.accounting, 'owners'] as const,
  fees: (period: string) => [...qk.accounting, 'fees', period] as const,
  transactions: (f: ListTransactionsInputType) => [...qk.accounting, 'transactions', f] as const,
  transaction: (id: string) => [...qk.accounting, 'transaction', id] as const,
  chart: [...qk.accounting, 'chart'] as const,
};

export const useReceivables = () => useQuery({ queryKey: ak.receivables, queryFn: () => getReceivables({}), staleTime: 20_000 });
export const usePayments = (f: ListPaymentsInputType, enabled = true) => useQuery({ queryKey: ak.payments(f), queryFn: () => listPayments(f), placeholderData: keepPreviousData, staleTime: 20_000, enabled });
export const useBills = (f: ListBillsInputType, enabled = true) => useQuery({ queryKey: ak.bills(f), queryFn: () => listBills(f), placeholderData: keepPreviousData, staleTime: 20_000, enabled });
export const useBillPayments = (f: ListBillPaymentsInputType, enabled = true) => useQuery({ queryKey: ak.billPayments(f), queryFn: () => listBillPayments(f), placeholderData: keepPreviousData, staleTime: 20_000, enabled });
export const useBanking = () => useQuery({ queryKey: ak.banking, queryFn: () => getBanking({}), staleTime: 20_000 });
export const useRegister = (f: GetAccountRegisterInputType) => useQuery({ queryKey: ak.register(f), queryFn: () => getAccountRegister(f), placeholderData: keepPreviousData, retry: retryUnlessNotFound, staleTime: 15_000 });
export const useReconciliation = (accountId: string, enabled = true) => useQuery({ queryKey: ak.reconciliation(accountId), queryFn: () => getReconciliation({ accountId }), retry: retryUnlessNotFound, staleTime: 10_000, enabled });
export const useOwnerFunds = (enabled = true) => useQuery({ queryKey: ak.owners, queryFn: () => getOwnerFunds({}), staleTime: 20_000, enabled });
export const useFeePreview = (period: string, enabled = true) => useQuery({ queryKey: ak.fees(period), queryFn: () => runManagementFees({ action: 'preview', period }), placeholderData: keepPreviousData, staleTime: 10_000, enabled });
export const useTransactions = (f: ListTransactionsInputType) => useQuery({ queryKey: ak.transactions(f), queryFn: () => listTransactions(f), placeholderData: keepPreviousData, staleTime: 15_000 });
export const useTransaction = (id: string | null) => useQuery({ queryKey: ak.transaction(id ?? ''), queryFn: () => getTransaction({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000 });
export const useChart = () => useQuery({ queryKey: ak.chart, queryFn: () => getChartBalances({}), staleTime: 20_000 });

/** How each transaction kind reads in a list. */
export const TXN_LABEL: Record<string, string> = {
  Charge: 'Charge',
  Payment: 'Payment',
  Credit: 'Credit',
  Refund: 'Refund',
  'Deposit application': 'Deposit applied',
  Bill: 'Bill',
  'Bill payment': 'Bill payment',
  Expense: 'Expense',
  'Owner contribution': 'Contribution',
  'Owner distribution': 'Distribution',
  'Management fee': 'Mgmt fee',
  Transfer: 'Transfer',
  'Journal entry': 'Journal entry',
};

/** Who may void a kind (mirrors voidLedgerTransaction). */
export const VOID_CAPABILITY: Record<string, 'receivables.manage' | 'payables.manage' | 'banking.manage'> = {
  Charge: 'receivables.manage',
  Payment: 'receivables.manage',
  Credit: 'receivables.manage',
  Refund: 'receivables.manage',
  'Deposit application': 'receivables.manage',
  Bill: 'payables.manage',
  'Bill payment': 'payables.manage',
  Expense: 'payables.manage',
};
export const voidCapability = (kind: string) => VOID_CAPABILITY[kind] ?? 'banking.manage';

/** Date presets shared by the registers. */
export type RangePreset = '30' | '90' | 'year' | 'all';
export function rangeFor(preset: RangePreset, today: string): { from?: string; to?: string } {
  if (preset === 'all') return {};
  if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01` };
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Number(preset));
  return { from: d.toISOString().slice(0, 10) };
}
export const RANGE_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All' },
] as const;
