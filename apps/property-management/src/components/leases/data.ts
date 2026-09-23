import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  getLease, leaseLifecycle, listLeases,
  type GetLeaseOutputType, type LeaseLifecycleInputType, type LeaseLifecycleOutputType, type ListLeasesInputType, type ListLeasesOutputType,
} from 'zitejs/api';
import { RENEWAL_STATUSES, type LeasePhase } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { invalidate, invalidateMoney, qk, retryUnlessNotFound } from '../../lib/queries';
import type { Workspace } from '../../lib/workspace';

/**
 * Lease data: list and detail queries, grouping and ordering, and the one
 * helper every lifecycle button uses — it runs the action, says what happened
 * (including when a template is switched off and nobody was emailed), and
 * refreshes everything a lease change touches.
 */

export type LeaseRow = ListLeasesOutputType['leases'][number];
export type LeaseDetail = GetLeaseOutputType;
export type LeaseFilters = NonNullable<ListLeasesInputType['filters']>;
export type Tally = { sent: number; failed: number; noEmail: number; templateOff: boolean } | null | undefined;

export const NAV_ORDER_KEY = 'property-management:leases:order';

export const lk = {
  lists: [...qk.leases, 'list'] as const,
  list: (filters: LeaseFilters) => [...qk.leases, 'list', filters] as const,
  details: [...qk.leases, 'detail'] as const,
  detail: (id: string) => [...qk.leases, 'detail', id] as const,
};

export function useLeases(filters: LeaseFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: lk.list(filters), queryFn: () => listLeases({ filters }), placeholderData: keepPreviousData, staleTime: 20_000, enabled: opts.enabled ?? true });
}

export function useLease(id: string | null | undefined) {
  return useQuery({ queryKey: lk.detail(id ?? ''), queryFn: () => getLease({ id: id! }), enabled: Boolean(id), retry: retryUnlessNotFound, staleTime: 10_000 });
}

/** Everything a lease event can change: the lease, residents, occupancy in bootstrap, money, units, applications, inbox. */
export function afterLeaseChange(qc: QueryClient, opts: { money?: boolean } = {}) {
  invalidate(qc, 'leases', 'residents', 'bootstrap', 'units', 'properties', 'dashboard', 'activity', 'documents', 'leasing', 'messages', 'tasks');
  if (opts.money) invalidateMoney(qc);
}

/** What happened to the emails an action sends. `what` names the template, e.g. "Signature request". */
export function tallyText(t: Tally, what = 'Email') {
  if (!t) return undefined;
  if (t.templateOff) return `The ${what} template is switched off in Settings, so nobody was emailed.`;
  const parts: string[] = [];
  if (t.sent) parts.push(`${what} sent to ${t.sent} ${t.sent === 1 ? 'resident' : 'residents'}`);
  if (t.failed) parts.push(`${t.failed} ${t.failed === 1 ? 'email' : 'emails'} couldn’t be delivered`);
  if (t.noEmail) parts.push(`${t.noEmail} without an email address`);
  return parts.length ? `${parts.join(' · ')}.` : undefined;
}

/** Run a lifecycle action with a pending flag, a toast and the right invalidations. */
export function useLeaseLifecycle() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async (input: LeaseLifecycleInputType, opts: { what?: string; money?: boolean; quiet?: boolean; errorFallback?: string } = {}): Promise<LeaseLifecycleOutputType | null> => {
      setPending(input.action);
      try {
        const res = await leaseLifecycle(input);
        afterLeaseChange(qc, { money: opts.money });
        if (!opts.quiet) {
          const description = [tallyText(res.tally, opts.what), res.skipped?.length ? `Skipped: ${res.skipped.join('; ')}.` : ''].filter(Boolean).join(' ');
          if (res.tally?.templateOff) toast.warning(res.message, { description });
          else toast.success(res.message, { description: description || undefined });
        }
        return res;
      } catch (e) {
        toast.error(errorMessage(e, opts.errorFallback ?? 'That didn’t work. Try again.'));
        return null;
      } finally {
        setPending(null);
      }
    },
    [qc],
  );
  return { run, pending };
}

// ─── Grouping & ordering ────────────────────────────────────────────────────

export type LeaseGrouping = 'phase' | 'property' | 'renewal' | 'none';
export type LeaseOrdering = 'end' | 'unit' | 'balance' | 'rent' | 'newest' | 'start';

export const GROUPINGS: ReadonlyArray<{ value: LeaseGrouping; label: string }> = [
  { value: 'phase', label: 'Phase' },
  { value: 'property', label: 'Property' },
  { value: 'renewal', label: 'Renewal status' },
  { value: 'none', label: 'No grouping' },
];

export const ORDERINGS: ReadonlyArray<{ value: LeaseOrdering; label: string }> = [
  { value: 'end', label: 'Ending soonest' },
  { value: 'unit', label: 'Unit' },
  { value: 'balance', label: 'Balance owed' },
  { value: 'rent', label: 'Rent' },
  { value: 'start', label: 'Start date' },
  { value: 'newest', label: 'Newest' },
];

export const DISPLAY_PROPERTIES = [
  { key: 'number', label: 'Lease #' },
  { key: 'residents', label: 'Residents' },
  { key: 'term', label: 'Term' },
  { key: 'expiry', label: 'Days left' },
  { key: 'renewal', label: 'Renewal' },
  { key: 'rent', label: 'Rent' },
  { key: 'balance', label: 'Balance' },
  { key: 'deposit', label: 'Deposit held' },
];

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function compareLeases(ordering: LeaseOrdering, ws: Workspace) {
  const nullsLast = (a: string | null, b: string | null) => (a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0);
  const unit = (l: LeaseRow) => ws.unitLabel(l.unitId, l.propertyId);
  const byNumber = (a: LeaseRow, b: LeaseRow) => (b.number ?? 0) - (a.number ?? 0);
  switch (ordering) {
    case 'end':
      return (a: LeaseRow, b: LeaseRow) => nullsLast(a.moveOutDate ?? a.endDate, b.moveOutDate ?? b.endDate) || collator.compare(unit(a), unit(b));
    case 'unit':
      return (a: LeaseRow, b: LeaseRow) => collator.compare(unit(a), unit(b)) || byNumber(a, b);
    case 'balance':
      return (a: LeaseRow, b: LeaseRow) => b.balance - a.balance || collator.compare(unit(a), unit(b));
    case 'rent':
      return (a: LeaseRow, b: LeaseRow) => b.rent - a.rent || collator.compare(unit(a), unit(b));
    case 'start':
      return (a: LeaseRow, b: LeaseRow) => nullsLast(b.startDate, a.startDate) || byNumber(a, b);
    default:
      return byNumber;
  }
}

export type LeaseGroup = { key: string; label: string; items: LeaseRow[]; color?: string; kind: LeaseGrouping };

/** Phases in the order a property manager works them: what needs doing first, settled leases last. */
export const PHASE_ORDER: LeasePhase[] = ['Draft', 'Pending signature', 'Notice', 'Expiring', 'Month-to-month', 'Upcoming', 'Current', 'Ended', 'Canceled'];

const RENEWAL_LABEL: Record<string, string> = { None: 'No renewal', Offered: 'Renewal offered', Accepted: 'Renewed', Declined: 'Declined' };

export function groupLeases(rows: LeaseRow[], grouping: LeaseGrouping, ordering: LeaseOrdering, ws: Workspace, opts: { showEmpty?: boolean } = {}): LeaseGroup[] {
  const sorted = [...rows].sort(compareLeases(ordering, ws));
  if (grouping === 'none') return [{ key: 'all', label: 'All leases', items: sorted, kind: 'none' }];
  const buckets = new Map<string, LeaseRow[]>();
  const keyOf = (l: LeaseRow) => (grouping === 'phase' ? l.phase : grouping === 'property' ? l.propertyId ?? '__none__' : l.renewalStatus || 'None');
  for (const l of sorted) {
    const k = keyOf(l);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(l);
  }
  const make = (key: string, label: string, color?: string): LeaseGroup => ({ key, label, items: buckets.get(key) ?? [], color, kind: grouping });
  if (grouping === 'phase') return PHASE_ORDER.filter(p => buckets.has(p) || (opts.showEmpty && p !== 'Canceled')).map(p => make(p, p));
  if (grouping === 'renewal') return [...RENEWAL_STATUSES].sort((a, b) => ['Offered', 'Accepted', 'Declined', 'None'].indexOf(a) - ['Offered', 'Accepted', 'Declined', 'None'].indexOf(b)).filter(s => buckets.has(s) || opts.showEmpty).map(s => make(s, RENEWAL_LABEL[s] ?? s));
  const groups = ws.orderedProperties.filter(p => buckets.has(p.id) || (opts.showEmpty && p.status !== 'Archived')).map(p => make(p.id, p.name, p.color));
  if (buckets.has('__none__')) groups.push(make('__none__', 'No property'));
  return groups;
}

/** Residents on the selected leases who can be written to, for the composer. */
export function composeRecipients(leases: LeaseRow[]) {
  const seen = new Set<string>();
  const out: Array<{ kind: 'tenant'; id: string; name: string; email: string | null }> = [];
  for (const l of leases) {
    for (const r of l.residents) {
      if ((r.role !== 'Primary' && r.role !== 'Co-tenant') || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ kind: 'tenant', id: r.id, name: r.name, email: r.email || null });
    }
  }
  return out;
}

export const residentNames = (l: Pick<LeaseRow, 'residents'>) => l.residents.filter(r => r.role !== 'Guarantor').map(r => r.name).join(', ');
