import { ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@project/components/lib/utils';

/**
 * Small form controls for filters. Native selects on purpose: they're fast,
 * fully accessible and open the phone's own picker, and styled to match.
 */

export const NativeSelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { active?: boolean; size?: 'md' | 'lg' }>(function NativeSelect(
  { className, children, active, size = 'md', ...props },
  ref,
) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        ref={ref}
        {...props}
        className={cn(
          'w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border bg-background pl-3 pr-9 text-[15px] text-foreground shadow-2xs transition-[border-color,box-shadow,background-color] hover:border-foreground/25 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15',
          size === 'md' ? 'h-10' : 'h-11',
          active ? 'border-foreground/30 bg-accent/60 font-medium' : 'border-border',
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
});

/** A row of mutually exclusive choices that reads as one control. Arrow keys move between them. */
export function Segmented({ label, options, value, onChange, className, size = 'md' }: { label: string; options: ReadonlyArray<{ id: string; label: ReactNode }>; value: string; onChange: (id: string) => void; className?: string; size?: 'md' | 'lg' }) {
  const index = Math.max(0, options.findIndex(o => o.id === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-lg border bg-muted/60 p-0.5 shadow-2xs', className)}
      onKeyDown={e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = options[(index + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
        onChange(next.id);
        const el = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next.id)}"]`);
        el?.focus();
      }}
    >
      {options.map(o => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-id={o.id}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={cn(
              'min-w-[2.75rem] whitespace-nowrap rounded-md px-3 text-[15px] font-medium [.w-full>&]:flex-1 transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
              size === 'md' ? 'h-[34px]' : 'h-10',
              on ? 'bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
