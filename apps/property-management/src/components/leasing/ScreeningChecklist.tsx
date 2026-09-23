import { Check, CircleMinus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { SCREENING_RESULTS } from '@project/shared/constants';
import { dateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Tip } from '../primitives/bits';
import { useApplicationActions } from './data';
import { type ScreeningCheck, type ScreeningResult } from './rules';

const RESULT_META: Record<ScreeningResult, { label: string; icon: React.ReactNode; on: string }> = {
  Pending: { label: 'Pending', icon: <span className="h-1.5 w-1.5 rounded-full bg-current" />, on: 'bg-muted text-foreground' },
  Pass: { label: 'Passed', icon: <Check className="h-3 w-3" strokeWidth={3} />, on: 'bg-tone-success/10 text-tone-success border-tone-success/30' },
  Concern: { label: 'Flagged', icon: <TriangleAlert className="h-3 w-3" />, on: 'bg-tone-warning/10 text-tone-warning border-tone-warning/30' },
  Fail: { label: 'Failed', icon: <X className="h-3 w-3" strokeWidth={3} />, on: 'bg-tone-danger/10 text-tone-danger border-tone-danger/30' },
  Waived: { label: 'Waived', icon: <CircleMinus className="h-3 w-3" />, on: 'bg-tone-info/10 text-tone-info border-tone-info/30' },
};

function NoteInput({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      onChange={e => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onSave(text.trim())}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      maxLength={1000}
      placeholder={disabled ? '' : 'Add a note — what you checked, who you spoke to'}
      className="h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-[13.5px] text-muted-foreground outline-none placeholder:text-muted-foreground/60 hover:border-input focus:border-ring focus:bg-background focus:text-foreground disabled:hover:border-transparent"
    />
  );
}

/**
 * The same six checks for every applicant. Each result saves as you click it
 * (with who and when); notes save when you leave the field. Recording the
 * first result moves a Submitted application into Screening.
 */
export function ScreeningChecklist({ application, locked }: { application: { id: string; number: number | null; screening: ScreeningCheck[] }; locked?: boolean }) {
  const ws = useWorkspace();
  const { screen } = useApplicationActions();
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-2xs">
      {application.screening.map(c => {
        const by = c.byId ? ws.memberById.get(c.byId)?.name ?? c.byName : c.byName;
        return (
          <div key={c.key} className="border-b px-3 py-2 last:border-b-0 sm:px-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', c.result === 'Pending' ? 'border-dashed text-muted-foreground' : RESULT_META[c.result].on)}>{c.result === 'Pending' ? null : RESULT_META[c.result].icon}</span>
              <span className="min-w-0 flex-1 text-[14px] font-medium">{c.label}</span>
              <div role="radiogroup" aria-label={c.label} className="flex items-center gap-0.5">
                {SCREENING_RESULTS.filter(r => r !== 'Pending').map(r => {
                  const on = c.result === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={locked}
                      onClick={() => void screen(application, c.key, on ? 'Pending' : r).catch(() => undefined)}
                      className={cn('inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-60', on ? RESULT_META[r].on : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground')}
                    >
                      {on && RESULT_META[r].icon}
                      {RESULT_META[r].label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 pl-8">
              <NoteInput value={c.note} disabled={locked} onSave={note => void screen(application, c.key, c.result, note).catch(() => undefined)} />
              {c.at && c.result !== 'Pending' && (
                <Tip label={dateTime(c.at)}>
                  <span className="shrink-0 whitespace-nowrap text-sm text-faint">{by ? `${by.split(' ')[0]} · ` : ''}{timeAgo(c.at)}</span>
                </Tip>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
