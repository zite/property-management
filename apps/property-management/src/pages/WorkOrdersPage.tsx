import { Plus, Wrench } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Kbd, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import type { WorkOrderFilters } from '../components/workOrders/data';
import { WorkOrdersView } from '../components/workOrders/WorkOrdersView';
import { useAppActions } from '../lib/app-actions';
import { useWorkspace } from '../lib/workspace';

type Tab = { key: string; label: string; base: WorkOrderFilters; locked?: string[]; count?: number | null };

/**
 * The maintenance queue. Tabs are fixed scopes (all open work, mine,
 * unassigned, waiting on owners); each remembers its own filters and layout.
 */
export function WorkOrdersPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const [params] = useSearchParams();
  useDocumentTitle('Work orders');
  const tabs: Tab[] = [
    { key: 'all', label: 'All', base: {} },
    { key: 'mine', label: 'Assigned to me', base: { assigneeIds: ['__me__'] }, locked: ['assigneeIds'] },
    ...(ws.can('maintenance.manage')
      ? [
          { key: 'unassigned', label: 'Unassigned', base: { assigneeIds: ['__none__'] }, locked: ['assigneeIds'] },
          { key: 'approvals', label: 'Owner approval', base: { approvals: ['Pending' as const] }, locked: ['approvals'], count: ws.counts.approvalsPending },
        ]
      : []),
  ];
  const current = tabs.find(t => t.key === params.get('tab')) ?? tabs[0];

  return (
    <>
      <PageHeader
        icon={<Wrench />}
        title="Work orders"
        tabs={[
          ...tabs.map(t => ({ to: t.key === 'all' ? '/work-orders' : `/work-orders?tab=${t.key}`, label: t.label, count: t.count, active: t.key === current.key, end: true })),
          ...(ws.can('maintenance.manage') ? [{ to: '/work-orders/schedules', label: 'Recurring', active: false }] : []),
        ]}
        actions={
          ws.can('maintenance.create') && (
            <Tip label="New work order" keys={['C']}>
              <button type="button" onClick={() => app.openCreate('workOrder')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New work order</span>
                <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none lg:inline-flex">C</Kbd>
              </button>
            </Tip>
          )
        }
      />
      <WorkOrdersView
        key={current.key}
        surfaceKey={`work-orders:${current.key}`}
        baseFilters={current.base}
        lockedFilters={current.locked}
        defaults={current.key === 'approvals' ? { grouping: 'property' } : current.key === 'mine' ? { ordering: 'due' } : undefined}
        emptyTitle={current.key === 'mine' ? 'Nothing assigned to you' : current.key === 'unassigned' ? 'Everything is assigned' : current.key === 'approvals' ? 'Nothing waiting on owners' : undefined}
        emptyDescription={current.key === 'mine' ? 'Work orders you’re assigned show up here.' : current.key === 'unassigned' ? 'New requests without an assignee land here.' : current.key === 'approvals' ? 'Work orders on hold for an owner’s approval show up here.' : undefined}
      />
    </>
  );
}
