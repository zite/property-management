import { Plus, Users } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useResidents, type ResidentStatus } from '../components/residents/data';
import { ResidentsView } from '../components/residents/ResidentsView';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';

const TABS: Array<{ key: ResidentStatus; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: 'future', label: 'Moving in' },
  { key: 'past', label: 'Past' },
  { key: 'all', label: 'All' },
];

/** Everyone who lives in, is moving into, or has lived in one of your homes — and how to reach them. */
export function ResidentsPage() {
  const app = useAppActions();
  const [params] = useSearchParams();
  useDocumentTitle('Residents');
  const current = TABS.find(t => t.key === params.get('tab')) ?? TABS[0];
  const { data } = useResidents({ status: current.key });
  return (
    <>
      <PageHeader
        icon={<Users />}
        title="Residents"
        tabs={TABS.map(t => ({ to: t.key === 'current' ? '/residents' : `/residents?tab=${t.key}`, label: t.label, count: t.key === 'future' ? data?.counts.future ?? null : null, active: t.key === current.key, end: true }))}
        actions={
          <button type="button" onClick={() => app.openCreate('tenant')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New resident</span>
          </button>
        }
      />
      <ResidentsView key={current.key} status={current.key} surfaceKey={`residents:${current.key}`} />
    </>
  );
}
