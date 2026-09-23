import { CircleDollarSign } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { APPLICATION_STATUS_COLOR, COLORS, type ApplicationStatus } from '@project/shared/constants';
import type { Tone } from '@project/shared/tone';
import { useWorkspace } from '../../lib/workspace';
import { Tip } from '../primitives/bits';
import { APPLICATION_TONE, Pill, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { incomeRatio, incomeTone, type ScreeningCheck } from './rules';

/** Small leasing glyphs and chips, sized to sit in list rows and rails like the rest of the kit. */

const INQUIRY_GLYPH: Record<string, { as: string; color: string }> = {
  New: { as: 'New', color: COLORS.blue },
  Contacted: { as: 'In progress', color: COLORS.amber },
  'Showing scheduled': { as: 'Scheduled', color: COLORS.violet },
  Applied: { as: 'Completed', color: COLORS.green },
  Closed: { as: 'Canceled', color: COLORS.gray },
};

export function InquiryStatusGlyph({ status, size = 14 }: { status: string; size?: number }) {
  const g = INQUIRY_GLYPH[status] ?? INQUIRY_GLYPH.New;
  return <WorkOrderStatusGlyph status={g.as} color={g.color} size={size} />;
}

export const LISTING_TONE: Record<string, Tone> = { Draft: 'neutral', Published: 'success', Paused: 'warning', Leased: 'accent' };
const LISTING_DOT: Record<string, string> = { Draft: COLORS.gray, Published: COLORS.green, Paused: COLORS.amber, Leased: COLORS.teal };

export function ListingStatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <Pill tone={LISTING_TONE[status] ?? 'neutral'} dot={LISTING_DOT[status]} className={className}>
      {status === 'Published' ? 'Live' : status}
    </Pill>
  );
}

export function ApplicationStatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <Pill tone={APPLICATION_TONE[status as ApplicationStatus] ?? 'neutral'} dot={APPLICATION_STATUS_COLOR[status as ApplicationStatus]} className={className}>
      {status}
    </Pill>
  );
}

const TONE_TEXT: Record<string, string> = { success: 'text-tone-success', warning: 'text-tone-warning', danger: 'text-tone-danger', neutral: 'text-muted-foreground' };

/** "4.1×" coloured against the organization's income multiple, with the arithmetic in the tooltip. */
export function IncomeRatio({ income, rent, className, showIncome }: { income: number | null | undefined; rent: number | null | undefined; className?: string; showIncome?: boolean }) {
  const ws = useWorkspace();
  const multiple = ws.settings.incomeMultiple || 3;
  const ratio = incomeRatio(income, rent);
  const tone = incomeTone(ratio, multiple);
  const label = ratio == null ? (income ? ws.money(income, { cents: false }) : 'No income') : `${ratio.toFixed(1)}×`;
  return (
    <Tip label={ratio == null ? (rent ? 'No income reported' : 'No rent to compare against') : `${ws.money(income, { cents: false })}/mo household income is ${ratio.toFixed(1)}× the ${ws.money(rent, { cents: false })} rent. Your guideline is ${multiple}×.`}>
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm tabular-nums', className)}>
        {showIncome && income ? <span className="text-muted-foreground">{ws.money(income, { cents: false, compact: income >= 100_000 })}</span> : null}
        <span className={cn('font-medium', TONE_TEXT[tone])}>{label}</span>
      </span>
    </Tip>
  );
}

/** Six short bars: filled for each check with a result, amber/red where one raised a concern or failed. */
export function ScreeningMeter({ done, flags, total = 6, checks, className }: { done: number; flags: number; total?: number; checks?: ScreeningCheck[]; className?: string }) {
  const bars = checks
    ? checks.map(c => (c.result === 'Pending' ? 'bg-muted-foreground/20' : c.result === 'Fail' ? 'bg-tone-danger' : c.result === 'Concern' ? 'bg-tone-warning' : c.result === 'Waived' ? 'bg-tone-info/70' : 'bg-tone-success'))
    : Array.from({ length: total }, (_, i) => (i < done - flags ? 'bg-tone-success' : i < done ? 'bg-tone-warning' : 'bg-muted-foreground/20'));
  return (
    <Tip label={done === 0 ? 'Screening not started' : `${done} of ${total} checks done${flags ? ` · ${flags} flagged` : ''}`}>
      <span className={cn('inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground', className)}>
        <span className="flex items-center gap-[2px]" aria-hidden>
          {bars.map((b, i) => <span key={i} className={cn('h-2.5 w-[3px] rounded-full', b)} />)}
        </span>
        {done}/{total}
      </span>
    </Tip>
  );
}

export function FeeChip({ amount, paidAt, className }: { amount: number | null; paidAt: string | null; className?: string }) {
  const ws = useWorkspace();
  if (!amount) return null;
  return (
    <Tip label={paidAt ? `${ws.money(amount)} application fee paid` : `${ws.money(amount)} application fee not paid`}>
      <span className={cn('inline-flex items-center gap-1 text-sm', paidAt ? 'text-muted-foreground' : 'text-tone-warning', className)}>
        <CircleDollarSign className="h-3 w-3" />
        {paidAt ? 'Paid' : 'Unpaid'}
      </span>
    </Tip>
  );
}
