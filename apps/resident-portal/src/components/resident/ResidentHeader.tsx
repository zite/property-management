import { Check, ChevronDown, Home } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { shortDate } from '../../lib/format';
import { useResidentLease } from '../../lib/residentLease';
import { BackLink, Container } from '../ui';

/**
 * The top of every resident page: a way back, the page title, which home it's
 * about — and, for someone on more than one lease, the switcher between them.
 */
export function ResidentHeader({ title, subtitle, back, actions, eyebrow, className }: { title: ReactNode; subtitle?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <Container className={cn('pb-2 pt-6 sm:pt-8', className)}>
      {back && (
        <div className="mb-3">
          <BackLink to={back.to}>{back.label}</BackLink>
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <div className="mt-1.5 text-[15px] text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </Container>
  );
}

const statusWord = (status: string, startDate: string | null, moveOutDate: string | null) => {
  if (status === 'Pending signature') return 'To sign';
  if (status === 'Ended') return moveOutDate ? `Ended ${shortDate(moveOutDate)}` : 'Past lease';
  if (startDate && startDate > new Date().toISOString().slice(0, 10)) return `Starts ${shortDate(startDate)}`;
  return 'Current';
};

/** The home this page is about, as a quiet line — or a menu when the resident has more than one lease. */
export function LeaseSwitcher({ className }: { className?: string }) {
  const { lease, leases, choose } = useResidentLease();
  if (!lease) return null;
  const label = [lease.propertyName, lease.unitName].filter(Boolean).join(' ');
  if (leases.length < 2) {
    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[15px] text-muted-foreground', className)}>
        <Home className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            '-ml-2 inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 text-[15px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
            className,
          )}
          aria-label={`Showing ${label}. Switch lease`}
        >
          <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">Your leases</DropdownMenuLabel>
        {leases.map(l => (
          <DropdownMenuItem key={l.id} onSelect={() => choose(l.id)} className="gap-2.5 rounded-lg px-2.5 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{[l.propertyName, l.unitName].filter(Boolean).join(' ')}</span>
              <span className="block text-xs text-muted-foreground">{statusWord(l.status, l.startDate, l.moveOutDate)}</span>
            </span>
            {l.id === lease.id && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Showing" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
