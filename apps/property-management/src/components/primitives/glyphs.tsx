import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import {
  APPLICATION_STATUS_COLOR, COLORS, LEASE_PHASE_COLOR, OCCUPANCY_COLOR, PRIORITY_COLOR, WORK_ORDER_STATUS_COLOR,
  type ApplicationStatus, type LeasePhase, type Occupancy, type WorkOrderPriority, type WorkOrderStatus,
} from '@project/shared/constants';
import type { Tone } from '@project/shared/tone';

/**
 * The small drawn glyphs that make lists scannable at a glance — status as a
 * ring that fills, priority as signal bars, occupancy as a house. Each is
 * sized to sit in a 16px slot and uses mid-tone colours that read in both themes.
 */

export function WorkOrderStatusGlyph({ status, size = 14, className, color: override }: { status: WorkOrderStatus | string; size?: number; className?: string; color?: string }) {
  const color = override ?? WORK_ORDER_STATUS_COLOR[status as WorkOrderStatus] ?? COLORS.gray;
  const s = size;
  const c = s / 2;
  const r = s / 2 - 1.25;
  const common = { width: s, height: s, viewBox: `0 0 ${s} ${s}`, className: cn('shrink-0', className), 'aria-hidden': true } as const;
  switch (status) {
    case 'New':
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2.2 1.8" />
        </svg>
      );
    case 'Scheduled':
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <path d={`M${c} ${c - r + 2.2} V${c} L${c + r * 0.45} ${c + r * 0.3}`} stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" />
        </svg>
      );
    case 'In progress':
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <path d={`M${c} ${c} L${c} ${c - r + 2} A${r - 2} ${r - 2} 0 0 1 ${c} ${c + r - 2} Z`} fill={color} />
        </svg>
      );
    case 'On hold':
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} />
          <path d={`M${c - 1.6} ${c - 2.2} V${c + 2.2} M${c + 1.6} ${c - 2.2} V${c + 2.2}`} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      );
    case 'Completed':
      return (
        <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)} style={{ width: s, height: s, background: color }} aria-hidden>
          <Check style={{ width: s * 0.66, height: s * 0.66 }} className="text-white" strokeWidth={3.2} />
        </span>
      );
    case 'Canceled':
      return (
        <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)} style={{ width: s, height: s, background: color }} aria-hidden>
          <X style={{ width: s * 0.62, height: s * 0.62 }} className="text-white" strokeWidth={3.2} />
        </span>
      );
    default:
      return (
        <svg {...common}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      );
  }
}

/** Signal bars; an emergency is a filled red square with an exclamation mark. */
export function PriorityGlyph({ priority, size = 14, className }: { priority: WorkOrderPriority | string; size?: number; className?: string }) {
  if (priority === 'Emergency') {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[3px] text-[11px] font-bold leading-none text-white', className)} style={{ width: size, height: size, background: PRIORITY_COLOR.Emergency }} aria-hidden>
        !
      </span>
    );
  }
  const level = priority === 'High' ? 3 : priority === 'Normal' ? 2 : priority === 'Low' ? 1 : 0;
  const bar = (i: number) => (i < level ? 'currentColor' : 'currentColor');
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={cn('shrink-0', level >= 3 ? 'text-foreground' : 'text-muted-foreground', className)} aria-hidden>
      {[0, 1, 2].map(i => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width={3} height={3.5 + i * 3} rx={0.8} fill={bar(i)} opacity={i < level ? 1 : 0.25} />
      ))}
    </svg>
  );
}

/** A small house: filled when occupied, half when on notice, outlined when vacant. */
export function OccupancyGlyph({ occupancy, size = 14, className }: { occupancy: Occupancy | string; size?: number; className?: string }) {
  const color = OCCUPANCY_COLOR[occupancy as Occupancy] ?? COLORS.gray;
  const house = 'M2.5 6.4 7 2.5l4.5 3.9V11a.9.9 0 0 1-.9.9H3.4a.9.9 0 0 1-.9-.9Z';
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <clipPath id="ks-house-half">
          <rect x="0" y="0" width="7" height="14" />
        </clipPath>
      </defs>
      <path d={house} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      {occupancy === 'Occupied' && <path d={house} fill={color} />}
      {occupancy === 'Notice' && <path d={house} fill={color} clipPath="url(#ks-house-half)" />}
    </svg>
  );
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-tone-info/10 text-tone-info',
  accent: 'bg-tone-accent/10 text-tone-accent',
  success: 'bg-tone-success/10 text-tone-success',
  warning: 'bg-tone-warning/10 text-tone-warning',
  danger: 'bg-tone-danger/10 text-tone-danger',
};

/** A compact status pill. Use tones, never raw colours, so both themes pass contrast. */
export function Pill({ tone = 'neutral', children, className, dot, title }: { tone?: Tone; children: ReactNode; className?: string; dot?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-1.5 text-[12.5px] font-medium leading-none', TONE_CLASSES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  );
}

export const LEASE_PHASE_TONE: Record<LeasePhase, Tone> = {
  Draft: 'neutral',
  'Pending signature': 'accent',
  Upcoming: 'info',
  Current: 'success',
  Expiring: 'warning',
  Notice: 'warning',
  'Month-to-month': 'info',
  Ended: 'neutral',
  Canceled: 'neutral',
};

export function LeasePhasePill({ phase, className }: { phase: LeasePhase; className?: string }) {
  return (
    <Pill tone={LEASE_PHASE_TONE[phase]} dot={LEASE_PHASE_COLOR[phase]} className={className}>
      {phase}
    </Pill>
  );
}

export const APPLICATION_TONE: Record<ApplicationStatus, Tone> = {
  Draft: 'neutral',
  Submitted: 'info',
  Screening: 'warning',
  Approved: 'success',
  Denied: 'danger',
  Withdrawn: 'neutral',
  Leased: 'accent',
};

export function ApplicationStatusGlyph({ status, size = 14 }: { status: ApplicationStatus | string; size?: number }) {
  const color = APPLICATION_STATUS_COLOR[status as ApplicationStatus] ?? COLORS.gray;
  const map: Record<string, WorkOrderStatus> = { Draft: 'New', Submitted: 'Scheduled', Screening: 'In progress', Approved: 'Completed', Leased: 'Completed', Denied: 'Canceled', Withdrawn: 'Canceled' };
  return <WorkOrderStatusGlyph status={map[status] ?? 'New'} size={size} color={color} />;
}

/** Task checkbox-circle: outlined, half (in progress), checked, crossed. */
export function TaskStatusGlyph({ status, size = 15 }: { status: string; size?: number }) {
  if (status === 'To do') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 1.25} fill="none" stroke={COLORS.gray} strokeWidth={1.5} />
      </svg>
    );
  }
  const map: Record<string, WorkOrderStatus> = { 'In progress': 'In progress', Done: 'Completed', Canceled: 'Canceled' };
  return <WorkOrderStatusGlyph status={map[status] ?? 'New'} size={size} />;
}

export function PropertySwatch({ color, size = 8, className }: { color: string | null | undefined; size?: number; className?: string }) {
  return <span className={cn('inline-block shrink-0 rounded-[3px]', className)} style={{ width: size, height: size, background: color || COLORS.gray }} aria-hidden />;
}
