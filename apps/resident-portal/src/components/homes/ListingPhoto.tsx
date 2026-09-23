import { Home } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { sizedPhoto } from '../../lib/listings';

/**
 * A listing photo that fades in once loaded and falls back to a calm
 * placeholder when there's no photo or the link is broken — never a broken
 * image icon on the company's public page.
 */
export function ListingPhoto({ src, alt, width = 800, className, imgClassName, eager }: { src: string | null | undefined; alt: string; width?: number; className?: string; imgClassName?: string; eager?: boolean }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  useEffect(() => setState(src ? 'loading' : 'failed'), [src]);
  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {state !== 'loaded' && (
        <div className={cn('absolute inset-0 flex items-center justify-center text-muted-foreground/60', state === 'loading' && 'skeleton rounded-none')} aria-hidden>
          {state === 'failed' && <Home className="h-8 w-8" strokeWidth={1.5} />}
        </div>
      )}
      {src && state !== 'failed' && (
        <img
          src={sizedPhoto(src, width)}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn('h-full w-full object-cover transition-opacity duration-300', state === 'loaded' ? 'opacity-100' : 'opacity-0', imgClassName)}
        />
      )}
    </div>
  );
}
