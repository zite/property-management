import type { Role } from './constants';

/**
 * What each role may do, as capabilities rather than role checks sprinkled
 * through the code. The server enforces these (`assertCan`); the client uses
 * the same table only to hide buttons that would be refused.
 *
 *   Admin            — everything, including people, settings and the books
 *   Property Manager — runs properties day to day: leasing, maintenance, receivables, payables
 *   Leasing Agent    — listings, inquiries, applications, leases and residents; sees balances
 *   Maintenance      — work orders, vendors, inspections and schedules
 *   Accountant       — all money: receivables, payables, banking, owners and reports
 */

export const CAPABILITIES = [
  'portfolio.manage',
  'owners.manage',
  'leasing.manage',
  'residents.manage',
  'maintenance.manage',
  'maintenance.create',
  'vendors.manage',
  'accounting.view',
  'receivables.manage',
  'payables.manage',
  'banking.manage',
  'reports.view',
  'communications.send',
  'announcements.send',
  'settings.manage',
  'members.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL = [...CAPABILITIES];

const MATRIX: Record<Role, readonly Capability[]> = {
  Admin: ALL,
  'Property Manager': [
    'portfolio.manage', 'owners.manage', 'leasing.manage', 'residents.manage', 'maintenance.manage', 'maintenance.create', 'vendors.manage',
    'accounting.view', 'receivables.manage', 'payables.manage', 'reports.view', 'communications.send', 'announcements.send',
  ],
  'Leasing Agent': ['leasing.manage', 'residents.manage', 'maintenance.create', 'accounting.view', 'communications.send'],
  Maintenance: ['maintenance.manage', 'maintenance.create', 'vendors.manage', 'communications.send'],
  Accountant: ['owners.manage', 'accounting.view', 'receivables.manage', 'payables.manage', 'banking.manage', 'reports.view', 'communications.send', 'vendors.manage'],
};

export function capabilitiesFor(role: Role): Capability[] {
  return [...(MATRIX[role] ?? [])];
}

export function can(role: Role | null | undefined, capability: Capability) {
  return Boolean(role && MATRIX[role]?.includes(capability));
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Admin: 'Everything, including team members, settings and the chart of accounts.',
  'Property Manager': 'Properties, leasing, maintenance, receivables and payables. No banking or settings.',
  'Leasing Agent': 'Listings, inquiries, applications, leases and residents. Can see balances but not post money.',
  Maintenance: 'Work orders, vendors, inspections and preventive maintenance.',
  Accountant: 'Receivables, payables, banking, owner distributions, reports and the general ledger.',
};
