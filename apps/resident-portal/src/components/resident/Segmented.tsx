import { useRef } from 'react';
import { cn } from '@project/components/lib/utils';

/** A small radio group that looks like tabs — filters and Open/Past switches. Arrow keys move between options. */
export function Segmented({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string; count?: number }>; label: string; className?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex h-9 items-center rounded-lg bg-muted p-0.5', className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={e => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
              onChange(options[next].value);
              refs.current[next]?.focus();
            }}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
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
