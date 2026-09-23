import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@project/components/ui/tooltip';
import type { Tone } from '@project/shared/tone';

/**
 * The portal's primitives. Controls are 40–48px tall so they're easy to hit
 * on a phone, and every focusable thing has a visible ring.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'soft' | 'ink';
export type ButtonSize = 'sm' | 'md' | 'lg';

const focusRing = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background';

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0',
    focusRing,
    size === 'sm' && 'h-9 px-3 text-sm [&_svg]:h-4 [&_svg]:w-4',
    size === 'md' && 'h-10 px-4 text-[15px] [&_svg]:h-4 [&_svg]:w-4',
    size === 'lg' && 'h-12 px-5 text-base [&_svg]:h-[18px] [&_svg]:w-[18px]',
    variant === 'primary' && 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
    variant === 'secondary' && 'border border-border bg-background text-foreground shadow-2xs hover:border-foreground/25 hover:bg-accent',
    variant === 'ghost' && 'text-foreground hover:bg-accent',
    // Ink, so the brand colour stays reserved for the one action a page is really about.
    variant === 'ink' && 'bg-foreground text-background shadow-xs hover:bg-foreground/90',
    variant === 'soft' && 'bg-primary/[0.08] text-primary hover:bg-primary/[0.14]',
    variant === 'danger' && 'bg-tone-danger text-white shadow-sm hover:bg-tone-danger/90 dark:text-[hsl(240_10%_6%)]',
    variant === 'link' && 'h-auto px-0 text-primary underline-offset-4 hover:underline active:translate-y-0',
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size, loading, className, children, disabled, type = 'button', ...props }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function LinkButton({ variant, size, className, ...props }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-tone-info',
  accent: 'text-tone-accent',
  success: 'text-tone-success',
  warning: 'text-tone-warning',
  danger: 'text-tone-danger',
};

const TONE_PILL: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  info: 'bg-tone-info/[0.08] text-tone-info ring-tone-info/20',
  accent: 'bg-tone-accent/[0.08] text-tone-accent ring-tone-accent/20',
  success: 'bg-tone-success/[0.09] text-tone-success ring-tone-success/25',
  warning: 'bg-tone-warning/[0.09] text-tone-warning ring-tone-warning/25',
  danger: 'bg-tone-danger/[0.08] text-tone-danger ring-tone-danger/20',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-tone-neutral',
  info: 'bg-tone-info',
  accent: 'bg-tone-accent',
  success: 'bg-tone-success',
  warning: 'bg-tone-warning',
  danger: 'bg-tone-danger',
};

export function StatusPill({ tone, children, className, dot = true }: { tone: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ring-1 ring-inset', TONE_PILL[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export function CountBadge({ count, className, label }: { count: number; className?: string; label?: string }) {
  if (!count) return null;
  return (
    <span className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-semibold tabular-nums text-primary-foreground', className)} aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'aside' } & Record<string, unknown>) {
  return (
    <As className={cn('rounded-xl border bg-card text-card-foreground shadow-xs print-plain', className)} {...rest}>
      {children}
    </As>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function PageSkeleton({ variant = 'detail' }: { variant?: 'detail' | 'list' | 'form' }) {
  return (
    <div className="mx-auto w-full max-w-page px-4 py-10 sm:px-6" role="status" aria-label="Loading">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-9 w-2/3 max-w-lg" />
      <Skeleton className="mt-3 h-5 w-1/2 max-w-md" />
      {variant === 'list' ? (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {Array.from({ length: variant === 'form' ? 5 : 4 }).map((_, i) => (
              <Skeleton key={i} className={variant === 'form' ? 'h-16 rounded-lg' : 'h-24 rounded-xl'} />
            ))}
          </div>
          <Skeleton className="hidden h-64 rounded-xl lg:block" />
        </div>
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {Icon && (
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-[15px] text-muted-foreground">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

const ALERT_ICON: Record<'info' | 'success' | 'warning' | 'danger', LucideIcon> = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertCircle };

export function Alert({ tone = 'info', title, children, action, className, icon }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: LucideIcon }) {
  const Icon = icon ?? ALERT_ICON[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-start',
        tone === 'info' && 'border-tone-info/25 bg-tone-info/[0.06]',
        tone === 'success' && 'border-tone-success/25 bg-tone-success/[0.06]',
        tone === 'warning' && 'border-tone-warning/30 bg-tone-warning/[0.07]',
        tone === 'danger' && 'border-tone-danger/25 bg-tone-danger/[0.06]',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', TONE_TEXT[tone])} aria-hidden />
        <div className="min-w-0 flex-1 text-[15px]">
          {title && <p className="font-semibold text-foreground">{title}</p>}
          {children && <div className={cn('text-foreground/85', title && 'mt-0.5')}>{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 gap-2 pl-8 sm:pl-0">{action}</div>}
    </div>
  );
}

/** A property's monogram: its first letter on a hairline tint of its colour. */
export function PropertyGlyph({ color, name, size = 'md', className }: { color: string; name?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const dims = { sm: 'h-8 w-8 text-sm rounded-md', md: 'h-10 w-10 text-base rounded-md', lg: 'h-11 w-11 text-lg rounded-md', xl: 'h-14 w-14 text-2xl rounded-lg' }[size];
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center bg-muted font-semibold text-foreground/75 ring-1 ring-inset', dims, className)}
      style={{ boxShadow: `inset 0 0 0 1px ${color}33`, background: `${color}14` }}
    >
      {(name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProgressBar({ value, className, label, tone = 'primary' }: { value: number; className?: string; label?: string; tone?: 'primary' | 'success' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', tone === 'success' ? 'bg-tone-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs rounded-lg bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Container({ className, children, size = 'page' }: { className?: string; children: ReactNode; size?: 'page' | 'narrow' | 'form' }) {
  return <div className={cn('mx-auto w-full px-4 sm:px-6', size === 'page' && 'max-w-page', size === 'narrow' && 'max-w-3xl', size === 'form' && 'max-w-5xl', className)}>{children}</div>;
}

export function SectionHeading({ children, count, action, id }: { children: ReactNode; count?: number; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3 border-b pb-2.5">
      <h2 id={id} className="flex items-baseline gap-2 font-serif text-xl font-semibold">
        {children}
        {count != null && <span className="font-sans text-sm font-normal tabular-nums text-faint">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

const inputBase =
  'w-full rounded-lg border border-input bg-background px-3 text-[15px] text-foreground shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-[invalid=true]:border-tone-danger';

export const inputClass = (className?: string) => cn(inputBase, 'h-11', className);
export const textareaClass = (className?: string) => cn(inputBase, 'block min-h-[112px] resize-y py-2.5 leading-relaxed', className);

export function FieldRow({ id, label, hint, error, children, optional }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode; optional?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[15px] font-medium">
        {label}
        {optional && <span className="ml-1.5 text-sm font-normal text-muted-foreground">(optional)</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn('no-print -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground', focusRing)}>
      <span aria-hidden>←</span> {children}
    </Link>
  );
}
