import type { SavedView } from '../../lib/types';
import { ApplicationsView } from './ApplicationsView';

/** A saved view with scope `applications`, rendered at `/views/:id` through `pages/ViewPage.tsx`. */
export default function ApplicationsSavedView({ view }: { view: SavedView }) {
  return <ApplicationsView surfaceKey={`view:${view.id}`} savedView={view} />;
}
