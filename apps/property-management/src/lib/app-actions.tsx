import { createContext, useContext } from 'react';

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
};

/**
 * Everything that can be created from anywhere — the ⌘K palette, the sidebar's
 * "+" menu, a page's primary button, a row's context menu. The dialog for each
 * lives once in the shell, so creating a work order from a unit page or from
 * the palette is the same flow. `defaults` pre-fills it (a property, a unit, a
 * lease, a vendor…); each dialog documents the keys it reads.
 */
export type CreateKind =
  | 'workOrder'
  | 'task'
  | 'lease'
  | 'property'
  | 'unit'
  | 'owner'
  | 'vendor'
  | 'tenant'
  | 'inquiry'
  | 'listing'
  | 'bill'
  | 'payment'
  | 'charge'
  | 'credit'
  | 'announcement'
  | 'inspection';

export type CreateDefaults = Record<string, string | number | boolean | null | undefined>;

export type ComposeRecipient = { kind: 'tenant' | 'owner' | 'vendor' | 'applicant'; id: string; name: string; email?: string | null };

export type ComposeOptions = {
  recipients: ComposeRecipient[];
  subject?: string;
  body?: string;
  /** Links the message to a record so it shows on that record's timeline too. */
  context?: { leaseId?: string; workOrderId?: string; propertyId?: string; applicationId?: string };
};

export type AppActions = {
  openPalette: (initialQuery?: string) => void;
  openShortcuts: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  openCreate: (kind: CreateKind, defaults?: CreateDefaults) => void;
  openCompose: (options: ComposeOptions) => void;
  /** Peek a work order in a side sheet without leaving the current list. */
  peekWorkOrder: (number: number) => void;
  closePeek: () => void;
  peekedWorkOrder: number | null;
};

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions() {
  const ctx = useContext(AppActionsContext);
  if (!ctx) throw new Error('useAppActions must be used inside AppShell');
  return ctx;
}
