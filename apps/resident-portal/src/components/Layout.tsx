import { useQueryClient } from '@tanstack/react-query';
import {
  Building2, ClipboardList, CreditCard, FileText, Home, KeyRound, LayoutDashboard, LogOut, Mail, Menu, MessageSquare, Phone, Receipt, Search, ShieldCheck, UserRound, Wrench, type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@project/components/ui/sheet';
import { useSession } from '../lib/auth';
import { initials } from '../lib/format';
import { useMe, usePortal, type Me } from '../lib/queries';
import { Button, CountBadge } from './ui';

/**
 * The portal frame. One sign-in can be a resident, an owner and a vendor at
 * once, so the header shows the navigation for the area you're in (decided by
 * the URL) and the account menu lets you move between areas.
 */

export type Area = 'public' | 'resident' | 'owner' | 'vendor';

type NavItem = { to: string; label: string; icon: LucideIcon; badge?: number; end?: boolean };

export function areaOf(pathname: string): Area {
  if (pathname.startsWith('/resident')) return 'resident';
  if (pathname.startsWith('/owner')) return 'owner';
  if (pathname.startsWith('/vendor')) return 'vendor';
  return 'public';
}

function navFor(area: Area, me: Me | undefined, signedIn: boolean): NavItem[] {
  switch (area) {
    case 'resident':
      return [
        { to: '/resident', label: 'Home', icon: Home, end: true },
        { to: '/resident/payments', label: 'Payments', icon: CreditCard, badge: me?.resident && me.resident.balance > 0 ? 1 : 0 },
        { to: '/resident/maintenance', label: 'Maintenance', icon: Wrench, badge: 0 },
        { to: '/resident/lease', label: 'Lease', icon: KeyRound, badge: (me?.resident?.toSign ?? 0) + (me?.resident?.renewalOffers ?? 0) },
        { to: '/resident/documents', label: 'Documents', icon: FileText },
        { to: '/resident/messages', label: 'Messages', icon: MessageSquare, badge: me?.resident?.unreadMessages ?? 0 },
      ];
    case 'owner':
      return [
        { to: '/owner', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/owner/statements', label: 'Statements', icon: Receipt },
        { to: '/owner/approvals', label: 'Approvals', icon: ShieldCheck, badge: me?.owner?.pendingApprovals ?? 0 },
        { to: '/owner/documents', label: 'Documents', icon: FileText },
        { to: '/owner/messages', label: 'Messages', icon: MessageSquare, badge: me?.owner?.unreadMessages ?? 0 },
      ];
    case 'vendor':
      return [
        { to: '/vendor', label: 'Work orders', icon: Wrench, end: true, badge: me?.vendor?.openWorkOrders ?? 0 },
        { to: '/vendor/payments', label: 'Payments', icon: Receipt },
        { to: '/vendor/profile', label: 'Company', icon: Building2 },
      ];
    default:
      return [
        { to: '/homes', label: 'Homes for rent', icon: Search },
        ...(signedIn && (me?.applicant.applications ?? 0) > 0 ? [{ to: '/applications', label: 'My applications', icon: ClipboardList }] : []),
      ];
  }
}

/** Areas this person can open, for the account menu and the landing redirect. */
export function areasFor(me: Me | undefined): Array<{ area: Area; to: string; label: string; icon: LucideIcon; hint: string }> {
  const out: Array<{ area: Area; to: string; label: string; icon: LucideIcon; hint: string }> = [];
  if (me?.resident) out.push({ area: 'resident', to: '/resident', label: 'Resident portal', icon: Home, hint: me.resident.leases[0] ? `${me.resident.leases[0].propertyName} ${me.resident.leases[0].unitName}`.trim() : '' });
  if (me?.owner) out.push({ area: 'owner', to: '/owner', label: 'Owner portal', icon: Building2, hint: me.owner.name });
  if (me?.vendor) out.push({ area: 'vendor', to: '/vendor', label: 'Vendor portal', icon: Wrench, hint: me.vendor.name });
  return out;
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <TopBar />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Wordmark() {
  const { data } = usePortal();
  const s = data?.settings;
  if (!s) return <span className="skeleton h-7 w-44" aria-hidden />;
  if (s.logoUrl) return <img src={s.logoUrl} alt={s.organizationName} className="h-8 max-w-[200px] object-contain" />;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[12px] font-semibold tracking-wide text-primary-foreground" aria-hidden>
        {initials(s.organizationName)}
      </span>
      <span className="hidden truncate text-[16px] font-semibold tracking-tight sm:inline">{s.organizationName}</span>
    </span>
  );
}

function TopBar() {
  const { user, isLoading, signIn, signOut, name } = useSession();
  const me = useMe();
  const qc = useQueryClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  const area = areaOf(location.pathname);
  const links = navFor(area, me.data, Boolean(user));
  const areas = areasFor(me.data);
  const displayName = me.data?.name || name;
  const attention = (me.data?.resident?.unreadMessages ?? 0) + (me.data?.resident?.toSign ?? 0) + (me.data?.owner?.pendingApprovals ?? 0) + (me.data?.vendor?.openWorkOrders ?? 0) + (me.data?.vendor?.unreadMessages ?? 0) + (me.data?.owner?.unreadMessages ?? 0);

  const doSignOut = () => {
    qc.removeQueries({ queryKey: ['portal'], predicate: q => q.queryKey[1] !== 'site' });
    signOut();
  };

  return (
    <header className="no-print sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-page items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="-mx-1.5 flex min-w-0 items-center rounded-lg px-1.5 py-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35" aria-label="Home">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="ml-3 hidden min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none md:flex">
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                cn(
                  'relative inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
                  isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              {l.label}
              {l.badge ? <CountBadge count={l.badge} /> : null}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {isLoading ? (
            <span className="skeleton h-9 w-9 rounded-full" aria-hidden />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 md:pr-3"
                  aria-label={`Account menu for ${displayName}`}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border bg-muted text-[13px] font-semibold text-foreground/75">{initials(displayName)}</span>
                  <span className="hidden max-w-[160px] truncate text-[15px] font-medium md:inline">{displayName.split(' ')[0]}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
                <DropdownMenuLabel className="px-2.5 py-2 font-normal">
                  <span className="block truncate text-[15px] font-medium">{displayName}</span>
                  <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
                </DropdownMenuLabel>
                {areas.length > 0 && <DropdownMenuSeparator />}
                {areas.map(a => (
                  <DropdownMenuItem key={a.area} asChild className="gap-2.5 rounded-lg px-2.5 py-2 text-[15px]">
                    <Link to={a.to}>
                      <a.icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block">{a.label}</span>
                        {a.hint && <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>}
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="h-10 gap-2.5 rounded-lg px-2.5 text-[15px]">
                  <Link to="/homes"><Search className="h-4 w-4" /> Browse homes for rent</Link>
                </DropdownMenuItem>
                {(me.data?.applicant.applications ?? 0) > 0 && (
                  <DropdownMenuItem asChild className="h-10 gap-2.5 rounded-lg px-2.5 text-[15px]">
                    <Link to="/applications"><ClipboardList className="h-4 w-4" /> My applications</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild className="h-10 gap-2.5 rounded-lg px-2.5 text-[15px]">
                  <Link to="/account"><UserRound className="h-4 w-4" /> Account</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={doSignOut} className="h-10 gap-2.5 rounded-lg px-2.5 text-[15px]">
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" variant="ink" onClick={() => signIn()} className="h-9 px-4">
              Sign in
            </Button>
          )}
          <button
            type="button"
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 md:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
            {attention > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" aria-hidden />}
          </button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-[86%] max-w-sm flex-col gap-0 p-0">
          <div className="border-b px-5 py-4">
            <SheetTitle className="text-base font-semibold">Menu</SheetTitle>
          </div>
          <nav aria-label="Mobile" className="flex flex-col gap-1 overflow-y-auto p-3">
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => cn('flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium', isActive ? 'bg-accent text-foreground' : 'text-foreground/85 hover:bg-accent')}
              >
                <l.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                <span className="flex-1">{l.label}</span>
                {l.badge ? <CountBadge count={l.badge} /> : null}
              </NavLink>
            ))}
            {areas.filter(a => a.area !== area).length > 0 && <div className="mx-3 my-2 border-t" />}
            {areas.filter(a => a.area !== area).map(a => (
              <Link key={a.area} to={a.to} className="flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium text-foreground/85 hover:bg-accent">
                <a.icon className="h-5 w-5 text-muted-foreground" aria-hidden /> {a.label}
              </Link>
            ))}
            {area !== 'public' && (
              <Link to="/homes" className="flex h-12 items-center gap-3 rounded-xl px-3 text-base font-medium text-foreground/85 hover:bg-accent">
                <Search className="h-5 w-5 text-muted-foreground" aria-hidden /> Homes for rent
              </Link>
            )}
          </nav>
          <div className="mt-auto border-t p-4">
            {user ? (
              <>
                <p className="truncate text-sm text-muted-foreground">Signed in as {user.email}</p>
                <Button variant="secondary" className="mt-3 w-full" onClick={doSignOut}>
                  <LogOut /> Sign out
                </Button>
              </>
            ) : (
              <Button className="w-full" size="lg" onClick={() => signIn()}>
                Sign in
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function Footer() {
  const { data } = usePortal();
  const s = data?.settings;
  const year = new Date().getFullYear();
  return (
    <footer className="no-print mt-16 border-t bg-background">
      <div className="mx-auto flex max-w-page flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold tracking-tight">{s?.organizationName ?? ' '}</p>
          {s?.address && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{s.address}</p>}
          <p className="mt-2 text-sm text-faint">© {year}{s?.officeHours ? ` · Office hours ${s.officeHours}` : ''}</p>
        </div>
        <ul className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
          {s?.emergencyPhone && (
            <li>
              <a href={`tel:${s.emergencyPhone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 font-medium text-tone-danger hover:underline">
                <Phone className="h-4 w-4" aria-hidden /> Emergency maintenance {s.emergencyPhone}
              </a>
            </li>
          )}
          {s?.phone && (
            <li>
              <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline">
                <Phone className="h-4 w-4" aria-hidden /> {s.phone}
              </a>
            </li>
          )}
          {s?.supportEmail && (
            <li>
              <a href={`mailto:${s.supportEmail}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline">
                <Mail className="h-4 w-4" aria-hidden /> {s.supportEmail}
              </a>
            </li>
          )}
        </ul>
      </div>
    </footer>
  );
}
