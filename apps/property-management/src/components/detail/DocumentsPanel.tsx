import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Download, FileText, Image as ImageIcon, Loader2, MoreHorizontal, Trash2, Upload, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { listDocuments, saveDocument, type ListDocumentsInputType, type ListDocumentsOutputType } from 'zitejs/api';
import { uploadFile } from 'zitejs/upload';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import type { DocumentCategory } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { daysFromToday, shortDate, timeAgo } from '../../lib/format';
import { qk } from '../../lib/queries';
import { IconButton, Tip } from '../primitives/bits';
import { Pill } from '../primitives/glyphs';

export type DocumentScope = ListDocumentsInputType['scope'];
export type DocumentRow = ListDocumentsOutputType['documents'][number];

const sizeLabel = (n: number | null) => (n == null ? '' : n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/**
 * Documents on any record: drag in or pick files to upload, set a category,
 * share with the resident or owner portal, and remove. `links` are the ids the
 * new document should carry (the scope record plus anything implied — a lease
 * document also carries its property and unit).
 */
export function DocumentsPanel({ scope, id, links, defaultCategory = 'Other', showSharing = { tenant: false, owner: false }, className, compact }: {
  scope: DocumentScope;
  id: string;
  links: Record<string, string | null | undefined>;
  defaultCategory?: DocumentCategory;
  showSharing?: { tenant?: boolean; owner?: boolean };
  className?: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const app = useAppActions();
  const key = [...qk.documents, scope, id];
  const { data, isPending } = useQuery({ queryKey: key, queryFn: () => listDocuments({ scope, id }), staleTime: 30_000 });
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} is over 25 MB`);
        continue;
      }
      setUploading(u => [...u, file.name]);
      try {
        const { fileUrl } = await uploadFile({ data: file, filename: file.name });
        await saveDocument({
          action: 'create',
          name: file.name,
          url: fileUrl,
          category: /image\//.test(file.type) ? 'Photo' : defaultCategory,
          size: file.size,
          mimeType: file.type || null,
          sharedWithTenant: false,
          sharedWithOwner: false,
          links: Object.fromEntries(Object.entries(links).filter(([, v]) => v)) as never,
        });
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        toast.error(errorMessage(e, `Couldn't upload ${file.name}`));
      } finally {
        setUploading(u => u.filter(n => n !== file.name));
        void qc.invalidateQueries({ queryKey: qk.documents });
      }
    }
  };

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof saveDocument>[0]) => saveDocument(patch),
    onMutate: async patch => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ListDocumentsOutputType>(key);
      if (prev && 'id' in patch) {
        qc.setQueryData<ListDocumentsOutputType>(key, {
          documents: patch.action === 'delete' ? prev.documents.filter(d => d.id !== patch.id) : prev.documents.map(d => (d.id === patch.id ? { ...d, ...(patch as Partial<DocumentRow>) } : d)),
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(errorMessage(e, "Couldn't update the document"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.documents }),
  });

  const docs = data?.documents ?? [];

  return (
    <div
      className={cn('relative rounded-lg border bg-card', dragging && 'border-primary/60 ring-2 ring-primary/20', className)}
      onDragOver={e => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" multiple className="hidden" onChange={e => e.target.files && void upload(e.target.files)} />
      {isPending ? (
        <div className="space-y-2 p-3">
          <div className="skeleton h-9 w-full" />
          <div className="skeleton h-9 w-4/5" />
        </div>
      ) : docs.length === 0 && uploading.length === 0 ? (
        <button type="button" onClick={() => input.current?.click()} className={cn('flex w-full flex-col items-center justify-center gap-1 px-4 text-center text-[14px] text-muted-foreground hover:bg-accent/40', compact ? 'py-5' : 'py-8')}>
          <Upload className="mb-1 h-4 w-4" />
          <span>Drop files here or <span className="text-primary">choose files</span></span>
          <span className="text-sm text-faint">Leases, notices, insurance, photos — up to 25 MB each</span>
        </button>
      ) : (
        <ul className="divide-y">
          {docs.map(d => {
            const expires = daysFromToday(d.expiresOn);
            return (
              <li key={d.id} className="group flex items-center gap-3 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground">
                  {d.category === 'Photo' || /image\//.test(d.mimeType) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <a href={d.url} target="_blank" rel="noreferrer" className="block truncate text-[14px] font-medium hover:underline">{d.name}</a>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                    <span>{d.category}</span>
                    {d.size != null && <span>· {sizeLabel(d.size)}</span>}
                    <span>· {d.uploadedByName || 'Uploaded'} {timeAgo(d.uploadedAt)}</span>
                    {expires != null && (
                      <span className={cn(expires < 0 ? 'text-tone-danger' : expires <= 30 ? 'text-tone-warning' : '')}>
                        · {expires < 0 ? `Expired ${shortDate(d.expiresOn)}` : `Expires ${shortDate(d.expiresOn)}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {d.sharedWithTenant && <Tip label="Visible in the resident portal"><span><Pill tone="info"><UserRound className="h-3 w-3" /> Resident</Pill></span></Tip>}
                  {d.sharedWithOwner && <Tip label="Visible in the owner portal"><span><Pill tone="accent"><Building2 className="h-3 w-3" /> Owner</Pill></span></Tip>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="sm" aria-label={`Actions for ${d.name}`} className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem asChild className="text-[14px]">
                        <a href={d.url} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" /> Open</a>
                      </DropdownMenuItem>
                      {showSharing.tenant && (
                        <DropdownMenuCheckboxItem className="text-[14px]" checked={d.sharedWithTenant} onCheckedChange={v => update.mutate({ action: 'update', id: d.id, sharedWithTenant: Boolean(v) })}>
                          Share with resident
                        </DropdownMenuCheckboxItem>
                      )}
                      {showSharing.owner && (
                        <DropdownMenuCheckboxItem className="text-[14px]" checked={d.sharedWithOwner} onCheckedChange={v => update.mutate({ action: 'update', id: d.id, sharedWithOwner: Boolean(v) })}>
                          Share with owner
                        </DropdownMenuCheckboxItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-[14px] text-tone-danger focus:text-tone-danger"
                        onSelect={async () => {
                          if (await app.confirm({ title: `Delete ${d.name}?`, description: 'It will be removed from this record and from any portal it was shared to.', confirmLabel: 'Delete', destructive: true })) {
                            update.mutate({ action: 'delete', id: d.id });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
          {uploading.map(name => (
            <li key={name} className="flex items-center gap-3 px-3 py-2 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading {name}…
            </li>
          ))}
          <li>
            <button type="button" onClick={() => input.current?.click()} className="flex h-9 w-full items-center gap-2 px-3 text-[14px] text-muted-foreground hover:bg-accent/40 hover:text-foreground">
              <Upload className="h-3.5 w-3.5" /> Upload files
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
