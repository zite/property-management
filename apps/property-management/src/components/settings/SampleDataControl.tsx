import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { seedWorkspace } from 'zitejs/api';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { useOrgSettings } from './data';

/**
 * The one way to load the sample company: a quiet block at the bottom of
 * Settings → Organization (and of Demo data once it's been removed). Admins
 * only, and only while the server says loading is allowed: no demo in the
 * workspace and nothing of the organization's own yet. A load that stopped
 * partway can be continued from here. Once the demo is in, this is a link to
 * Settings → Demo data, where it's removed.
 *
 * A load takes a few minutes of phase calls. It runs outside any component,
 * so leaving the page doesn't start a second one when the page mounts again.
 */

let running: string | null = null;
const listeners = new Set<() => void>();
const setRunning = (message: string | null) => {
  running = message;
  listeners.forEach(l => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const keepTabOpen = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

async function loadSample(qc: QueryClient) {
  if (running !== null) return;
  setRunning('Starting');
  window.addEventListener('beforeunload', keepTabOpen);
  try {
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      const res = await seedWorkspace({});
      setRunning(res.message);
      done = res.done;
      if (!done && res.phase.endsWith(':running')) await new Promise(r => setTimeout(r, 2500));
    }
    if (!done) throw new Error('Loading the sample data is taking longer than usual. Press Continue loading to pick up where it stopped.');
    await qc.invalidateQueries();
    toast.success('Sample data loaded', { description: 'Explore it, then remove it in Settings → Demo data before adding your own properties.' });
  } catch (e) {
    toast.error(errorMessage(e, 'Loading the sample data stopped partway. Press Continue loading to pick up where it left off.'));
    await qc.invalidateQueries();
  } finally {
    window.removeEventListener('beforeunload', keepTabOpen);
    setRunning(null);
  }
}

const link = 'text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground';

export function SampleDataControl({ removeLink = false }: { removeLink?: boolean }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const org = useOrgSettings(ws.isAdmin);
  const message = useSyncExternalStore(subscribe, () => running);

  if (!ws.isAdmin || !org.data) return null;
  const { canLoad, resumable, seededAt } = org.data.demo;
  const pending = message !== null;

  if (!pending && !canLoad && !resumable) {
    if (!removeLink || !seededAt) return null;
    return (
      <Block>
        The sample company is loaded. Review or remove it in <Link to="/settings/demo" className={link}>Demo data</Link>.
      </Block>
    );
  }

  const start = async () => {
    const ok = await app.confirm(
      resumable
        ? { title: 'Continue loading the sample data?', description: 'Adds the rest of the sample company. It takes a few minutes, so keep this tab open. You can remove all of it later in Settings → Demo data.', confirmLabel: 'Continue loading' }
        : {
            title: 'Load sample data?',
            description: 'Adds a sample company, Cedar & Main Property Management: 6 properties, 35 units, residents, vendors, work orders and eight months of books, with your email linked to a sample lease, owner and vendor so you can preview the portal. It takes a few minutes. You can remove it later in Settings → Demo data.',
            confirmLabel: 'Load sample data',
          },
    );
    if (ok) await loadSample(qc);
  };

  return (
    <Block
      action={
        <button type="button" data-sample-load onClick={() => void start()} disabled={pending} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-60">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {pending ? 'Loading…' : resumable ? 'Continue loading' : 'Load sample data'}
        </button>
      }
    >
      {pending
        ? `${message.replace(/…$/, '')}…`
        : resumable
          ? <>Loading the sample data stopped partway. Continue to add the rest, or remove what’s there in <Link to="/settings/demo" className={link}>Demo data</Link>.</>
          : 'Load a sample company (six properties, their residents, work orders and eight months of books) to see how the app fits together before adding your own.'}
    </Block>
  );
}

function Block({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label="Sample data" className="mt-12 border-t pt-5">
      <h3 className="text-[13.5px] font-medium text-muted-foreground">Sample data</h3>
      <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="min-w-0 flex-1 basis-[320px] text-sm text-muted-foreground" aria-live="polite">{children}</p>
        {action}
      </div>
    </section>
  );
}
