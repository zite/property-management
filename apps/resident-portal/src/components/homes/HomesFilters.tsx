import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { formatMoney } from '../../lib/format';
import { BED_OPTIONS, DEFAULT_FILTERS, PET_OPTIONS, activeFilterCount, placeOptions, rentSteps, type HomeFilters, type ListingCard } from '../../lib/listings';
import { Button } from '../ui';
import { NativeSelect, Segmented } from './controls';

type Props = {
  listings: ListingCard[];
  filters: HomeFilters;
  onChange: (next: HomeFilters) => void;
  resultCount: number;
  currency: string;
};

function PlaceSelect({ listings, filters, onChange, className }: Omit<Props, 'resultCount' | 'currency'> & { className?: string }) {
  const { cities, buildings } = placeOptions(listings);
  const known = !filters.place || [...cities, ...buildings].some(o => o.value === filters.place);
  return (
    <NativeSelect aria-label="Location" value={known ? filters.place : ''} active={Boolean(filters.place)} onChange={e => onChange({ ...filters, place: e.target.value })} className={className}>
      <option value="">All locations</option>
      {cities.length > 0 && (
        <optgroup label="Cities">
          {cities.map(c => (
            <option key={c.value} value={c.value}>
              {c.label} ({c.count})
            </option>
          ))}
        </optgroup>
      )}
      {buildings.length > 1 && (
        <optgroup label="Buildings">
          {buildings.map(b => (
            <option key={b.value} value={b.value}>
              {b.label} ({b.count})
            </option>
          ))}
        </optgroup>
      )}
    </NativeSelect>
  );
}

function RentSelect({ listings, filters, onChange, currency, className, size }: Omit<Props, 'resultCount'> & { className?: string; size?: 'md' | 'lg' }) {
  const steps = rentSteps(listings);
  const values = filters.maxRent && !steps.includes(filters.maxRent) ? [...steps, filters.maxRent].sort((a, b) => a - b) : steps;
  return (
    <NativeSelect aria-label="Maximum rent" size={size} value={filters.maxRent ?? ''} active={filters.maxRent != null} onChange={e => onChange({ ...filters, maxRent: e.target.value ? Number(e.target.value) : null })} className={className}>
      <option value="">Any rent</option>
      {values.map(v => (
        <option key={v} value={v}>
          Up to {formatMoney(v, currency, { cents: false })}
        </option>
      ))}
    </NativeSelect>
  );
}

function PetSelect({ filters, onChange, className, size }: Pick<Props, 'filters' | 'onChange'> & { className?: string; size?: 'md' | 'lg' }) {
  return (
    <NativeSelect aria-label="Pets" size={size} value={filters.pets} active={Boolean(filters.pets)} onChange={e => onChange({ ...filters, pets: e.target.value })} className={className}>
      {PET_OPTIONS.map(o => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function DateFilter({ filters, onChange, className, size = 'md' }: Pick<Props, 'filters' | 'onChange'> & { className?: string; size?: 'md' | 'lg' }) {
  const on = Boolean(filters.availableBy);
  return (
    <label
      className={cn(
        'flex min-w-0 cursor-text items-center gap-2 rounded-lg border bg-background pl-3 pr-1 shadow-2xs transition-[border-color,box-shadow] hover:border-foreground/25 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15',
        size === 'md' ? 'h-10' : 'h-11',
        on ? 'border-foreground/30 bg-accent/60' : 'border-border',
        className,
      )}
    >
      <span className="shrink-0 whitespace-nowrap text-[15px] text-muted-foreground">Move in by</span>
      <input
        type="date"
        value={filters.availableBy}
        onChange={e => onChange({ ...filters, availableBy: e.target.value })}
        className={cn('h-full min-w-0 flex-1 bg-transparent pr-1 text-[15px] outline-none', on ? 'font-medium text-foreground' : 'text-muted-foreground')}
      />
      {on && (
        <button
          type="button"
          onClick={e => {
            e.preventDefault();
            onChange({ ...filters, availableBy: '' });
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
          aria-label="Clear move-in date"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </label>
  );
}

/**
 * The filter bar. Wide screens get every control inline; phones get location
 * plus one "Filters" button that opens the rest in a sheet, with the live
 * result count on its button so nobody applies a filter that finds nothing.
 */
export function HomesFilters({ listings, filters, onChange, resultCount, currency }: Props) {
  const [open, setOpen] = useState(false);
  const extra = activeFilterCount({ ...filters, place: '' });
  const any = activeFilterCount(filters) > 0;
  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 lg:flex">
        <PlaceSelect listings={listings} filters={filters} onChange={onChange} className="w-52" />
        <Segmented label="Bedrooms" options={BED_OPTIONS} value={filters.beds} onChange={beds => onChange({ ...filters, beds })} />
        <RentSelect listings={listings} filters={filters} onChange={onChange} currency={currency} className="w-40" />
        <PetSelect filters={filters} onChange={onChange} className="w-40" />
        <DateFilter filters={filters} onChange={onChange} className="w-60" />
        {any && (
          <Button variant="ghost" size="sm" className="ml-auto h-10 text-muted-foreground" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}>
            <X aria-hidden /> Clear
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 lg:hidden">
        <PlaceSelect listings={listings} filters={filters} onChange={onChange} className="flex-1" />
        <Button variant="secondary" className={cn('shrink-0', extra > 0 && 'border-foreground/30 bg-accent/60')} onClick={() => setOpen(true)} aria-haspopup="dialog">
          <SlidersHorizontal aria-hidden /> Filters
          {extra > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-2xs font-semibold text-background">{extra}</span>}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-2xl px-5 pb-6 pt-5">
          <SheetTitle className="text-lg font-semibold">Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow the homes by bedrooms, rent, pets and move-in date.</SheetDescription>
          <div className="mt-5 space-y-6">
            <div>
              <p className="mb-2 text-[15px] font-medium">Bedrooms</p>
              <Segmented label="Bedrooms" size="lg" options={BED_OPTIONS} value={filters.beds} onChange={beds => onChange({ ...filters, beds })} className="flex w-full" />
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium">Rent</p>
              <RentSelect listings={listings} filters={filters} onChange={onChange} currency={currency} size="lg" />
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium">Pets</p>
              <PetSelect filters={filters} onChange={onChange} size="lg" />
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium">Available to move in</p>
              <DateFilter filters={filters} onChange={onChange} size="lg" />
            </div>
          </div>
          <div className="mt-8 flex gap-2">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => onChange({ ...DEFAULT_FILTERS, place: filters.place, sort: filters.sort })} disabled={extra === 0}>
              Clear
            </Button>
            <Button variant="ink" size="lg" className="flex-[2]" onClick={() => setOpen(false)}>
              {resultCount === 0 ? 'No homes match' : `Show ${resultCount} ${resultCount === 1 ? 'home' : 'homes'}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
