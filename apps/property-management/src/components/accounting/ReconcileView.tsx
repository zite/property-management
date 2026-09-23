import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, History, Loader2, Scale, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveReconciliation } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { fromCents, toCents } from '@project/shared/money';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dateTime, fullDate, plural, todayString } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Field, FieldRow, MoneyInput } from '../form/fields';
import { RowCheckbox } from '../list/GroupedList';
import { EmptyState, SkeletonRows } from '../primitives/bits';
import { Money } from '../primitives/data';
import { TXN_LABEL, useReconciliation, type ReconciliationData } from './accountingData';
import { Notice, primaryButton, secondaryButton } from './parts';

type Candidate = ReconciliationData['candidates'][number];

/**
 * Reconcile a bank account against its statement: enter the statement's date
 * and ending balance, check off what cleared, and finish when the difference
 * is zero. Checked items save as you go, so you can leave and come back.
 */
export function ReconcileView({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const ws = useWorkspace();
  const { data, isPending, isError, error, refetch } = useReconciliation(accountId);
  const canManage = ws.can('banking.manage');

  if (isPending) return <div className="p-6"><SkeletonRows rows={10} /></div>;
  if (isError || !data) return <EmptyState className="flex-1" title="Reconciliation didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />;
  if (!canManage) return <EmptyState className="flex-1" icon={<Scale />} title="Only accountants and admins can reconcile" description="Ask someone with banking access to reconcile this account." />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {data.inProgress ? <Workspace key={data.inProgress.id} data={data} accountId={accountId} onDone={onDone} /> : <StartForm data={data} accountId={accountId} onCancel={onDone} />}
    </div>
  );
}

function StartForm({ data, accountId, onCancel }: { data: ReconciliationData; accountId: string; onCancel: () => void }) {
  const qc = useQueryClient();
  const [statementDate, setStatementDate] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const last = data.lastCompleted;

  useEffect(() => {
    // Default to the usual statement date: the end of last month, or the month after the last reconciliation.
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = new Date();
    let candidate = iso(new Date(t.getFullYear(), t.getMonth(), 0));
    if (last && candidate <= last.statementDate) {
      const [y, m] = last.statementDate.split('-').map(Number);
      candidate = iso(new Date(y, m + 1, 0));
      if (candidate > todayString()) candidate = todayString();
    }
    setStatementDate(candidate);
  }, [last?.id]);

  const start = async () => {
    if (pending) return;
    if (!statementDate) return setError('Enter the statement date.');
    if (balance == null) return setError('Enter the ending balance from the statement.');
    if (last && statementDate <= last.statementDate) return setError(`This account is reconciled through ${fullDate(last.statementDate)}. Choose a later date.`);
    setPending(true);
    setError(null);
    try {
      await saveReconciliation({ action: 'start', accountId, statementDate, statementBalance: balance });
      invalidate(qc, 'accounting');
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t start the reconciliation'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-8">
      <form onSubmit={e => { e.preventDefault(); void start(); }} className="rounded-lg border bg-card p-5 shadow-2xs">
        <h2 className="text-[16px] font-semibold">Start a reconciliation</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {last ? <>Last reconciled through {fullDate(last.statementDate)} at <Money value={last.statementBalance} className="font-medium text-foreground" />. </> : 'This account hasn’t been reconciled yet. '}
          Enter the ending date and balance from your bank statement.
        </p>
        <FieldRow className="mt-4">
          <Field label="Statement ending date">
            <DateInput value={statementDate} onChange={setStatementDate} max={todayString()} />
          </Field>
          <Field label="Statement ending balance" hint={<>Beginning balance <Money value={data.beginningBalance} /></>}>
            <MoneyInput value={balance} onChange={setBalance} autoFocus />
          </Field>
        </FieldRow>
        {error && <p role="alert" className="mt-3 text-[14px] text-tone-danger">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onCancel}>Back to register</button>
          <button type="submit" className={primaryButton} disabled={pending}>{pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Start reconciling</button>
        </div>
      </form>
      <HistoryList data={data} accountId={accountId} />
    </div>
  );
}

function Workspace({ data, accountId, onDone }: { data: ReconciliationData; accountId: string; onDone: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const rec = data.inProgress!;
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rec.cleared));
  const [statementBalance, setStatementBalance] = useState<number | null>(rec.statementBalance);
  const [statementDate, setStatementDate] = useState<string | null>(rec.statementDate);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [busy, setBusy] = useState<'finish' | 'discard' | null>(null);
  const dirty = useRef(false);
  const latest = useRef({ checked, statementBalance, statementDate });
  latest.current = { checked, statementBalance, statementDate };

  const save = async () => {
    const { checked: c, statementBalance: b, statementDate: d } = latest.current;
    dirty.current = false;
    setSaving('saving');
    try {
      await saveReconciliation({ action: 'save', id: rec.id, cleared: [...c], statementBalance: b ?? undefined, statementDate: d && d !== rec.statementDate ? d : undefined });
      setSaving('saved');
      if (d && d !== rec.statementDate) void qc.invalidateQueries({ queryKey: ['accounting', 'reconciliation', accountId] });
    } catch (e) {
      setSaving('error');
      toast.error(errorMessage(e, 'Couldn’t save your progress'));
    }
  };

  // Save shortly after the last change, and on the way out.
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(t);
  }, [checked, statementBalance, statementDate]);
  useEffect(() => () => { if (dirty.current) void save(); }, []);

  const mark = (fn: () => void) => { dirty.current = true; fn(); };
  const toggle = (id: string) => mark(() => setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }));

  const deposits = data.candidates.filter(c => c.amount > 0);
  const payments = data.candidates.filter(c => c.amount < 0);
  const clearedDeposits = toCents(deposits.filter(c => checked.has(c.id)).reduce((s, c) => s + c.amount, 0));
  const clearedPayments = toCents(payments.filter(c => checked.has(c.id)).reduce((s, c) => s + c.amount, 0));
  const beginning = toCents(data.beginningBalance);
  const clearedBalance = beginning + clearedDeposits + clearedPayments;
  const difference = toCents(statementBalance ?? 0) - clearedBalance;
  const balanced = statementBalance != null && difference === 0;

  const finish = async () => {
    if (!balanced || busy) return;
    setBusy('finish');
    try {
      await saveReconciliation({ action: 'finish', id: rec.id, cleared: [...checked] });
      dirty.current = false;
      invalidate(qc, 'accounting');
      toast.success('Reconciliation finished', { description: `${data.account.name} is reconciled through ${fullDate(rec.statementDate)} · ${plural(checked.size, 'transaction')} cleared` });
      onDone();
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t finish the reconciliation'));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (busy) return;
    const ok = await app.confirm({ title: 'Discard this reconciliation?', description: `Your checkmarks for the ${fullDate(rec.statementDate)} statement are cleared. Nothing in the books changes.`, confirmLabel: 'Discard', destructive: true });
    if (!ok) return;
    setBusy('discard');
    try {
      dirty.current = false;
      await saveReconciliation({ action: 'discard', id: rec.id });
      invalidate(qc, 'accounting');
      toast.success('Reconciliation discarded');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t discard it'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          <div className="bg-background px-4 py-2.5">
            <label className="text-sm text-muted-foreground" htmlFor="rec-date">Statement date</label>
            <DateInput id="rec-date" value={statementDate} onChange={v => v && mark(() => setStatementDate(v))} className="mt-0.5 h-8" max={todayString()} />
          </div>
          <div className="bg-background px-4 py-2.5">
            <label className="text-sm text-muted-foreground" htmlFor="rec-balance">Statement ending balance</label>
            <MoneyInput id="rec-balance" value={statementBalance} onChange={v => mark(() => setStatementBalance(v))} className="mt-0.5 [&_input]:h-8" />
          </div>
          <Figure label="Beginning balance" value={<Money value={data.beginningBalance} />} />
          <Figure label={`Deposits cleared (${deposits.filter(c => checked.has(c.id)).length})`} value={<Money value={fromCents(clearedDeposits)} className="text-tone-success" />} />
          <Figure label={`Payments cleared (${payments.filter(c => checked.has(c.id)).length})`} value={<Money value={fromCents(Math.abs(clearedPayments))} />} />
          <div className={cn('px-4 py-2.5', balanced ? 'bg-tone-success/[0.08]' : 'bg-background')}>
            <div className="text-sm text-muted-foreground">Difference</div>
            <div className={cn('num mt-0.5 flex items-center gap-1.5 text-[18px] font-semibold leading-7', balanced ? 'text-tone-success' : 'text-tone-danger')}>
              {balanced && <CheckCircle2 className="h-4 w-4" />}
              <Money value={fromCents(difference)} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            Cleared balance <Money value={fromCents(clearedBalance)} className="font-medium text-foreground" />
            {' · '}
            {saving === 'saving' ? 'Saving…' : saving === 'error' ? <span className="text-tone-danger">Not saved</span> : saving === 'saved' ? 'Progress saved' : 'Checkmarks save as you go'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={cn(secondaryButton, 'text-tone-danger')} onClick={() => void discard()} disabled={Boolean(busy)}>{busy === 'discard' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Discard</button>
            <button type="button" className={secondaryButton} onClick={() => { if (dirty.current) void save(); onDone(); }} disabled={Boolean(busy)}>Finish later</button>
            <button type="button" className={primaryButton} onClick={() => void finish()} disabled={!balanced || Boolean(busy)} title={balanced ? undefined : 'Finish when the difference is zero'}>
              {busy === 'finish' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Finish reconciliation
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <CandidateList title="Deposits and credits" rows={deposits} checked={checked} onToggle={toggle} onAll={on => mark(() => setChecked(prev => { const n = new Set(prev); deposits.forEach(c => (on ? n.add(c.id) : n.delete(c.id))); return n; }))} />
        <CandidateList title="Checks and payments" rows={payments} checked={checked} onToggle={toggle} onAll={on => mark(() => setChecked(prev => { const n = new Set(prev); payments.forEach(c => (on ? n.add(c.id) : n.delete(c.id))); return n; }))} />
      </div>
      {data.laterCount > 0 && <p className="px-4 pb-4 text-sm text-muted-foreground">{plural(data.laterCount, 'transaction')} dated after {fullDate(rec.statementDate)} {data.laterCount === 1 ? 'isn’t' : 'aren’t'} shown — {data.laterCount === 1 ? 'it belongs' : 'they belong'} on a later statement.</p>}
      <div className="px-4 pb-24">
        <HistoryList data={data} accountId={accountId} />
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-background px-4 py-2.5">
      <div className="truncate text-sm text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-[16px] font-semibold leading-7">{value}</div>
    </div>
  );
}

function CandidateList({ title, rows, checked, onToggle, onAll }: { title: string; rows: Candidate[]; checked: Set<string>; onToggle: (id: string) => void; onAll: (on: boolean) => void }) {
  const ws = useWorkspace();
  const all = rows.length > 0 && rows.every(r => checked.has(r.id));
  const total = rows.filter(r => checked.has(r.id)).reduce((s, r) => s + Math.round(Math.abs(r.amount) * 100), 0) / 100;
  return (
    <section className="overflow-hidden rounded-lg border" aria-label={title}>
      <div className="group/row flex h-9 items-center gap-2 border-b bg-subtle/80 px-3">
        <RowCheckbox selected={all} selecting onToggle={() => onAll(!all)} />
        <h3 className="text-[14px] font-medium">{title}</h3>
        <span className="text-sm tabular-nums text-muted-foreground">{rows.filter(r => checked.has(r.id)).length} of {rows.length}</span>
        <Money value={total} className="ml-auto text-[14px] font-medium" />
      </div>
      {!rows.length ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing uncleared through the statement date.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          {rows.map(r => {
            const on = checked.has(r.id);
            return (
              <div key={r.id} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => onToggle(r.id)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(r.id); } }} className={cn('group/row flex min-h-10 cursor-default select-none items-center gap-2.5 border-b px-3 py-1 text-[14px] outline-none last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/60', on && 'bg-tone-success/[0.05]')}>
                <RowCheckbox selected={on} selecting onToggle={() => onToggle(r.id)} />
                <span className="w-[84px] shrink-0 tabular-nums text-muted-foreground">{fullDate(r.date).replace(/, \d{4}$/, '')}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate">{r.party || r.description}</span>
                  <span className="block truncate text-sm text-muted-foreground">{TXN_LABEL[r.kind] ?? r.kind} #{r.number}{r.reference ? ` · ${r.paymentMethod === 'Check' ? 'check ' : ''}${r.reference}` : ''}{r.propertyCount > 1 ? ` · ${r.propertyCount} properties` : r.propertyId ? ` · ${ws.propertyName(r.propertyId)}` : ''}</span>
                </span>
                <Money value={Math.abs(r.amount)} className={cn('shrink-0', on && 'font-medium')} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HistoryList({ data, accountId }: { data: ReconciliationData; accountId: string }) {
  const app = useAppActions();
  const qc = useQueryClient();
  const [undoing, setUndoing] = useState<string | null>(null);
  const history = data.history;
  const latestId = history[0]?.id;
  const undo = async (id: string, date: string) => {
    if (undoing) return;
    const ok = await app.confirm({
      title: `Undo the ${fullDate(date)} reconciliation?`,
      description: 'Its transactions become uncleared and it reopens as in progress, with your checkmarks kept. Discard it afterwards if you want to start over.',
      confirmLabel: 'Undo reconciliation',
      destructive: true,
    });
    if (!ok) return;
    setUndoing(id);
    try {
      await saveReconciliation({ action: 'undo', id });
      invalidate(qc, 'accounting');
      toast.success('Reconciliation reopened');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t undo the reconciliation'));
    } finally {
      setUndoing(null);
    }
  };
  const rows = useMemo(() => history, [history]);
  return (
    <section className="mt-8">
      <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-medium"><History className="h-3.5 w-3.5 text-muted-foreground" /> Reconciliation history</h3>
      {!rows.length ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">No finished reconciliations yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {rows.map(r => (
            <div key={r.id} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-[14px] last:border-b-0">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-tone-success" />
              <span className="w-28 shrink-0 font-medium tabular-nums">{fullDate(r.statementDate)}</span>
              <Money value={r.statementBalance} className="w-28 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{plural(r.transactions, 'transaction')} · {r.completedByName ?? 'Someone'}{r.completedAt ? `, ${dateTime(r.completedAt)}` : ''}</span>
              {r.id === latestId && !data.inProgress && (
                <button type="button" className="ghost-chip h-8 gap-1.5 text-sm" disabled={Boolean(undoing)} onClick={() => void undo(r.id, r.statementDate)}>
                  {undoing === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {data.inProgress && history.length > 0 && <Notice className="mt-2" tone="info">Finish or discard the reconciliation in progress to undo an earlier one.</Notice>}
    </section>
  );
}
