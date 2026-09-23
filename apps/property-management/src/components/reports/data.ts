import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  reportAging, reportBalanceSheet, reportCashFlow, reportDeposits, reportExpirations, reportGeneralLedger, reportIncomeStatement, reportLeasingFunnel,
  reportOccupancy, reportOwnerStatement, reportPayments, reportRentRoll, reportTrialBalance, reportVacancy, reportVendorSpend, reportWorkOrders,
} from 'zitejs/api';
import { qk } from '../../lib/queries';
import type { ReportInputValues } from './catalog';
import type { ReportDoc } from './doc';

/**
 * Fetching reports. Each report has its own endpoint (so each is its own small
 * bundle on the server); they all take the same resolved parameters and
 * return a ReportDoc. Keys live under `['reports', key, input]`, which every
 * money write already invalidates (`invalidateMoney`).
 */

type Caller = (input: ReportInputValues) => Promise<unknown>;

const CALLERS: Record<string, Caller> = {
  'income-statement': reportIncomeStatement as Caller,
  'balance-sheet': reportBalanceSheet as Caller,
  'cash-flow': reportCashFlow as Caller,
  'trial-balance': reportTrialBalance as Caller,
  'general-ledger': reportGeneralLedger as Caller,
  'owner-statement': reportOwnerStatement as Caller,
  'rent-roll': reportRentRoll as Caller,
  aging: reportAging as Caller,
  payments: reportPayments as Caller,
  deposits: reportDeposits as Caller,
  vacancy: reportVacancy as Caller,
  'lease-expirations': reportExpirations as Caller,
  'leasing-funnel': reportLeasingFunnel as Caller,
  'work-orders': reportWorkOrders as Caller,
  'vendor-spend': reportVendorSpend as Caller,
  occupancy: reportOccupancy as Caller,
};

export function useReport(key: string, input: ReportInputValues) {
  return useQuery({
    queryKey: [...qk.reports, key, input],
    queryFn: async () => (await CALLERS[key](input)) as ReportDoc,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: (count, error) => !/permission|can’t see|\(403\)|\(400\)/i.test(String((error as Error)?.message ?? '')) && count < 2,
  });
}

// ── Recently viewed ─────────────────────────────────────────────────────────

const RECENT_KEY = 'property-management:reports:recent';

export type RecentReport = { key: string; search: string; at: string };

export function readRecent(): RecentReport[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(r => r && typeof r.key === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Remember a report (with the parameters it was last opened with), most recent first. */
export function rememberReport(key: string, search: string) {
  try {
    const next = [{ key, search, at: new Date().toISOString() }, ...readRecent().filter(r => r.key !== key)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function forgetRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage unavailable */
  }
}
