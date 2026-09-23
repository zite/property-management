import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';

export type Photo = { url: string; name: string };

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Photos on a work order: thumbnails that open full size, an add tile, and
 * remove on hover. Uploads run in parallel; each finished photo is committed
 * through `onChange` straight away so a slow one doesn't hold the rest.
 */
export function Photos({ photos, onChange, editable = true, size = 72, className }: { photos: Photo[]; onChange?: (photos: Photo[]) => void; editable?: boolean; size?: number; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string[]>([]);
  const latest = useRef(photos);
  latest.current = photos;

  const add = async (files: FileList) => {
    const list = [...files].filter(f => {
      if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) {
        toast.error(`${f.name} isn’t an image`);
        return false;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 20 MB`);
        return false;
      }
      return true;
    });
    setPending(p => [...p, ...list.map(f => f.name)]);
    await Promise.all(
      list.map(async file => {
        try {
          const { fileUrl } = await uploadFile({ data: file, filename: file.name });
          if (!fileUrl) throw new Error('The upload service did not return a link');
          latest.current = [...latest.current, { url: fileUrl, name: file.name }];
          onChange?.(latest.current);
        } catch (e) {
          toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
        } finally {
          setPending(p => p.filter(n => n !== file.name));
        }
      }),
    );
  };

  if (!editable && !photos.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {photos.map(p => (
        <div key={p.url} className="group/photo relative overflow-hidden rounded-md border bg-muted" style={{ width: size, height: size }}>
          <a href={p.url} target="_blank" rel="noreferrer" title={p.name}>
            <img src={p.url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
          </a>
          {editable && onChange && (
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              onClick={() => onChange(photos.filter(x => x.url !== p.url))}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/photo:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {pending.map(n => (
        <div key={n} className="flex items-center justify-center rounded-md border border-dashed bg-muted/50" style={{ width: size, height: size }} title={`Uploading ${n}`}>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ))}
      {editable && onChange && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed text-2xs text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-accent/50 hover:text-foreground"
            style={{ width: size, height: size }}
          >
            <ImagePlus className="h-4 w-4" />
            Add photo
          </button>
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files?.length) void add(e.target.files); e.target.value = ''; }} />
        </>
      )}
    </div>
  );
}
