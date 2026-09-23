import { Hammer, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { inScope, VendorsView, type VendorScope } from '../components/maintenance/VendorsView';
import { useVendors } from '../components/maintenance/data';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';

const SCOPES: Array<{ key: VendorScope; label: string }> = [
  { key: 'active', label: 'All vendors' },
  { key: 'attention', label: 'Needs attention' },
  { key: '1099', label: '1099' },
  { key: 'inactive', label: 'Inactive' },
];

/** The vendor directory, scoped by tab: everyone active, compliance problems, 1099 vendors, inactive. */
export function VendorsPage() {
  const app = useAppActions();
  const [params] = useSearchParams();
  const { data, isPending, isError, error, refetch, isFetching } = useVendors();
  const scope = (SCOPES.find(s => s.key === params.get('tab'))?.key ?? 'active') as VendorScope;
  useDocumentTitle('Vendors');
  const vendors = data?.vendors ?? [];
  const count = (s: VendorScope) => (data ? vendors.filter(v => inScope(v, s)).length : null);

  return (
    <>
      <PageHeader
        icon={<Hammer />}
        title="Vendors"
        tabs={SCOPES.map(s => ({ to: s.key === 'active' ? '/vendors' : `/vendors?tab=${s.key}`, label: s.label, count: s.key === 'active' ? null : count(s.key), active: s.key === scope, end: true }))}
        actions={
          <button type="button" onClick={() => app.openCreate('vendor')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New vendor</span>
          </button>
        }
      />
      <VendorsView
        key={scope}
        scope={scope}
        vendors={vendors}
        isPending={isPending}
        isError={isError}
        errorText={errorMessage(error, 'Something went wrong.')}
        onRetry={() => void refetch()}
        fetching={isFetching && !isPending}
        canSeeMoney={data?.canSeeMoney ?? false}
        year={data?.year ?? new Date().getFullYear()}
      />
    </>
  );
}
