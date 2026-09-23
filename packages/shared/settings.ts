/**
 * Organization policy that both the browser and the server compute — kept
 * free of database imports so Settings can preview exactly what the daily run does.
 */

export type LateFeePolicy = { lateFeeType: 'None' | 'Flat' | 'Percent'; lateFeeAmount: number; lateFeePercent: number; lateFeeMax: number | null };

/** The late fee a policy charges on a monthly rent. */
export function lateFeeFor(s: LateFeePolicy, rent: number) {
  if (s.lateFeeType === 'None') return 0;
  let fee = s.lateFeeType === 'Percent' ? Math.round(rent * s.lateFeePercent) / 100 : s.lateFeeAmount;
  if (s.lateFeeMax != null && s.lateFeeMax > 0) fee = Math.min(fee, s.lateFeeMax);
  return Math.max(0, Math.round(fee * 100) / 100);
}

export const DEFAULT_LEASE_TEMPLATE = `# Residential Lease Agreement

This Residential Lease Agreement ("Lease") is made on {{lease_start_date}} between **{{organization_name}}**, as agent for the owner ("Landlord"), and **{{tenant_names}}** ("Tenant").

## 1. Premises
Landlord leases to Tenant the residence at **{{unit_address}}** ("Premises").

## 2. Term
The lease begins on **{{lease_start_date}}** and ends on **{{lease_end_date}}**. Unless either party gives written notice at least 30 days before the end date, the lease continues month to month on the same terms.

## 3. Rent
Tenant agrees to pay **{{rent_amount}}** per month, due on the **{{rent_due_day}}** of each month. Rent may be paid through the resident portal or by any method Landlord accepts in writing.

## 4. Late charges
Rent not received within {{grace_period_days}} days of the due date is late, and a late fee of **{{late_fee}}** will be charged.

## 5. Security deposit
Tenant has paid a security deposit of **{{deposit_amount}}**. It will be returned, less lawful deductions for unpaid rent and damage beyond normal wear and tear, with an itemized statement within the period required by law after Tenant vacates.

## 6. Utilities
Tenant is responsible for all utilities and services not listed as included by Landlord.

## 7. Use and occupancy
The Premises will be used only as a private residence for the persons named in this Lease. Tenant will comply with all laws and community rules and will not disturb neighbors.

## 8. Maintenance and repairs
Tenant will keep the Premises clean and promptly report needed repairs through the resident portal. Landlord will make repairs required by law within a reasonable time. Tenant is responsible for damage caused by Tenant, household members or guests.

## 9. Entry
Landlord may enter the Premises with reasonable notice to inspect, make repairs or show the unit, and at any time in an emergency.

## 10. Pets
No animals are permitted without Landlord's written consent, except assistance animals as required by law.

## 11. Move-out
Tenant will return all keys and leave the Premises clean and in the same condition as at move-in, except for normal wear and tear.

## 12. Entire agreement
This Lease, with any addenda signed by both parties, is the entire agreement. It may only be changed in writing signed by both parties.
`;
