import { CornerDownLeft, HandCoins, Link2, LogOut, MessageSquare, Repeat, SquareArrowOutUpRight } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@project/components/ui/context-menu';
import { cn } from '@project/components/lib/utils';
import type { LeasePhase } from '@project/shared/constants';
import { leaseRef } from '@project/shared/leases';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { endOfMonth, format } from 'date-fns';
import { appUrl, fullDate, parseDay, shortDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { RowShell } from '../list/GroupedList';
import { Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { LeasePhasePill, Pill, PropertySwatch } from '../primitives/glyphs';
import { composeRecipients, residentNames, type LeaseRow as Lease } from './data';

/** "16 days", "Ends today", "Ended 3 days ago" — how long a lease has left, coloured as it gets close. */
export function ExpiryChip({ lease, className }: { lease: Pick<Lease, 'daysToEnd' | 'endDate' | 'leaseType' | 'status' | 'moveOutDate' | 'phase'>; className?: string }) {
  const ws = useWorkspace();
  if (lease.status === 'Ended' || lease.status === 'Canceled') return <span className={cn('text-sm text-muted-foreground', className)}>{lease.status === 'Ended' && lease.moveOutDate ? `Out ${shortDate(lease.moveOutDate)}` : '—'}</span>;
  if (lease.phase === 'Notice' && lease.moveOutDate) {
    const days = Math.round((Date.parse(lease.moveOutDate) - Date.parse(ws.today)) / 86_400_000);
    return (
      <Tip label={`Moving out ${fullDate(lease.moveOutDate)}`}>
        <span className={cn('whitespace-nowrap text-sm tabular-nums text-tone-warning', className)}>{days <= 0 ? 'Out today' : `Out in ${days}d`}</span>
      </Tip>
    );
  }
  if (lease.leaseType === 'Month-to-month' || lease.daysToEnd == null) return <span className={cn('whitespace-nowrap text-sm text-muted-foreground', className)}>Month-to-month</span>;
  const d = lease.daysToEnd;
  const tone = d < 0 ? 'text-muted-foreground' : d <= 30 ? 'text-tone-danger' : d <= (ws.settings.renewalNoticeDays || 60) ? 'text-tone-warning' : 'text-muted-foreground';
  return (
    <Tip label={lease.endDate ? `Ends ${fullDate(lease.endDate)}` : 'No end date'}>
      <span className={cn('whitespace-nowrap text-sm tabular-nums', tone, className)}>{d < 0 ? `Ended ${-d}d ago` : d === 0 ? 'Ends today' : d > 365 ? `${Math.round(d / 30)} mo` : `${d} days`}</span>
    </Tip>
  );
}

export function RenewalPill({ lease }: { lease: Pick<Lease, 'renewalStatus' | 'renewalRent' | 'renewalExpiresOn'> }) {
  const ws = useWorkspace();
  if (lease.renewalStatus === 'Offered') {
    const expired = lease.renewalExpiresOn && lease.renewalExpiresOn < ws.today;
    return (
      <Tip label={expired ? `Offer expired ${shortDate(lease.renewalExpiresOn)}` : lease.renewalExpiresOn ? `Open until ${shortDate(lease.renewalExpiresOn)}` : 'Waiting on the residents'}>
        <span><Pill tone={expired ? 'danger' : 'accent'}><Repeat className="h-3 w-3" /> {expired ? 'Offer expired' : 'Offered'}{lease.renewalRent ? ` · ${ws.money(lease.renewalRent, { cents: false })}` : ''}</Pill></span>
      </Tip>
    );
  }
  if (lease.renewalStatus === 'Accepted') return <Pill tone="success"><Repeat className="h-3 w-3" /> Renewed</Pill>;
  if (lease.renewalStatus === 'Declined') return <Pill tone="neutral">Not renewing</Pill>;
  return null;
}

/** "Oct ’25 – Sep ’26" for whole-month terms, "Jun 15 ’26 – Jun 14 ’27" otherwise, "Since Mar ’24" when month-to-month. */
export function termText(l: Pick<Lease, 'startDate' | 'endDate' | 'leaseType'>) {
  if (!l.startDate) return '';
  const my = (d: string) => format(parseDay(d), 'MMM ’yy');
  const mdy = (d: string) => format(parseDay(d), 'MMM d ’yy');
  if (l.leaseType === 'Month-to-month' || !l.endDate) return `Since ${my(l.startDate)}`;
  const wholeMonths = l.startDate.endsWith('-01') && format(parseDay(l.endDate), 'yyyy-MM-dd') === format(endOfMonth(parseDay(l.endDate)), 'yyyy-MM-dd');
  return wholeMonths ? `${my(l.startDate)} – ${my(l.endDate)}` : `${mdy(l.startDate)} – ${mdy(l.endDate)}`;
}

type RowProps = {
  lease: Lease;
  properties: Set<string>;
  hidePhase: boolean;
  hideProperty: boolean;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  onClick: (l: Lease, e: MouseEvent) => void;
  onHover: (l: Lease) => void;
  onToggleSelect: (l: Lease, e: MouseEvent) => void;
  targetsFor: (l: Lease) => Lease[];
  onRenew: (targets: Lease[]) => void;
};

function LeaseRowInner({ lease: l, properties, hidePhase, hideProperty, selected, focused, selecting, onClick, onHover, onToggleSelect, targetsFor, onRenew }: RowProps) {
  const ws = useWorkspace();
  const has = (k: string) => properties.has(k);
  const property = l.propertyId ? ws.propertyById.get(l.propertyId) : undefined;
  const closed = l.status === 'Ended' || l.status === 'Canceled';
  const names = residentNames(l);
  const singleUnit = (ws.unitsByProperty.get(l.propertyId ?? '')?.length ?? 0) <= 1;
  return (
    <RowShell id={l.id} selected={selected} focused={focused} selecting={selecting} onClick={e => onClick(l, e)} onHover={() => onHover(l)} onToggleSelect={e => onToggleSelect(l, e)} muted={l.status === 'Canceled'} menu={<LeaseMenu targets={targetsFor(l)} onRenew={onRenew} />}>
      {has('number') && <span className="hidden w-[52px] shrink-0 whitespace-nowrap text-[13.5px] tabular-nums text-muted-foreground sm:inline">{leaseRef(l.number)}</span>}
      {!hidePhase && <LeasePhasePill phase={l.phase as LeasePhase} className="hidden sm:inline-flex" />}
      {/* Grouped by property, a single-unit home needs no unit label: the group header already names it. */}
      {!(hideProperty && singleUnit) && (
        <span className="flex min-w-0 max-w-[55%] shrink-0 items-center gap-1.5">
          {!hideProperty && <PropertySwatch color={property?.color} />}
          <span className={cn('truncate font-medium', l.status === 'Canceled' && 'line-through decoration-muted-foreground/50')}>{hideProperty && l.unitId ? ws.unitById.get(l.unitId)?.name ?? ws.unitLabel(l.unitId, l.propertyId) : ws.unitLabel(l.unitId, l.propertyId)}</span>
        </span>
      )}
      {(has('residents') || (hideProperty && singleUnit)) && <span className={cn('min-w-0 truncate', hideProperty && singleUnit ? 'font-medium' : 'text-[13.5px] text-muted-foreground')}>{names || 'No residents'}</span>}
      <span className="min-w-4 flex-1" />
      {has('renewal') && !closed && <span className="hidden shrink-0 md:inline-flex"><RenewalPill lease={l} /></span>}
      {has('term') && <span className="hidden w-[150px] shrink-0 truncate text-right text-sm tabular-nums text-muted-foreground xl:inline">{termText(l)}</span>}
      {has('expiry') && <ExpiryChip lease={l} className="hidden w-[92px] shrink-0 text-right md:inline" />}
      {has('rent') && <span className="hidden w-[76px] shrink-0 text-right text-[13.5px] lg:inline"><Money value={l.rent} cents={l.rent % 1 !== 0} /></span>}
      {has('balance') && (
        <span className="w-[84px] shrink-0 text-right text-[13.5px]">
          {closed && Math.abs(l.balance) < 0.005 ? <span className="text-muted-foreground/70">—</span> : <Money value={l.balance} tone="balance" muted0 />}
        </span>
      )}
      {has('deposit') && (
        <Tip label={l.deposit ? `${ws.money(l.deposit)} required` : 'No deposit required'}>
          <span className="hidden w-[76px] shrink-0 text-right text-[13.5px] text-muted-foreground xl:inline"><Money value={l.depositHeld} muted0 cents={l.depositHeld % 1 !== 0} /></span>
        </Tip>
      )}
    </RowShell>
  );
}

export const LeaseListRow = memo(LeaseRowInner);

const item = 'h-9 gap-2 text-[14px]';

/** Right-click on a lease row. Acts on the selection when the row is part of it. */
export function LeaseMenu({ targets, onRenew }: { targets: Lease[]; onRenew: (targets: Lease[]) => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  if (!targets.length) return null;
  const single = targets.length === 1 ? targets[0] : null;
  const renewable = targets.filter(l => l.status === 'Active' && !l.moveOutDate);
  const recipients = composeRecipients(targets);
  return (
    <div onClick={e => e.stopPropagation()}>
      {!single && <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{targets.length} leases selected</div>}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => navigate(`/leases/${single.id}`)}>
            <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut><CornerDownLeft className="h-3 w-3" /></ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      {ws.can('communications.send') && (
        <ContextMenuItem className={item} disabled={!recipients.length} onSelect={() => app.openCompose({ recipients, context: single ? { leaseId: single.id, propertyId: single.propertyId ?? undefined } : undefined })}>
          <MessageSquare className="h-3.5 w-3.5" /> Message residents <ContextMenuShortcut>M</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuItem className={item} disabled={!renewable.length} onSelect={() => onRenew(renewable)}>
        <Repeat className="h-3.5 w-3.5" /> Offer renewal{renewable.length > 1 ? `s (${renewable.length})` : ''} <ContextMenuShortcut>R</ContextMenuShortcut>
      </ContextMenuItem>
      {single && single.status === 'Active' && !single.moveOutDate && (
        <ContextMenuItem className={item} onSelect={() => navigate(`/leases/${single.id}/overview?notice=1`)}>
          <LogOut className="h-3.5 w-3.5" /> Record notice…
        </ContextMenuItem>
      )}
      {single && ws.can('receivables.manage') && single.status !== 'Draft' && single.status !== 'Canceled' && (
        <ContextMenuItem className={item} onSelect={() => app.openCreate('payment', { leaseId: single.id })}>
          <HandCoins className="h-3.5 w-3.5" /> Receive payment
        </ContextMenuItem>
      )}
      {single && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem className={item} onSelect={() => void copyText(appUrl(`/leases/${single.id}`), 'Link copied')}>
            <Link2 className="h-3.5 w-3.5" /> Copy link
          </ContextMenuItem>
        </>
      )}
    </div>
  );
}
