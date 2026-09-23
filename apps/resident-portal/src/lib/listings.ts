import { useQuery } from '@tanstack/react-query';
import { differenceInCalendarDays, format } from 'date-fns';
import { getPublicListing, listPublicListings, type GetPublicListingOutputType, type ListPublicListingsOutputType } from 'zitejs/api';
import { formatMoney, parseDay, shortDate } from './format';
import { retry } from './queries';

/**
 * Homes for rent: the queries, the filter model the homes page keeps in its
 * URL (so a filtered search can be shared or bookmarked), and the small
 * formatting rules every listing card and page agree on.
 */

export type ListingCard = ListPublicListingsOutputType['listings'][number];
export type ListingDetailData = GetPublicListingOutputType;
export type ListingDetail = GetPublicListingOutputType['listing'];

export const homesKeys = {
  all: ['portal', 'homes'] as const,
  list: ['portal', 'homes', 'list'] as const,
  detail: (slug: string) => ['portal', 'homes', 'detail', slug] as const,
};

export function usePublicListings() {
  return useQuery({ queryKey: homesKeys.list, queryFn: () => listPublicListings({}), staleTime: 60_000, retry });
}

/** A view counts once per visitor per tab session, not on every refetch. */
function firstView(slug: string) {
  try {
    const key = `resident-portal:viewed:${slug}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

export function usePublicListing(slug: string | undefined) {
  return useQuery({
    queryKey: homesKeys.detail(slug ?? ''),
    queryFn: () => getPublicListing({ slug: slug!, countView: firstView(slug!) }),
    enabled: Boolean(slug),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Round amounts without cents ("$1,275"), anything else with them ("$1,275.50"). */
export const money = (n: number, currency = 'USD') => formatMoney(n, currency, { cents: Math.round(n * 100) % 100 !== 0 });

export function bedsLabel(beds: number | null | undefined, long = false) {
  if (beds == null) return '';
  if (beds === 0) return 'Studio';
  return long ? `${beds} ${beds === 1 ? 'bedroom' : 'bedrooms'}` : `${beds} bd`;
}

export function bathsLabel(baths: number | null | undefined, long = false) {
  if (baths == null) return '';
  const n = Number.isInteger(baths) ? String(baths) : baths.toFixed(1);
  return long ? `${n} ${baths === 1 ? 'bathroom' : 'bathrooms'}` : `${n} ba`;
}

export const sqftLabel = (sqft: number | null | undefined) => (sqft ? `${sqft.toLocaleString()} sq ft` : '');

/** "Studio · 1 ba · 480 sq ft" */
export const sizeLine = (l: { beds: number | null; baths: number | null; squareFeet?: number | null }) =>
  [bedsLabel(l.beds), bathsLabel(l.baths), sqftLabel(l.squareFeet)].filter(Boolean).join(' · ');

export function availability(day: string | null | undefined): { label: string; now: boolean } {
  if (!day) return { label: 'Available now', now: true };
  const days = differenceInCalendarDays(parseDay(day), new Date());
  return days <= 0 ? { label: 'Available now', now: true } : { label: `Available ${shortDate(day)}`, now: false };
}

export const longDay = (day: string) => format(parseDay(day), 'EEEE, MMMM d');

export const PET_LABEL: Record<string, string> = {
  'No pets': 'No pets',
  'Cats only': 'Cats welcome',
  'Dogs only': 'Dogs welcome',
  'Cats and dogs': 'Cats & dogs welcome',
  'Case by case': 'Pets considered',
};

export const petsAllowed = (policy: string) => Boolean(policy) && policy !== 'No pets';

export const place = (l: { city: string; state: string }) => [l.city, l.state].filter(Boolean).join(', ');

/**
 * Listing photos are full-size links; cards ask for a smaller copy when the
 * host supports sizing by query (Unsplash does), and leave anything else alone.
 */
export function sizedPhoto(url: string | null | undefined, width: number) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.unsplash.com') return url;
    const ratio = Number(u.searchParams.get('h')) / Number(u.searchParams.get('w')) || 2 / 3;
    u.searchParams.set('w', String(width));
    u.searchParams.set('h', String(Math.round(width * ratio)));
    return u.toString();
  } catch {
    return url;
  }
}

// ── Filters ─────────────────────────────────────────────────────────────────

export const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'rent-asc', label: 'Rent: low to high' },
  { id: 'rent-desc', label: 'Rent: high to low' },
  { id: 'available', label: 'Soonest available' },
] as const;
export type SortId = (typeof SORTS)[number]['id'];

export const BED_OPTIONS = [
  { id: '', label: 'Any' },
  { id: '0', label: 'Studio' },
  { id: '1', label: '1' },
  { id: '2', label: '2' },
  { id: '3', label: '3+' },
] as const;

export const PET_OPTIONS = [
  { id: '', label: 'Any pet policy' },
  { id: 'any', label: 'Pets allowed' },
  { id: 'cats', label: 'Cats allowed' },
  { id: 'dogs', label: 'Dogs allowed' },
] as const;

export type HomeFilters = {
  place: string;
  beds: string;
  maxRent: number | null;
  pets: string;
  availableBy: string;
  sort: SortId;
};

export const DEFAULT_FILTERS: HomeFilters = { place: '', beds: '', maxRent: null, pets: '', availableBy: '', sort: 'newest' };

export function filtersFromParams(p: URLSearchParams): HomeFilters {
  const sort = p.get('sort');
  const max = Number(p.get('max'));
  const beds = p.get('beds') ?? '';
  const pets = p.get('pets') ?? '';
  const by = p.get('by') ?? '';
  return {
    place: p.get('in') ?? '',
    beds: BED_OPTIONS.some(b => b.id === beds) ? beds : '',
    maxRent: Number.isFinite(max) && max > 0 ? max : null,
    pets: PET_OPTIONS.some(o => o.id === pets) ? pets : '',
    availableBy: /^\d{4}-\d{2}-\d{2}$/.test(by) ? by : '',
    sort: SORTS.some(s => s.id === sort) ? (sort as SortId) : 'newest',
  };
}

export function filtersToParams(f: HomeFilters) {
  const p = new URLSearchParams();
  if (f.place) p.set('in', f.place);
  if (f.beds) p.set('beds', f.beds);
  if (f.maxRent) p.set('max', String(f.maxRent));
  if (f.pets) p.set('pets', f.pets);
  if (f.availableBy) p.set('by', f.availableBy);
  if (f.sort !== 'newest') p.set('sort', f.sort);
  return p;
}

/** How many narrowing filters are on (sort isn't one). */
export const activeFilterCount = (f: HomeFilters) => [f.place, f.beds, f.maxRent, f.pets, f.availableBy].filter(v => v !== '' && v != null).length;

export function placeOptions(listings: ListingCard[]) {
  const cities = new Map<string, { value: string; label: string; count: number }>();
  const buildings = new Map<string, { value: string; label: string; count: number }>();
  for (const l of listings) {
    if (l.city) {
      const c = cities.get(l.city) ?? { value: `city:${l.city}`, label: place(l), count: 0 };
      c.count++;
      cities.set(l.city, c);
    }
    if (l.propertyName) {
      const b = buildings.get(l.propertyName) ?? { value: `building:${l.propertyName}`, label: l.propertyName, count: 0 };
      b.count++;
      buildings.set(l.propertyName, b);
    }
  }
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return { cities: [...cities.values()].sort(byLabel), buildings: [...buildings.values()].sort(byLabel) };
}

/** Round rent ceilings that bracket what's actually listed. */
export function rentSteps(listings: ListingCard[]) {
  const steps = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000, 5000, 7500, 10000];
  if (!listings.length) return steps.slice(0, 8);
  const min = Math.min(...listings.map(l => l.rent));
  const max = Math.max(...listings.map(l => l.rent));
  const lo = steps.findIndex(s => s >= min);
  const hi = steps.findIndex(s => s >= max);
  const from = Math.max(0, lo === -1 ? steps.length - 1 : lo);
  const to = hi === -1 ? steps.length - 1 : hi;
  return steps.slice(from, Math.max(from + 3, to + 1));
}

export function applyFilters(listings: ListingCard[], f: HomeFilters) {
  const [kind, value] = f.place.includes(':') ? [f.place.slice(0, f.place.indexOf(':')), f.place.slice(f.place.indexOf(':') + 1)] : ['', ''];
  const out = listings.filter(l => {
    if (kind === 'city' && l.city !== value) return false;
    if (kind === 'building' && l.propertyName !== value) return false;
    if (f.beds !== '') {
      const want = Number(f.beds);
      if (l.beds == null) return false;
      if (want >= 3 ? l.beds < 3 : l.beds !== want) return false;
    }
    if (f.maxRent != null && l.rent > f.maxRent) return false;
    if (f.pets === 'any' && !petsAllowed(l.petPolicy)) return false;
    if (f.pets === 'cats' && !['Cats only', 'Cats and dogs', 'Case by case'].includes(l.petPolicy)) return false;
    if (f.pets === 'dogs' && !['Dogs only', 'Cats and dogs', 'Case by case'].includes(l.petPolicy)) return false;
    if (f.availableBy && l.availableOn && l.availableOn > f.availableBy) return false;
    return true;
  });
  const avail = (l: ListingCard) => l.availableOn ?? '0000-00-00';
  const newest = (a: ListingCard, b: ListingCard) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  switch (f.sort) {
    case 'rent-asc':
      return out.sort((a, b) => a.rent - b.rent || newest(a, b));
    case 'rent-desc':
      return out.sort((a, b) => b.rent - a.rent || newest(a, b));
    case 'available':
      return out.sort((a, b) => avail(a).localeCompare(avail(b)) || a.rent - b.rent);
    default:
      return out.sort(newest);
  }
}
