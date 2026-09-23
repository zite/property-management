import { CloudOff, Phone, Siren, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { errorMessage, isNotFound } from '../../lib/errors';
import { categoryMeta, requestStatus, telHref } from '../../lib/residentFormat';
import { Button, Card, Container, EmptyState, LinkButton, Skeleton, StatusPill } from '../ui';

/** Small pieces every resident page shares. */

export function RequestStatusPill({ status, className }: { status: string; className?: string }) {
  const s = requestStatus(status);
  return (
    <StatusPill tone={s.tone} className={className}>
      {s.label}
    </StatusPill>
  );
}

export function CategoryGlyph({ category, className, size = 'md' }: { category: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = categoryMeta(category).icon;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-foreground/70',
        size === 'sm' && 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
        size === 'md' && 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        size === 'lg' && 'h-12 w-12 rounded-xl [&_svg]:h-5 [&_svg]:w-5',
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** A card with a quiet heading row. */
export function Panel({ title, icon: Icon, action, children, className, bodyClassName, id }: { title?: ReactNode; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <Card as="section" className={cn('overflow-hidden', className)} aria-labelledby={id}>
      {title && (
        <div className="flex min-h-[52px] items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5">
          <h2 id={id} className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="truncate">{title}</span>
          </h2>
          {action}
        </div>
      )}
      <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </Card>
  );
}

/** A page that couldn't load: says why, and offers to try again. */
export function LoadError({ error, onRetry, what = 'this page' }: { error: unknown; onRetry: () => void; what?: string }) {
  const notFound = isNotFound(error);
  return (
    <Container size="narrow" className="py-14">
      <EmptyState
        icon={CloudOff}
        title={notFound ? `We couldn't find ${what}` : `${what.charAt(0).toUpperCase()}${what.slice(1)} didn't load`}
        action={
          <>
            {!notFound && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
            <LinkButton to="/resident" variant={notFound ? 'primary' : 'ghost'}>Resident home</LinkButton>
          </>
        }
      >
        {errorMessage(error, 'Check your connection and try again.')}
      </EmptyState>
    </Container>
  );
}

/** Skeleton for a resident page: header, then cards shaped like the content. */
export function ResidentSkeleton({ variant = 'cards' }: { variant?: 'cards' | 'list' | 'document' }) {
  return (
    <div role="status" aria-label="Loading">
      <Container className="pb-2 pt-6 sm:pt-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2.5 h-5 w-40" />
      </Container>
      <Container className="py-5">
        {variant === 'list' ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-64 rounded-lg" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-xl" />
            ))}
          </div>
        ) : variant === 'document' ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-96 rounded-xl" />
            </div>
            <Skeleton className="hidden h-72 rounded-xl lg:block" />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <Skeleton className="h-60 rounded-xl" />
              <Skeleton className="h-44 rounded-xl" />
              <Skeleton className="h-44 rounded-xl" />
            </div>
            <div className="space-y-5">
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-52 rounded-xl" />
            </div>
          </div>
        )}
      </Container>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** The 24/7 line, for when something can't wait for a reply. */
export function EmergencyCard({ phone, className, compact }: { phone: string; className?: string; compact?: boolean }) {
  if (!phone) return null;
  return (
    <div className={cn('rounded-xl border border-tone-danger/25 bg-tone-danger/[0.05] p-4', className)}>
      <div className="flex gap-3">
        <Siren className="mt-0.5 h-5 w-5 shrink-0 text-tone-danger" aria-hidden />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Maintenance emergency?</p>
          {!compact && <p className="mt-0.5 text-sm text-foreground/80">Flooding, no heat, a gas smell or no power — call now, day or night. Don’t wait for a reply online.</p>}
          <a href={telHref(phone)} className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg bg-tone-danger px-3.5 text-[15px] font-medium text-white shadow-xs transition-colors hover:bg-tone-danger/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-tone-danger/35 dark:text-[hsl(240_10%_6%)]">
            <Phone className="h-4 w-4" aria-hidden /> Call {phone}
          </a>
        </div>
      </div>
    </div>
  );
}

/** Label/value pairs, stacked on a phone. */
export function Facts({ items, className }: { items: Array<{ label: string; value: ReactNode; hint?: ReactNode } | null | false>; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {items.filter(Boolean).map(i => {
        const item = i as { label: string; value: ReactNode; hint?: ReactNode };
        return (
          <div key={item.label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-[15px] font-medium">{item.value}</dd>
            {item.hint && <dd className="mt-0.5 text-sm text-muted-foreground">{item.hint}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
