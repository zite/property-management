import type { LeasePhase, Occupancy } from './constants';
import { addDays, daysBetween } from './dates';

/**
 * What a lease is doing today, derived from its stored status and dates.
 *
 * Stored status only moves on real events (signed, activated, ended). Whether
 * an active lease is "expiring", "on notice" or "month-to-month" depends on
 * today's date, so it is computed, never saved — nothing goes stale overnight.
 */

export type LeaseDates = {
  status: string;
  leaseType?: string | null;
  startDate: string | null;
  endDate: string | null;
  noticeGivenOn?: string | null;
  moveOutDate?: string | null;
};

export function leasePhase(l: LeaseDates, today: string, expiringDays = 60): LeasePhase {
  switch (l.status) {
    case 'Draft':
      return 'Draft';
    case 'Pending signature':
      return 'Pending signature';
    case 'Ended':
      return 'Ended';
    case 'Canceled':
      return 'Canceled';
  }
  if (l.startDate && l.startDate > today) return 'Upcoming';
  if (l.noticeGivenOn || (l.moveOutDate && l.moveOutDate >= today)) return 'Notice';
  if (l.leaseType === 'Month-to-month' || (l.endDate && l.endDate < today)) return 'Month-to-month';
  if (l.endDate && daysBetween(today, l.endDate) <= expiringDays) return 'Expiring';
  return 'Current';
}

/** Is this lease putting someone in the unit today? */
export function isOccupying(l: LeaseDates, today: string) {
  if (l.status !== 'Active') return false;
  if (l.startDate && l.startDate > today) return false;
  if (l.moveOutDate && l.moveOutDate < today) return false;
  return true;
}

/**
 * Occupancy of a unit given its leases. Notice means someone lives there but
 * has a move-out date or gave notice — the unit can be marketed.
 */
export function unitOccupancy(leases: Array<LeaseDates & { id: string }>, today: string): { occupancy: Occupancy; currentLeaseId: string | null; upcomingLeaseId: string | null } {
  const current = leases.find(l => isOccupying(l, today)) ?? null;
  const upcoming = leases.find(l => (l.status === 'Active' || l.status === 'Pending signature') && l.startDate && l.startDate > today) ?? null;
  if (!current) return { occupancy: 'Vacant', currentLeaseId: null, upcomingLeaseId: upcoming?.id ?? null };
  const onNotice = Boolean(current.noticeGivenOn || current.moveOutDate);
  return { occupancy: onNotice ? 'Notice' : 'Occupied', currentLeaseId: current.id, upcomingLeaseId: upcoming?.id ?? null };
}

/** "The Alder #204 · Chen" — the label a lease carries in the database and in lists. */
export function leaseLabel(propertyName: string, unitName: string, tenantNames: string[]) {
  const unit = unitName && !/^(main|house|home)$/i.test(unitName) ? ` ${unitName.replace(/^unit\s+/i, '#')}` : '';
  const surnames = [...new Set(tenantNames.map(n => n.trim().split(/\s+/).slice(-1)[0]).filter(Boolean))];
  return `${propertyName}${unit}${surnames.length ? ` · ${surnames.slice(0, 2).join(' & ')}${surnames.length > 2 ? ' +' : ''}` : ''}`;
}

export const leaseRef = (n: number | null | undefined) => (n ? `L-${n}` : 'Draft');
export const workOrderRef = (n: number | null | undefined) => (n ? `WO-${n}` : 'WO');
export const applicationRef = (n: number | null | undefined) => (n ? `APP-${n}` : 'APP');

/** Days until a lease ends, negative once past. */
export const daysToEnd = (endDate: string | null | undefined, today: string) => (endDate ? daysBetween(today, endDate) : null);

/** The default end for a new fixed-term lease: the day before the same date N months later. */
export function defaultEndDate(start: string, months = 12) {
  const [y, m, d] = start.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return addDays(`${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`, -1);
}
