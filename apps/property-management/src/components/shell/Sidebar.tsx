import {
  BarChart3, Building2, ChevronRight, ClipboardCheck, ExternalLink, FileSignature, Home, Inbox, Keyboard, KeyRound, Laptop, Layers, ListChecks, Megaphone, MessageSquare, Moon, Plus, Search, Settings, Sun, UserPlus, UserRound, Users, Wallet, Wrench, Hammer,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import type { Capability } from '@project/shared/roles';
import { useAppActions, type CreateKind } from '../../lib/app-actions';
import { MOD } from '../../lib/hotkeys';
import { useTheme } from '../../lib/theme';
import { useWorkspace } from '../../lib/workspace';
import { MemberAvatar } from '../primitives/Avatar';
import { OccupancyGlyph, PropertySwatch } from '../primitives/glyphs';
import { Kbd, Tip } from '../primitives/bits';

function useStoredToggle(key: string, initial = true) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(`property-management:sidebar:${key}`);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setValue(v => {
      try {
        localStorage.setItem(`property-management:sidebar:${key}`, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  return [value, toggle] as const;
}

export const VIEW_SCOPE_CAPABILITY: Record<string, Capability> = { work_orders: 'maintenance.create', leases: 'residents.manage', residents: 'residents.manage', applications: 'leasing.manage' };

function Item({ to, icon, label, count, onNavigate, end, indent, alert, matchPrefix }: { to: string; icon: ReactNode; label: string; count?: number | null; onNavigate?: () => void; end?: boolean; indent?: boolean; alert?: boolean; matchPrefix?: string }) {
  const location = useLocation();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-sidebar-foreground transition-colors duration-75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
          indent && 'pl-[30px]',
          (isActive || (matchPrefix && location.pathname.startsWith(matchPrefix))) && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        )
      }
    >
      <span className="flex w-4 shrink-0 items-center justify-center [&_svg]:h-[15px] [&_svg]:w-[15px]">{icon}</span>
      <span className="truncate">{label}</span>
      {count ? (
        <span className={cn('ml-auto text-sm tabular-nums', alert ? 'rounded-full bg-tone-danger px-1.5 text-[12px] font-medium leading-[20px] text-white dark:text-[hsl(220_10%_6%)]' : 'text-muted-foreground')}>{count}</span>
      ) : null}
    </NavLink>
  );
}

function SectionHeader({ label, open, onToggle, action }: { label: string; open: boolean; onToggle: () => void; action?: ReactNode }) {
  return (
    <div className="group/sh flex h-8 items-center pl-2 pr-1">
      <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        {label}
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
      </button>
      <span className="opacity-0 transition-opacity group-hover/sh:opacity-100">{action}</span>
    </div>
  );
}

export const CREATE_MENU: Array<{ kind: CreateKind; label: string; icon: ReactNode; capability: Parameters<ReturnType<typeof useWorkspace>['can']>[0]; keys?: string[] }> = [
  { kind: 'workOrder', label: 'Work order', icon: <Wrench className="h-3.5 w-3.5" />, capability: 'maintenance.create', keys: ['C'] },
  { kind: 'task', label: 'Task', icon: <ListChecks className="h-3.5 w-3.5" />, capability: 'communications.send' },
  { kind: 'payment', label: 'Receive payment', icon: <Wallet className="h-3.5 w-3.5" />, capability: 'receivables.manage' },
  { kind: 'charge', label: 'Charge a resident', icon: <FileSignature className="h-3.5 w-3.5" />, capability: 'receivables.manage' },
  { kind: 'bill', label: 'Bill', icon: <Layers className="h-3.5 w-3.5" />, capability: 'payables.manage' },
  { kind: 'lease', label: 'Lease (move-in)', icon: <KeyRound className="h-3.5 w-3.5" />, capability: 'residents.manage' },
  { kind: 'inquiry', label: 'Lead / inquiry', icon: <UserPlus className="h-3.5 w-3.5" />, capability: 'leasing.manage' },
  { kind: 'announcement', label: 'Announcement', icon: <Megaphone className="h-3.5 w-3.5" />, capability: 'announcements.send' },
  { kind: 'property', label: 'Property', icon: <Building2 className="h-3.5 w-3.5" />, capability: 'portfolio.manage' },
  { kind: 'vendor', label: 'Vendor', icon: <Hammer className="h-3.5 w-3.5" />, capability: 'vendors.manage' },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const { resolved, toggle, setPref } = useTheme();
  const [propertiesOpen, toggleProperties] = useStoredToggle('properties', false);
  const [viewsOpen, toggleViews] = useStoredToggle('views');
  // A shared view only shows to people whose role can open that list.
  const views = ws.views.filter(v => !VIEW_SCOPE_CAPABILITY[v.scope] || ws.can(VIEW_SCOPE_CAPABILITY[v.scope]));
  const me = ws.memberById.get(ws.me.id);
  const c = ws.counts;
  const activeProperties = ws.orderedProperties.filter(p => p.status !== 'Archived');
  const createItems = CREATE_MENU.filter(i => ws.can(i.capability));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 px-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent/70">
              {ws.settings.logoUrl ? <img src={ws.settings.logoUrl} alt="" className="h-5 w-5 rounded-[5px] object-cover" onError={e => { e.currentTarget.src = '/favicon.svg'; }} /> : <img src="/favicon.svg" alt="" className="h-5 w-5 rounded-[5px]" />}
              <span className="truncate text-[14.5px] font-semibold tracking-tight">{ws.settings.organizationName}</span>
              <ChevronRight className="h-3 w-3 shrink-0 rotate-90 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-2 py-2 font-normal">
              <MemberAvatar member={me} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">{ws.me.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{ws.me.email} · {ws.me.role}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="text-[14px]">
              <NavLink to="/settings/profile" onClick={onNavigate}><UserRound className="h-3.5 w-3.5" /> Your profile</NavLink>
            </DropdownMenuItem>
            {ws.can('settings.manage') && (
              <DropdownMenuItem asChild className="text-[14px]">
                <NavLink to="/settings" onClick={onNavigate}><Settings className="h-3.5 w-3.5" /> Settings</NavLink>
              </DropdownMenuItem>
            )}
            {ws.can('members.manage') && (
              <DropdownMenuItem asChild className="text-[14px]">
                <NavLink to="/settings/team" onClick={onNavigate}><UserPlus className="h-3.5 w-3.5" /> Invite teammates</NavLink>
              </DropdownMenuItem>
            )}
            {ws.settings.portalUrl && (
              <DropdownMenuItem asChild className="text-[14px]">
                <a href={ws.settings.portalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open the resident portal</a>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[14px]" onSelect={toggle}>
              {resolved === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />} {resolved === 'dark' ? 'Light theme' : 'Dark theme'}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[14px]" onSelect={() => setPref('system')}>
              <Laptop className="h-3.5 w-3.5" /> Match system theme
            </DropdownMenuItem>
            <DropdownMenuItem className="text-[14px]" onSelect={() => app.openShortcuts()}>
              <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts <span className="ml-auto"><Kbd>?</Kbd></span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip label="Search" keys={[MOD, 'K']}>
          <button type="button" onClick={() => app.openPalette()} aria-label="Search" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <Search className="h-4 w-4" />
          </button>
        </Tip>
        {createItems.length > 0 && (
          <DropdownMenu>
            <Tip label="Create">
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Create" className="flex h-7 w-7 items-center justify-center rounded-md border bg-background text-foreground shadow-2xs hover:bg-accent">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-sm font-medium text-muted-foreground">Create</DropdownMenuLabel>
              {createItems.map(i => (
                <DropdownMenuItem key={i.kind} className="text-[14px]" onSelect={() => app.openCreate(i.kind)}>
                  {i.icon} {i.label}
                  {i.keys && <span className="ml-auto"><Kbd>{i.keys[0]}</Kbd></span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <nav className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-4">
        <Item to="/home" icon={<Home />} label="Home" onNavigate={onNavigate} />
        <Item to="/inbox" icon={<Inbox />} label="Inbox" count={c.inboxUnread} onNavigate={onNavigate} />
        <Item to="/tasks" icon={<ListChecks />} label="My tasks" count={c.myTasks} alert={c.tasksOverdue > 0} onNavigate={onNavigate} />
        {ws.can('communications.send') && <Item to="/messages" icon={<MessageSquare />} label="Messages" count={c.messagesUnread} onNavigate={onNavigate} />}

        {(ws.can('maintenance.create') || ws.can('vendors.manage')) && (
          <div className="pt-4">
            <div className="flex h-8 items-center px-2 text-sm font-medium text-muted-foreground">Maintenance</div>
            {ws.can('maintenance.create') && <Item to="/work-orders" icon={<Wrench />} label="Work orders" count={c.workOrdersEmergency || c.workOrdersNew} alert={c.workOrdersEmergency > 0} onNavigate={onNavigate} matchPrefix="/work-orders" />}
            {ws.can('maintenance.manage') && <Item to="/inspections" icon={<ClipboardCheck />} label="Inspections" onNavigate={onNavigate} matchPrefix="/inspections" />}
            {ws.can('vendors.manage') && <Item to="/vendors" icon={<Hammer />} label="Vendors" onNavigate={onNavigate} matchPrefix="/vendors" />}
          </div>
        )}

        {(ws.can('leasing.manage') || ws.can('residents.manage')) && (
          <div className="pt-4">
            <div className="flex h-8 items-center px-2 text-sm font-medium text-muted-foreground">Leasing</div>
            {ws.can('leasing.manage') && <Item to="/leasing" icon={<UserPlus />} label="Leasing" count={c.applicationsToReview + c.inquiriesNew} onNavigate={onNavigate} matchPrefix="/leasing" />}
            <Item to="/leases" icon={<KeyRound />} label="Leases" onNavigate={onNavigate} matchPrefix="/leases" />
            <Item to="/residents" icon={<Users />} label="Residents" onNavigate={onNavigate} matchPrefix="/residents" />
          </div>
        )}

        <div className="pt-4">
          <SectionHeader
            label="Portfolio"
            open={propertiesOpen}
            onToggle={toggleProperties}
            action={
              ws.can('portfolio.manage') ? (
                <button type="button" onClick={() => app.openCreate('property')} aria-label="New property" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : undefined
            }
          />
          <Item to="/properties" end icon={<Building2 />} label="Properties" count={ws.properties.length} onNavigate={onNavigate} />
          {propertiesOpen &&
            activeProperties.map(p => (
              <NavLink
                key={p.id}
                to={`/properties/${p.id}`}
                onClick={onNavigate}
                className={({ isActive }) => cn('group flex h-8 items-center gap-2 rounded-md pl-[30px] pr-2 text-[14px] text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground', isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground')}
              >
                <PropertySwatch color={p.color} />
                <span className="truncate">{p.name}</span>
                {p.vacant > 0 && (
                  <Tip label={`${p.vacant} vacant`} side="right">
                    <span className="ml-auto flex items-center gap-0.5 text-sm text-muted-foreground"><OccupancyGlyph occupancy="Vacant" size={12} />{p.vacant}</span>
                  </Tip>
                )}
              </NavLink>
            ))}
          {ws.can('owners.manage') && <Item to="/owners" icon={<UserRound />} label="Owners" onNavigate={onNavigate} matchPrefix="/owners" />}
        </div>

        {(ws.can('accounting.view') || ws.can('reports.view')) && (
          <div className="pt-4">
            <div className="flex h-8 items-center px-2 text-sm font-medium text-muted-foreground">Money</div>
            {ws.can('accounting.view') && <Item to="/accounting" icon={<Wallet />} label="Accounting" count={ws.can('payables.manage') ? c.billsDue : 0} onNavigate={onNavigate} matchPrefix="/accounting" />}
            {ws.can('reports.view') && <Item to="/reports" icon={<BarChart3 />} label="Reports" onNavigate={onNavigate} matchPrefix="/reports" />}
            {ws.can('announcements.send') && <Item to="/announcements" icon={<Megaphone />} label="Announcements" onNavigate={onNavigate} />}
          </div>
        )}

        {views.length > 0 && (
          <div className="pt-4">
            <SectionHeader label="Views" open={viewsOpen} onToggle={toggleViews} />
            {viewsOpen && views.map(v => <Item key={v.id} to={`/views/${v.id}`} icon={<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />} label={v.name} onNavigate={onNavigate} />)}
          </div>
        )}
      </nav>

      <div className="shrink-0 space-y-px border-t border-sidebar-border px-2 py-2">
        {ws.settings.portalUrl && (
          <a href={ws.settings.portalUrl} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground">
            <ExternalLink className="h-[15px] w-[15px]" /> Resident portal
          </a>
        )}
        <NavLink to={ws.can('settings.manage') ? '/settings' : '/settings/profile'} onClick={onNavigate} className="flex h-9 items-center gap-2 rounded-md px-2 text-[14px] text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground">
          <MemberAvatar member={me} size={20} />
          <span className="truncate">{ws.me.name}</span>
          <Settings className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        </NavLink>
      </div>
    </div>
  );
}
