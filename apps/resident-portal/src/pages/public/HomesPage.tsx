import { ArrowRight, Home, KeyRound, Mail, Phone, SearchX } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { areasFor } from '../../components/Layout';
import { HomesFilters } from '../../components/homes/HomesFilters';
import { ListingCard, ListingCardSkeleton } from '../../components/homes/ListingCard';
import { NativeSelect } from '../../components/homes/controls';
import { Alert, Button, Container, EmptyState, Skeleton } from '../../components/ui';
import { useSession } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatMoney, plural } from '../../lib/format';
import { DEFAULT_FILTERS, SORTS, money, activeFilterCount, applyFilters, filtersFromParams, filtersToParams, usePublicListings, type HomeFilters } from '../../lib/listings';
import { useMe, usePortal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * Homes for rent — the company's public front door, and the portal's landing
 * page for anyone signed out. Filters live in the URL so a search can be
 * shared, and run in the browser so they feel instant.
 */
export default function HomesPage() {
  useDocumentTitle('Homes for rent');
  const portal = usePortal();
  const q = usePublicListings();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const currency = portal.data?.settings.currency ?? 'USD';

  const all = q.data?.listings ?? [];
  const results = useMemo(() => applyFilters([...all], filters), [all, filters]);
  const setFilters = (next: HomeFilters) => setParams(filtersToParams(next), { replace: true });
  const filtered = activeFilterCount(filters) > 0;

  return (
    <div>
      <Hero listingsCount={q.data ? all.length : null} fromRent={all.length ? Math.min(...all.map(l => l.rent)) : null} cities={[...new Set(all.map(l => l.city).filter(Boolean))]} currency={currency} />

      {(q.isPending || all.length > 0) && (
        <div className="sticky top-16 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Container className="py-3">
            {q.isPending ? (
              <div className="flex gap-2" aria-hidden>
                <Skeleton className="h-10 flex-1 lg:w-56 lg:flex-none" />
                <Skeleton className="hidden h-10 w-64 lg:block" />
                <Skeleton className="hidden h-10 w-44 lg:block" />
                <Skeleton className="h-10 w-28 lg:w-44" />
              </div>
            ) : (
              <HomesFilters listings={all} filters={filters} onChange={setFilters} resultCount={results.length} currency={currency} />
            )}
          </Container>
        </div>
      )}

      <Container className="py-6 sm:py-8">
        {q.isError ? (
          <Alert tone="danger" title="Homes didn’t load" action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}>Try again</Button>}>
            {errorMessage(q.error, 'Check your connection and try again.')}
          </Alert>
        ) : q.isPending ? (
          <>
            <Skeleton className="mb-5 h-5 w-32" />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>
            <span className="sr-only" role="status">Loading homes…</span>
          </>
        ) : all.length === 0 ? (
          <NoListings />
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="text-[15px] text-muted-foreground" role="status" aria-live="polite">
                <span className="font-semibold text-foreground">{plural(results.length, 'home')}</span>
                {filtered ? ` of ${all.length} match` : ' available'}
              </p>
              <NativeSelect aria-label="Sort homes" value={filters.sort} onChange={e => setFilters({ ...filters, sort: e.target.value as HomeFilters['sort'] })} className="w-[12.5rem]">
                {SORTS.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {results.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card">
                <EmptyState
                  icon={SearchX}
                  title="No homes match those filters"
                  action={
                    <Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                      Clear filters
                    </Button>
                  }
                >
                  {filters.maxRent != null
                    ? `Nothing is listed at ${formatMoney(filters.maxRent, currency, { cents: false })} or less with these filters. Try a higher rent or fewer filters.`
                    : 'Try fewer bedrooms, a later move-in date or a different location.'}
                </EmptyState>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((l, i) => (
                  <li key={l.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <ListingCard listing={l} currency={currency} priority={i < 3} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Container>
    </div>
  );
}

function Hero({ listingsCount, fromRent, cities, currency }: { listingsCount: number | null; fromRent: number | null; cities: string[]; currency: string }) {
  const portal = usePortal();
  const s = portal.data?.settings;
  const { user, signIn } = useSession();
  const me = useMe();
  const areas = areasFor(me.data);

  return (
    <section className="border-b bg-background">
      <Container className="py-7 sm:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div className="min-w-0">
            {s ? (
              <>
                <p className="text-sm font-medium text-primary">Homes for rent{cities.length ? ` in ${cities.slice(0, 3).join(', ')}${cities.length > 3 ? ' and nearby' : ''}` : ''}</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{s.portalHeadline}</h1>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">{s.portalIntro}</p>
              </>
            ) : (
              <div aria-hidden>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-3 h-10 w-72 max-w-full" />
                <Skeleton className="mt-4 h-5 w-full max-w-xl" />
                <Skeleton className="mt-2 h-5 w-2/3 max-w-md" />
              </div>
            )}
            {listingsCount != null && listingsCount > 0 && (
              <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Available</dt>
                  <dd className="text-lg font-semibold tabular-nums">{plural(listingsCount, 'home')}</dd>
                </div>
                {fromRent != null && (
                  <div>
                    <dt className="text-muted-foreground">Starting at</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {money(fromRent, currency)}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </dd>
                  </div>
                )}
                {s?.phone && (
                  <div>
                    <dt className="text-muted-foreground">Questions?</dt>
                    <dd className="text-lg font-semibold">
                      <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                        {s.phone}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          {user && areas.length > 0 ? (
            <aside className="hidden rounded-xl border bg-subtle p-5 lg:block">
              <p className="text-sm font-medium text-muted-foreground">Signed in as {me.data?.name || user.email}</p>
              <ul className="mt-3 space-y-1">
                {areas.map(a => (
                  <li key={a.area}>
                    <Link to={a.to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
                      <a.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{a.label}</span>
                        {a.hint && <span className="block truncate text-sm text-muted-foreground">{a.hint}</span>}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          ) : !user ? (
            <aside className="hidden rounded-xl border bg-subtle p-5 lg:block">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                  <KeyRound className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">Already live with us?</p>
                  <p className="text-sm text-muted-foreground">Residents, owners and vendors</p>
                </div>
              </div>
              <p className="mt-3 text-[15px] text-muted-foreground">Sign in to pay rent, request maintenance, read your lease or check on an application.</p>
              <Button variant="ink" className="mt-4 w-full" onClick={() => signIn()}>
                Sign in
              </Button>
            </aside>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

function NoListings() {
  const { data } = usePortal();
  const s = data?.settings;
  return (
    <div className="rounded-xl border bg-card">
      <EmptyState icon={Home} title="No homes are available right now">
        Everything we manage is rented at the moment. New homes are listed here as soon as they open up
        {s?.phone || s?.supportEmail ? ' — or get in touch and we’ll tell you what’s coming up.' : '.'}
      </EmptyState>
      {(s?.phone || s?.supportEmail) && (
        <div className="-mt-6 flex flex-wrap justify-center gap-2 px-6 pb-12">
          {s?.phone && (
            <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-4 text-[15px] font-medium shadow-2xs hover:bg-accent">
              <Phone className="h-4 w-4" aria-hidden /> {s.phone}
            </a>
          )}
          {s?.supportEmail && (
            <a href={`mailto:${s.supportEmail}?subject=${encodeURIComponent('Upcoming rentals')}`} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-4 text-[15px] font-medium shadow-2xs hover:bg-accent">
              <Mail className="h-4 w-4" aria-hidden /> Email us
            </a>
          )}
        </div>
      )}
    </div>
  );
}
