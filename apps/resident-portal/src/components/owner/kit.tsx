import { CloudOff, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { errorMessage, isNotFound } from '../../lib/errors';
import { formatMoney } from '../../lib/format';
import { BackLink, Button, Card, Container, EmptyState, LinkButton, Skeleton } from '../ui';

/**
 * Pieces the owner and vendor areas share: the page header, a titled panel,
 * stat tiles, a segmented control, money that never prints "-$0.00", and
 * designed loading and error states.
 */

export function PageHeader({ title, subtitle, eyebrow, back, actions, className }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; className?: string }) {
  return (
    <Container className={cn('pb-2 pt-6 sm:pt-8', className)}>
      {back && (
        <div className="mb-3">
          <BackLink to={back.to}>{back.label}</BackLink>
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5 text-sm font-medium text-muted-foreground">{eyebrow}</div>}
          <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <div className="mt-1.5 text-[15px] text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </Container>
  );
}

export function Panel({ title, icon: Icon, action, children, className, bodyClassName, flush, description }: { title?: ReactNode; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; flush?: boolean; description?: ReactNode }) {
  const id = useId();
  return (
    <Card as="section" className={cn('overflow-hidden', className)} aria-labelledby={title ? id : undefined}>
      {title && (
        <div className="flex min-h-[52px] items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5">
          <div className="min-w-0">
            <h2 id={id} className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
              {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="truncate">{title}</span>
            </h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(!flush && 'px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </Card>
  );
}

/** A figure with its label and one line of context. Big numbers use proportional figures. */
export function StatTile({ label, value, detail, tone, children, className }: { label: string; value: ReactNode; detail?: ReactNode; tone?: 'danger' | 'success' | 'warning'; children?: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex min-w-0 flex-col p-4 sm:p-5', className)}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-2xl font-semibold tracking-tight sm:text-[26px]', tone === 'danger' && 'text-tone-danger', tone === 'success' && 'text-tone-success', tone === 'warning' && 'text-tone-warning')}>{value}</p>
      {children}
      {detail && <p className="mt-1.5 text-sm text-muted-foreground">{detail}</p>}
    </Card>
  );
}

/** Money for display: whole-cent rounding, and zero is always "$0.00", never "-$0.00". */
export function money(n: number | null | undefined, currency = 'USD', opts: { cents?: boolean; compact?: boolean } = {}) {
  const v = n == null || Math.abs(n) < 0.005 ? 0 : n;
  return formatMoney(v, currency, opts);
}

/** Accounting style for statements: negatives in parentheses. */
export function ledgerMoney(n: number, currency = 'USD') {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return v < 0 ? `(${formatMoney(-v, currency)})` : formatMoney(v, currency);
}

export function Segmented({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string; count?: number }>; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1 scrollbar-none', className)}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            onKeyDown={e => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = options.findIndex(x => x.value === value);
              const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
              onChange(next.value);
              const parent = e.currentTarget.parentElement;
              requestAnimationFrame(() => (parent?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
            }}
            tabIndex={active ? 0 : -1}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
              active ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
            {o.count != null && <span className={cn('tabular-nums', active ? 'text-muted-foreground' : 'text-faint')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A page that couldn't load: says why, offers to try again, and a way home. */
export function LoadError({ error, onRetry, what, home }: { error: unknown; onRetry: () => void; what: string; home: { to: string; label: string } }) {
  const notFound = isNotFound(error);
  return (
    <Container size="narrow" className="py-14">
      <EmptyState
        icon={CloudOff}
        title={notFound ? `We couldn't find ${what}` : `${what.charAt(0).toUpperCase()}${what.slice(1)} didn't load`}
        action={
          <>
            {!notFound && (
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            )}
            <LinkButton to={home.to} variant={notFound ? 'primary' : 'ghost'}>
              {home.label}
            </LinkButton>
          </>
        }
      >
        {errorMessage(error, 'Check your connection and try again.')}
      </EmptyState>
    </Container>
  );
}

export function AreaSkeleton({ tiles = 4, variant = 'dashboard' }: { tiles?: number; variant?: 'dashboard' | 'list' | 'document' | 'detail' }) {
  return (
    <div role="status" aria-label="Loading">
      <Container className="pb-2 pt-6 sm:pt-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-8 w-64 max-w-full" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </Container>
      <Container className="space-y-5 pt-5">
        {variant === 'dashboard' && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: tiles }).map((_, i) => (
                <Skeleton key={i} className="h-[112px] rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-xl" />
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-64 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          </>
        )}
        {variant === 'list' && (
          <>
            <Skeleton className="h-11 w-72 max-w-full rounded-xl" />
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3.5 w-1/3" />
                  </div>
                  <Skeleton className="hidden h-7 w-24 rounded-full sm:block" />
                </div>
              ))}
            </div>
          </>
        )}
        {variant === 'document' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-3 rounded-xl border bg-card p-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex justify-between gap-6">
                  <Skeleton className={cn('h-4', i % 4 === 0 ? 'w-40' : 'w-56')} />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </div>
        )}
        {variant === 'detail' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
            <div className="space-y-5">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-52 rounded-xl" />
            </div>
          </div>
        )}
      </Container>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A definition row: label left, value right, wraps on a phone. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2', className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] font-medium">{children}</dd>
    </div>
  );
}

/** "Good morning" by the viewer's clock. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Work order status → pill tone. */
export function workOrderTone(status: string): 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'Scheduled':
      return 'info';
    case 'In progress':
      return 'accent';
    case 'On hold':
      return 'warning';
    case 'Completed':
      return 'success';
    default:
      return 'neutral';
  }
}
