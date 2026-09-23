import { lazy, Suspense } from 'react';
import type { ComposeOptions, CreateDefaults, CreateKind } from '../../lib/app-actions';

/**
 * The registry of create dialogs. Each lives in its own area's folder and is
 * loaded on first use; the shell mounts exactly one at a time.
 *
 * Contract for every dialog: `({ open, onOpenChange, defaults })`. On success
 * it closes itself, toasts, invalidates its query roots and (usually) offers
 * to open what it created.
 */
export type CreateDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; defaults?: CreateDefaults };

const DIALOGS: Record<CreateKind, React.LazyExoticComponent<React.ComponentType<CreateDialogProps>>> = {
  workOrder: lazy(() => import('../workOrders/CreateWorkOrderDialog')),
  task: lazy(() => import('../tasks/TaskDialog')),
  lease: lazy(() => import('../leases/NewLeaseDialog')),
  tenant: lazy(() => import('../residents/TenantDialog')),
  property: lazy(() => import('../portfolio/PropertyDialog')),
  unit: lazy(() => import('../portfolio/UnitDialog')),
  owner: lazy(() => import('../portfolio/OwnerDialog')),
  vendor: lazy(() => import('../maintenance/VendorDialog')),
  inspection: lazy(() => import('../maintenance/InspectionDialog')),
  inquiry: lazy(() => import('../leasing/InquiryDialog')),
  listing: lazy(() => import('../leasing/ListingDialog')),
  bill: lazy(() => import('../accounting/BillDialog')),
  payment: lazy(() => import('../accounting/ReceivePaymentDialog')),
  charge: lazy(() => import('../accounting/ChargeDialog')),
  credit: lazy(() => import('../accounting/CreditDialog')),
  announcement: lazy(() => import('../comms/AnnouncementDialog')),
};

const Compose = lazy(() => import('../comms/ComposeDialog'));

export function CreateDialogHost({ state, onClose }: { state: { kind: CreateKind; defaults?: CreateDefaults; open: boolean } | null; onClose: () => void }) {
  if (!state) return null;
  const Dialog = DIALOGS[state.kind];
  return (
    <Suspense fallback={null}>
      <Dialog open={state.open} onOpenChange={o => !o && onClose()} defaults={state.defaults} />
    </Suspense>
  );
}

export function ComposeHost({ state, onClose }: { state: { open: boolean; options: ComposeOptions } | null; onClose: () => void }) {
  if (!state) return null;
  return (
    <Suspense fallback={null}>
      <Compose open={state.open} onOpenChange={o => !o && onClose()} options={state.options} />
    </Suspense>
  );
}
