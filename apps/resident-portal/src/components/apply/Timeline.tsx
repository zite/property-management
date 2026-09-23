import { Check, X } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import type { ApplicationData } from '../../lib/apply';
import { mediumDateTime } from '../../lib/format';

type Item = ApplicationData['timeline'][number];

/** Where an application is: finished steps filled, the next one ringed, the rest waiting. */
export function Timeline({ items }: { items: Item[] }) {
  const lastDone = items.map(i => i.done).lastIndexOf(true);
  return (
    <ol className="relative">
      {items.map((item, i) => {
        const upNext = i === lastDone + 1;
        const last = i === items.length - 1;
        const fill = item.tone === 'danger' ? 'bg-tone-danger text-white dark:text-[hsl(240_10%_6%)]' : item.tone === 'success' ? 'bg-tone-success text-white dark:text-[hsl(240_10%_6%)]' : item.tone === 'muted' ? 'bg-tone-neutral text-white dark:text-[hsl(240_10%_6%)]' : 'bg-primary text-primary-foreground';
        return (
          <li key={item.key} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className={cn('absolute left-[11px] top-7 h-[calc(100%-24px)] w-0.5 rounded-full', item.done && items[i + 1]?.done ? 'bg-primary/50' : 'bg-border')} aria-hidden />}
            <span className={cn('relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', item.done ? fill : 'border-2 border-border bg-background', upNext && 'border-primary/50 ring-4 ring-primary/10')} aria-hidden>
              {item.done && (item.tone === 'danger' || item.tone === 'muted' ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />)}
            </span>
            <div className="min-w-0">
              <p className={cn('text-[15px] font-medium', !item.done && 'text-muted-foreground')}>
                {item.label}
                <span className="sr-only">{item.done ? ' — done' : ' — not yet'}</span>
              </p>
              {item.at ? <p className="text-sm text-muted-foreground">{mediumDateTime(item.at)}</p> : upNext ? <p className="text-sm text-muted-foreground">Up next</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
