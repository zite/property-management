import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { Tip } from '../primitives/bits';

export type ListingPhoto = { url: string; name: string };

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * A listing's photos in the order applicants see them. The first is the cover.
 * Upload several at once; move left or right, make any photo the cover, or
 * remove it. Every change saves straight away.
 */
export function ListingPhotos({ photos, onChange, disabled }: { photos: ListingPhoto[]; onChange: (photos: ListingPhoto[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string[]>([]);
  const latest = useRef(photos);
  latest.current = photos;

  const add = async (files: FileList) => {
    const list = [...files].filter(f => {
      if (!f.type.startsWith('image/')) {
        toast.error(`${f.name} isn’t an image`);
        return false;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 20 MB`);
        return false;
      }
      return true;
    });
    if (latest.current.length + list.length > 40) {
      toast.error('A listing can have up to 40 photos');
      return;
    }
    setPending(p => [...p, ...list.map(f => f.name)]);
    // One at a time, so each photo lands in the order it was picked and a slow one can't reorder the rest.
    for (const file of list) {
      try {
        const { fileUrl } = await uploadFile({ data: file, filename: file.name });
        if (!fileUrl) throw new Error('The upload service didn’t return a link');
        latest.current = [...latest.current, { url: fileUrl, name: file.name }];
        onChange(latest.current);
      } catch (e) {
        toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
      } finally {
        setPending(p => p.filter(n => n !== file.name));
      }
    }
  };

  const move = (i: number, to: number) => {
    const next = [...photos];
    const [p] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, p);
    onChange(next);
  };

  return (
    <div
      className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]"
      onDragOver={e => { if (!disabled) e.preventDefault(); }}
      onDrop={e => {
        if (disabled || !e.dataTransfer.files.length) return;
        e.preventDefault();
        void add(e.dataTransfer.files);
      }}
    >
      {photos.map((p, i) => (
        <div key={`${p.url}-${i}`} className={cn('group/photo relative aspect-[3/2] overflow-hidden rounded-md border bg-muted', i === 0 && 'ring-2 ring-primary/50 ring-offset-1 ring-offset-background')}>
          <a href={p.url} target="_blank" rel="noreferrer" title={p.name} tabIndex={-1}>
            <img src={p.url} alt={p.name} loading="lazy" className="h-full w-full object-cover" onError={e => ((e.target as HTMLImageElement).style.opacity = '0.2')} />
          </a>
          {i === 0 && <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11.5px] font-medium text-white">Cover</span>}
          {!disabled && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 opacity-0 transition-opacity focus-within:opacity-100 group-hover/photo:opacity-100">
              <Tip label="Move earlier"><button type="button" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)} className="flex h-6 w-6 items-center justify-center rounded text-white hover:bg-white/20 disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" /></button></Tip>
              <Tip label="Move later"><button type="button" aria-label={`Move ${p.name} later`} disabled={i === photos.length - 1} onClick={() => move(i, i + 1)} className="flex h-6 w-6 items-center justify-center rounded text-white hover:bg-white/20 disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" /></button></Tip>
              {i > 0 && <Tip label="Make cover"><button type="button" aria-label={`Make ${p.name} the cover`} onClick={() => move(i, 0)} className="flex h-6 w-6 items-center justify-center rounded text-white hover:bg-white/20"><Star className="h-3.5 w-3.5" /></button></Tip>}
              <span className="flex-1" />
              <Tip label="Remove"><button type="button" aria-label={`Remove ${p.name}`} onClick={() => onChange(photos.filter((_, j) => j !== i))} className="flex h-6 w-6 items-center justify-center rounded text-white hover:bg-white/20"><X className="h-3.5 w-3.5" /></button></Tip>
            </div>
          )}
        </div>
      ))}
      {pending.map(n => (
        <div key={n} className="flex aspect-[3/2] items-center justify-center rounded-md border border-dashed bg-muted/50" title={`Uploading ${n}`}>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ))}
      {!disabled && (
        <>
          <button type="button" onClick={() => input.current?.click()} className="flex aspect-[3/2] flex-col items-center justify-center gap-1 rounded-md border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-accent/50 hover:text-foreground">
            <ImagePlus className="h-4 w-4" />
            {photos.length ? 'Add photos' : 'Add photos — or drop them here'}
          </button>
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files?.length) void add(e.target.files); e.target.value = ''; }} />
        </>
      )}
    </div>
  );
}
