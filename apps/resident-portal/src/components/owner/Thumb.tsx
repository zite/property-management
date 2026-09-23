import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@project/components/lib/utils';

/** A photo that links to the full image, and degrades to a named tile if the image can't load. */
export function Thumb({ url, name, className }: { url: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <a href={url} target="_blank" rel="noreferrer" title={name} className={cn('block overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35', className)}>
      {broken ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
          <ImageOff className="h-5 w-5" aria-hidden />
          <span className="line-clamp-2 break-all">{name}</span>
        </span>
      ) : (
        <img src={url} alt={name} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform hover:scale-105" />
      )}
    </a>
  );
}
