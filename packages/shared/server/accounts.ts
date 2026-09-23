import { ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import type { AccountSubtype, AccountType } from '../constants';
import { bool, chunked, num, str } from './sql';

/**
 * The chart of accounts.
 *
 * A property management company keeps its books in trust for owners, so the
 * default chart is organised the way owner statements read: bank and deposit
 * accounts, receivables and payables, owner equity, then income and expense
 * categories. The posting engine finds the accounts it needs by `systemKey`,
 * so an organization can rename or renumber anything without breaking it.
 */

export type SystemKey =
  | 'operating_bank'
  | 'deposit_bank'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'deposits_held'
  | 'prepaid_rent'
  | 'owner_equity'
  | 'owner_contributions'
  | 'owner_distributions'
  | 'rent_income'
  | 'late_fee_income'
  | 'pet_income'
  | 'parking_income'
  | 'utility_income'
  | 'application_fee_income'
  | 'damage_income'
  | 'other_income'
  | 'concessions'
  | 'repairs'
  | 'turnover'
  | 'landscaping'
  | 'pest_control'
  | 'utilities'
  | 'insurance'
  | 'property_tax'
  | 'management_fees'
  | 'hoa_dues'
  | 'professional_fees'
  | 'advertising'
  | 'bad_debt'
  | 'other_expense';

export type AccountDef = {
  number: string;
  name: string;
  accountType: AccountType;
  subtype: AccountSubtype;
  systemKey: SystemKey;
  description: string;
  tenantCharge?: boolean;
  billExpense?: boolean;
};

export const DEFAULT_CHART: AccountDef[] = [
  { number: '1000', name: 'Operating Bank Account', accountType: 'Asset', subtype: 'Bank', systemKey: 'operating_bank', description: 'Rent collected and bills paid for managed properties.' },
  { number: '1010', name: 'Security Deposit Trust Account', accountType: 'Asset', subtype: 'Bank', systemKey: 'deposit_bank', description: 'Tenant security deposits held separately, where required.' },
  { number: '1100', name: 'Accounts Receivable', accountType: 'Asset', subtype: 'Receivable', systemKey: 'accounts_receivable', description: 'What tenants owe. Every lease balance is this account, by lease.' },
  { number: '2000', name: 'Accounts Payable', accountType: 'Liability', subtype: 'Payable', systemKey: 'accounts_payable', description: 'Unpaid vendor bills.' },
  { number: '2100', name: 'Security Deposits Held', accountType: 'Liability', subtype: 'Deposits held', systemKey: 'deposits_held', description: 'Deposits owed back to tenants when they move out.' },
  { number: '2200', name: 'Prepaid Rent', accountType: 'Liability', subtype: 'Prepaid', systemKey: 'prepaid_rent', description: 'Rent received before it is due.' },
  { number: '3000', name: 'Owner Equity', accountType: 'Equity', subtype: 'Owner equity', systemKey: 'owner_equity', description: 'Opening balances and retained owner funds.' },
  { number: '3100', name: 'Owner Contributions', accountType: 'Equity', subtype: 'Contributions', systemKey: 'owner_contributions', description: 'Money owners put in to cover expenses or reserves.' },
  { number: '3200', name: 'Owner Distributions', accountType: 'Equity', subtype: 'Distributions', systemKey: 'owner_distributions', description: 'Money paid out to owners.' },
  { number: '4000', name: 'Rent Income', accountType: 'Income', subtype: 'Operating income', systemKey: 'rent_income', description: 'Monthly rent.', tenantCharge: true },
  { number: '4010', name: 'Late Fees', accountType: 'Income', subtype: 'Operating income', systemKey: 'late_fee_income', description: 'Fees for rent paid after the grace period.', tenantCharge: true },
  { number: '4020', name: 'Pet Rent & Fees', accountType: 'Income', subtype: 'Operating income', systemKey: 'pet_income', description: 'Monthly pet rent and one-time pet fees.', tenantCharge: true },
  { number: '4030', name: 'Parking Income', accountType: 'Income', subtype: 'Operating income', systemKey: 'parking_income', description: 'Parking spaces and garages.', tenantCharge: true },
  { number: '4040', name: 'Utility Reimbursements', accountType: 'Income', subtype: 'Operating income', systemKey: 'utility_income', description: 'Water, sewer and trash billed back to tenants.', tenantCharge: true },
  { number: '4050', name: 'Application Fees', accountType: 'Income', subtype: 'Other income', systemKey: 'application_fee_income', description: 'Rental application fees.', tenantCharge: true },
  { number: '4060', name: 'Damage & Repair Charges', accountType: 'Income', subtype: 'Other income', systemKey: 'damage_income', description: 'Tenant-caused damage billed back.', tenantCharge: true },
  { number: '4090', name: 'Other Tenant Income', accountType: 'Income', subtype: 'Other income', systemKey: 'other_income', description: 'Anything else charged to a tenant.', tenantCharge: true },
  { number: '4900', name: 'Rent Concessions', accountType: 'Income', subtype: 'Operating income', systemKey: 'concessions', description: 'Credits and discounts given to tenants. Reduces income.' },
  { number: '5000', name: 'Repairs & Maintenance', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'repairs', description: 'Work orders and general repairs.', billExpense: true },
  { number: '5010', name: 'Cleaning & Turnover', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'turnover', description: 'Make-ready cleaning, paint and carpet between tenants.', billExpense: true },
  { number: '5020', name: 'Landscaping & Snow Removal', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'landscaping', description: 'Grounds, landscaping and snow removal.', billExpense: true },
  { number: '5030', name: 'Pest Control', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'pest_control', description: 'Routine and on-call pest control.', billExpense: true },
  { number: '5100', name: 'Utilities', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'utilities', description: 'Owner-paid water, sewer, trash, gas and electric.', billExpense: true },
  { number: '5200', name: 'Insurance', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'insurance', description: 'Property and liability insurance premiums.', billExpense: true },
  { number: '5300', name: 'Property Taxes', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'property_tax', description: 'Real estate taxes.', billExpense: true },
  { number: '5400', name: 'Management Fees', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'management_fees', description: 'Monthly property management fees.', billExpense: true },
  { number: '5500', name: 'HOA Dues', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'hoa_dues', description: 'Homeowners association dues and assessments.', billExpense: true },
  { number: '5600', name: 'Legal & Professional Fees', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'professional_fees', description: 'Attorneys, accountants and eviction costs.', billExpense: true },
  { number: '5700', name: 'Advertising & Leasing', accountType: 'Expense', subtype: 'Operating expense', systemKey: 'advertising', description: 'Listing sites, signs and leasing commissions.', billExpense: true },
  { number: '5800', name: 'Bad Debt', accountType: 'Expense', subtype: 'Other expense', systemKey: 'bad_debt', description: 'Uncollectible tenant balances written off.' },
  { number: '5900', name: 'Other Expenses', accountType: 'Expense', subtype: 'Other expense', systemKey: 'other_expense', description: 'Anything that does not fit another category.', billExpense: true },
];

export type AccountRow = {
  id: string;
  number: string;
  name: string;
  accountType: AccountType;
  subtype: AccountSubtype | '';
  systemKey: SystemKey | null;
  description: string;
  active: boolean;
  tenantCharge: boolean;
  billExpense: boolean;
  bankName: string;
  accountLast4: string;
  position: number;
};

export function toAccountRow(r: Record<string, unknown>): AccountRow {
  return {
    id: String(r.id),
    number: str(r.number) ?? '',
    name: str(r.name) ?? '',
    accountType: (str(r.accountType) || 'Asset') as AccountType,
    subtype: (str(r.subtype) ?? '') as AccountSubtype | '',
    systemKey: (str(r.systemKey) || null) as SystemKey | null,
    description: str(r.description) ?? '',
    active: r.active == null ? true : bool(r.active),
    tenantCharge: bool(r.tenantCharge),
    billExpense: bool(r.billExpense),
    bankName: str(r.bankName) ?? '',
    accountLast4: str(r.accountLast4) ?? '',
    position: num(r.position),
  };
}

/** Debit-normal accounts grow with debits; the rest grow with credits. */
export const isDebitNormal = (t: AccountType) => t === 'Asset' || t === 'Expense';

export async function loadAccounts(): Promise<AccountRow[]> {
  const { rows } = await zite.sql({ query: `SELECT * FROM "Accounts" ORDER BY "number" ASC, created_at ASC`, params: [] });
  return rows.map(toAccountRow);
}

/**
 * Create the default chart on a fresh install, and quietly add back any system
 * account that went missing — the engine can't post a payment without AR.
 */
export async function ensureChartOfAccounts(): Promise<AccountRow[]> {
  const existing = await loadAccounts();
  const keys = new Set(existing.map(a => a.systemKey).filter(Boolean));
  const missing = DEFAULT_CHART.filter(d => !keys.has(d.systemKey));
  if (!missing.length) return existing;
  await chunked(missing, async batch => {
    await zite.accounts.bulkCreate({
      records: batch.map(d => ({
        number: d.number,
        name: d.name,
        accountType: d.accountType,
        subtype: d.subtype,
        systemKey: d.systemKey,
        description: d.description,
        active: true,
        tenantCharge: Boolean(d.tenantCharge),
        billExpense: Boolean(d.billExpense),
        position: DEFAULT_CHART.indexOf(d),
      })),
    });
  });
  return loadAccounts();
}

export type Chart = {
  all: AccountRow[];
  byId: Map<string, AccountRow>;
  key: (k: SystemKey) => AccountRow;
};

let cached: { at: number; chart: Chart } | null = null;

/** The chart, indexed. Cached for a few seconds within a worker — an endpoint posting ten charges reads it once. */
export async function getChart(opts: { fresh?: boolean } = {}): Promise<Chart> {
  if (!opts.fresh && cached && Date.now() - cached.at < 5000) return cached.chart;
  const all = await ensureChartOfAccounts();
  const byId = new Map(all.map(a => [a.id, a]));
  const byKey = new Map(all.filter(a => a.systemKey).map(a => [a.systemKey as SystemKey, a]));
  const chart: Chart = {
    all,
    byId,
    key: k => {
      const a = byKey.get(k);
      if (!a) throw new ZiteError(`The chart of accounts is missing its ${k.replace(/_/g, ' ')} account`, 'INTERNAL_ERROR');
      return a;
    },
  };
  cached = { at: Date.now(), chart };
  return chart;
}

export function invalidateChart() {
  cached = null;
}
