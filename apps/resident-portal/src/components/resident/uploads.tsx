import { AlertCircle, FileText, ImagePlus, Loader2, Paperclip, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { fileSize, isImage } from '../../lib/residentFormat';
import { uploadPortalFile } from '../../lib/upload';

/**
 * Picking and uploading files. Uploads start the moment a file is chosen, so
 * by the time someone presses Send there's nothing left to wait for; the form
 * stays disabled while anything is still on its way.
 */

export type PickedFile = { key: string; file: File; name: string; size: number; preview: string | null; status: 'uploading' | 'done' | 'error'; url: string | null; error: string | null };

export function useUploads(max: number) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => () => filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []);

  const start = useCallback((entry: PickedFile) => {
    uploadPortalFile(entry.file)
      .then(up => setFiles(list => list.map(f => (f.key === entry.key ? { ...f, status: 'done', url: up.url, error: null } : f))))
      .catch(e => setFiles(list => list.map(f => (f.key === entry.key ? { ...f, status: 'error', error: errorMessage(e, 'Upload failed') } : f))));
  }, []);

  const add = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return;
      const incoming = Array.from(list);
      const room = max - filesRef.current.length;
      if (room <= 0) {
        toast.error(`You can add up to ${max} files.`);
        return;
      }
      if (incoming.length > room) toast.error(`Only the first ${room} ${room === 1 ? 'file was' : 'files were'} added — the limit is ${max}.`);
      const entries: PickedFile[] = incoming.slice(0, room).map(file => ({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        status: 'uploading',
        url: null,
        error: null,
      }));
      setFiles(prev => [...prev, ...entries]);
      entries.forEach(start);
    },
    [max, start],
  );

  const remove = useCallback((key: string) => {
    setFiles(list => {
      const f = list.find(x => x.key === key);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return list.filter(x => x.key !== key);
    });
  }, []);

  const retryOne = useCallback(
    (key: string) => {
      const f = filesRef.current.find(x => x.key === key);
      if (!f) return;
      setFiles(list => list.map(x => (x.key === key ? { ...x, status: 'uploading', error: null } : x)));
      start(f);
    },
    [start],
  );

  const reset = useCallback(() => {
    filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]);
  }, []);

  return {
    files,
    add,
    remove,
    retry: retryOne,
    reset,
    uploading: files.some(f => f.status === 'uploading'),
    failed: files.some(f => f.status === 'error'),
    uploaded: files.filter(f => f.status === 'done' && f.url).map(f => ({ url: f.url!, name: f.name })),
    full: files.length >= max,
  };
}

export type Uploads = ReturnType<typeof useUploads>;

/** A photo drop zone with square previews — for maintenance requests. */
export function PhotoPicker({ uploads, max, id, describedBy }: { uploads: Uploads; max: number; id: string; describedBy?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
        {uploads.files.map(f => (
          <Thumb key={f.key} file={f} onRemove={() => uploads.remove(f.key)} onRetry={() => uploads.retry(f.key)} />
        ))}
        {!uploads.full && (
          <button
            type="button"
            id={id}
            aria-describedby={describedBy}
            onClick={() => input.current?.click()}
            onDragOver={e => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={e => {
              e.preventDefault();
              setOver(false);
              uploads.add(e.dataTransfer.files);
            }}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
              over && 'border-primary bg-primary/[0.06] text-foreground',
            )}
          >
            <ImagePlus className="h-6 w-6" aria-hidden />
            <span>{uploads.files.length ? 'Add more' : 'Add photos'}</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={e => {
          uploads.add(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="mt-2 text-sm text-muted-foreground">
        {uploads.files.length}/{max} photos{uploads.uploading ? ' · uploading…' : ''}
      </p>
    </div>
  );
}

function Thumb({ file, onRemove, onRetry }: { file: PickedFile; onRemove: () => void; onRetry: () => void }) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border bg-muted">
      {file.preview ? (
        <img src={file.preview} alt={file.name} className={cn('h-full w-full object-cover transition-opacity', file.status !== 'done' && 'opacity-60')} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="line-clamp-2 break-all text-2xs text-muted-foreground">{file.name}</span>
        </div>
      )}
      {file.status === 'uploading' && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/30" role="status" aria-label={`Uploading ${file.name}`}>
          <Loader2 className="h-6 w-6 animate-spin text-foreground" aria-hidden />
        </span>
      )}
      {file.status === 'error' && (
        <button type="button" onClick={onRetry} className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/80 text-xs font-medium text-tone-danger" aria-label={`Retry uploading ${file.name}`}>
          <RotateCw className="h-5 w-5" aria-hidden /> Retry
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/75 text-background shadow-sm transition-colors hover:bg-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={`Remove ${file.name}`}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** A paperclip button plus chips for what's attached — for message composers. */
export function AttachButton({ uploads, accept, label = 'Attach', disabled }: { uploads: Uploads; accept?: string; label?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || uploads.full}
        className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50"
      >
        <Paperclip className="h-4 w-4" aria-hidden /> {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={e => {
          uploads.add(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function AttachmentChips({ uploads }: { uploads: Uploads }) {
  if (!uploads.files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Attachments">
      {uploads.files.map(f => (
        <li key={f.key} className={cn('flex h-9 max-w-full items-center gap-2 rounded-lg border bg-background pl-1.5 pr-1 text-sm', f.status === 'error' && 'border-tone-danger/40')}>
          {f.preview ? (
            <img src={f.preview} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="max-w-[12rem] truncate">{f.name}</span>
          {f.status === 'uploading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Uploading" />
          ) : f.status === 'error' ? (
            <button type="button" onClick={() => uploads.retry(f.key)} className="inline-flex items-center gap-1 text-xs font-medium text-tone-danger hover:underline">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Retry
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{fileSize(f.size)}</span>
          )}
          <button type="button" onClick={() => uploads.remove(f.key)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${f.name}`}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Attached files on a sent message or a request: image thumbnails, other files as links. */
export function FileList({ files, className }: { files: Array<{ url: string; name: string }>; className?: string }) {
  if (!files.length) return null;
  const images = files.filter(f => isImage(f.name, f.url));
  const others = files.filter(f => !isImage(f.name, f.url));
  return (
    <div className={cn('space-y-2', className)}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(f => (
            <ImageTile key={f.url} file={f} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {others.map(f => (
            <li key={f.url} className="max-w-full">
              <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border bg-background px-2.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{f.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A photo thumbnail that falls back to a named file tile when the image can't be shown. */
function ImageTile({ file }: { file: { url: string; name: string } }) {
  const [broken, setBroken] = useState(false);
  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" title={file.name}>
      {broken ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="line-clamp-2 break-all text-2xs text-muted-foreground">{file.name}</span>
        </span>
      ) : (
        <img src={file.url} alt={file.name} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform hover:scale-[1.03]" />
      )}
    </a>
  );
}
