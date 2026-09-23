import {
  BarChart3, Building2, Check, ClipboardCheck, Command as CommandIcon, ExternalLink, Hammer, Home, Inbox, Keyboard, KeyRound, Laptop, ListChecks, Megaphone, MessageSquare, Moon, Settings, Sun, UserPlus, UserRound, Users, Wallet, Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@project/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import type { Capability } from '@project/shared/roles';
import { useAppActions } from '../../lib/app-actions';
import { useSearch } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { useWorkspace } from '../../lib/workspace';
import { ApplicationStatusGlyph, OccupancyGlyph, PriorityGlyph, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { Kbd } from '../primitives/bits';
import { CREATE_MENU } from './Sidebar';

const itemCls = 'h-9 gap-2.5 rounded-md px-2.5 text-[14px] [&_svg]:text-muted-foreground';

export const NAV: Array<{ label: string; to: string; icon: typeof Home; keys: string[]; capability?: Capability }> = [
  { label: 'Home', to: '/home', icon: Home, keys: ['G', 'H'] },
  { label: 'Inbox', to: '/inbox', icon: Inbox, keys: ['G', 'I'] },
  { label: 'My tasks', to: '/tasks', icon: ListChecks, keys: ['G', 'T'] },
  { label: 'Messages', to: '/messages', icon: MessageSquare, keys: ['G', 'M'], capability: 'communications.send' },
  { label: 'Work orders', to: '/work-orders', icon: Wrench, keys: ['G', 'W'], capability: 'maintenance.create' },
  { label: 'Inspections', to: '/inspections', icon: ClipboardCheck, keys: [], capability: 'maintenance.manage' },
  { label: 'Vendors', to: '/vendors', icon: Hammer, keys: ['G', 'V'], capability: 'vendors.manage' },
  { label: 'Leasing', to: '/leasing', icon: UserPlus, keys: ['G', 'A'], capability: 'leasing.manage' },
  { label: 'Leases', to: '/leases', icon: KeyRound, keys: ['G', 'L'], capability: 'residents.manage' },
  { label: 'Residents', to: '/residents', icon: Users, keys: ['G', 'R'], capability: 'residents.manage' },
  { label: 'Properties', to: '/properties', icon: Building2, keys: ['G', 'P'] },
  { label: 'Owners', to: '/owners', icon: UserRound, keys: ['G', 'O'], capability: 'owners.manage' },
  { label: 'Accounting', to: '/accounting', icon: Wallet, keys: ['G', 'B'], capability: 'accounting.view' },
  { label: 'Reports', to: '/reports', icon: BarChart3, keys: ['G', 'E'], capability: 'reports.view' },
  { label: 'Announcements', to: '/announcements', icon: Megaphone, keys: [], capability: 'announcements.send' },
  { label: 'Settings', to: '/settings', icon: Settings, keys: ['G', ','] },
];

/**
 * ⌘K: jump to any resident, lease, work order, unit, property, owner, vendor or
 * application by name, email, phone or number; create anything; navigate; and
 * switch theme. Units and properties match instantly from bootstrap; the rest
 * search the server as you type.
 */
export function CommandPalette({ open, onOpenChange, initialQuery = '' }: { open: boolean; onOpenChange: (o: boolean) => void; initialQuery?: string }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const navigate = useNavigate();
  const { setPref, pref } = useTheme();
  const [query, setQuery] = useState(initialQuery);
  const { data, isFetching } = useSearch(open ? query : '');

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const run = (fn: () => void) => {
    onOpenChange(false);
    window.setTimeout(fn, 0);
  };

  const q = query.trim().toLowerCase();
  const properties = useMemo(() => (q ? ws.orderedProperties.filter(p => `${p.name} ${p.code} ${p.street} ${p.city}`.toLowerCase().includes(q)).slice(0, 5) : []), [ws, q]);
  const units = useMemo(() => {
    if (q.length < 2) return [];
    return ws.units.filter(u => !u.archived && `${ws.unitLabel(u.id)} ${u.residentNames}`.toLowerCase().includes(q)).slice(0, 6);
  }, [ws, q]);
  const nav = NAV.filter(n => !n.capability || ws.can(n.capability));
  const creates = CREATE_MENU.filter(i => ws.can(i.capability));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[14vh] max-w-[640px] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%] sm:rounded-xl [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <DialogDescription className="sr-only">Search or run a command</DialogDescription>
        <Command loop className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search residents, units, work orders, leases — or type a command…" className="h-12 text-[15px]" />
          <CommandList className="max-h-[min(460px,62vh)] p-1.5">
            <CommandEmpty className="py-8 text-center text-[14px] text-muted-foreground">{isFetching ? 'Searching…' : 'No results'}</CommandEmpty>

            {data && q && data.workOrders.length > 0 && (
              <CommandGroup heading="Work orders">
                {data.workOrders.map(w => (
                  <CommandItem key={w.id} value={`wo ${w.number} ${w.title} ${query}`} className={itemCls} onSelect={() => go(`/work-orders/${w.number}`)}>
                    <WorkOrderStatusGlyph status={w.status} />
                    <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">WO-{w.number}</span>
                    <span className="truncate">{w.title}</span>
                    <span className="ml-auto flex items-center gap-2"><PriorityGlyph priority={w.priority} /></span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.tenants.length > 0 && (
              <CommandGroup heading="Residents">
                {data.tenants.map(t => (
                  <CommandItem key={t.id} value={`tenant ${t.name} ${t.subtitle} ${query}`} className={itemCls} onSelect={() => go(`/residents/${t.id}`)}>
                    <UserRound /> <span className="truncate">{t.name}</span>
                    <span className="ml-auto max-w-[260px] truncate text-sm text-muted-foreground">{t.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.leases.length > 0 && (
              <CommandGroup heading="Leases">
                {data.leases.map(l => (
                  <CommandItem key={l.id} value={`lease ${l.name} ${l.number ?? ''} ${query}`} className={itemCls} onSelect={() => go(`/leases/${l.id}`)}>
                    <KeyRound /> <span className="truncate">{l.name}</span>
                    <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                      {l.balance > 0 && <span className="text-tone-danger">{l.balanceLabel}</span>}
                      {l.phase}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {units.length > 0 && (
              <CommandGroup heading="Units">
                {units.map(u => (
                  <CommandItem key={u.id} value={`unit ${ws.unitLabel(u.id)} ${u.residentNames}`} className={itemCls} onSelect={() => go(`/units/${u.id}`)}>
                    <OccupancyGlyph occupancy={u.occupancy} /> <span className="truncate">{ws.unitLabel(u.id)}</span>
                    <span className="ml-auto max-w-[220px] truncate text-sm text-muted-foreground">{u.residentNames || u.occupancy}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {properties.length > 0 && (
              <CommandGroup heading="Properties">
                {properties.map(p => (
                  <CommandItem key={p.id} value={`property ${p.name} ${p.code} ${p.city}`} className={itemCls} onSelect={() => go(`/properties/${p.id}`)}>
                    <PropertySwatch color={p.color} size={10} /> {p.name}
                    <span className="ml-auto text-sm text-muted-foreground">{p.city} · {p.unitCount} units</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.applications.length > 0 && (
              <CommandGroup heading="Applications">
                {data.applications.map(a => (
                  <CommandItem key={a.id} value={`application ${a.name} ${a.subtitle} ${query}`} className={itemCls} onSelect={() => go(`/applications/${a.number}`)}>
                    <ApplicationStatusGlyph status={a.status} /> <span className="truncate">{a.name}</span>
                    <span className="ml-auto text-sm text-muted-foreground">{a.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.owners.length > 0 && (
              <CommandGroup heading="Owners">
                {data.owners.map(o => (
                  <CommandItem key={o.id} value={`owner ${o.name} ${o.subtitle}`} className={itemCls} onSelect={() => go(`/owners/${o.id}`)}>
                    <Building2 /> <span className="truncate">{o.name}</span>
                    <span className="ml-auto truncate text-sm text-muted-foreground">{o.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data && q && data.vendors.length > 0 && (
              <CommandGroup heading="Vendors">
                {data.vendors.map(v => (
                  <CommandItem key={v.id} value={`vendor ${v.name} ${v.subtitle}`} className={itemCls} onSelect={() => go(`/vendors/${v.id}`)}>
                    <Hammer /> <span className="truncate">{v.name}</span>
                    <span className="ml-auto truncate text-sm text-muted-foreground">{v.subtitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {creates.length > 0 && (
              <CommandGroup heading="Create">
                {creates.map(c => (
                  <CommandItem key={c.kind} value={`create new ${c.label}`} className={itemCls} onSelect={() => run(() => app.openCreate(c.kind))}>
                    {c.icon} New {c.label.toLowerCase()}
                    {c.keys && <Kbd className="ml-auto">{c.keys[0]}</Kbd>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandSeparator className="my-1" />
            <CommandGroup heading="Go to">
              {nav.map(n => (
                <CommandItem key={n.to} value={`go to ${n.label}`} className={itemCls} onSelect={() => go(n.to)}>
                  <n.icon /> {n.label}
                  {n.keys.length > 0 && <span className="ml-auto flex items-center gap-1">{n.keys.map(k => <Kbd key={k}>{k}</Kbd>)}</span>}
                </CommandItem>
              ))}
              {ws.settings.portalUrl && (
                <CommandItem value="Open resident portal" className={itemCls} onSelect={() => run(() => window.open(ws.settings.portalUrl!, '_blank', 'noopener'))}>
                  <ExternalLink /> Open the resident portal
                </CommandItem>
              )}
            </CommandGroup>

            <CommandGroup heading="Preferences">
              {([['light', 'Switch to light theme', Sun], ['dark', 'Switch to dark theme', Moon], ['system', 'Use system theme', Laptop]] as const).map(([value, label, Icon]) => (
                <CommandItem key={value} value={label} className={itemCls} onSelect={() => run(() => setPref(value))}>
                  <Icon /> {label}
                  {pref === value && <Check className="ml-auto h-3.5 w-3.5" />}
                </CommandItem>
              ))}
              <CommandItem value="Keyboard shortcuts help" className={itemCls} onSelect={() => run(() => app.openShortcuts())}>
                <Keyboard /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-2xs text-muted-foreground">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
            <span className="ml-auto flex items-center gap-1"><CommandIcon className="h-3 w-3" /> Command palette</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
