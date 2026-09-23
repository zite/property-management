import { ListChecks, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Kbd, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { canManageTasks, type TaskScope } from '../components/tasks/data';
import { TasksView } from '../components/tasks/TasksView';
import { useAppActions } from '../lib/app-actions';
import { useWorkspace } from '../lib/workspace';

type Tab = { key: TaskScope; label: string; count?: number | null; emptyTitle: string; emptyDescription: string };

/**
 * Tasks. Tabs are fixed scopes — mine, the team's open work (managers),
 * created by me, done — each remembering its own filters and display.
 * `?task=<id>` opens a task in the side sheet from anywhere.
 */
export function TasksPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const [params] = useSearchParams();
  useDocumentTitle('Tasks');
  const tabs: Tab[] = [
    { key: 'mine', label: 'My tasks', count: ws.counts.myTasks, emptyTitle: 'Nothing on your list', emptyDescription: 'Tasks assigned to you show up here — ones you create, ones teammates hand you, and ones opened automatically for renewals and move-outs.' },
    ...(canManageTasks(ws) ? [{ key: 'open' as const, label: 'All open', emptyTitle: 'No open tasks on the team', emptyDescription: 'When anyone on the team has something to do, it shows up here.' }] : []),
    { key: 'created', label: 'Created by me', emptyTitle: 'You haven’t handed anything off', emptyDescription: 'Tasks you create — for yourself or a teammate — show up here until they’re done.' },
    { key: 'done', label: 'Done', emptyTitle: 'Nothing completed recently', emptyDescription: 'Tasks finished in the last 120 days show up here.' },
  ];
  const current = tabs.find(t => t.key === params.get('tab')) ?? tabs[0];

  return (
    <>
      <PageHeader
        icon={<ListChecks />}
        title="Tasks"
        tabs={tabs.map(t => ({ to: t.key === 'mine' ? '/tasks' : `/tasks?tab=${t.key}`, label: t.label, count: t.count, active: t.key === current.key, end: true }))}
        actions={
          <Tip label="New task" keys={['N']}>
            <button type="button" onClick={() => app.openCreate('task')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New task</span>
              <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none lg:inline-flex">N</Kbd>
            </button>
          </Tip>
        }
      />
      <TasksView
        key={current.key}
        surfaceKey={`tasks:${current.key}`}
        scope={current.key}
        defaults={current.key === 'done' ? { grouping: 'none', ordering: 'completed' } : current.key === 'open' ? { grouping: 'assignee' } : undefined}
        emptyTitle={current.emptyTitle}
        emptyDescription={current.emptyDescription}
      />
    </>
  );
}
