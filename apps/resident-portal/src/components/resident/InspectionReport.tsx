import { ChevronDown, ClipboardCheck, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@project/components/lib/utils';
import { longDate, mediumDateTime, shortDate } from '../../lib/format';
import { CONDITION_TONE } from '../../lib/residentFormat';
import type { ResidentLeaseDetail } from '../../lib/residentQueries';
import { Button, StatusPill } from '../ui';

type Inspection = ResidentLeaseDetail['inspections'][number];

/**
 * An inspection report the office shared: overall condition, then room by
 * room, with anything less than good called out first so it's easy to check
 * against what the resident sees.
 */
export function InspectionReport({ inspection: i, onAcknowledge, acknowledging }: { inspection: Inspection; onAcknowledge: () => void; acknowledging: boolean }) {
  const [open, setOpen] = useState(!i.acknowledgedAt && i.status === 'Completed');
  const items = i.areas.flatMap(a => a.items);
  const rated = items.filter(it => it.condition && it.condition !== 'N/A');
  const issues = rated.filter(it => ['Poor', 'Damaged', 'Missing'].includes(it.condition!));
  const fair = rated.filter(it => it.condition === 'Fair');

  if (i.status !== 'Completed') {
    return (
      <div className="flex items-start gap-3 rounded-xl border px-4 py-3.5">
        <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-[15px] font-medium">{i.type} inspection scheduled</p>
          <p className="text-sm text-muted-foreground">{i.scheduledFor ? mediumDateTime(i.scheduledFor) : 'Date to be confirmed'} · We’ll share the report here when it’s done.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-accent/40 focus-visible:bg-accent/50 focus-visible:outline-none">
        <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium">
            {i.type} inspection
            {i.overallCondition && <StatusPill tone={CONDITION_TONE[i.overallCondition] ?? 'neutral'} className="h-6">{i.overallCondition}</StatusPill>}
          </p>
          <p className="text-sm text-muted-foreground">
            {i.completedAt ? `Completed ${longDate(i.completedAt.slice(0, 10))}` : 'Completed'} · {rated.length} items checked
            {issues.length ? ` · ${issues.length} need attention` : ''}
          </p>
          <p className={cn('mt-1 text-sm', i.acknowledgedAt ? 'text-tone-success' : 'font-medium text-tone-warning')}>{i.acknowledgedAt ? `You acknowledged this ${shortDate(i.acknowledgedAt.slice(0, 10))}` : 'Waiting for you to review'}</p>
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div className="border-t px-4 py-4">
          {i.summary && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{i.summary}</p>}
          {(issues.length > 0 || fair.length > 0) && (
            <div className="mt-3 rounded-lg bg-tone-warning/[0.06] px-3.5 py-3">
              <p className="text-sm font-medium">Noted in the report</p>
              <ul className="mt-1 space-y-1 text-[15px]">
                {[...issues, ...fair].map(it => (
                  <li key={it.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{i.areas.find(a => a.items.some(x => x.id === it.id))?.name} · {it.name}</span>
                    <span className="text-sm text-muted-foreground">{it.condition}{it.notes ? ` — ${it.notes}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {i.areas.map(a => (
              <div key={a.id}>
                <h4 className="text-sm font-semibold">{a.name}</h4>
                <ul className="mt-1.5 divide-y rounded-lg border">
                  {a.items.map(it => (
                    <li key={it.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 text-[15px]">{it.name}</span>
                        {it.condition ? <StatusPill tone={CONDITION_TONE[it.condition] ?? 'neutral'} className="h-6" dot={false}>{it.condition}</StatusPill> : <span className="text-sm text-muted-foreground">Not checked</span>}
                      </div>
                      {it.notes && <p className="mt-0.5 text-sm text-muted-foreground">{it.notes}</p>}
                      {it.photos.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {it.photos.map(p => (
                            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-md border">
                              <img src={p.url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {i.reportUrl ? (
              <a href={i.reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-medium text-primary hover:underline">
                <ExternalLink className="h-4 w-4" aria-hidden /> Open the PDF report
              </a>
            ) : (
              <span />
            )}
            {!i.acknowledgedAt && (
              <div className="sm:text-right">
                <Button variant="ink" onClick={onAcknowledge} loading={acknowledging} className="w-full sm:w-auto">
                  I’ve reviewed this report
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">If something doesn’t match what you see, message the office too.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
