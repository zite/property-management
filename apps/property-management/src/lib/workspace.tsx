import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { formatMoney, type MoneyFormat } from '@project/shared/money';
import { can, type Capability } from '@project/shared/roles';
import type { Role } from '@project/shared/constants';
import type { Account, Bootstrap, Member, Owner, Property, SavedView, Unit, Vendor } from './types';

/**
 * The reference data every screen renders names from, indexed once.
 *
 * Lists return ids for properties, units, people, vendors and accounts; this
 * is where an id becomes "The Alder · 204", an avatar or an account name. One
 * memoised context is what lets an optimistic edit re-render every surface
 * from a single cache write.
 */
export type Workspace = Bootstrap & {
  role: Role;
  can: (capability: Capability) => boolean;
  isAdmin: boolean;
  memberById: Map<string, Member>;
  activeMembers: Member[];
  ownerById: Map<string, Owner>;
  propertyById: Map<string, Property>;
  unitById: Map<string, Unit>;
  unitsByProperty: Map<string, Unit[]>;
  vendorById: Map<string, Vendor>;
  activeVendors: Vendor[];
  accountById: Map<string, Account>;
  accountByKey: Map<string, Account>;
  viewById: Map<string, SavedView>;
  /** Active properties in name order, archived last. */
  orderedProperties: Property[];
  bankAccounts: Account[];
  chargeAccounts: Account[];
  expenseAccounts: Account[];
  money: (n: number | null | undefined, opts?: MoneyFormat) => string;
  /** "The Alder · 204", "2217 Elm Street" (single-unit properties drop the unit). */
  unitLabel: (unitId: string | null | undefined, propertyId?: string | null) => string;
  propertyName: (propertyId: string | null | undefined) => string;
  memberName: (memberId: string | null | undefined) => string;
};

const WorkspaceContext = createContext<Workspace | null>(null);

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map(i => [i.id, i]));

export function buildWorkspace(data: Bootstrap): Workspace {
  const role = data.me.role as Role;
  const memberById = byId(data.members);
  const propertyById = byId(data.properties);
  const unitById = byId(data.units);
  const unitsByProperty = new Map<string, Unit[]>();
  for (const u of data.units) {
    if (!unitsByProperty.has(u.propertyId)) unitsByProperty.set(u.propertyId, []);
    unitsByProperty.get(u.propertyId)!.push(u);
  }
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  for (const list of unitsByProperty.values()) list.sort((a, b) => collator.compare(a.name, b.name));
  const accounts = data.accounts.filter(a => a.active);
  const currency = data.settings.currency || 'USD';

  const unitLabel = (unitId: string | null | undefined, propertyId?: string | null) => {
    const unit = unitId ? unitById.get(unitId) : undefined;
    const property = propertyById.get(unit?.propertyId ?? propertyId ?? '');
    if (!unit) return property?.name ?? '';
    const single = (unitsByProperty.get(unit.propertyId)?.length ?? 0) <= 1;
    return single ? property?.name ?? unit.name : `${property?.name ?? ''} · ${unit.name}`;
  };

  return {
    ...data,
    role,
    can: cap => can(role, cap),
    isAdmin: role === 'Admin',
    memberById,
    activeMembers: data.members.filter(m => m.status !== 'Deactivated'),
    ownerById: byId(data.owners),
    propertyById,
    unitById,
    unitsByProperty,
    vendorById: byId(data.vendors),
    activeVendors: data.vendors.filter(v => v.status !== 'Inactive'),
    accountById: byId(data.accounts),
    accountByKey: new Map(data.accounts.filter(a => a.systemKey).map(a => [a.systemKey!, a])),
    viewById: byId(data.views),
    orderedProperties: [...data.properties].sort((a, b) => Number(a.status === 'Archived') - Number(b.status === 'Archived') || collator.compare(a.name, b.name)),
    bankAccounts: accounts.filter(a => a.subtype === 'Bank'),
    chargeAccounts: accounts.filter(a => a.tenantCharge),
    expenseAccounts: accounts.filter(a => a.accountType === 'Expense'),
    money: (n, opts) => formatMoney(n ?? 0, currency, opts),
    unitLabel,
    propertyName: id => (id ? propertyById.get(id)?.name ?? '' : ''),
    memberName: id => (id ? memberById.get(id)?.name ?? 'Former teammate' : ''),
  };
}

export function WorkspaceProvider({ data, children }: { data: Bootstrap; children: ReactNode }) {
  const value = useMemo(() => buildWorkspace(data), [data]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ws;
}
