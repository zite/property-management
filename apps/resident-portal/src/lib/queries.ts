import { useQuery } from '@tanstack/react-query';
import { getPortal, getPortalMe, type GetPortalMeOutputType, type GetPortalOutputType } from 'zitejs/api';
import { useSession } from './auth';
import { errorStatus } from './errors';

export type Portal = GetPortalOutputType;
export type Me = GetPortalMeOutputType;
export type ResidentLease = NonNullable<Me['resident']>['leases'][number];

/**
 * Every portal query key starts with 'portal', so a sign-out clears them all
 * together. Areas add keys under their own second segment:
 *   ['portal', 'homes', …]      public listings and applications
 *   ['portal', 'resident', …]   the resident area
 *   ['portal', 'owner', …]      the owner area
 *   ['portal', 'vendor', …]     the vendor area
 * and invalidate by that prefix after a write.
 */
export const qk = {
  portal: ['portal', 'site'] as const,
  me: ['portal', 'me'] as const,
  homes: ['portal', 'homes'] as const,
  applications: ['portal', 'applications'] as const,
  resident: ['portal', 'resident'] as const,
  owner: ['portal', 'owner'] as const,
  vendor: ['portal', 'vendor'] as const,
};

/** Don't retry what the server refused ("not yours", "not found", "sign in"). */
export const retry = (count: number, e: unknown) => {
  const s = errorStatus(e);
  if (s && s >= 400 && s < 500) return false;
  return count < 2;
};

/** The marketplace demo, whose read-only database refuses any write with an error toast. */
export const isDemoPreview = () => typeof window !== 'undefined' && Boolean((window as { __ziteDemo?: unknown }).__ziteDemo);

export function usePortal() {
  return useQuery({ queryKey: qk.portal, queryFn: () => getPortal({}), staleTime: 5 * 60_000, retry });
}

export function useMe() {
  const { user } = useSession();
  return useQuery({ queryKey: qk.me, queryFn: () => getPortalMe({}), enabled: Boolean(user), staleTime: 20_000, retry });
}

/** The lease the resident area shows: the one chosen in the switcher, else the current one. */
export function currentLease(me: Me | undefined, chosenId?: string | null): ResidentLease | null {
  const leases = me?.resident?.leases ?? [];
  return leases.find(l => l.id === chosenId) ?? leases[0] ?? null;
}
