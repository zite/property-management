import { formatDay, termMonths } from './dates';
import { formatAddress, joinNames, ordinal, renderMerge, type MergeContext } from './merge';
import { formatMoney } from './money';

/**
 * The lease agreement: the organization's template (Settings → Lease
 * template) with the lease's own values merged in. Rendered when a lease is
 * sent for signature and frozen onto the lease, so what a resident signed
 * never changes if the template is edited later.
 */

export type LeaseDocInput = {
  organizationName: string;
  currency: string;
  gracePeriodDays: number;
  lateFee: number;
  property: { name: string; street?: string | null; city?: string | null; state?: string | null; postalCode?: string | null };
  unitName: string;
  tenantNames: string[];
  startDate: string;
  endDate: string | null;
  rent: number;
  deposit: number;
  rentDueDay: number;
};

export function leaseMergeContext(d: LeaseDocInput): MergeContext {
  const months = termMonths(d.startDate, d.endDate);
  return {
    organization_name: d.organizationName,
    property_name: d.property.name,
    unit_name: d.unitName,
    unit_address: formatAddress(d.property, d.unitName),
    tenant_names: joinNames(d.tenantNames),
    lease_start_date: formatDay(d.startDate, 'long'),
    lease_end_date: d.endDate ? formatDay(d.endDate, 'long') : 'month to month',
    rent_amount: formatMoney(d.rent, d.currency),
    rent_due_day: ordinal(d.rentDueDay),
    deposit_amount: formatMoney(d.deposit, d.currency),
    late_fee: formatMoney(d.lateFee, d.currency),
    grace_period_days: String(d.gracePeriodDays),
    renewal_term: months ? `${months} months` : '',
  };
}

export function renderLeaseTerms(template: string, d: LeaseDocInput) {
  return renderMerge(template, leaseMergeContext(d));
}
