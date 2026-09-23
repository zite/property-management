import { SCREENING_CHECKS, SCREENING_RESULTS, type ApplicationStatus } from '@project/shared/constants';

/**
 * Leasing rules shared by the staff screens and their endpoints. Pure
 * TypeScript — no React, no database — so the page explains a rule with the
 * same code the server enforces it with.
 */

export type ScreeningResult = (typeof SCREENING_RESULTS)[number];

/** One line of the screening checklist as stored in `Applications.screening` (a JSON array). */
export type ScreeningCheck = {
  key: string;
  label: string;
  result: ScreeningResult;
  note: string;
  byId: string | null;
  byName: string | null;
  at: string | null;
};

const RESULTS = new Set<string>(SCREENING_RESULTS);

/**
 * The checklist in the fixed order every applicant gets, whatever the stored
 * JSON holds — missing checks read as Pending, unknown keys are dropped.
 */
export function normalizeScreening(raw: unknown): ScreeningCheck[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
  }
  const byKey = new Map<string, Record<string, unknown>>();
  if (Array.isArray(list)) for (const item of list) if (item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string') byKey.set((item as { key: string }).key, item as Record<string, unknown>);
  return SCREENING_CHECKS.map(c => {
    const s = byKey.get(c.key) ?? {};
    const result = RESULTS.has(String(s.result)) ? (s.result as ScreeningResult) : 'Pending';
    return {
      key: c.key,
      label: c.label,
      result,
      note: typeof s.note === 'string' ? s.note : '',
      byId: typeof s.byId === 'string' && s.byId ? s.byId : null,
      byName: typeof s.byName === 'string' && s.byName ? s.byName : null,
      at: typeof s.at === 'string' && s.at ? s.at : null,
    };
  });
}

export const screeningDone = (checks: ScreeningCheck[]) => checks.filter(c => c.result !== 'Pending').length;
export const screeningFlags = (checks: ScreeningCheck[]) => checks.filter(c => c.result === 'Concern' || c.result === 'Fail').length;

export const SCREENING_RESULT_TONE: Record<ScreeningResult, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  Pending: 'neutral',
  Pass: 'success',
  Concern: 'warning',
  Fail: 'danger',
  Waived: 'info',
};

/** Statuses a person can set by hand; the rest only come from a decision or a signed lease. */
export const MANUAL_APPLICATION_STATUSES = ['Submitted', 'Screening'] as const satisfies readonly ApplicationStatus[];
export const OPEN_APPLICATION_STATUSES: ApplicationStatus[] = ['Submitted', 'Screening', 'Approved'];
export const CLOSED_APPLICATION_STATUSES: ApplicationStatus[] = ['Denied', 'Withdrawn', 'Leased'];
export const UNDECIDED_APPLICATION_STATUSES: ApplicationStatus[] = ['Submitted', 'Screening'];

/**
 * Why an application was not approved. Objective, documentable criteria only —
 * the same list for every applicant, so decisions can be explained and audited.
 */
export const DENIAL_REASONS = [
  'Income below the requirement',
  'Income or employment could not be verified',
  'Rental history or landlord reference',
  'Credit history',
  'Background check results',
  'Incomplete application or information could not be verified',
  'Occupancy limit for the unit',
  'Another applicant was approved first',
  'Other',
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

export const APPROVAL_CONDITIONS = ['Additional security deposit', 'Qualified guarantor', 'Proof of renters insurance before move-in', 'First month’s rent paid before move-in'] as const;

/** Why a lead didn't turn into an application. */
export const LOST_REASONS = ['No response', 'Rented elsewhere', 'Home didn’t fit their needs', 'Timing didn’t work', 'Price', 'Duplicate', 'Other'] as const;

/** Household income against rent, and how it compares to the organization's multiple. */
export function incomeRatio(income: number | null | undefined, rent: number | null | undefined) {
  if (!income || !rent || rent <= 0) return null;
  return Math.round((income / rent) * 10) / 10;
}

export function incomeTone(ratio: number | null, multiple: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (ratio == null) return 'neutral';
  if (ratio >= multiple) return 'success';
  if (ratio >= multiple * 0.85) return 'warning';
  return 'danger';
}

/** Monthly income in cents so co-applicants never add up to $4,099.9999. */
export function householdIncome(monthlyIncome: number | null | undefined, coApplicants: Array<{ monthlyIncome?: number | null }>) {
  const cents = Math.round((monthlyIncome ?? 0) * 100) + coApplicants.reduce((a, c) => a + Math.round((Number(c.monthlyIncome) || 0) * 100), 0);
  return cents / 100;
}

// ─── Inquiries ──────────────────────────────────────────────────────────────

export const OPEN_INQUIRY_STATUSES = ['New', 'Contacted', 'Showing scheduled'] as const;
export const CLOSED_INQUIRY_STATUSES = ['Applied', 'Closed'] as const;

export const inquiryThread = (id: string) => `inquiry:${id}`;

// ─── Listings ───────────────────────────────────────────────────────────────

export const LEASE_TERM_SUGGESTIONS = ['12 months', '6 months', '18 months', '24 months', 'Month-to-month', '6–12 months'];

export const AMENITY_SUGGESTIONS = [
  'In-unit washer & dryer', 'On-site laundry', 'Dishwasher', 'Central air', 'Heat included', 'Hardwood floors', 'Walk-in closet', 'Balcony', 'Private patio',
  'Fenced yard', 'Garage', 'Off-street parking', 'Bike storage', 'Package lockers', 'Elevator', 'Fitness center', 'Rooftop deck', 'Storage', 'Pet friendly',
];

/** URL-safe slug: "Top-floor studio at The Alder" → "top-floor-studio-at-the-alder". */
export function slugify(text: string, max = 70) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A portal link for a listing, or null until the portal's address is known. */
export function homeUrl(portalUrl: string | null | undefined, slug: string | null | undefined, apply = false) {
  if (!portalUrl || !slug) return null;
  return `${portalUrl.replace(/\/+$/, '')}/#/homes/${slug}${apply ? '/apply' : ''}`;
}

export type ListingFacts = {
  propertyName: string;
  unitName: string;
  propertyType: string;
  city: string;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  amenities: string[];
  petPolicy: string;
  leaseTerm: string;
  availableOn: string | null;
  parking?: string;
};

/** The title a new listing starts with. */
export function listingTitleTemplate(f: Pick<ListingFacts, 'propertyName' | 'unitName' | 'beds' | 'propertyType'>) {
  const kind = f.propertyType === 'Single-family' ? 'house' : f.propertyType === 'Townhome' ? 'townhome' : f.propertyType === 'Condo' ? 'condo' : 'apartment';
  const unit = f.unitName && !/^(main|house|home)$/i.test(f.unitName) ? ` ${f.unitName.replace(/^unit\s+/i, '')}` : '';
  const what = f.beds === 0 ? 'Studio' : f.beds != null ? `${f.beds}-bed ${kind}` : kind.charAt(0).toUpperCase() + kind.slice(1);
  return `${what} at ${f.propertyName}${unit}`.slice(0, 120);
}

function formatLongDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * A plain, factual description built from what’s on file for the unit.
 * The non-AI path for "Write description", and the starting text of a new listing.
 */
export function listingDescriptionTemplate(f: ListingFacts, today?: string) {
  const baths = f.baths != null ? `${Number.isInteger(f.baths) ? f.baths : f.baths.toFixed(1)}-bath` : null;
  const size = [f.beds === 0 ? 'Studio' : f.beds != null ? `${f.beds}-bedroom` : null, baths].filter(Boolean).join(', ');
  const noun = f.beds === 0 ? '' : size ? ' home' : 'Home';
  const where = [f.propertyName, f.city].filter(Boolean).join(' in ') || 'our building';
  const opening = `${size}${noun} at ${where}${f.squareFeet ? `, with about ${f.squareFeet.toLocaleString('en-US')} square feet` : ''}.`;
  const list = f.amenities.slice(0, 6).map(a => (/^[A-Z][a-z]/.test(a) ? a.charAt(0).toLowerCase() + a.slice(1) : a));
  const features = list.length ? `Features include ${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]}.` : '';
  const available = f.availableOn ? (today && f.availableOn <= today ? 'Available now' : `Available ${formatLongDay(f.availableOn)}`) : '';
  const months = /^(\d+)\s*months?$/i.exec(f.leaseTerm.trim());
  const lease = months ? `${months[1]}-month lease` : f.leaseTerm.trim() ? (/lease/i.test(f.leaseTerm) ? f.leaseTerm.trim() : `${f.leaseTerm.trim()} lease`) : '';
  const terms = [available, lease ? (available ? lease.charAt(0).toLowerCase() + lease.slice(1) : lease.charAt(0).toUpperCase() + lease.slice(1)) : ''].filter(Boolean).join(', ');
  const pets = f.petPolicy ? (f.petPolicy === 'No pets' ? 'No pets.' : f.petPolicy === 'Case by case' ? 'Pets considered case by case.' : `${f.petPolicy} welcome.`) : '';
  return [[opening, features].filter(Boolean).join(' '), [terms ? `${terms}.` : '', pets, f.parking ? `Parking: ${f.parking.replace(/\.$/, '')}.` : ''].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join('\n\n');
}

