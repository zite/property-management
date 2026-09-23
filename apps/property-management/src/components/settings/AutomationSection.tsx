import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CalendarClock, CircleCheck, KeyRound, Loader2, Play, Receipt, Repeat, ShieldAlert, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { runAutomation, type RunAutomationOutputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { dateTime, plural, timeAgo } from '../../lib/format';
import { invalidate, invalidateMoney } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { Tip } from '../primitives/bits';
import { Note } from './controls';
import { sk, useOrgSettings, type OrgSettingsData } from './data';
import { Group, SectionError, SectionHeader, SectionSkeleton } from './form';
import { lateFeeFor } from './rules';

type Summary = RunAutomationOutputType;

type Job = { key: string; icon: ReactNode; title: string; description: ReactNode; off?: boolean; link: { to: string; label: string }; count: (s: Summary) => number; result: (n: number) => string };

const link = 'text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground';

/** Settings → Automation: what the daily run does with today's settings, its last run, and Run now. */
export default function AutomationSection() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useOrgSettings();
  const [running, setRunning] = useState(false);
  const [fresh, setFresh] = useState<Summary | null>(null);

  if (q.isPending) return <SectionSkeleton rows={7} />;
  if (q.isError || !q.data) return <SectionError error={q.error} onRetry={() => void q.refetch()} />;

  const s = q.data.settings;
  const summary: Summary | null = fresh ?? q.data.automation.summary;
  const ranAt = fresh?.ranAt ?? q.data.automation.ranAt;
  const m = (n: number | null) => ws.money(n ?? 0, { cents: Math.round((n ?? 0) * 100) % 100 !== 0 });
  const feeText = s.lateFeeType === 'Percent' ? `${s.lateFeePercent}% of rent${s.lateFeeMax ? ` (up to ${m(s.lateFeeMax)})` : ''}` : m(lateFeeFor(s, 1_000_000));

  const jobs: Job[] = [
    {
      key: 'charges', icon: <Repeat />, title: 'Post recurring charges', link: { to: '/settings/rent', label: 'Rent & fees' },
      description: <>Adds rent, pet rent, parking and other recurring charges to each lease {s.chargeDaysAhead ? `${plural(s.chargeDaysAhead, 'day')} before they’re due` : 'on the day they’re due'}.</>,
      count: r => r.chargesPosted, result: n => (n ? `${plural(n, 'charge')} posted` : 'Nothing due'),
    },
    {
      key: 'late', icon: <Receipt />, title: 'Assess late fees', off: s.lateFeeType === 'None', link: { to: '/settings/rent', label: 'Rent & fees' },
      description: s.lateFeeType === 'None' ? 'Off — no late fee is set.' : <>Adds a {feeText} late fee to rent still unpaid {plural(s.gracePeriodDays, 'day')} after it’s due, and emails the <Link to="/settings/templates" className={link}>late notice</Link>.</>,
      count: r => r.lateFees, result: n => (n ? `${plural(n, 'late fee')} added` : 'No late rent'),
    },
    {
      key: 'reminders', icon: <BellRing />, title: 'Send rent reminders', off: !(s.rentReminderDays > 0), link: { to: '/settings/rent', label: 'Rent & fees' },
      description: s.rentReminderDays > 0 ? <>Emails residents the <Link to="/settings/templates" className={link}>rent reminder</Link> {plural(s.rentReminderDays, 'day')} before rent is due.</> : 'Off — reminders are set to 0 days.',
      count: r => r.rentReminders, result: n => (n ? `${plural(n, 'reminder')} sent` : 'None due today'),
    },
    {
      key: 'leases', icon: <KeyRound />, title: 'Open renewal and move-out tasks', link: { to: '/settings/leasing', label: 'Leasing' },
      description: <>Opens a renewal task for the property manager {plural(s.renewalNoticeDays, 'day')} before a fixed-term lease ends, and a move-out task on the move-out date.</>,
      count: r => r.renewalTasks + r.moveOutTasks, result: n => (n ? `${plural(n, 'task')} opened` : 'No new tasks'),
    },
    {
      key: 'maintenance', icon: <CalendarClock />, title: 'Create preventive maintenance', link: { to: '/work-orders/schedules', label: 'Recurring maintenance' },
      description: 'Creates work orders from recurring maintenance schedules — filter changes, inspections, gutter cleaning — ahead of their due date.',
      count: r => r.workOrdersCreated, result: n => (n ? `${plural(n, 'work order')} created` : 'Nothing due'),
    },
    {
      key: 'insurance', icon: <ShieldAlert />, title: 'Watch vendor insurance', link: { to: '/vendors', label: 'Vendors' },
      description: 'Opens a task when a vendor’s certificate of insurance has expired or expires within 30 days.',
      count: r => r.insuranceAlerts, result: n => (n ? `${plural(n, 'alert')} raised` : 'All current'),
    },
    {
      key: 'fees', icon: <Wallet />, title: 'Post management fees', link: { to: '/settings/maintenance', label: 'Maintenance & owners' },
      description: <>Once a month closes, posts each property’s management fee — {s.managementFeePercent}% of rent collected unless the property or owner has its own rate.</>,
      count: r => r.managementFees, result: n => (n ? `${plural(n, 'fee')} posted` : 'Nothing to post'),
    },
  ];

  const run = async () => {
    setRunning(true);
    try {
      const res = await runAutomation({});
      setFresh(res);
      qc.setQueryData<OrgSettingsData>(sk.org, old => (old ? { ...old, automation: { ranAt: res.ranAt, summary: res } } : old));
      invalidateMoney(qc);
      invalidate(qc, 'tasks', 'workOrders', 'schedules', 'inbox', 'messages', 'settings');
      const total = res.chargesPosted + res.lateFees + res.rentReminders + res.renewalTasks + res.moveOutTasks + res.workOrdersCreated + res.insuranceAlerts + res.managementFees;
      if (res.errors.length) toast.warning(`Automation finished with ${plural(res.errors.length, 'problem')}`, { description: res.errors[0] });
      else toast.success(total ? 'Automation finished' : 'Automation finished — nothing needed doing', { description: total ? jobs.map(j => (j.count(res) ? j.result(j.count(res)) : '')).filter(Boolean).join(' · ') : undefined });
    } catch (e) {
      toast.error(errorMessage(e, 'The automation didn’t run. Try again.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <SectionHeader
        title="Automation"
        description="Every morning at 6:00 AM Mountain Time, the routine work below runs automatically. Each step is safe to repeat — running it again never double-charges or double-sends."
        action={
          <button type="button" onClick={() => void run()} disabled={running} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-60">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {running ? 'Running…' : 'Run now'}
          </button>
        }
      />

      <div className="mb-9 overflow-hidden rounded-lg border bg-card shadow-2xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          {ranAt ? (
            <>
              <CircleCheck className={cn('h-4 w-4', summary?.errors.length ? 'text-tone-warning' : 'text-tone-success')} />
              <Tip label={dateTime(ranAt)}>
                <span className="text-[14px] font-medium">Last ran {timeAgo(ranAt)}</span>
              </Tip>
              <span className="text-sm text-muted-foreground">{dateTime(ranAt)}{summary?.today ? ` · for ${summary.today}` : ''}</span>
            </>
          ) : (
            <span className="text-[14px] text-muted-foreground">Hasn’t run yet. It runs tomorrow morning, or press Run now.</span>
          )}
        </div>
        {summary && summary.errors.length > 0 && (
          <div className="border-t">
            <Note tone="warning" icon={<AlertTriangle />}>
              <div className="font-medium">{plural(summary.errors.length, 'step')} didn’t finish — the rest ran normally and it will try again tomorrow.</div>
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {summary.errors.map((e, i) => <li key={i} className="[overflow-wrap:anywhere]">{e}</li>)}
              </ul>
            </Note>
          </div>
        )}
      </div>

      <Group title="Every morning">
        {jobs.map(j => {
          const n = summary ? j.count(summary) : null;
          return (
            <div key={j.key} className={cn('flex gap-3 px-4 py-3.5', j.off && 'bg-subtle/40')}>
              <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background [&_svg]:h-3.5 [&_svg]:w-3.5', j.off ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{j.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn('text-[14px] font-medium', j.off && 'text-muted-foreground')}>{j.title}</span>
                  {summary && n != null && !j.off && <span className={cn('text-sm', n > 0 ? 'text-tone-success' : 'text-muted-foreground')}>Last run: {j.result(n)}</span>}
                </div>
                <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{j.description}</p>
              </div>
              <Link to={j.link.to} className="mt-0.5 hidden h-8 shrink-0 items-center rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex">{j.link.label}</Link>
            </div>
          );
        })}
      </Group>
    </>
  );
}
