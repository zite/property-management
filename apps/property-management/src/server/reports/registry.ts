import type { ReportDoc } from '../../components/reports/doc';
import { buildAging } from './aging';
import { buildBalanceSheet, buildTrialBalance } from './balances';
import type { ReportScope } from './common';
import { buildGeneralLedger } from './generalLedger';
import { buildIncomeStatement } from './incomeStatement';
import { buildExpirations, buildLeasingFunnel, buildVacancy } from './leasing';
import { buildOccupancy } from './occupancy';
import { buildVendorSpend, buildWorkOrders } from './operations';
import { buildDeposits, buildPayments } from './receivables';
import { buildRentRoll } from './rentRoll';
import { buildCashFlow, buildOwnerStatement } from './statements';

/** Report key → builder, for the PDF endpoint (each report endpoint imports only its own builder). */
export const BUILDERS: Record<string, (scope: ReportScope) => Promise<ReportDoc>> = {
  'income-statement': buildIncomeStatement,
  'balance-sheet': buildBalanceSheet,
  'cash-flow': buildCashFlow,
  'trial-balance': buildTrialBalance,
  'general-ledger': buildGeneralLedger,
  'owner-statement': buildOwnerStatement,
  'rent-roll': buildRentRoll,
  aging: buildAging,
  payments: buildPayments,
  deposits: buildDeposits,
  vacancy: buildVacancy,
  'lease-expirations': buildExpirations,
  'leasing-funnel': buildLeasingFunnel,
  'work-orders': buildWorkOrders,
  'vendor-spend': buildVendorSpend,
  occupancy: buildOccupancy,
};
