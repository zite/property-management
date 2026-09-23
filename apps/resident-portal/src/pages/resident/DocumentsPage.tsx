import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FileText, FileUp, FolderOpen, Loader2, Search, ShieldCheck, Upload, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadResidentDocument } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { LoadError, ResidentSkeleton } from '../../components/resident/bits';
import { LeaseSwitcher, ResidentHeader } from '../../components/resident/ResidentHeader';
import { Alert, Button, Card, Container, EmptyState, FieldRow, inputClass } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { shortDate } from '../../lib/format';
import { documentCategory, fileSize, UPLOAD_CATEGORIES } from '../../lib/residentFormat';
import { useReturnFocus } from '../../lib/residentFocus';
import { useResidentLease } from '../../lib/residentLease';
import { useRefreshResident, useResidentDocuments, type ResidentDocument } from '../../lib/residentQueries';
import { uploadPortalFile } from '../../lib/upload';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Documents shared with the household, grouped the way people look for them —
 * the lease, notices, inspection reports, insurance — plus a way to send the
 * office renters insurance or anything else they've asked for.
 */
export default function DocumentsPage() {
  useDocumentTitle('Documents');
  const { leaseId } = useResidentLease();
  const q = useResidentDocuments(leaseId);
  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const docs = (q.data?.documents ?? []).filter(doc => !term || doc.name.toLowerCase().includes(term) || documentCategory(doc.category).label.toLowerCase().includes(term));
    const map = new Map<string, ResidentDocument[]>();
    for (const doc of docs) {
      const key = documentCategory(doc.category).label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(doc);
    }
    return [...map.entries()].sort((a, b) => documentCategory(a[1][0].category).order - documentCategory(b[1][0].category).order);
  }, [q.data, search]);

  if (q.isPending) return <ResidentSkeleton variant="list" />;
  if (q.isError || !q.data || !leaseId) return <LoadError error={q.error} onRetry={() => q.refetch()} what="your documents" />;

  const d = q.data;
  const hasInsurance = d.documents.some(doc => doc.category === 'Insurance');

  return (
    <div className="animate-fade-in">
      <ResidentHeader
        title="Documents"
        subtitle={<LeaseSwitcher />}
        actions={
          <Button size="lg" variant="ink" onClick={() => setUploadOpen(true)} className="w-full sm:w-auto">
            <Upload aria-hidden /> Upload a document
          </Button>
        }
      />
      <Container className="space-y-5 pb-4 pt-4">
        {!hasInsurance && (
          <Alert
            tone="info"
            icon={ShieldCheck}
            title="Have renters insurance?"
            action={
              <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
                Upload proof
              </Button>
            }
          >
            Upload your policy’s declarations page so the office has it on file.
          </Alert>
        )}

        {d.documents.length > 6 && (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents" aria-label="Search documents" className={inputClass('pl-9 pr-9')} />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label="Clear search">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        )}

        {d.documents.length === 0 ? (
          <Card>
            <EmptyState icon={FolderOpen} title="No documents yet" action={<Button variant="secondary" onClick={() => setUploadOpen(true)}>Upload a document</Button>}>
              Your lease, notices and inspection reports will appear here when the office shares them.
            </EmptyState>
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <EmptyState icon={Search} title="Nothing matches" action={<Button variant="secondary" onClick={() => setSearch('')}>Clear search</Button>}>
              No documents match “{search}”.
            </EmptyState>
          </Card>
        ) : (
          groups.map(([label, docs]) => {
            const Icon = documentCategory(docs[0].category).icon;
            return (
              <section key={label} aria-label={label}>
                <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> {label}
                  <span className="text-sm font-normal text-faint">{docs.length}</span>
                </h2>
                <Card className="overflow-hidden">
                  <ul className="divide-y">
                    {docs.map(doc => (
                      <li key={doc.id}>
                        <a href={doc.url} target="_blank" rel="noreferrer" className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/50 focus-visible:outline-none sm:px-5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
                            <FileText className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-[15px] font-medium group-hover:underline">{doc.name}</span>
                            <span className="block text-sm text-muted-foreground">
                              {[doc.uploadedAt ? shortDate(doc.uploadedAt.slice(0, 10)) : null, doc.uploadedBy === 'You' ? 'Uploaded by you' : doc.uploadedBy, fileSize(doc.size), doc.expiresOn ? `Expires ${shortDate(doc.expiresOn)}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Opens in a new tab" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })
        )}
      </Container>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} leaseId={leaseId} defaultCategory={hasInsurance ? 'Other' : 'Insurance'} />
    </div>
  );
}

function UploadDialog({ open, onOpenChange, leaseId, defaultCategory }: { open: boolean; onOpenChange: (o: boolean) => void; leaseId: string; defaultCategory: string }) {
  const id = useId();
  const refresh = useRefreshResident();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [expiresOn, setExpiresOn] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  useReturnFocus(open);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setName('');
    setCategory(defaultCategory);
    setExpiresOn('');
    setProblem(null);
  }, [open, defaultCategory]);

  const save = useMutation({
    mutationFn: async () => {
      const up = await uploadPortalFile(file!);
      return uploadResidentDocument({ leaseId, name: name.trim() || file!.name, url: up.url, category: category as 'Insurance', size: up.size, mimeType: up.type || null, expiresOn: category === 'Insurance' && expiresOn ? expiresOn : null });
    },
    onSuccess: () => {
      toast.success('Uploaded. The office can see it now.');
      void refresh();
      onOpenChange(false);
    },
    onError: e => setProblem(errorMessage(e, "The upload didn't finish. Try again.")),
  });

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setProblem(`${f.name} is larger than 20 MB.`);
      return;
    }
    setProblem(null);
    setFile(f);
    if (!name) setName(f.name.replace(/\.[a-z0-9]+$/i, ''));
  };

  return (
    <Dialog open={open} onOpenChange={o => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-md gap-0 overflow-y-auto rounded-2xl p-5 sm:p-6">
        <DialogTitle className="text-xl font-semibold">Upload a document</DialogTitle>
        <DialogDescription className="mt-1 text-[15px] text-muted-foreground">It goes to the office and stays in your documents. PDFs and photos up to 20 MB.</DialogDescription>
        <form
          className="mt-5 space-y-4"
          onSubmit={e => {
            e.preventDefault();
            if (!file) return setProblem('Choose a file to upload.');
            save.mutate();
          }}
        >
          {file ? (
            <div className="flex items-center gap-3 rounded-xl border p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileText className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{file.name}</span>
                <span className="block text-sm text-muted-foreground">{fileSize(file.size)}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={save.isPending}>
                Change
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={e => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={cn('flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35', dragging && 'border-primary bg-primary/[0.05]')}
            >
              <FileUp className="h-7 w-7 text-muted-foreground" aria-hidden />
              <span className="text-[15px] font-medium">Choose a file</span>
              <span className="text-sm text-muted-foreground">or drag it here</span>
            </button>
          )}
          <input ref={input} type="file" accept="application/pdf,image/*,.doc,.docx" className="sr-only" tabIndex={-1} aria-hidden onChange={e => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }} />
          <FieldRow id={`${id}-category`} label="What is it?">
            <select id={`${id}-category`} value={category} onChange={e => setCategory(e.target.value)} className={inputClass()}>
              {UPLOAD_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow id={`${id}-name`} label="Name">
            <input id={`${id}-name`} value={name} onChange={e => setName(e.target.value)} maxLength={200} className={inputClass()} placeholder="e.g. Renters insurance 2026–27" />
          </FieldRow>
          {category === 'Insurance' && (
            <FieldRow id={`${id}-expires`} label="Policy end date" optional hint="So the office knows when it needs renewing.">
              <input id={`${id}-expires`} type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} className={inputClass()} />
            </FieldRow>
          )}
          {problem && <p role="alert" className="text-sm text-tone-danger">{problem}</p>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="ink" disabled={!file || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} {save.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
