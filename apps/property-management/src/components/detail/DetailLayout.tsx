import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';

/**
 * A record page: the header bar, a readable main column, and a properties
 * rail on the right (above the content on narrow screens) — the shape of
 * every detail page, so people always know where to look.
 */
export function DetailLayout({ header, rail, children, className, wide }: { header: ReactNode; rail?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className={cn('min-w-0 flex-1 lg:overflow-y-auto', className)}>
          <div className={cn('mx-auto w-full px-5 pb-24 pt-6 sm:px-8', wide ? 'max-w-6xl' : 'max-w-[860px]')}>{children}</div>
        </div>
        {rail && <aside className="order-first shrink-0 border-b bg-subtle/40 lg:order-none lg:w-[300px] lg:overflow-y-auto lg:border-b-0 lg:border-l">{rail}</aside>}
      </div>
    </div>
  );
}

export function RailSection({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b px-4 py-3 last:border-b-0', className)}>
      {(title || action) && (
        <div className="mb-1.5 flex h-6 items-center justify-between">
          {title && <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>}
          {action}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

/** A label and an (often editable) value in the rail. Put a ghost-chip trigger in `children`. */
export function RailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-9 items-center gap-2', className)}>
      <span className="w-[92px] shrink-0 text-[13.5px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

/** Section heading inside the main column. */
export function SectionHeading({ children, action, className, count }: { children: ReactNode; action?: ReactNode; className?: string; count?: number }) {
  return (
    <div className={cn('mb-2 mt-8 flex items-center justify-between gap-3 first:mt-0', className)}>
      <h2 className="flex items-baseline gap-2 text-[14px] font-medium">
        {children}
        {count != null && <span className="text-sm tabular-nums text-muted-foreground">{count}</span>}
      </h2>
      {action && <div className="flex items-center gap-1">{action}</div>}
    </div>
  );
}

/** Underlined tabs inside a record page (not the header's pill tabs). */
export function InlineTabs<V extends string>({ value, onChange, tabs, className }: { value: V; onChange: (v: V) => void; tabs: ReadonlyArray<{ value: V; label: ReactNode; count?: number | null }>; className?: string }) {
  return (
    <div role="tablist" className={cn('flex items-center gap-4 overflow-x-auto border-b scrollbar-none', className)}>
      {tabs.map(t => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn('relative flex h-9 shrink-0 items-center gap-1.5 text-[14px] transition-colors', value === t.value ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {t.label}
          {t.count != null && t.count > 0 && <span className="tabular-nums text-sm text-muted-foreground">{t.count}</span>}
          {value === t.value && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-foreground" />}
        </button>
      ))}
    </div>
  );
}
