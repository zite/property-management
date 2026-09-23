import { ExternalLink, FileImage, FileText, FolderOpen, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { useOwnerDocuments, type OwnerDocuments } from '../../components/owner/data';
import { AreaSkeleton, LoadError, PageHeader, Segmented } from '../../components/owner/kit';
import { Button, Card, Container, EmptyState, StatusPill, inputClass } from '../../components/ui';
import { shortDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Documents the office has shared: management agreements, insurance policies,
 * warranties and repair quotes — grouped by property, searchable.
 */

type Doc = OwnerDocuments['documents'][number];

const fileSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function OwnerDocumentsPage() {
  useDocumentTitle('Documents');
  const q = useOwnerDocuments();
  const [scope, setScope] = useState('all');
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const docs = q.data?.documents ?? [];
    const term = search.trim().toLowerCase();
    const filtered = docs.filter(d => (scope === 'all' ? true : scope === 'general' ? !d.propertyId : d.propertyId === scope)).filter(d => !term || `${d.name} ${d.category} ${d.propertyName} ${d.workOrderTitle}`.toLowerCase().includes(term));
    const map = new Map<string, { title: string; docs: Doc[] }>();
    for (const d of filtered) {
      const key = d.propertyId ?? 'general';
      if (!map.has(key)) map.set(key, { title: d.propertyId ? d.propertyName : 'Your account', docs: [] });
      map.get(key)!.docs.push(d);
    }
    return [...map.entries()].sort((a, b) => (a[0] === 'general' ? -1 : b[0] === 'general' ? 1 : a[1].title.localeCompare(b[1].title)));
  }, [q.data, scope, search]);

  if (q.isPending) return <AreaSkeleton variant="list" />;
  if (q.isError || !q.data) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your documents" home={{ to: '/owner', label: 'Overview' }} />;
  const d = q.data;
  const hasGeneral = d.documents.some(x => !x.propertyId);
  const options = [
    { value: 'all', label: 'All', count: d.documents.length },
    ...(hasGeneral ? [{ value: 'general', label: 'Your account', count: d.documents.filter(x => !x.propertyId).length }] : []),
    ...d.properties.filter(p => d.documents.some(x => x.propertyId === p.id)).map(p => ({ value: p.id, label: p.name, count: d.documents.filter(x => x.propertyId === p.id).length })),
  ];
  const filtering = scope !== 'all' || search.trim() !== '';

  return (
    <div className="animate-fade-in">
      <PageHeader title="Documents" subtitle="Agreements, insurance, warranties and quotes your property manager has shared with you." />
      <Container className="space-y-5 pb-4 pt-4">
        {d.documents.length === 0 ? (
          <Card>
            <EmptyState icon={FolderOpen} title="No documents shared yet">
              When your property manager shares your management agreement, insurance policies or repair quotes, you’ll find them here.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {options.length > 2 && <Segmented label="Filter by property" value={scope} onChange={setScope} options={options} />}
              <div className="relative md:ml-auto md:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents" aria-label="Search documents" className={inputClass('pl-9')} />
              </div>
            </div>
            {groups.length === 0 ? (
              <Card>
                <EmptyState
                  icon={Search}
                  title="Nothing matches"
                  action={
                    filtering && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setScope('all');
                          setSearch('');
                        }}
                      >
                        Clear filters
                      </Button>
                    )
                  }
                >
                  No documents match {search.trim() ? `“${search.trim()}”` : 'this filter'}.
                </EmptyState>
              </Card>
            ) : (
              groups.map(([key, g]) => (
                <section key={key} aria-labelledby={`docs-${key}`}>
                  <h2 id={`docs-${key}`} className="mb-2 text-[15px] font-semibold">
                    {g.title} <span className="text-sm font-normal tabular-nums text-faint">{g.docs.length}</span>
                  </h2>
                  <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
                    {g.docs.map(doc => (
                      <DocRow key={doc.id} doc={doc} />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </Container>
    </div>
  );
}

function DocRow({ doc }: { doc: Doc }) {
  const image = /^image\//.test(doc.mimeType) || /\.(png|jpe?g|webp|gif|heic)(\?|$)/i.test(doc.url);
  const Icon = doc.category === 'Insurance' ? ShieldCheck : image ? FileImage : FileText;
  const expired = doc.expiresOn && doc.expiresOn < new Date().toISOString().slice(0, 10);
  return (
    <li>
      <a href={doc.url} target="_blank" rel="noreferrer" className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-medium leading-snug">{doc.name}</span>
          <span className="block text-sm text-muted-foreground">
            {[doc.category === 'Invoice' ? 'Quote or invoice' : doc.category, doc.workOrderNumber ? `WO-${doc.workOrderNumber}` : null, doc.uploadedAt ? `Shared ${shortDate(doc.uploadedAt)}` : null, fileSize(doc.size)].filter(Boolean).join(' · ')}
          </span>
        </span>
        {doc.expiresOn && (
          <StatusPill tone={expired ? 'danger' : 'neutral'} className="hidden sm:inline-flex">
            {expired ? 'Expired' : 'Expires'} {shortDate(doc.expiresOn)}
          </StatusPill>
        )}
        <ExternalLink className={cn('h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100')} aria-label="Opens in a new tab" />
      </a>
    </li>
  );
}
