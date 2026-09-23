import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  getApplication, getInquiry, getListing, listApplications, listInquiries, listListings, listVacancies, saveInquiry, saveListing, updateApplication,
  type GetApplicationOutputType, type GetInquiryOutputType, type GetListingOutputType, type ListApplicationsInputType, type ListApplicationsOutputType,
  type ListInquiriesInputType, type ListInquiriesOutputType, type ListListingsOutputType, type ListVacanciesOutputType, type SaveInquiryInputType, type SaveListingInputType,
} from 'zitejs/api';
import { APPLICATION_STATUSES, INQUIRY_STATUSES, type ApplicationStatus } from '@project/shared/constants';
import { applicationRef } from '@project/shared/leases';
import { errorMessage } from '../../lib/errors';
import { invalidate, qk, retryUnlessNotFound } from '../../lib/queries';
import type { Workspace } from '../../lib/workspace';
import { incomeRatio, OPEN_APPLICATION_STATUSES, OPEN_INQUIRY_STATUSES, type ScreeningResult } from './rules';

/**
 * Leasing data: types, queries, grouping and optimistic writes for
 * applications, leads (inquiries) and listings. Every frequent edit — a status,
 * an assignee, a screening result — lands in every cached list and the open
 * record before the request leaves, and rolls back with a toast if it fails.
 */

export type Application = ListApplicationsOutputType['applications'][number];
export type ApplicationDetail = GetApplicationOutputType;
export type ApplicationFilters = NonNullable<ListApplicationsInputType['filters']>;
export type Inquiry = ListInquiriesOutputType['inquiries'][number];
export type InquiryDetail = GetInquiryOutputType;
export type InquiryFilters = NonNullable<ListInquiriesInputType['filters']>;
export type Listing = ListListingsOutputType['listings'][number];
export type ListingDetail = GetListingOutputType;
export type Vacancy = ListVacanciesOutputType['vacancies'][number];
export type ListingPatch = Extract<SaveListingInputType, { action: 'update' }>['patch'];
export type InquiryPatch = Extract<SaveInquiryInputType, { action: 'update' }>['patch'];
export type ApplicationPatch = { status?: 'Submitted' | 'Screening'; assigneeId?: string | null; desiredMoveIn?: string | null; screeningNotes?: string; feePaid?: boolean };

export const lk = {
  root: qk.leasing,
  applications: [...qk.leasing, 'applications'] as const,
  applicationLists: [...qk.leasing, 'applications', 'list'] as const,
  applicationList: (f: ApplicationFilters) => [...qk.leasing, 'applications', 'list', f] as const,
  applicationDetails: [...qk.leasing, 'applications', 'detail'] as const,
  applicationDetail: (n: number) => [...qk.leasing, 'applications', 'detail', n] as const,
  inquiries: [...qk.leasing, 'inquiries'] as const,
  inquiryLists: [...qk.leasing, 'inquiries', 'list'] as const,
  inquiryList: (f: InquiryFilters) => [...qk.leasing, 'inquiries', 'list', f] as const,
  inquiryDetails: [...qk.leasing, 'inquiries', 'detail'] as const,
  inquiryDetail: (id: string) => [...qk.leasing, 'inquiries', 'detail', id] as const,
  listings: [...qk.leasing, 'listings'] as const,
  listingList: [...qk.leasing, 'listings', 'list'] as const,
  listingDetails: [...qk.leasing, 'listings', 'detail'] as const,
  listingDetail: (id: string) => [...qk.leasing, 'listings', 'detail', id] as const,
  vacancies: [...qk.leasing, 'vacancies'] as const,
};

/** sessionStorage key with the last application list's visible order, for J/K on the record page. */
export const APP_NAV_ORDER_KEY = 'property-management:applications:order';

export function useApplications(filters: ApplicationFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: lk.applicationList(filters), queryFn: () => listApplications({ filters }), placeholderData: keepPreviousData, staleTime: 20_000, enabled: opts.enabled ?? true });
}

export function useApplication(number: number | null) {
  return useQuery({ queryKey: lk.applicationDetail(number ?? 0), queryFn: () => getApplication({ number: number! }), enabled: Boolean(number), retry: retryUnlessNotFound, staleTime: 10_000 });
}

export function useInquiries(filters: InquiryFilters) {
  return useQuery({ queryKey: lk.inquiryList(filters), queryFn: () => listInquiries({ filters }), placeholderData: keepPreviousData, staleTime: 20_000 });
}

export function useInquiry(id: string | null) {
  return useQuery({ queryKey: lk.inquiryDetail(id ?? ''), queryFn: () => getInquiry({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000 });
}

export function useListings() {
  return useQuery({ queryKey: lk.listingList, queryFn: () => listListings({}), staleTime: 30_000 });
}

export function useListing(id: string | null | undefined) {
  return useQuery({ queryKey: lk.listingDetail(id ?? ''), queryFn: () => getListing({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000 });
}

export function useVacancies() {
  return useQuery({ queryKey: lk.vacancies, queryFn: () => listVacancies({}), staleTime: 30_000 });
}

/** Everything a leasing write can change elsewhere: sidebar counts, the inbox, tasks, units. */
export function afterLeasingWrite(qc: QueryClient, delay = 0) {
  const run = () => invalidate(qc, 'leasing', 'bootstrap', 'inbox', 'tasks', 'dashboard', 'units', 'properties');
  if (delay) window.setTimeout(run, delay);
  else run();
}

const timers = new Map<string, number>();
function refreshSoon(qc: QueryClient, key: string, delay = 1200) {
  window.clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(() => { timers.delete(key); afterLeasingWrite(qc); }, delay));
}

type Snapshot = Array<[readonly unknown[], unknown]>;
const snapshotOf = (qc: QueryClient, ...keys: ReadonlyArray<readonly unknown[]>): Snapshot => keys.flatMap(k => qc.getQueriesData({ queryKey: k }));
const restore = (qc: QueryClient, snap: Snapshot) => snap.forEach(([k, d]) => qc.setQueryData(k, d));

// ─── Applications ───────────────────────────────────────────────────────────

export type ApplicationGrouping = 'status' | 'property' | 'listing' | 'assignee' | 'none';
export type ApplicationOrdering = 'newest' | 'oldest' | 'moveIn' | 'ratio' | 'updated';

export const APPLICATION_GROUPINGS: ReadonlyArray<{ value: ApplicationGrouping; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'property', label: 'Property' },
  { value: 'listing', label: 'Listing' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'No grouping' },
];

export const APPLICATION_ORDERINGS: ReadonlyArray<{ value: ApplicationOrdering; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'moveIn', label: 'Move-in date' },
  { value: 'ratio', label: 'Income to rent' },
  { value: 'updated', label: 'Last updated' },
];

export const APPLICATION_PROPERTIES = [
  { key: 'number', label: 'ID' },
  { key: 'unit', label: 'Unit' },
  { key: 'moveIn', label: 'Move-in' },
  { key: 'income', label: 'Income' },
  { key: 'screening', label: 'Screening' },
  { key: 'fee', label: 'Fee' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'assignee', label: 'Assignee' },
];

export function compareApplications(ordering: ApplicationOrdering) {
  const newest = (a: Application, b: Application) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '') || (b.number ?? 0) - (a.number ?? 0);
  switch (ordering) {
    case 'oldest':
      return (a: Application, b: Application) => -newest(a, b);
    case 'moveIn':
      return (a: Application, b: Application) => (a.desiredMoveIn && b.desiredMoveIn ? a.desiredMoveIn.localeCompare(b.desiredMoveIn) : a.desiredMoveIn ? -1 : b.desiredMoveIn ? 1 : 0) || newest(a, b);
    case 'ratio':
      return (a: Application, b: Application) => (incomeRatio(b.householdIncome, b.rent) ?? -1) - (incomeRatio(a.householdIncome, a.rent) ?? -1) || newest(a, b);
    case 'updated':
      return (a: Application, b: Application) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || newest(a, b);
    default:
      return newest;
  }
}

export type ApplicationGroup = { key: string; label: string; items: Application[]; kind: ApplicationGrouping; color?: string };

export function groupApplications(rows: Application[], grouping: ApplicationGrouping, ordering: ApplicationOrdering, ws: Workspace, opts: { showEmpty?: boolean; showClosed?: boolean; board?: boolean } = {}): ApplicationGroup[] {
  const sorted = [...rows].sort(compareApplications(ordering));
  if (grouping === 'none') return [{ key: 'all', label: 'All applications', items: sorted, kind: 'none' }];
  const buckets = new Map<string, Application[]>();
  const keyOf = (a: Application) => (grouping === 'status' ? a.status : grouping === 'property' ? a.propertyId ?? '__none__' : grouping === 'listing' ? a.listingId ?? '__none__' : a.assigneeId ?? '__none__');
  for (const a of sorted) {
    const k = keyOf(a);
    buckets.set(k, [...(buckets.get(k) ?? []), a]);
  }
  const make = (key: string, label: string, color?: string): ApplicationGroup => ({ key, label, items: buckets.get(key) ?? [], kind: grouping, color });
  const showEmpty = opts.showEmpty || opts.board;
  if (grouping === 'status') {
    const base: ApplicationStatus[] = opts.board ? ['Submitted', 'Screening', 'Approved', 'Denied'] : opts.showClosed ? APPLICATION_STATUSES.filter(s => s !== 'Draft') : OPEN_APPLICATION_STATUSES;
    const groups = base.filter(s => showEmpty || buckets.has(s)).map(s => make(s, s));
    for (const s of APPLICATION_STATUSES) if (buckets.has(s) && !groups.some(g => g.key === s)) groups.push(make(s, s));
    return groups;
  }
  if (grouping === 'property') {
    const groups = ws.orderedProperties.filter(p => buckets.has(p.id)).map(p => make(p.id, p.name, p.color));
    if (buckets.has('__none__')) groups.push(make('__none__', 'No property'));
    return groups;
  }
  if (grouping === 'listing') {
    return [...buckets.keys()]
      .map(k => make(k, k === '__none__' ? 'No listing' : buckets.get(k)![0].listingTitle ?? 'Listing'))
      .sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label)));
  }
  const members = [...buckets.keys()].filter(k => k !== '__none__').map(k => make(k, k === ws.me.id ? `${ws.memberName(k)} (you)` : ws.memberName(k)));
  members.sort((a, b) => (a.key === ws.me.id ? -1 : b.key === ws.me.id ? 1 : a.label.localeCompare(b.label)));
  return [...(buckets.has('__none__') || showEmpty ? [make('__none__', 'Unassigned')] : []), ...members];
}

export function applyApplicationPatch(a: Application, patch: ApplicationPatch): Application {
  const next = { ...a, lastActivityAt: new Date().toISOString() };
  if (patch.status) next.status = patch.status;
  if (patch.assigneeId !== undefined) next.assigneeId = patch.assigneeId;
  if (patch.desiredMoveIn !== undefined) next.desiredMoveIn = patch.desiredMoveIn;
  if (patch.feePaid !== undefined) next.feePaidAt = patch.feePaid ? new Date().toISOString() : null;
  return next;
}

export function useApplicationActions() {
  const qc = useQueryClient();

  const update = useCallback(
    async (targets: Array<Pick<Application, 'id' | 'number'>>, patch: ApplicationPatch, opts: { toast?: string | false } = {}) => {
      if (!targets.length) return;
      await qc.cancelQueries({ queryKey: lk.applications });
      const snap = snapshotOf(qc, lk.applicationLists, lk.applicationDetails);
      const ids = new Set(targets.map(t => t.id));
      qc.setQueriesData<ListApplicationsOutputType>({ queryKey: lk.applicationLists }, old => (old ? { ...old, applications: old.applications.map(a => (ids.has(a.id) ? applyApplicationPatch(a, patch) : a)) } : old));
      qc.setQueriesData<ApplicationDetail>({ queryKey: lk.applicationDetails }, old => {
        if (!old?.application || !ids.has(old.application.id)) return old;
        const next = applyApplicationPatch(old.application as unknown as Application, patch) as unknown as ApplicationDetail['application'];
        return { ...old, application: { ...old.application, ...next, screeningNotes: patch.screeningNotes ?? old.application.screeningNotes } };
      });
      try {
        const res = await updateApplication({ ids: [...ids], patch });
        refreshSoon(qc, 'applications', targets.length > 1 ? 400 : 1200);
        if (opts.toast !== false && (opts.toast || targets.length > 1)) toast.success(opts.toast || `Updated ${res.updated} of ${targets.length} applications`);
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, targets.length === 1 ? `Couldn’t update ${applicationRef(targets[0].number)}` : `Couldn’t update ${targets.length} applications`));
        throw e;
      }
    },
    [qc],
  );

  const screen = useCallback(
    async (app: { id: string; number: number | null }, key: string, result: ScreeningResult, note?: string) => {
      const detailKey = lk.applicationDetail(app.number ?? 0);
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<ApplicationDetail>(detailKey);
      if (prev) {
        const screening = prev.application.screening.map(c => (c.key === key ? { ...c, result, note: note ?? c.note, at: new Date().toISOString() } : c));
        const status = prev.application.status === 'Submitted' && result !== 'Pending' ? 'Screening' : prev.application.status;
        qc.setQueryData<ApplicationDetail>(detailKey, { ...prev, application: { ...prev.application, screening, status, screeningDone: screening.filter(c => c.result !== 'Pending').length, screeningFlags: screening.filter(c => c.result === 'Concern' || c.result === 'Fail').length } });
      }
      try {
        await updateApplication({ ids: [app.id], screening: { key: key as never, result, ...(note !== undefined ? { note } : {}) } });
        refreshSoon(qc, 'applications');
      } catch (e) {
        if (prev) qc.setQueryData(detailKey, prev);
        toast.error(errorMessage(e, 'Couldn’t save the screening result'));
        throw e;
      }
    },
    [qc],
  );

  return { update, screen };
}

// ─── Inquiries ──────────────────────────────────────────────────────────────

export type InquiryGrouping = 'status' | 'listing' | 'source' | 'assignee' | 'none';
export type InquiryOrdering = 'newest' | 'oldest' | 'showing' | 'lastContact';

export const INQUIRY_GROUPINGS: ReadonlyArray<{ value: InquiryGrouping; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'listing', label: 'Listing' },
  { value: 'source', label: 'Source' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'No grouping' },
];

export const INQUIRY_ORDERINGS: ReadonlyArray<{ value: InquiryOrdering; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'showing', label: 'Showing time' },
  { value: 'lastContact', label: 'Last contact' },
];

export const INQUIRY_PROPERTIES = [
  { key: 'source', label: 'Source' },
  { key: 'interest', label: 'Interested in' },
  { key: 'message', label: 'Message' },
  { key: 'showing', label: 'Showing' },
  { key: 'lastContact', label: 'Last contact' },
  { key: 'received', label: 'Received' },
  { key: 'assignee', label: 'Assignee' },
];

export function compareInquiries(ordering: InquiryOrdering) {
  const newest = (a: Inquiry, b: Inquiry) => b.receivedAt.localeCompare(a.receivedAt);
  switch (ordering) {
    case 'oldest':
      return (a: Inquiry, b: Inquiry) => -newest(a, b);
    case 'showing':
      return (a: Inquiry, b: Inquiry) => (a.showingAt && b.showingAt ? a.showingAt.localeCompare(b.showingAt) : a.showingAt ? -1 : b.showingAt ? 1 : 0) || newest(a, b);
    case 'lastContact':
      return (a: Inquiry, b: Inquiry) => (a.lastContactedAt && b.lastContactedAt ? a.lastContactedAt.localeCompare(b.lastContactedAt) : a.lastContactedAt ? 1 : b.lastContactedAt ? -1 : 0) || newest(a, b);
    default:
      return newest;
  }
}

export type InquiryGroup = { key: string; label: string; items: Inquiry[]; kind: InquiryGrouping };

export function groupInquiries(rows: Inquiry[], grouping: InquiryGrouping, ordering: InquiryOrdering, ws: Workspace, opts: { showEmpty?: boolean; showClosed?: boolean; board?: boolean } = {}): InquiryGroup[] {
  const sorted = [...rows].sort(compareInquiries(ordering));
  if (grouping === 'none') return [{ key: 'all', label: 'All leads', items: sorted, kind: 'none' }];
  const buckets = new Map<string, Inquiry[]>();
  const keyOf = (q: Inquiry) => (grouping === 'status' ? q.status : grouping === 'listing' ? q.listingId ?? '__none__' : grouping === 'source' ? q.source : q.assigneeId ?? '__none__');
  for (const q of sorted) buckets.set(keyOf(q), [...(buckets.get(keyOf(q)) ?? []), q]);
  const make = (key: string, label: string): InquiryGroup => ({ key, label, items: buckets.get(key) ?? [], kind: grouping });
  if (grouping === 'status') {
    const base: string[] = opts.board ? [...OPEN_INQUIRY_STATUSES, 'Applied'] : opts.showClosed ? [...INQUIRY_STATUSES] : [...OPEN_INQUIRY_STATUSES];
    const groups = base.filter(s => opts.showEmpty || opts.board || buckets.has(s)).map(s => make(s, s));
    for (const s of INQUIRY_STATUSES) if (buckets.has(s) && !groups.some(g => g.key === s)) groups.push(make(s, s));
    return groups;
  }
  if (grouping === 'listing') {
    return [...buckets.keys()].map(k => make(k, k === '__none__' ? 'No listing' : buckets.get(k)![0].listingTitle ?? 'Listing')).sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label)));
  }
  if (grouping === 'source') return [...buckets.keys()].sort().map(k => make(k, k));
  const members = [...buckets.keys()].filter(k => k !== '__none__').map(k => make(k, k === ws.me.id ? `${ws.memberName(k)} (you)` : ws.memberName(k)));
  return [...(buckets.has('__none__') ? [make('__none__', 'Unassigned')] : []), ...members];
}

export function useInquiryActions() {
  const qc = useQueryClient();
  const update = useCallback(
    async (targets: Array<Pick<Inquiry, 'id' | 'name'>>, patch: InquiryPatch, opts: { toast?: string | false; lostReason?: string } = {}) => {
      if (!targets.length) return;
      await qc.cancelQueries({ queryKey: lk.inquiries });
      const snap = snapshotOf(qc, lk.inquiryLists, lk.inquiryDetails);
      const ids = new Set(targets.map(t => t.id));
      const apply = <T extends Inquiry>(q: T): T => ({ ...q, ...(patch as Partial<T>) });
      qc.setQueriesData<ListInquiriesOutputType>({ queryKey: lk.inquiryLists }, old => (old ? { ...old, inquiries: old.inquiries.map(q => (ids.has(q.id) ? apply(q) : q)) } : old));
      qc.setQueriesData<InquiryDetail>({ queryKey: lk.inquiryDetails }, old => (old?.inquiry && ids.has(old.inquiry.id) ? { ...old, inquiry: apply(old.inquiry) } : old));
      try {
        await saveInquiry({ action: 'update', ids: [...ids], patch, ...(opts.lostReason ? { lostReason: opts.lostReason as never } : {}) });
        refreshSoon(qc, 'inquiries', targets.length > 1 ? 400 : 1000);
        if (opts.toast !== false && (opts.toast || targets.length > 1)) toast.success(opts.toast || `Updated ${targets.length} leads`);
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, targets.length === 1 ? `Couldn’t update ${targets[0].name}` : `Couldn’t update ${targets.length} leads`));
        throw e;
      }
    },
    [qc],
  );
  return { update };
}

// ─── Listings ───────────────────────────────────────────────────────────────

export function useListingActions() {
  const qc = useQueryClient();

  const update = useCallback(
    async (id: string, patch: ListingPatch, opts: { toast?: string } = {}) => {
      const key = lk.listingDetail(id);
      await qc.cancelQueries({ queryKey: key });
      const snap = snapshotOf(qc, key, lk.listingList);
      qc.setQueryData<ListingDetail>(key, old => (old ? { ...old, listing: { ...old.listing, ...(patch as Partial<ListingDetail['listing']>), ...(patch.photos ? { cover: patch.photos[0]?.url ?? null } : {}) } } : old));
      qc.setQueryData<ListListingsOutputType>(lk.listingList, old => (old ? { ...old, listings: old.listings.map(l => (l.id === id ? { ...l, ...(patch as Partial<Listing>), ...(patch.photos ? { cover: patch.photos[0]?.url ?? null } : {}) } : l)) } : old));
      try {
        const res = await saveListing({ action: 'update', id, patch });
        if (opts.toast) toast.success(opts.toast);
        refreshSoon(qc, `listing:${id}`, 800);
        return res;
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, 'Couldn’t save the listing'));
        throw e;
      }
    },
    [qc],
  );

  const setStatus = useCallback(
    async (listing: Pick<Listing, 'id' | 'title' | 'status'>, status: 'Draft' | 'Published' | 'Paused' | 'Leased') => {
      const key = lk.listingDetail(listing.id);
      const snap = snapshotOf(qc, key, lk.listingList);
      const stamp = status === 'Published' && listing.status !== 'Paused' ? { publishedAt: new Date().toISOString() } : {};
      qc.setQueryData<ListingDetail>(key, old => (old ? { ...old, listing: { ...old.listing, status, ...stamp } } : old));
      qc.setQueryData<ListListingsOutputType>(lk.listingList, old => (old ? { ...old, listings: old.listings.map(l => (l.id === listing.id ? { ...l, status, ...stamp } : l)) } : old));
      try {
        await saveListing({ action: 'status', id: listing.id, status });
        const verb = status === 'Published' ? (listing.status === 'Paused' ? 'Listing resumed' : 'Listing published') : status === 'Paused' ? 'Listing paused' : status === 'Leased' ? 'Marked leased' : 'Moved back to draft';
        toast.success(verb, { description: status === 'Published' ? 'It’s live on the portal’s homes page.' : status === 'Paused' ? 'It’s hidden from the portal until you resume it.' : undefined });
        afterLeasingWrite(qc);
      } catch (e) {
        restore(qc, snap);
        toast.error(errorMessage(e, 'Couldn’t change the listing’s status'));
        throw e;
      }
    },
    [qc],
  );

  return { update, setStatus };
}
