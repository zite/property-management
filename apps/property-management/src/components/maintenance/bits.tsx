import { FileWarning, ShieldAlert, ShieldCheck, ShieldX, Star } from 'lucide-react';
import { cn } from '@project/components/lib/utils';
import { shortDate } from '../../lib/format';
import { Tip } from '../primitives/bits';
import { Pill, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { CONDITION_TONE, INSURANCE_LABEL, INSURANCE_TONE, type InsuranceStatus, type VendorRow } from './data';

/** A vendor's initial on its colour — how a vendor appears in lists. */
export function VendorGlyph({ name, color, size = 20, className }: { name: string; color: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold leading-none text-white', className)}
      style={{ width: size, height: size, background: color || '#64748b', fontSize: Math.round(size * 0.5) }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

const INSURANCE_ICON: Record<InsuranceStatus, typeof ShieldCheck> = { Valid: ShieldCheck, Expiring: ShieldAlert, Expired: ShieldX, Missing: ShieldX, 'Not required': ShieldCheck };

/** Certificate of insurance status: Valid / Expires soon / Expired / Missing, with the date in the tooltip. */
export function InsurancePill({ status, expiresOn, className, compact }: { status: InsuranceStatus; expiresOn: string | null; className?: string; compact?: boolean }) {
  if (status === 'Not required') return <span className={cn('text-sm text-muted-foreground', className)}>Not required</span>;
  const Icon = INSURANCE_ICON[status];
  const label = status === 'Expiring' && expiresOn && !compact ? `Expires ${shortDate(expiresOn)}` : status === 'Expired' && expiresOn && !compact ? `Expired ${shortDate(expiresOn)}` : INSURANCE_LABEL[status];
  const tip = status === 'Missing' ? 'No certificate of insurance on file' : expiresOn ? `Certificate of insurance ${status === 'Expired' ? 'expired' : 'expires'} ${shortDate(expiresOn)}` : INSURANCE_LABEL[status];
  return (
    <Tip label={tip}>
      <span className={className}>
        <Pill tone={INSURANCE_TONE[status]}>
          <Icon className="h-3 w-3" /> {compact ? INSURANCE_LABEL[status] : label}
        </Pill>
      </span>
    </Tip>
  );
}

/** Insurance, plus W-9 and 1099 flags, in one row. */
export function ComplianceChips({ vendor, compact }: { vendor: Pick<VendorRow, 'compliance' | 'insuranceExpiresOn' | 'is1099' | 'w9OnFile'>; compact?: boolean }) {
  const c = vendor.compliance;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <InsurancePill status={c.insurance} expiresOn={vendor.insuranceExpiresOn} compact={compact} />
      {c.w9Missing && (
        <Tip label={c.w9PendingReview ? 'The vendor uploaded a W-9 — check it and mark it on file' : 'A 1099 vendor with no W-9 on file'}>
          <span><Pill tone="warning"><FileWarning className="h-3 w-3" /> {c.w9PendingReview ? 'W-9 to review' : 'No W-9'}</Pill></span>
        </Tip>
      )}
      {c.coiPendingReview && !compact && (
        <Tip label={`A newer certificate${c.pendingCoiExpiresOn ? ` (expires ${shortDate(c.pendingCoiExpiresOn)})` : ''} is waiting for review`}>
          <span><Pill tone="info">COI to review</Pill></span>
        </Tip>
      )}
    </span>
  );
}

export function Rating({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={cn('text-sm text-muted-foreground/70', className)}>—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm tabular-nums', className)}>
      <Star className="h-3 w-3 fill-current text-tone-warning" />
      {value.toFixed(1)}
    </span>
  );
}

export function ConditionPill({ condition, className }: { condition: string | null | undefined; className?: string }) {
  if (!condition) return <span className={cn('text-sm text-muted-foreground', className)}>Not checked</span>;
  return <Pill tone={CONDITION_TONE[condition] ?? 'neutral'} className={className}>{condition}</Pill>;
}

const INSPECTION_GLYPH: Record<string, string> = { Scheduled: 'Scheduled', 'In progress': 'In progress', Completed: 'Completed', Canceled: 'Canceled' };
export function InspectionStatusGlyph({ status, size = 14 }: { status: string; size?: number }) {
  return <WorkOrderStatusGlyph status={INSPECTION_GLYPH[status] ?? 'New'} size={size} />;
}
