import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { useWorkspace } from '../../lib/workspace';
import { PropertySwatch } from './glyphs';
import { Tip } from './bits';

/**
 * Money, figures and facts. Every amount in the app renders through <Money>
 * so tabular alignment, negative styling and currency are identical everywhere.
 */

export function Money({ value, className, signed, compact, cents = true, tone = 'plain', muted0 }: {
  value: number | null | undefined;
  className?: string;
  /** Show + for positive values. */
  signed?: boolean;
  compact?: boolean;
  cents?: boolean;
  /** `balance`: positive owed amounts in danger, credits in success. `flow`: in green, out plain. */
  tone?: 'plain' | 'balance' | 'flow';
  /** Render zero as a quiet dash. */
  muted0?: boolean;
}) {
  const ws = useWorkspace();
  const v = value ?? 0;
  if (muted0 && Math.abs(v) < 0.005) return <span className={cn('num text-muted-foreground/70', className)}>—</span>;
  const color = tone === 'balance' ? (v > 0.005 ? 'text-tone-danger' : v < -0.005 ? 'text-tone-success' : 'text-muted-foreground') : tone === 'flow' && v > 0 ? 'text-tone-success' : v < -0.005 ? 'text-foreground' : '';
  return <span className={cn('num whitespace-nowrap', color, className)}>{ws.money(v, { compact, cents, sign: signed })}</span>;
}

export function StatTile({ label, value, hint, trend, onClick, className, tone }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean } | null;
  onClick?: () => void;
  className?: string;
  tone?: 'default' | 'danger' | 'warning' | 'success';
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col items-start rounded-lg border bg-card px-4 py-3 text-left shadow-2xs transition-colors',
        onClick && 'hover:border-foreground/15 hover:bg-accent/40',
        className,
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className={cn('num mt-1 text-[22px] font-semibold leading-7 tracking-tight', tone === 'danger' && 'text-tone-danger', tone === 'warning' && 'text-tone-warning', tone === 'success' && 'text-tone-success')}>{value}</span>
      <span className="mt-0.5 flex min-h-[18px] items-center gap-1.5 text-sm text-muted-foreground">
        {trend && (
          <span className={cn('font-medium', trend.direction === 'flat' ? 'text-muted-foreground' : trend.good ? 'text-tone-success' : 'text-tone-danger')}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
          </span>
        )}
        {hint}
      </span>
    </Comp>
  );
}

/** Label/value rows for a detail rail or a summary card. */
export function Facts({ items, className, columns = 1 }: { items: Array<{ label: ReactNode; value: ReactNode; hidden?: boolean }>; className?: string; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2.5 text-[14px]', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3', className)}>
      {items
        .filter(i => !i.hidden)
        .map((i, n) => (
          <div key={n} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{i.label}</dt>
            <dd className="mt-0.5 min-w-0 break-words">{i.value ?? <span className="text-muted-foreground/70">—</span>}</dd>
          </div>
        ))}
    </dl>
  );
}

/** A property's colour swatch and name — how a property appears inline everywhere. */
export function PropertyLabel({ propertyId, unitId, className, hideSwatch }: { propertyId?: string | null; unitId?: string | null; className?: string; hideSwatch?: boolean }) {
  const ws = useWorkspace();
  const unit = unitId ? ws.unitById.get(unitId) : undefined;
  const property = ws.propertyById.get(unit?.propertyId ?? propertyId ?? '');
  if (!property) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {!hideSwatch && <PropertySwatch color={property.color} />}
      <span className="truncate">{ws.unitLabel(unitId, property.id)}</span>
    </span>
  );
}

/** A number with a label underneath, for dense header strips. */
export function Figure({ label, value, tip, className }: { label: string; value: ReactNode; tip?: string; className?: string }) {
  const body = (
    <div className={cn('min-w-0', className)}>
      <div className="num truncate text-[16px] font-semibold leading-5">{value}</div>
      <div className="truncate text-sm text-muted-foreground">{label}</div>
    </div>
  );
  return tip ? <Tip label={tip}>{body}</Tip> : body;
}

export function Card({ title, action, children, className, bodyClassName, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cn('rounded-lg border bg-card shadow-2xs', className)}>
      {(title || action) && (
        <header className="flex min-h-10 items-center justify-between gap-3 border-b px-4 py-2">
          <h2 className="truncate text-[14px] font-medium">{title}</h2>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
