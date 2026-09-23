import { Layers } from 'lucide-react';
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import type { SavedView } from '../lib/types';
import { useWorkspace } from '../lib/workspace';
import { VIEW_SCOPE_CAPABILITY } from '../components/shell/Sidebar';

/**
 * A saved view from the sidebar. The view's scope picks the list that renders
 * it; each area registers a component taking `{ view }` that renders its
 * list with `savedView={view}` and `surfaceKey={`view:${view.id}`}`.
 */
const SURFACES: Record<string, { label: string; to: string; Component: LazyExoticComponent<ComponentType<{ view: SavedView }>> }> = {
  work_orders: { label: 'Work orders', to: '/work-orders', Component: lazy(() => import('../components/workOrders/WorkOrdersSavedView')) },
  leases: { label: 'Leases', to: '/leases', Component: lazy(() => import('../components/leases/LeasesSavedView')) },
  tasks: { label: 'Tasks', to: '/tasks', Component: lazy(() => import('../components/tasks/TasksSavedView')) },
  applications: { label: 'Applications', to: '/leasing/applications', Component: lazy(() => import('../components/leasing/ApplicationsSavedView')) },
};

export function ViewPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  const view = id ? ws.viewById.get(id) : undefined;
  useDocumentTitle(view?.name ?? 'View');
  const needs = view ? VIEW_SCOPE_CAPABILITY[view.scope] : undefined;
  const surface = view && (!needs || ws.can(needs)) ? SURFACES[view.scope] : undefined;

  if (!view || !surface) {
    return (
      <>
        <PageHeader icon={<Layers />} title="View" />
        <EmptyState icon={<Layers />} title={view ? 'This kind of view isn’t supported' : 'View not found'} description={view ? undefined : 'It may have been deleted, or it isn’t shared with you.'} />
      </>
    );
  }
  const { Component } = surface;
  return (
    <>
      <PageHeader icon={<Layers />} breadcrumb={{ to: surface.to, label: surface.label }} title={view.name} />
      <Suspense fallback={<div className="flex-1" />}>
        <Component key={view.id} view={view} />
      </Suspense>
    </>
  );
}
