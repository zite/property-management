import { Menu, Search } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@project/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { cn } from '@project/components/lib/utils';
import { AppActionsContext, type AppActions, type ComposeOptions, type ConfirmOptions, type CreateDefaults, type CreateKind } from '../../lib/app-actions';
import { useHotkeys } from '../../lib/hotkeys';
import { useTheme } from '../../lib/theme';
import { useWorkspace } from '../../lib/workspace';
import { IconButton } from '../primitives/bits';
import { CommandPalette } from './CommandPalette';
import { ComposeHost, CreateDialogHost } from './CreateDialogs';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Sidebar } from './Sidebar';

const WorkOrderPeek = lazy(() => import('../workOrders/WorkOrderPeek'));

function ConfirmDialog({ state, onResolve }: { state: (ConfirmOptions & { open: boolean }) | null; onResolve: (ok: boolean) => void }) {
  return (
    <AlertDialog open={Boolean(state?.open)} onOpenChange={o => !o && onResolve(false)}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[16px]">{state?.title}</AlertDialogTitle>
          <AlertDialogDescription className={cn('text-[14px]', !state?.description && 'sr-only')}>{state?.description ?? state?.title}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-9 text-[14px]" onClick={() => onResolve(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction autoFocus className={cn('h-9 text-[14px]', state?.destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')} onClick={() => onResolve(true)}>
            {state?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const GO: Record<string, string> = { h: '/home', i: '/inbox', t: '/tasks', m: '/messages', w: '/work-orders', v: '/vendors', a: '/leasing', l: '/leases', r: '/residents', p: '/properties', o: '/owners', b: '/accounting', e: '/reports', ',': '/settings' };

export function AppShell() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const { toggle: toggleTheme } = useTheme();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  const [create, setCreate] = useState<{ kind: CreateKind; defaults?: CreateDefaults; open: boolean } | null>(null);
  const [compose, setCompose] = useState<{ open: boolean; options: ComposeOptions } | null>(null);
  const [peek, setPeek] = useState<number | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('property-management:sidebar:collapsed') === '1';
    } catch {
      return false;
    }
  });
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    setMobileNav(false);
    setPeek(null);
  }, [location.pathname]);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        confirmResolver.current = resolve;
        setConfirmState({ ...options, open: true });
      }),
    [],
  );

  const actions = useMemo<AppActions>(
    () => ({
      openPalette: q => {
        setPaletteQuery(q ?? '');
        setPaletteOpen(true);
      },
      openShortcuts: () => setShortcutsOpen(true),
      confirm,
      openCreate: (kind, defaults) => setCreate({ kind, defaults, open: true }),
      openCompose: options => setCompose({ open: true, options }),
      peekWorkOrder: n => setPeek(n),
      closePeek: () => setPeek(null),
      peekedWorkOrder: peek,
    }),
    [confirm, peek],
  );

  const toggleSidebar = () =>
    setCollapsed(c => {
      try {
        localStorage.setItem('property-management:sidebar:collapsed', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });

  useHotkeys({ 'mod+k': () => setPaletteOpen(o => !o) }, { allowInOverlay: true, allowInInputs: ['mod+k'] });
  useHotkeys({
    c: () => ws.can('maintenance.create') && actions.openCreate('workOrder'),
    '?': () => setShortcutsOpen(true),
    '[': toggleSidebar,
    'mod+shift+l': toggleTheme,
    'shift+p': () => ws.can('receivables.manage') && actions.openCreate('payment'),
    'shift+h': () => ws.can('receivables.manage') && actions.openCreate('charge'),
    g: () => {
      if (pendingG.current) window.clearTimeout(pendingG.current);
      pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
    },
  });

  // "G then X" navigation, in the capture phase so list shortcuts don't claim the second key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pendingG.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'g') return;
      window.clearTimeout(pendingG.current);
      pendingG.current = null;
      const to = GO[key];
      if (to) {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigate(to);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [navigate]);

  return (
    <AppActionsContext.Provider value={actions}>
      <div className="flex h-[100dvh] overflow-hidden bg-canvas">
        <aside className={cn('no-print hidden shrink-0 overflow-hidden transition-[width] duration-200 md:block', collapsed ? 'w-0' : 'w-[240px]')}>
          <div className="h-full w-[240px]">
            <Sidebar />
          </div>
        </aside>

        <div className={cn('flex min-w-0 flex-1 flex-col md:py-2 md:pr-2', collapsed && 'md:pl-2')}>
          <div className="no-print flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:hidden">
            <Sheet open={mobileNav} onOpenChange={setMobileNav}>
              <IconButton onClick={() => setMobileNav(true)} aria-label="Open navigation">
                <Menu />
              </IconButton>
              <SheetContent side="left" className="w-[280px] bg-sidebar p-0 [&>button:first-child]:hidden">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SheetDescription className="sr-only">Main navigation</SheetDescription>
                <Sidebar onNavigate={() => setMobileNav(false)} />
              </SheetContent>
            </Sheet>
            <img src="/favicon.svg" alt="" className="h-5 w-5 rounded" />
            <span className="truncate text-[14.5px] font-semibold">{ws.settings.organizationName}</span>
            <IconButton className="ml-auto" onClick={() => setPaletteOpen(true)} aria-label="Search">
              <Search />
            </IconButton>
          </div>
          <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-lg md:border md:shadow-xs">
            <Outlet context={{ toggleSidebar, sidebarCollapsed: collapsed }} />
          </main>
        </div>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} initialQuery={paletteQuery} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        <CreateDialogHost state={create} onClose={() => setCreate(c => (c ? { ...c, open: false } : c))} />
        <ComposeHost state={compose} onClose={() => setCompose(c => (c ? { ...c, open: false } : c))} />
        {peek != null && (
          <Suspense fallback={null}>
            <WorkOrderPeek number={peek} onClose={() => setPeek(null)} />
          </Suspense>
        )}
        <ConfirmDialog
          state={confirmState}
          onResolve={ok => {
            confirmResolver.current?.(ok);
            confirmResolver.current = null;
            setConfirmState(s => (s ? { ...s, open: false } : s));
          }}
        />
      </div>
    </AppActionsContext.Provider>
  );
}
