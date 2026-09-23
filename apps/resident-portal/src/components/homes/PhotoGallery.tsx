import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Grid2x2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { sizedPhoto } from '../../lib/listings';
import { ListingPhoto } from './ListingPhoto';

/**
 * A listing's photos: a hero with a grid beside it on wide screens, a swipeable
 * strip on phones, and a full-screen viewer for both. The viewer is a real
 * dialog — arrow keys move, Escape closes, focus goes back to the photo you opened.
 */
export function PhotoGallery({ photos, title, className }: { photos: string[]; title: string; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const n = photos.length;

  if (n === 0) {
    return <ListingPhoto src={null} alt="" className={cn('aspect-[16/9] rounded-2xl sm:aspect-[21/9]', className)} />;
  }

  const tile = (i: number, extra?: string) => (
    <button
      key={i}
      type="button"
      onClick={() => setOpen(i)}
      className={cn('group relative block h-full w-full overflow-hidden focus-visible:z-10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring', extra)}
      aria-label={`Open photo ${i + 1} of ${n}`}
    >
      <ListingPhoto src={photos[i]} alt={i === 0 ? title : ''} width={i === 0 ? 1400 : 700} eager={i < 3} className="h-full w-full" imgClassName="transition-[transform,opacity,filter] duration-500 group-hover:scale-[1.02] group-hover:brightness-[0.94]" />
    </button>
  );

  const shown = Math.min(n, 5);
  const layout =
    shown === 1 ? 'grid-cols-1 grid-rows-1' : shown === 2 ? 'grid-cols-2 grid-rows-1' : shown === 3 ? 'grid-cols-3 grid-rows-2' : 'grid-cols-4 grid-rows-2';

  return (
    <div className={className}>
      {/* Wide screens: hero plus grid. */}
      <div className={cn('relative hidden h-[26rem] gap-2 overflow-hidden rounded-2xl sm:grid lg:h-[30rem]', layout)}>
        {tile(0, shown >= 3 ? 'col-span-2 row-span-2' : '')}
        {shown === 4 && (
          <>
            {tile(1, 'col-span-2')}
            {tile(2)}
            {tile(3)}
          </>
        )}
        {shown !== 4 && photos.slice(1, shown).map((_, i) => tile(i + 1))}
        {n > 1 && (
          <button
            type="button"
            onClick={() => setOpen(0)}
            className="absolute bottom-4 right-4 inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-background/95 px-3 text-sm font-medium text-foreground shadow-md backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Grid2x2 className="h-4 w-4" aria-hidden /> Show all {n} photos
          </button>
        )}
      </div>

      {/* Phones: a swipeable strip with a counter. */}
      <MobileStrip photos={photos} title={title} onOpen={setOpen} />

      <Lightbox photos={photos} title={title} index={open} onIndex={setOpen} />
    </div>
  );
}

function MobileStrip({ photos, title, onOpen }: { photos: string[]; title: string; onOpen: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  return (
    <div className="relative -mx-4 sm:hidden">
      <div
        ref={ref}
        className="flex snap-x snap-mandatory overflow-x-auto scrollbar-none"
        onScroll={e => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {photos.map((p, i) => (
          <button key={i} type="button" onClick={() => onOpen(i)} className="w-full shrink-0 snap-center focus-visible:outline-none" aria-label={`Open photo ${i + 1} of ${photos.length}`}>
            <ListingPhoto src={p} alt={i === 0 ? title : ''} width={900} eager={i === 0} className="aspect-[4/3]" />
          </button>
        ))}
      </div>
      {photos.length > 1 && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium tabular-nums text-white" aria-hidden>
          {at + 1} / {photos.length}
        </span>
      )}
    </div>
  );
}

function Lightbox({ photos, title, index, onIndex }: { photos: string[]; title: string; index: number | null; onIndex: (i: number | null) => void }) {
  const n = photos.length;
  const touch = useRef<number | null>(null);
  const go = (delta: number) => onIndex(index == null ? 0 : (index + delta + n) % n);
  const thumbs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (index == null) return;
    thumbs.current?.querySelector<HTMLElement>(`[data-thumb="${index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    // Warm the neighbours so arrowing through feels instant.
    for (const d of [1, -1]) {
      const img = new Image();
      img.src = sizedPhoto(photos[(index + d + n) % n], 1800);
    }
  }, [index, n, photos]);

  return (
    <DialogPrimitive.Root open={index != null} onOpenChange={o => !o && onIndex(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(222_20%_4%/0.97)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
          onKeyDown={e => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              go(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              go(-1);
            }
          }}
          onTouchStart={e => (touch.current = e.touches[0]?.clientX ?? null)}
          onTouchEnd={e => {
            const start = touch.current;
            const end = e.changedTouches[0]?.clientX;
            touch.current = null;
            if (start == null || end == null || Math.abs(end - start) < 40) return;
            go(end < start ? 1 : -1);
          }}
        >
          <DialogPrimitive.Title className="sr-only">Photos of {title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Use the left and right arrow keys to move between photos.</DialogPrimitive.Description>
          <div className="flex h-16 shrink-0 items-center justify-between px-4 sm:px-6">
            <p className="text-sm font-medium tabular-nums text-white/80" aria-live="polite">
              {index != null ? index + 1 : 0} / {n}
            </p>
            <p className="mx-4 hidden min-w-0 flex-1 truncate text-center text-sm text-white/70 sm:block">{title}</p>
            <DialogPrimitive.Close className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60" aria-label="Close photos">
              <X className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-20">
            {index != null && (
              <img key={index} src={sizedPhoto(photos[index], 1800)} alt={`Photo ${index + 1} of ${title}`} className="max-h-full max-w-full select-none rounded-lg object-contain animate-fade-in" draggable={false} />
            )}
            {n > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60 sm:flex" aria-label="Previous photo">
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
                <button type="button" onClick={() => go(1)} className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/60 sm:flex" aria-label="Next photo">
                  <ChevronRight className="h-6 w-6" aria-hidden />
                </button>
              </>
            )}
          </div>

          {n > 1 && (
            <div ref={thumbs} className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto px-4 scrollbar-none sm:justify-center">
              {photos.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  data-thumb={i}
                  onClick={() => onIndex(i)}
                  aria-label={`Photo ${i + 1}`}
                  aria-current={i === index ? 'true' : undefined}
                  className={cn('h-14 w-20 shrink-0 overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-[hsl(222_20%_4%)] transition-opacity focus-visible:outline-none', i === index ? 'opacity-100 ring-white' : 'opacity-50 ring-transparent hover:opacity-80 focus-visible:ring-white/60')}
                >
                  <img src={sizedPhoto(p, 200)} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
