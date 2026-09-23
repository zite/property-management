import { Check } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { APPLY_STEPS, type StepId } from '../../lib/applyRules';

export type StepState = 'current' | 'done' | 'attention' | 'todo' | 'locked';

/** The application's steps as a vertical list: done ones ticked, ones needing a fix marked, the current one highlighted. */
export function StepList({ states, onSelect }: { states: Record<StepId, StepState>; onSelect: (step: StepId) => void }) {
  return (
    <ol className="space-y-0.5">
      {APPLY_STEPS.map((s, i) => {
        const state = states[s.id];
        const current = state === 'current';
        return (
          <li key={s.id}>
            <button
              type="button"
              disabled={state === 'locked'}
              aria-current={current ? 'step' : undefined}
              onClick={() => onSelect(s.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-default',
                current ? 'bg-primary/[0.08] font-semibold text-foreground' : state === 'locked' ? 'text-muted-foreground' : 'text-foreground hover:bg-accent',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  state === 'done' && 'bg-tone-success text-white dark:text-[hsl(240_10%_6%)]',
                  state === 'current' && 'bg-primary text-primary-foreground',
                  state === 'attention' && 'border-2 border-tone-warning bg-tone-warning/10 text-tone-warning',
                  (state === 'todo' || state === 'locked') && 'border border-border bg-background text-muted-foreground',
                )}
                aria-hidden
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === 'attention' ? '!' : i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <span className="sr-only">{state === 'done' ? ' (complete)' : state === 'attention' ? ' (needs attention)' : current ? ' (current step)' : ''}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
