import { ArrowRight, Bath, BedDouble, CalendarCheck, CalendarClock, Car, Check, Home, Link2, MapPin, PawPrint, Phone, Ruler, SearchX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@project/components/lib/utils';
import { InquiryDialog } from '../../components/homes/InquiryDialog';
import { ListingCard } from '../../components/homes/ListingCard';
import { PhotoGallery } from '../../components/homes/PhotoGallery';
import { Alert, BackLink, Button, Card, Container, EmptyState, LinkButton, Skeleton, StatusPill } from '../../components/ui';
import { statusCopy } from '../../lib/apply';
import { errorMessage, isNotFound } from '../../lib/errors';
import { initials, longDate } from '../../lib/format';
import { PET_LABEL, availability, money, bathsLabel, bedsLabel, petsAllowed, sqftLabel, usePublicListing, type ListingDetail, type ListingDetailData } from '../../lib/listings';
import { usePortal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/**
 * One home for rent. Everything a renter weighs — photos, size, rent and fees,
 * pets, when it's free — with one clear next step pinned beside it: apply, or
 * ask a question first.
 */
export default function ListingPage() {
  const { slug } = useParams();
  const q = usePublicListing(slug);
  useDocumentTitle(q.data?.listing.title ?? (q.isError ? 'Home not found' : 'Home for rent'));

  if (q.isPending) return <ListingSkeleton />;
  if (q.isError || !q.data) {
    return (
      <Container size="narrow" className="py-16">
        {isNotFound(q.error) ? (
          <EmptyState icon={SearchX} title="This home isn’t available" action={<LinkButton to="/homes">See available homes <ArrowRight aria-hidden /></LinkButton>}>
            It may have been rented or taken off the market. Browse the homes that are available now.
          </EmptyState>
        ) : (
          <Alert tone="danger" title="This home didn’t load" action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}>Try again</Button>}>
            {errorMessage(q.error, 'Check your connection and try again.')}
          </Alert>
        )}
      </Container>
    );
  }
  return <Listing data={q.data} />;
}

function Listing({ data }: { data: ListingDetailData }) {
  const { listing: l, similar } = data;
  const portal = usePortal();
  const currency = portal.data?.settings.currency ?? 'USD';
  const [inquiry, setInquiry] = useState<null | 'question' | 'showing'>(null);
  const avail = availability(l.availableOn);
  const address = [l.street && l.unitName ? `${l.street}, Unit ${l.unitName}` : l.street, [l.city, [l.state, l.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const amenities = [...new Set([...l.amenities, ...l.buildingAmenities])];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied.');
    } catch {
      toast.error('Couldn’t copy the link. Copy it from the address bar instead.');
    }
  };

  return (
    <div className="pb-28 lg:pb-8">
      <Container className="pt-5 sm:pt-6">
        <div className="flex items-center justify-between gap-3">
          <BackLink to="/homes">All homes</BackLink>
          <Button variant="ghost" size="sm" onClick={copyLink} className="-mr-2 text-muted-foreground">
            <Link2 aria-hidden /> Copy link
          </Button>
        </div>

        <header className="mt-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{l.title}</h1>
          <p className="mt-1.5 flex items-start gap-1.5 text-[15px] text-muted-foreground">
            <MapPin className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {l.propertyName && <span className="font-medium text-foreground/85">{l.propertyName}</span>}
              {l.propertyName && address ? ' · ' : ''}
              {address}
            </span>
          </p>
        </header>

        <PhotoGallery photos={l.photos} title={l.title} className="mt-5" />

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="min-w-0 space-y-10">
            <Facts l={l} />

            {l.description && (
              <Section title="About this home">
                <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">
                  {l.description.split(/\n{2,}|\r\n\r\n/).map((p, i) => (
                    <p key={i} className="whitespace-pre-line break-words">
                      {p.trim()}
                    </p>
                  ))}
                </div>
              </Section>
            )}

            {amenities.length > 0 && (
              <Section title="Features and amenities">
                <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {amenities.map(a => (
                    <li key={a} className="flex items-start gap-2.5 text-[15px]">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-tone-success" aria-hidden />
                      <span className="break-words">{a}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Lease terms">
              <dl className="divide-y rounded-xl border bg-card">
                <Term label="Monthly rent">{money(l.rent, currency)}</Term>
                <Term label="Security deposit">{l.deposit != null ? money(l.deposit, currency) : 'Ask the leasing team'}</Term>
                <Term label="Lease length">{l.leaseTerm || 'Ask the leasing team'}</Term>
                <Term label="Application fee">{l.applicationFee > 0 ? money(l.applicationFee, currency) : 'None'}</Term>
                <Term label="Available">{avail.now ? 'Now' : longDate(l.availableOn)}</Term>
              </dl>
            </Section>

            <Section title="Pets and parking">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoTile icon={PawPrint} title={PET_LABEL[l.petPolicy] ?? (l.petPolicy || 'Ask about pets')}>
                  {l.buildingPetPolicy || (petsAllowed(l.petPolicy) ? 'Pet rent or a deposit may apply.' : 'Assistance animals are always welcome.')}
                </InfoTile>
                <InfoTile icon={Car} title="Parking">
                  {l.parking || 'Ask the leasing team about parking.'}
                </InfoTile>
              </div>
            </Section>

            {l.showingInstructions && (
              <Section title="Seeing the home">
                <div className="flex flex-col gap-4 rounded-xl border bg-subtle p-5 sm:flex-row sm:items-center">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                    <CalendarClock className="h-5 w-5" aria-hidden />
                  </span>
                  <p className="min-w-0 flex-1 text-[15px] text-foreground/90">{l.showingInstructions}</p>
                  <Button variant="secondary" onClick={() => setInquiry('showing')} className="shrink-0">
                    Request a showing
                  </Button>
                </div>
              </Section>
            )}

            {(l.buildingDescription || l.yearBuilt) && (
              <Section title={`About ${l.propertyName || 'the building'}`}>
                <div className="flex gap-4">
                  <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground sm:flex">
                    <Home className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    {l.buildingDescription && <p className="text-[15px] leading-relaxed text-foreground/90">{l.buildingDescription}</p>}
                    <p className="mt-2 text-sm text-muted-foreground">{[l.propertyType, l.yearBuilt ? `Built ${l.yearBuilt}` : '', [l.city, l.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              </Section>
            )}
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <ApplyCard data={data} currency={currency} onAsk={() => setInquiry('question')} />
            </div>
          </aside>
        </div>

        <div className="mt-10 lg:hidden">
          <ContactCard data={data} onAsk={() => setInquiry('question')} />
        </div>

        {similar.length > 0 && (
          <section className="mt-14 border-t pt-10" aria-labelledby="similar-homes">
            <h2 id="similar-homes" className="text-xl font-semibold tracking-tight">
              More homes for rent
            </h2>
            <ul className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {similar.map(s => (
                <li key={s.id}>
                  <ListingCard listing={s} currency={currency} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>

      <MobileBar data={data} currency={currency} onAsk={() => setInquiry('question')} />

      <InquiryDialog open={inquiry != null} onOpenChange={o => !o && setInquiry(null)} slug={l.slug} listingTitle={l.title} initialKind={inquiry ?? 'question'} showingInstructions={l.showingInstructions} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Facts({ l }: { l: ListingDetail }) {
  const avail = availability(l.availableOn);
  const facts = [
    l.beds != null && { icon: BedDouble, label: 'Bedrooms', value: l.beds === 0 ? 'Studio' : bedsLabel(l.beds, true) },
    l.baths != null && { icon: Bath, label: 'Bathrooms', value: bathsLabel(l.baths, true) },
    l.squareFeet && { icon: Ruler, label: 'Size', value: sqftLabel(l.squareFeet) },
    { icon: CalendarCheck, label: 'Move in', value: avail.now ? 'Available now' : longDate(l.availableOn), good: avail.now },
  ].filter(Boolean) as Array<{ icon: typeof Bath; label: string; value: string; good?: boolean }>;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      {facts.map(f => (
        <div key={f.label} className="bg-card px-4 py-3.5">
          <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <f.icon className="h-4 w-4" aria-hidden /> {f.label}
          </dt>
          <dd className={cn('mt-1 text-[15px] font-semibold', f.good && 'text-tone-success')}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-[15px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[15px] font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function InfoTile({ icon: Icon, title, children }: { icon: typeof Car; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> {title}
      </p>
      <p className="mt-1 text-[15px] text-muted-foreground">{children}</p>
    </div>
  );
}

/** What to do next depends on whether you've already started. */
function primaryAction(data: ListingDetailData) {
  const { mine, listing, applicationsOpen } = data;
  if (mine?.status === 'Draft') return { kind: 'continue' as const, to: `/homes/${listing.slug}/apply`, label: 'Continue your application' };
  if (mine) return { kind: 'view' as const, to: `/applications/${mine.id}`, label: 'View your application' };
  if (!applicationsOpen) return { kind: 'closed' as const, to: '', label: 'Applications paused' };
  return { kind: 'apply' as const, to: `/homes/${listing.slug}/apply`, label: 'Apply now' };
}

function ApplyCard({ data, currency, onAsk }: { data: ListingDetailData; currency: string; onAsk: () => void }) {
  const { listing: l, mine } = data;
  const avail = availability(l.availableOn);
  const action = primaryAction(data);
  const portal = usePortal();
  const phone = portal.data?.settings.phone;
  return (
    <Card className="p-5 shadow-sm">
      <p className="text-3xl font-semibold tabular-nums tracking-tight">
        {money(l.rent, currency)}
        <span className="ml-1 text-base font-normal text-muted-foreground">/ month</span>
      </p>
      <p className={cn('mt-1 flex items-center gap-1.5 text-[15px]', avail.now ? 'text-tone-success' : 'text-foreground/85')}>
        <CalendarCheck className="h-4 w-4" aria-hidden /> {avail.label}
      </p>
      <dl className="mt-4 space-y-1.5 border-t pt-4 text-[15px]">
        {l.deposit != null && <MiniTerm label="Deposit" value={money(l.deposit, currency)} />}
        <MiniTerm label="Application fee" value={l.applicationFee > 0 ? money(l.applicationFee, currency) : 'None'} />
        {l.leaseTerm && <MiniTerm label="Lease" value={l.leaseTerm} />}
      </dl>

      {mine && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="text-sm text-muted-foreground">Your application</span>
          <StatusPill tone={statusCopy(mine.status).tone}>{statusCopy(mine.status).pill}</StatusPill>
        </div>
      )}

      {action.kind === 'closed' ? (
        <Alert tone="info" className="mt-5">
          Online applications are paused right now.{phone ? ` Call ${phone} to apply.` : ' Contact the office to apply.'}
        </Alert>
      ) : (
        <LinkButton to={action.to} size="lg" variant={action.kind === 'view' ? 'ink' : 'primary'} className="mt-5 w-full">
          {action.label} <ArrowRight aria-hidden />
        </LinkButton>
      )}
      <Button variant="secondary" size="lg" className="mt-2 w-full" onClick={onAsk}>
        Ask a question or book a tour
      </Button>
      {action.kind === 'apply' && <p className="mt-3 text-center text-sm text-muted-foreground">Takes about 10 minutes. Your answers save as you go.</p>}

      <div className="mt-5 border-t pt-4">
        <ContactLine data={data} />
      </div>
    </Card>
  );
}

function MiniTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ContactLine({ data }: { data: ListingDetailData }) {
  const portal = usePortal();
  const s = portal.data?.settings;
  const c = data.listing.contact;
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-semibold text-foreground/75" aria-hidden>
        {initials(c?.name ?? s?.organizationName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{c?.name ?? 'Leasing team'}</p>
        <p className="truncate text-sm text-muted-foreground">{c ? c.title || 'Leasing' : s?.organizationName}</p>
      </div>
      {s?.phone && (
        <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-label={`Call ${s.phone}`}>
          <Phone className="h-4 w-4" aria-hidden />
        </a>
      )}
    </div>
  );
}

function ContactCard({ data, onAsk }: { data: ListingDetailData; onAsk: () => void }) {
  return (
    <Card className="p-5">
      <p className="text-lg font-semibold">Questions about this home?</p>
      <div className="mt-4">
        <ContactLine data={data} />
      </div>
      <Button variant="secondary" size="lg" className="mt-4 w-full" onClick={onAsk}>
        Ask a question or book a tour
      </Button>
    </Card>
  );
}

/** Phones keep the rent and the next step in reach while scrolling. */
function MobileBar({ data, currency, onAsk }: { data: ListingDetailData; currency: string; onAsk: () => void }) {
  const { listing: l } = data;
  const action = primaryAction(data);
  const avail = availability(l.availableOn);
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_20px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-page items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold tabular-nums leading-tight">
            {money(l.rent, currency)}
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          </p>
          <p className={cn('truncate text-sm', avail.now ? 'text-tone-success' : 'text-muted-foreground')}>{avail.label}</p>
        </div>
        {action.kind === 'closed' ? (
          <Button size="lg" variant="secondary" onClick={onAsk}>
            Contact us
          </Button>
        ) : (
          <LinkButton to={action.to} size="lg" variant={action.kind === 'view' ? 'ink' : 'primary'} className="px-5">
            {action.kind === 'apply' ? 'Apply now' : action.kind === 'continue' ? 'Continue' : 'View application'}
          </LinkButton>
        )}
      </div>
    </div>
  );
}

function ListingSkeleton() {
  return (
    <Container className="pt-6" >
      <div role="status" aria-label="Loading">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-8 w-2/3 max-w-xl" />
        <Skeleton className="mt-2 h-5 w-1/2 max-w-sm" />
        <Skeleton className="mt-5 aspect-[4/3] w-full rounded-2xl sm:aspect-auto sm:h-[26rem] lg:h-[30rem]" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <Skeleton className="hidden h-80 rounded-xl lg:block" />
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    </Container>
  );
}
