import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@project/components/ui/tooltip';
import { Layout, areasFor } from './components/Layout';
import { SignInPrompt } from './components/SignInPrompt';
import { Container, LinkButton, PageSkeleton } from './components/ui';
import { useSession } from './lib/auth';
import { useBrand } from './lib/brand';
import { useMe, usePortal } from './lib/queries';
import { initSystemTheme, useIsDark } from './lib/theme';

// Before the first render, so a dark-mode visitor never sees a white flash.
initSystemTheme();

/**
 * Resident Portal: public listings and rental applications, plus separate
 * areas for residents, owners and vendors. HashRouter, not BrowserRouter —
 * the app is served from a path the runtime doesn't rewrite, so a refreshed
 * path-based link (the kind we email) would 404.
 *
 * Every page loads on demand, so one area's code never slows another's.
 */

const HomesPage = lazy(() => import('./pages/public/HomesPage'));
const ListingPage = lazy(() => import('./pages/public/ListingPage'));
const ApplyPage = lazy(() => import('./pages/public/ApplyPage'));
const MyApplicationsPage = lazy(() => import('./pages/public/MyApplicationsPage'));
const ApplicationStatusPage = lazy(() => import('./pages/public/ApplicationStatusPage'));
const AccountPage = lazy(() => import('./pages/public/AccountPage'));
const ResidentHomePage = lazy(() => import('./pages/resident/ResidentHomePage'));
const PaymentsPage = lazy(() => import('./pages/resident/PaymentsPage'));
const PayPage = lazy(() => import('./pages/resident/PayPage'));
const MaintenancePage = lazy(() => import('./pages/resident/MaintenancePage'));
const NewRequestPage = lazy(() => import('./pages/resident/NewRequestPage'));
const RequestPage = lazy(() => import('./pages/resident/RequestPage'));
const LeasePage = lazy(() => import('./pages/resident/LeasePage'));
const DocumentsPage = lazy(() => import('./pages/resident/DocumentsPage'));
const MessagesPage = lazy(() => import('./pages/resident/MessagesPage'));
const OwnerHomePage = lazy(() => import('./pages/owner/OwnerHomePage'));
const OwnerPropertyPage = lazy(() => import('./pages/owner/OwnerPropertyPage'));
const StatementsPage = lazy(() => import('./pages/owner/StatementsPage'));
const ApprovalsPage = lazy(() => import('./pages/owner/ApprovalsPage'));
const OwnerDocumentsPage = lazy(() => import('./pages/owner/OwnerDocumentsPage'));
const OwnerMessagesPage = lazy(() => import('./pages/owner/OwnerMessagesPage'));
const VendorHomePage = lazy(() => import('./pages/vendor/VendorHomePage'));
const VendorWorkOrderPage = lazy(() => import('./pages/vendor/VendorWorkOrderPage'));
const VendorPaymentsPage = lazy(() => import('./pages/vendor/VendorPaymentsPage'));
const VendorProfilePage = lazy(() => import('./pages/vendor/VendorProfilePage'));

const Page = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;

/** `/`: signed-in people land in their own area; everyone else sees homes for rent. */
function Landing() {
  const { user, isLoading } = useSession();
  const me = useMe();
  if (isLoading || (user && me.isPending)) return <PageSkeleton variant="list" />;
  const first = areasFor(me.data)[0];
  if (user && first) return <Navigate to={first.to} replace />;
  if (user && (me.data?.applicant.applications ?? 0) > 0) return <Navigate to="/applications" replace />;
  return <Navigate to="/homes" replace />;
}

/** Gate for an area: sign in first, then prove the account has that role. */
function RequireArea({ area, children }: { area: 'resident' | 'owner' | 'vendor'; children: ReactNode }) {
  const { user, isLoading } = useSession();
  const me = useMe();
  if (isLoading || (user && me.isPending)) return <PageSkeleton />;
  if (!user) {
    const copy = {
      resident: { title: 'Sign in to your resident portal', body: 'Use the email address on your lease to pay rent, request maintenance and see your documents.' },
      owner: { title: 'Sign in to your owner portal', body: 'Use the email address your property manager has on file to see statements, distributions and approvals.' },
      vendor: { title: 'Sign in to the vendor portal', body: 'Use the email address the property manager has on file for your company to see and update your work orders.' },
    }[area];
    return <SignInPrompt title={copy.title} body={copy.body} />;
  }
  const has = area === 'resident' ? me.data?.resident : area === 'owner' ? me.data?.owner : me.data?.vendor;
  if (!has) {
    return (
      <Container size="narrow" className="py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">We couldn’t find {area === 'resident' ? 'a lease' : area === 'owner' ? 'owner access' : 'vendor access'} for {user.email}</h1>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          {area === 'resident'
            ? 'If you just signed a lease, the office may not have added this email yet. Contact them and ask to be invited to the portal.'
            : 'Ask your property manager to enable portal access for this email address.'}
        </p>
        <LinkButton to="/" variant="secondary" className="mt-6">Go to the portal home</LinkButton>
      </Container>
    );
  }
  return <Page>{children}</Page>;
}

export default function App() {
  const portal = usePortal();
  useBrand(portal.data?.settings.brandColor);
  const dark = useIsDark();

  return (
    <TooltipProvider delayDuration={250}>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/homes" element={<Page><HomesPage /></Page>} />
            <Route path="/homes/:slug" element={<Page><ListingPage /></Page>} />
            <Route path="/homes/:slug/apply" element={<Page><ApplyPage /></Page>} />
            <Route path="/applications" element={<Page><MyApplicationsPage /></Page>} />
            <Route path="/applications/:id" element={<Page><ApplicationStatusPage /></Page>} />
            <Route path="/account" element={<Page><AccountPage /></Page>} />

            <Route path="/resident" element={<RequireArea area="resident"><ResidentHomePage /></RequireArea>} />
            <Route path="/resident/payments" element={<RequireArea area="resident"><PaymentsPage /></RequireArea>} />
            <Route path="/resident/pay" element={<RequireArea area="resident"><PayPage /></RequireArea>} />
            <Route path="/resident/maintenance" element={<RequireArea area="resident"><MaintenancePage /></RequireArea>} />
            <Route path="/resident/maintenance/new" element={<RequireArea area="resident"><NewRequestPage /></RequireArea>} />
            <Route path="/resident/maintenance/:number" element={<RequireArea area="resident"><RequestPage /></RequireArea>} />
            <Route path="/resident/lease" element={<RequireArea area="resident"><LeasePage /></RequireArea>} />
            <Route path="/resident/documents" element={<RequireArea area="resident"><DocumentsPage /></RequireArea>} />
            <Route path="/resident/messages" element={<RequireArea area="resident"><MessagesPage /></RequireArea>} />

            <Route path="/owner" element={<RequireArea area="owner"><OwnerHomePage /></RequireArea>} />
            <Route path="/owner/properties/:id" element={<RequireArea area="owner"><OwnerPropertyPage /></RequireArea>} />
            <Route path="/owner/statements" element={<RequireArea area="owner"><StatementsPage /></RequireArea>} />
            <Route path="/owner/approvals" element={<RequireArea area="owner"><ApprovalsPage /></RequireArea>} />
            <Route path="/owner/documents" element={<RequireArea area="owner"><OwnerDocumentsPage /></RequireArea>} />
            <Route path="/owner/messages" element={<RequireArea area="owner"><OwnerMessagesPage /></RequireArea>} />

            <Route path="/vendor" element={<RequireArea area="vendor"><VendorHomePage /></RequireArea>} />
            <Route path="/vendor/work-orders/:number" element={<RequireArea area="vendor"><VendorWorkOrderPage /></RequireArea>} />
            <Route path="/vendor/payments" element={<RequireArea area="vendor"><VendorPaymentsPage /></RequireArea>} />
            <Route path="/vendor/profile" element={<RequireArea area="vendor"><VendorProfilePage /></RequireArea>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </HashRouter>
      <Toaster position="bottom-center" theme={dark ? 'dark' : 'light'} closeButton toastOptions={{ className: 'text-[15px] rounded-xl' }} />
    </TooltipProvider>
  );
}
