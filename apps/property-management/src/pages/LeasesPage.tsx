import { KeyRound, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { LeaseFilters, LeaseGrouping, LeaseOrdering } from '../components/leases/data';
import { LeasesView } from '../components/leases/LeasesView';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';

type Tab = { key: string; label: string; base: LeaseFilters; locked?: string[]; defaults?: { grouping?: LeaseGrouping; ordering?: LeaseOrdering }; emptyTitle?: string; emptyDescription?: string };

const TABS: Tab[] = [
  { key: 'all', label: 'All', base: {} },
  { key: 'renewals', label: 'Renewals', base: { phases: ['Expiring', 'Month-to-month'] }, locked: ['phases'], defaults: { grouping: 'renewal', ordering: 'end' }, emptyTitle: 'No leases coming up for renewal', emptyDescription: 'Leases within the renewal window and month-to-month leases show up here.' },
  { key: 'move-outs', label: 'Move-outs', base: { phases: ['Notice'] }, locked: ['phases'], defaults: { grouping: 'none', ordering: 'end' }, emptyTitle: 'Nobody is moving out', emptyDescription: 'When residents give notice, their move-out shows up here until it’s complete.' },
  { key: 'unsigned', label: 'Unsigned', base: { phases: ['Draft', 'Pending signature'] }, locked: ['phases'], defaults: { grouping: 'phase', ordering: 'start' }, emptyTitle: 'Nothing waiting on signatures', emptyDescription: 'Drafts and leases out for signature show up here.' },
  { key: 'past', label: 'Past', base: { phases: ['Ended', 'Canceled'] }, locked: ['phases'], defaults: { grouping: 'none', ordering: 'end' }, emptyTitle: 'No past leases', emptyDescription: 'Ended and canceled leases are kept here with their ledgers.' },
];

/** Every lease, by phase: the renewal pipeline, move-outs, leases waiting on signatures, and history. */
export function LeasesPage() {
  const app = useAppActions();
  const [params] = useSearchParams();
  useDocumentTitle('Leases');
  const current = TABS.find(t => t.key === params.get('tab')) ?? TABS[0];

  return (
    <>
      <PageHeader
        icon={<KeyRound />}
        title="Leases"
        tabs={TABS.map(t => ({ to: t.key === 'all' ? '/leases' : `/leases?tab=${t.key}`, label: t.label, active: t.key === current.key, end: true }))}
        actions={
          <button type="button" onClick={() => app.openCreate('lease')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New lease</span>
          </button>
        }
      />
      <LeasesView key={current.key} surfaceKey={`leases:${current.key}`} baseFilters={current.base} lockedFilters={current.locked} defaults={current.defaults} emptyTitle={current.emptyTitle} emptyDescription={current.emptyDescription} />
    </>
  );
}
