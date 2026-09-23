import { ClipboardCheck, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { InspectionsView } from '../components/maintenance/InspectionsView';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';

/** Move-in, move-out and routine inspections: everything scheduled, in progress and recently done. */
export function InspectionsPage() {
  const app = useAppActions();
  const [params] = useSearchParams();
  const scope = params.get('tab') === 'mine' ? 'mine' : 'all';
  useDocumentTitle('Inspections');
  return (
    <>
      <PageHeader
        icon={<ClipboardCheck />}
        title="Inspections"
        tabs={[
          { to: '/inspections', label: 'All', active: scope === 'all', end: true },
          { to: '/inspections?tab=mine', label: 'Assigned to me', active: scope === 'mine', end: true },
        ]}
        actions={
          <button type="button" onClick={() => app.openCreate('inspection')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Schedule inspection</span>
          </button>
        }
      />
      <InspectionsView key={scope} scope={scope} />
    </>
  );
}
