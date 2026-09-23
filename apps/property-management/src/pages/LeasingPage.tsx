import { Plus, UserPlus } from 'lucide-react';
import { Navigate, useParams } from 'react-router-dom';
import { ApplicationsView } from '../components/leasing/ApplicationsView';
import { useListings } from '../components/leasing/data';
import { LeadsView } from '../components/leasing/LeadsView';
import { ListingsView } from '../components/leasing/ListingsView';
import { VacanciesView } from '../components/leasing/VacanciesView';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { useWorkspace } from '../lib/workspace';

const TABS = ['applications', 'leads', 'listings', 'vacancies'] as const;
type Tab = (typeof TABS)[number];
const TITLES: Record<Tab, string> = { applications: 'Applications', leads: 'Leads', listings: 'Listings', vacancies: 'Vacancies' };

const primary = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90';

/**
 * Leasing: the pipeline from an empty unit to a signed lease. Vacancies is the
 * to-do list, Listings market the homes, Leads are the people asking, and
 * Applications are the people who applied.
 */
export function LeasingPage() {
  const ws = useWorkspace();
  const app = useAppActions();
  const params = useParams();
  // Inbox notifications from the portal link to /leasing/inquiries.
  const raw = params.tab === 'inquiries' ? 'leads' : params.tab;
  const tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : null;
  useDocumentTitle(tab ? `${TITLES[tab]} · Leasing` : 'Leasing');
  const listings = useListings();
  if (!tab) return <Navigate to="/leasing/applications" replace />;
  if (params.tab === 'inquiries') return <Navigate to="/leasing/leads" replace />;

  const live = listings.data?.listings.filter(l => l.status === 'Published').length;
  const vacancies = ws.units.filter(u => !u.archived && u.occupancy !== 'Occupied' && ws.propertyById.get(u.propertyId)?.status !== 'Archived').length;

  return (
    <>
      <PageHeader
        icon={<UserPlus />}
        title="Leasing"
        tabs={[
          { to: '/leasing/applications', label: 'Applications', count: ws.counts.applicationsToReview },
          { to: '/leasing/leads', label: 'Leads', count: ws.counts.inquiriesNew },
          { to: '/leasing/listings', label: 'Listings', count: live ?? null },
          { to: '/leasing/vacancies', label: 'Vacancies', count: vacancies },
        ]}
        actions={
          tab === 'leads' ? (
            <button type="button" className={primary} onClick={() => app.openCreate('inquiry')}>
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New lead</span>
            </button>
          ) : tab === 'listings' || tab === 'vacancies' ? (
            <button type="button" className={primary} onClick={() => app.openCreate('listing')}>
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New listing</span>
            </button>
          ) : null
        }
      />
      {tab === 'applications' && <ApplicationsView surfaceKey="leasing:applications" />}
      {tab === 'leads' && <LeadsView surfaceKey="leasing:leads" />}
      {tab === 'listings' && <ListingsView />}
      {tab === 'vacancies' && <VacanciesView />}
    </>
  );
}
