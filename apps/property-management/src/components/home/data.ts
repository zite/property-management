import { useQuery } from '@tanstack/react-query';
import { getDashboard, type GetDashboardOutputType } from 'zitejs/api';
import { qk } from '../../lib/queries';

/** Home's one query. Refreshes when the window regains focus and every two minutes while open. */

export type Dashboard = GetDashboardOutputType;
export type AttentionSection = Dashboard['sections'][number];
export type AttentionItem = AttentionSection['items'][number];
export type FeedItem = Dashboard['activity'][number];

export function useDashboard() {
  return useQuery({
    queryKey: [...qk.dashboard, 'home'],
    queryFn: () => getDashboard({}),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 120_000,
  });
}
