import type { SavedView } from '../../lib/types';
import { WorkOrdersView } from './WorkOrdersView';

export default function WorkOrdersSavedView({ view }: { view: SavedView }) {
  return <WorkOrdersView surfaceKey={`view:${view.id}`} savedView={view} />;
}
