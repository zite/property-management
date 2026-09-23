import { FileText, ImagePlus, Loader2, RotateCw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { uploadPortalFile } from '../../lib/upload';

/**
 * Picking and uploading files for vendor forms: completion photos, invoices,
 * certificates. Uploads start the moment a file is chosen, so submitting is
 * instant; a failed upload can be retried or removed.
 */

export type Picked = { key: string; file: File; name: string; size: number; type: string; preview: string | null; status: 'uploading' | 'done' | 'error'; url: string | null; error: string | null };

export function useFilePicks(max: number) {
  const [items, setItems] = useState<Picked[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const upload = useCallback((item: Picked) => {
    uploadPortalFile(item.file)
      .then(res => alive.current && setItems(list => list.map(x => (x.key === item.key ? { ...x, status: 'done', url: res.url, error: null } : x))))
      .catch(e => alive.current && setItems(list => list.map(x => (x.key === item.key ? { ...x, status: 'error', error: e instanceof Error ? e.message : 'Upload failed' } : x))));
  }, []);

  const add = useCallback(
    (files: FileList | File[]) => {
      const incoming = [...files].slice(0, Math.max(0, max - items.length)).map(file => ({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        status: 'uploading' as const,
        url: null,
        error: null,
      }));
      if (!incoming.length) return;
      setItems(list => [...list, ...incoming]);
      incoming.forEach(upload);
    },
    [items.length, max, upload],
  );

  const remove = (key: string) =>
    setItems(list => {
      const x = list.find(i => i.key === key);
      if (x?.preview) URL.revokeObjectURL(x.preview);
      return list.filter(i => i.key !== key);
    });
  const retryItem = (key: string) => {
    const x = items.find(i => i.key === key);
    if (!x) return;
    setItems(list => list.map(i => (i.key === key ? { ...i, status: 'uploading', error: null } : i)));
    upload(x);
  };
  const reset = () => {
    items.forEach(i => i.preview && URL.revokeObjectURL(i.preview));
    setItems([]);
  };

  return { items, add, remove, retry: retryItem, reset, uploading: items.some(i => i.status === 'uploading'), failed: items.some(i => i.status === 'error'), done: items.filter(i => i.status === 'done' && i.url) };
}

export type FilePicks = ReturnType<typeof useFilePicks>;

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A drop zone plus the picked files. */
export function FilePickerField({ picks, id, accept, max, label, hint, invalid, describedBy }: { picks: FilePicks; id: string; accept: string; max: number; label: string; hint: string; invalid?: boolean; describedBy?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const full = picks.items.length >= max;
  const images = accept.startsWith('image');
  return (
    <div>
      {!full && (
        <label
          htmlFor={id}
          onDragOver={e => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={e => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer.files.length) picks.add(e.dataTransfer.files);
          }}
          className={cn(
            'flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-4 text-center transition-colors hover:border-foreground/30 hover:bg-accent/50 focus-within:ring-[3px] focus-within:ring-ring/35',
            over && 'border-primary bg-primary/[0.04]',
            invalid && 'border-tone-danger',
          )}
        >
          {images ? <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden /> : <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />}
          <span className="text-[15px] font-medium">{label}</span>
          <span className="text-sm text-muted-foreground">{hint}</span>
          <input
            ref={input}
            id={id}
            type="file"
            accept={accept}
            multiple={max > 1}
            className="sr-only"
            aria-describedby={describedBy}
            onChange={e => {
              if (e.target.files?.length) picks.add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {picks.items.length > 0 && (
        <ul className={cn('mt-2', images ? 'flex flex-wrap gap-2' : 'space-y-1.5')}>
          {picks.items.map(p =>
            images && p.preview ? (
              <li key={p.key} className="relative h-20 w-20 overflow-hidden rounded-lg border">
                <img src={p.preview} alt={p.name} className={cn('h-full w-full object-cover', p.status !== 'done' && 'opacity-60')} />
                {p.status === 'uploading' && <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-white drop-shadow" aria-label="Uploading" />}
                {p.status === 'error' && (
                  <button type="button" onClick={() => picks.retry(p.key)} className="absolute inset-0 m-auto flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-tone-danger" aria-label={`Retry ${p.name}`}>
                    <RotateCw className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={() => picks.remove(p.key)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background" aria-label={`Remove ${p.name}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ) : (
              <li key={p.key} className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{p.name}</span>
                  <span className={cn('block text-xs', p.status === 'error' ? 'text-tone-danger' : 'text-muted-foreground')}>{p.status === 'uploading' ? 'Uploading…' : p.status === 'error' ? p.error : kb(p.size)}</span>
                </span>
                {p.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                {p.status === 'error' && (
                  <button type="button" onClick={() => picks.retry(p.key)} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:underline">
                    Retry
                  </button>
                )}
                <button type="button" onClick={() => picks.remove(p.key)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${p.name}`}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
