import { useMemo } from 'react';
import type { SavedView } from '../../lib/types';
import { parseViewConfig } from '../list/SaveViewDialog';
import type { TaskScope } from './data';
import { TasksView } from './TasksView';

const SCOPES: TaskScope[] = ['mine', 'open', 'created', 'done'];

/** A saved task view (scope `tasks`). Its config's `filters.scope` says which tab it was saved from. */
export default function TasksSavedView({ view }: { view: SavedView }) {
  const scope = useMemo(() => {
    const s = parseViewConfig(view.config).filters.scope;
    return SCOPES.includes(s as TaskScope) ? (s as TaskScope) : 'open';
  }, [view.config]);
  return <TasksView surfaceKey={`view:${view.id}`} savedView={view} scope={scope} emptyTitle="No tasks in this view" emptyDescription="Tasks that match this view’s filters show up here." />;
}
