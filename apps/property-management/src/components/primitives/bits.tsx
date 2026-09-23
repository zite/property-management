import { forwardRef, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@project/components/ui/tooltip';
import { cn } from '@project/components/lib/utils';
type LabelLike = { name: string; color: string | null; description?: string | null };

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('kbd', className)}>{children}</kbd>;
}

/** A shortcut rendered as separate keys: "G then I" or "⌘ K". */
export function Keys({ keys, then }: { keys: string[]; then?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {then && i > 0 && <span className="text-2xs text-muted-foreground">then</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}

/** A tooltip that names the action and, where there is one, its shortcut. */
export function Tip({ label, keys, children, side = 'bottom', then }: { label: ReactNode; keys?: string[]; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; then?: boolean }) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        className="flex items-center gap-2 border bg-popover px-2 py-1 text-sm text-popover-foreground shadow-md"
      >
        <span>{label}</span>
        {keys && <Keys keys={keys} then={then} />}
      </TooltipContent>
    </Tooltip>
  );
}

export function LabelDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: color || '#95959f' }} aria-hidden />;
}

export function LabelChip({ label, className, onRemove }: { label: LabelLike; className?: string; onRemove?: () => void }) {
  return (
    <span className={cn('chip max-w-[160px] bg-background', className)} title={label.description ?? label.name}>
      <LabelDot color={label.color} />
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-1 ml-0.5 rounded-full px-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${label.name}`}>
          ×
        </button>
      )}
    </span>
  );
}

/** A project/initiative/team glyph: its emoji on a soft tint of its colour. */
export function Glyph({ icon, color, size = 18, className }: { icon: string | null | undefined; color?: string | null; size?: number; className?: string }) {
  const isEmoji = icon && /\p{Extended_Pictographic}/u.test(icon);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[5px] leading-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: isEmoji ? Math.round(size * 0.7) : Math.round(size * 0.62),
        background: `${color || '#6943d0'}22`,
        color: color || '#6943d0',
      }}
    >
      {icon || '◆'}
    </span>
  );
}

export function ProgressRing({ value, size = 16, stroke = 2, className, color }: { value: number; size?: number; stroke?: number; className?: string; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color ?? 'currentColor'}
        strokeWidth={stroke}
        strokeDasharray={`${v * c} ${c}`}
        strokeLinecap="round"
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

export function ProgressBar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const v = Math.max(0, Math.min(1, value));
  const fill = { primary: 'bg-primary', success: 'bg-tone-success', warning: 'bg-tone-warning', danger: 'bg-tone-danger' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-up', className)}>
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border bg-subtle text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <h3 className="text-[15px] font-medium">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[14px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md'; active?: boolean }>(
  ({ className, size = 'md', active, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-accent data-[state=open]:text-foreground',
        size === 'sm' ? 'h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5' : 'h-7 w-7 [&_svg]:h-4 [&_svg]:w-4',
        active && 'bg-accent text-foreground',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

export function SkeletonRows({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-px', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 px-5">
          <div className="skeleton h-3.5 w-3.5 rounded-full" />
          <div className="skeleton h-3 w-14" />
          <div className="skeleton h-3" style={{ width: `${30 + ((i * 37) % 40)}%` }} />
          <div className="ml-auto skeleton h-5 w-5 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SectionLabel({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <h3 className="text-sm font-medium text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}
