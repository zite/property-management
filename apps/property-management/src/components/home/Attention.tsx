import {
  CalendarClock, ChevronRight, CircleAlert, ClipboardList, ListChecks, MessageSquare, Receipt, ShieldAlert, ShieldQuestion, Truck, Wallet,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { shortDate, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { useListNav } from '../list/useListNav';
import { MemberAvatar } from '../primitives/Avatar';
import { Money, PropertyLabel } from '../primitives/data';
import { Pill, PriorityGlyph } from '../primitives/glyphs';
import { DueChip } from '../workOrders/WorkOrderRow';
import type { AttentionItem, AttentionSection } from './data';

const SECTION_ICON: Record<string, ReactNode> = {
  urgentWork: <CircleAlert />,
  myTasks: <ListChecks />,
  messages: <MessageSquare />,
  applications: <ClipboardList />,
  renewals: <CalendarClock />,
  moves: <Truck />,
  delinquent: <Wallet />,
  approvals: <ShieldQuestion />,
  bills: <Receipt />,
  insurance: <ShieldAlert />,
};

/** Which sections lead, by role: each person's first screen starts with their own work. */
const ORDER: Record<string, string[]> = {
  Admin: ['urgentWork', 'myTasks', 'messages', 'applications', 'renewals', 'moves', 'delinquent', 'approvals', 'bills', 'insurance'],
  'Property Manager': ['urgentWork', 'myTasks', 'messages', 'applications', 'renewals', 'moves', 'delinquent', 'approvals', 'bills', 'insurance'],
  'Leasing Agent': ['applications', 'renewals', 'moves', 'myTasks', 'messages', 'delinquent'],
  Maintenance: ['urgentWork', 'approvals', 'insurance', 'myTasks'],
  Accountant: ['delinquent', 'bills', 'myTasks', 'insurance'],
};

function When({ item }: { item: AttentionItem }) {
  if (!item.day) return null;
  const cls = 'whitespace-nowrap text-sm tabular-nums text-muted-foreground';
  switch (item.dayKind) {
    case 'due':
      return <DueChip day={item.day} className="text-sm" />;
    case 'ends':
      return <span className={cls}>Ends {shortDate(item.day)}</span>;
    case 'moveIn':
      return <span className={cls}>In {shortDate(item.day)}</span>;
    case 'moveOut':
      return <span className={cls}>Out {shortDate(item.day)}</span>;
    case 'expired':
      return <span className={cn(cls, 'text-tone-danger')}>Expired {shortDate(item.day)}</span>;
    case 'waiting':
      return <span className={cls}>{timeAgo(item.day)}</span>;
    default:
      return null;
  }
}

/**
 * The morning list: everything that needs someone today, grouped by why,
 * each row a direct link. J/K moves through every row across sections and ↵
 * opens it. Sections with nothing in them don't render.
 */
export function Attention({ sections, role }: { sections: AttentionSection[]; role: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const ordered = useMemo(() => {
    const order = ORDER[role] ?? ORDER.Admin;
    const sorted = [...sections].sort((a, b) => (order.indexOf(a.key) === -1 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) === -1 ? 99 : order.indexOf(b.key)));
    // The section that leads for this role gets room; the rest are three-row previews,
    // so ten sections read as a scannable page rather than one long list. `shown` is
    // also what the keyboard walks — slicing at render would let J/K reach hidden rows.
    return sorted.map((s, i) => ({ ...s, shown: s.items.slice(0, i === 0 ? 5 : 3) }));
  }, [sections, role]);
  const items = useMemo(() => ordered.flatMap(s => s.shown.map(i => ({ ...i, rowId: `${s.key}:${i.id}` }))), [ordered]);
  const nav = useListNav({ items, getId: (i: (typeof items)[number]) => i.rowId, onOpen: i => navigate(i.to), onPeek: i => navigate(i.to) });

  return (
    <div ref={nav.scrollRef} className="space-y-3">
      {ordered.map(section => (
        <section key={section.key} className="overflow-hidden rounded-lg border bg-card shadow-2xs" aria-label={section.title}>
          <header className="flex h-10 items-center gap-2 border-b px-3">
            <span className="flex text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{SECTION_ICON[section.key]}</span>
            <h3 className="truncate text-[14px] font-medium">{section.title}</h3>
            <span className="text-sm tabular-nums text-muted-foreground">{section.total}</span>
            {section.to && (
              <Link to={section.to} className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                {section.total > section.shown.length ? `View all ${section.total}` : 'View all'} <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </header>
          <ul>
            {section.shown.map(item => {
              const rowId = `${section.key}:${item.id}`;
              const focused = nav.focusedId === rowId;
              const member = item.memberId ? ws.memberById.get(item.memberId) : undefined;
              return (
                <li key={rowId} data-row-id={rowId}>
                  <Link
                    to={item.to}
                    onMouseMove={() => !focused && nav.setFocusedId(rowId)}
                    className={cn('relative flex min-h-10 items-center gap-2.5 border-b border-border/60 px-3 py-1.5 text-[14px] last:border-b-0 hover:bg-accent/50', focused && 'bg-accent/70')}
                  >
                    {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
                    {item.priority && <PriorityGlyph priority={item.priority} className="shrink-0" />}
                    <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                      <span className="block truncate font-medium sm:shrink-0 sm:max-w-[60%]">{item.title}</span>
                      {item.meta && <span className="block truncate text-sm text-muted-foreground sm:text-[13.5px]">{item.meta}</span>}
                    </span>
                    {(item.unitId || item.propertyId) && <PropertyLabel propertyId={item.propertyId} unitId={item.unitId} className="hidden max-w-[180px] text-sm text-muted-foreground lg:inline-flex" />}
                    {item.badge && <Pill tone={item.badge.tone} className="hidden sm:inline-flex">{item.badge.label}</Pill>}
                    {item.amount != null && <Money value={item.amount} className="shrink-0 text-[14px] font-medium" />}
                    <span className="shrink-0"><When item={item} /></span>
                    {member && <MemberAvatar member={member} size={18} className="hidden sm:inline-flex" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
