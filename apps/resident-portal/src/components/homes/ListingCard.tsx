import { MapPin, PawPrint } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { PET_LABEL, availability, money, petsAllowed, place, sizeLine, type ListingCard as Listing } from '../../lib/listings';
import { Skeleton } from '../ui';
import { ListingPhoto } from './ListingPhoto';

/** A home for rent in a grid: the photo does the selling, the numbers answer "can I live here?". */
export function ListingCard({ listing, currency = 'USD', priority }: { listing: Listing; currency?: string; priority?: boolean }) {
  const avail = availability(listing.availableOn);
  const size = sizeLine(listing);
  const dots = Math.min(listing.photoCount, 5);
  return (
    <Link
      to={`/homes/${listing.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
    >
      <div className="relative">
        <ListingPhoto
          src={listing.cover}
          alt=""
          width={720}
          eager={priority}
          className="aspect-[4/3]"
          imgClassName="transition-[transform,opacity] duration-500 ease-out group-hover:scale-[1.03]"
        />
        <span
          className={cn(
            'absolute left-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-background/95 px-2.5 text-xs font-medium shadow-sm ring-1 ring-black/5 backdrop-blur',
            avail.now ? 'text-tone-success' : 'text-foreground',
          )}
        >
          {avail.now && <span className="h-1.5 w-1.5 rounded-full bg-tone-success" aria-hidden />}
          {avail.label}
        </span>
        {dots > 1 && (
          <span className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1" aria-label={`${listing.photoCount} photos`}>
            {Array.from({ length: dots }).map((_, i) => (
              <span key={i} className={cn('h-1.5 w-1.5 rounded-full shadow-[0_0_2px_rgb(0_0_0/0.4)]', i === 0 ? 'bg-white' : 'bg-white/55')} aria-hidden />
            ))}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xl font-semibold tabular-nums tracking-tight">
            {money(listing.rent, currency)}
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">/mo</span>
          </p>
          {petsAllowed(listing.petPolicy) && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
              <PawPrint className="h-3.5 w-3.5" aria-hidden />
              {PET_LABEL[listing.petPolicy] ?? listing.petPolicy}
            </span>
          )}
        </div>
        {size && <p className="mt-0.5 text-[15px] text-foreground/80">{size}</p>}
        <h3 className="mt-2 line-clamp-2 text-[15px] font-medium leading-snug text-foreground group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">
          {listing.title}
        </h3>
        <p className="mt-auto flex min-w-0 items-center gap-1.5 pt-2 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{[listing.propertyName, place(listing)].filter(Boolean).join(' · ')}</span>
        </p>
      </div>
    </Link>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs" aria-hidden>
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
