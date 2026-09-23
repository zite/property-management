import type { SavedView } from '../../lib/types';
import { LeasesView } from './LeasesView';

/** A saved lease view from the sidebar, e.g. “Leases ending in 90 days” (phases Expiring and Notice, grouped by property). */
export default function LeasesSavedView({ view }: { view: SavedView }) {
  return <LeasesView surfaceKey={`view:${view.id}`} savedView={view} />;
}
