import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, CircleCheck, Info, Settings2, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { clearDemoData, type ClearDemoDataOutputType } from 'zitejs/api';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { fullDate } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Field, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { ProgressBar } from '../primitives/bits';
import { Note } from './controls';
import { sk, useDemoCounts, useOrgSettings } from './data';
import { Group, SectionError, SectionHeader, SectionSkeleton } from './form';

const PHRASE = 'remove demo data';

const SUMMARY: Array<{ label: string; tables: string[] }> = [
  { label: 'Properties', tables: ['Properties'] },
  { label: 'Units', tables: ['Units'] },
  { label: 'Owners', tables: ['Owners'] },
  { label: 'Residents', tables: ['Tenants'] },
  { label: 'Leases', tables: ['Leases'] },
  { label: 'Transactions', tables: ['Transactions'] },
  { label: 'Work orders', tables: ['WorkOrders'] },
  { label: 'Vendors', tables: ['Vendors'] },
  { label: 'Listings, inquiries and applications', tables: ['Listings', 'Inquiries', 'Applications'] },
  { label: 'Messages and announcements', tables: ['Messages', 'Announcements', 'Notifications'] },
  { label: 'Tasks, documents and inspections', tables: ['Tasks', 'Documents', 'Inspections', 'MaintenanceSchedules'] },
  { label: 'Sample teammates', tables: ['Members'] },
];

type Counts = ClearDemoDataOutputType['counts'];

const n = (v: number) => v.toLocaleString('en-US');

/** Settings → Demo data: what the sample company is, and removing it — resumably, with progress. */
export default function DemoDataSection() {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const org = useOrgSettings();
  const counts = useDemoCounts();
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<{ total: number; deleted: number } | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!run) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [run]);

  const remove = async () => {
    setConfirming(false);
    const total = Math.max(1, counts.data?.remaining ?? 1);
    let deleted = 0;
    setRun({ total, deleted });
    try {
      for (let i = 0; i < 80; i++) {
        const res = await clearDemoData({});
        deleted += res.deleted;
        setRun({ total: Math.max(total, deleted + res.remaining), deleted });
        if (res.done) break;
      }
      setFinished(true);
      qc.setQueryData(sk.demo, { done: true, hasDemo: false, seededAt: null, deleted: 0, remaining: 0, counts: [] });
      await qc.invalidateQueries();
      toast.success('Demo data removed', { description: `${n(deleted)} sample records are gone. The workspace is ready for your own properties.` });
    } catch (e) {
      toast.error(errorMessage(e, 'Removing the demo data stopped partway. Press Remove again to pick up where it left off.'));
      void counts.refetch();
    } finally {
      setRun(null);
    }
  };

  if (counts.isPending || org.isPending) return <SectionSkeleton rows={4} />;
  if (counts.isError || org.isError || !counts.data || !org.data) return <SectionError error={counts.error ?? org.error} onRetry={() => { void counts.refetch(); void org.refetch(); }} />;

  const data = counts.data;
  const seededAt = data.seededAt ?? org.data.demo.seededAt;

  if (run) {
    const pct = Math.min(1, run.deleted / run.total);
    return (
      <>
        <SectionHeader title="Demo data" description="Removing the sample company." />
        <div className="rounded-lg border bg-card px-5 py-6 shadow-2xs" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-medium">Removing sample records…</span>
            <span className="text-sm tabular-nums text-muted-foreground">{n(run.deleted)} of {n(run.total)}</span>
          </div>
          <ProgressBar value={Math.max(0.02, pct)} className="mt-3 h-2" />
          <p className="mt-3 text-[14px] text-muted-foreground">This takes a few minutes for a full demo — records are removed in batches so nothing gets left half-deleted. Keep this tab open; if it closes, press Remove again and it picks up where it stopped.</p>
        </div>
      </>
    );
  }

  if (!data.hasDemo || data.remaining === 0 || finished) {
    const wasSeeded = finished || org.data.demo.seedStatus === 'done';
    return (
      <>
        <SectionHeader title="Demo data" description="The sample company set up when this app was installed." />
        <Group>
          <Note tone="success" icon={<CircleCheck />}>
            <span className="font-medium">No demo data in this workspace.</span>{' '}
            <span className="text-muted-foreground">{finished ? 'The sample company has been removed. Everything here from now on is yours.' : wasSeeded ? 'Everything here is your own.' : 'No sample company was added here.'}</span>
          </Note>
        </Group>
        <Group title="Getting started">
          {ws.can('portfolio.manage') && (
            <button type="button" onClick={() => app.openCreate('property')} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/40">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">Add your first property</span><span className="block text-sm text-muted-foreground">Then its units, owner and current leases.</span></span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          )}
          <Link to="/settings/team" className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">Invite your team</span><span className="block text-sm text-muted-foreground">Give each person the role that fits their work.</span></span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </Link>
          <Link to="/settings/general" className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">Set up your company</span><span className="block text-sm text-muted-foreground">Name, logo, contact details, then rent and late-fee policies.</span></span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </Link>
        </Group>
      </>
    );
  }

  return (
    <>
      <SectionHeader title="Demo data" description="When this app was installed it built a sample company, Cedar & Main Property Management, so every screen had something to show. Remove it before you add your own properties." />

      <Group title="What’s sample data" description={seededAt ? `Added ${fullDate(seededAt)}.` : undefined}>
        <div className="grid gap-x-8 px-4 py-3 sm:grid-cols-2">
          {summarize(data.counts).map(r => (
            <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 text-[14px] last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="num font-medium">{n(r.count)}</span>
            </div>
          ))}
        </div>
        <Note icon={<Info />}>
          <p>Removed: everything the demo created — including the resident, owner and vendor records linked to your email so you could preview the portal — and anything added to those records since, like a note on a sample work order or a payment on a sample lease.</p>
          <p className="mt-1.5">Kept: your account and anyone you invited, properties and records your team created, your settings, chart of accounts and email templates. Company details still showing the demo’s name, address and phone are cleared.</p>
        </Note>
      </Group>

      <Group title="Remove demo data">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4">
          <p className="min-w-0 flex-1 text-[14px] text-muted-foreground">
            Permanently deletes {n(data.remaining)} sample records. This can’t be undone, and the demo can’t be added back.
          </p>
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-3 text-[14px] font-medium text-destructive-foreground shadow-xs hover:bg-destructive/90">
            <Trash2 className="h-3.5 w-3.5" /> Remove demo data
          </button>
        </div>
      </Group>

      <ConfirmRemoveDialog open={confirming} onOpenChange={setConfirming} count={data.remaining} onConfirm={() => void remove()} />
      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><Sparkles className="h-3 w-3" /> Tip: explore first — the demo shows how rent, maintenance and owner statements fit together.</p>
    </>
  );
}

function summarize(counts: Counts) {
  const by = new Map(counts.map(c => [c.table, c.count]));
  const rows = SUMMARY.map(s => ({ label: s.label, count: s.tables.reduce((a, t) => a + (by.get(t) ?? 0), 0) })).filter(r => r.count > 0);
  const shown = new Set(SUMMARY.flatMap(s => s.tables));
  const rest = counts.filter(c => !shown.has(c.table)).reduce((a, c) => a + c.count, 0);
  if (rest) rows.push({ label: 'Ledger lines, activity and other records', count: rest });
  return rows;
}

function ConfirmRemoveDialog({ open, onOpenChange, count, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; onConfirm: () => void }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const ok = text.trim().toLowerCase() === PHRASE;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove the demo data?"
      description={`${n(count)} sample records will be permanently deleted. Records your team added to the workspace stay.`}
      size="sm"
      destructive
      disabled={!ok}
      submitLabel="Remove demo data"
      onSubmit={() => {
        if (ok) onConfirm();
      }}
    >
      <Field label={<>Type <span className="font-mono text-[13px]">{PHRASE}</span> to confirm</>} htmlFor="demo-confirm">
        <TextInput id="demo-confirm" autoComplete="off" spellCheck={false} value={text} onChange={e => setText(e.target.value)} placeholder={PHRASE} data-autofocus />
      </Field>
    </FormDialog>
  );
}
