import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { updateOrgSettings } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { MOD, useHotkeys } from '../../lib/hotkeys';
import { invalidate } from '../../lib/queries';
import { EmptyState, Kbd } from '../primitives/bits';
import { SECTIONS, sk, useOrgSettings, type OrgSettings, type OrgSettingsData, type SectionKey } from './data';
import { validateSettings, type SettingsDraft, type SettingsKey } from './rules';

/**
 * How every Settings form behaves, in one place:
 *
 * - Edits collect in a draft; a "Save changes" bar slides up only while the
 *   draft differs from what is saved (⌘S or ⌘↵ saves, Discard reverts).
 * - Leaving with unsaved changes asks first — links anywhere in the app,
 *   the settings nav, closing the tab. Leaving another way (a G-then-letter
 *   shortcut) keeps the draft for this session and offers a way back.
 * - Errors show inline under the field as soon as a changed value is wrong,
 *   and for every field once someone tries to save.
 */

const stash = new Map<string, Record<string, unknown>>();

const same = (a: unknown, b: unknown) => (a === b ? true : JSON.stringify(a ?? null) === JSON.stringify(b ?? null));

export type Draft<T extends Record<string, unknown>> = {
  draft: T | null;
  saved: T | null;
  dirty: boolean;
  changed: Partial<T>;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  setMany: (patch: Partial<T>) => void;
  discard: () => void;
  /** Mark the current draft as saved. */
  commit: () => void;
};

export function useDraft<T extends Record<string, unknown>>(key: string, saved: T | null): Draft<T> {
  const [base, setBase] = useState<T | null>(saved);
  const [draft, setDraft] = useState<T | null>(() => (saved ? ({ ...saved, ...(stash.get(key) as Partial<T> | undefined) } as T) : null));
  const dirtyRef = useRef(false);

  const changed = useMemo(() => {
    const out: Partial<T> = {};
    if (!base || !draft) return out;
    for (const k of Object.keys(draft) as Array<keyof T>) if (!same(draft[k], base[k])) out[k] = draft[k];
    return out;
  }, [base, draft]);
  const dirty = Object.keys(changed).length > 0;
  dirtyRef.current = dirty;

  // Follow the server while nothing is being edited; restore a kept draft the first time data arrives.
  useEffect(() => {
    if (!saved) return;
    setBase(saved);
    setDraft(d => {
      if (!d) return { ...saved, ...(stash.get(key) as Partial<T> | undefined) } as T;
      return dirtyRef.current ? d : saved;
    });
  }, [saved, key]);

  const set = useCallback(<K extends keyof T>(k: K, value: T[K]) => setDraft(d => (d ? { ...d, [k]: value } : d)), []);
  const setMany = useCallback((patch: Partial<T>) => setDraft(d => (d ? { ...d, ...patch } : d)), []);
  const discard = useCallback(() => {
    stash.delete(key);
    setDraft(base);
  }, [base, key]);
  const commit = useCallback(() => {
    stash.delete(key);
    setBase(draft);
  }, [draft, key]);

  return { draft, saved: base, dirty, changed, set, setMany, discard, commit };
}

const DISCARD = { title: 'Discard unsaved changes?', description: 'You’ve changed settings on this page that aren’t saved yet.', confirmLabel: 'Discard changes', destructive: true };

/**
 * Ask before leaving with unsaved changes. Returns `leave(path)` for in-page
 * navigation that isn't a link (the mobile section picker, "Back").
 */
export function useUnsavedGuard({ key, label, dirty, draft, changed, discard }: { key: string; label: string; dirty: boolean; draft: unknown; changed: Record<string, unknown>; discard: () => void }) {
  const app = useAppActions();
  const navigate = useNavigate();
  const latest = useRef({ dirty, draft, changed, discard, label });
  latest.current = { dirty, draft, changed, discard, label };
  const leaving = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    leaving.current = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('data-allow-leave')) return;
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('#/')) return;
      const to = href.slice(1);
      if (to === window.location.hash.slice(1)) return;
      e.preventDefault();
      e.stopPropagation();
      void app.confirm(DISCARD).then(ok => {
        if (!ok) return;
        leaving.current = true;
        latest.current.discard();
        navigate(to);
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, app, navigate]);

  // Left without a link (a keyboard shortcut): keep the changes for when they come back.
  useEffect(() => {
    const here = window.location.hash.slice(1);
    return () => {
      const s = latest.current;
      if (!s.dirty || leaving.current) return;
      stash.set(key, s.changed);
      toast(`Your changes to ${s.label} aren’t saved`, { description: 'They’re kept until you reload.', action: { label: 'Go back', onClick: () => navigate(here) }, duration: 8000 });
    };
  }, [key, navigate]);

  return useCallback(
    async (to: string) => {
      if (latest.current.dirty) {
        const ok = await app.confirm(DISCARD);
        if (!ok) return false;
        leaving.current = true;
        latest.current.discard();
      }
      navigate(to);
      return true;
    },
    [app, navigate],
  );
}

/**
 * The bar that appears while a form has unsaved changes. Its buttons sit on
 * the left, clear of toasts in the bottom-right corner, and any toast still
 * showing when editing starts again is dismissed.
 */
export function SaveBar({ dirty, pending, errorCount, onSave, onDiscard, note }: { dirty: boolean; pending: boolean; errorCount: number; onSave: () => void; onDiscard: () => void; note?: ReactNode }) {
  useHotkeys({ 'mod+s': () => dirty && !pending && onSave(), 'mod+enter': () => dirty && !pending && onSave() }, { enabled: dirty, allowInInputs: ['mod+s', 'mod+enter'] });
  useEffect(() => {
    if (dirty) toast.dismiss();
  }, [dirty]);
  if (!dirty) return null;
  return (
    <div className="pointer-events-none sticky bottom-0 z-20 -mx-2 mt-8 pb-4 pt-2">
      <div role="region" aria-label="Unsaved changes" className="pointer-events-auto flex w-full max-w-[560px] flex-wrap items-center gap-2 rounded-lg border bg-popover p-2 pr-3.5 shadow-lg animate-fade-up">
        <button type="button" data-save onClick={onSave} disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-60">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save changes
          <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none sm:inline-flex">{MOD}S</Kbd>
        </button>
        <button type="button" data-discard onClick={onDiscard} disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
          <RotateCcw className="h-3.5 w-3.5" /> Discard
        </button>
        {errorCount > 0 ? (
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 text-[14px] text-tone-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {errorCount === 1 ? 'Fix the highlighted field to save' : `Fix ${errorCount} highlighted fields to save`}
          </span>
        ) : (
          <span className="ml-1 min-w-0 flex-1 truncate text-[14px] text-muted-foreground">{note ?? 'Unsaved changes'}</span>
        )}
      </div>
    </div>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────

export function SectionHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-[400px]">
        <h2 className="text-[20px] font-semibold leading-7 tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-[560px] text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A titled group of rows in one bordered surface. */
export function Group({ title, description, action, children, className, flush }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('mb-9 last:mb-0', className)}>
      {(title || action) && (
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-[14px] font-medium">{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </div>
      )}
      <div className={cn('overflow-hidden rounded-lg border bg-card shadow-2xs', !flush && 'divide-y')}>{children}</div>
    </section>
  );
}

/** A setting: what it is on the left, its control on the right (stacked on phones, or for wide controls). */
export function Row({ label, description, htmlFor, children, error, stacked, className, controlClassName }: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  error?: string | null;
  stacked?: boolean;
  className?: string;
  controlClassName?: string;
}) {
  return (
    <div className={cn('px-4 py-3.5', className)}>
      <div className={cn('flex flex-col gap-2.5', !stacked && 'sm:flex-row sm:items-center sm:justify-between sm:gap-6')}>
        <div className="min-w-0 flex-1">
          <label htmlFor={htmlFor} className="block text-[14px] font-medium">{label}</label>
          {description && <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{description}</div>}
        </div>
        <div className={cn('min-w-0', !stacked && 'sm:w-[260px] sm:shrink-0', controlClassName)}>{children}</div>
      </div>
      {error && <p role="alert" className={cn('mt-1.5 text-sm text-tone-danger', !stacked && 'sm:text-right')}>{error}</p>}
    </div>
  );
}

export function SectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-2 h-6 w-48" />
      <div className="skeleton mb-9 h-3.5 w-80 max-w-full" />
      <div className="skeleton mb-3 h-3.5 w-24" />
      <div className="divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-6 px-4 py-4">
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-32" />
              <div className="skeleton h-2.5" style={{ width: `${40 + ((i * 23) % 35)}%` }} />
            </div>
            <div className="skeleton hidden h-9 w-[260px] sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <EmptyState
      icon={<AlertCircle />}
      title="Couldn’t load these settings"
      description={errorMessage(error, 'The server didn’t respond. Check your connection and try again.')}
      action={<button type="button" onClick={onRetry} className="h-9 rounded-md border bg-background px-3 text-[14px] shadow-xs hover:bg-accent">Try again</button>}
    />
  );
}

// ── Organization settings forms ─────────────────────────────────────────

export type OrgForm<K extends SettingsKey> = {
  data: OrgSettingsData;
  draft: Pick<OrgSettings, K>;
  set: <F extends K>(key: F, value: Pick<OrgSettings, K>[F]) => void;
  setMany: (patch: Partial<Pick<OrgSettings, K>>) => void;
  errors: Partial<Record<SettingsKey, string>>;
  saved: Pick<OrgSettings, K>;
};

/**
 * A section that edits some of the organization's settings: loads them,
 * holds the draft, validates, saves only what changed and refreshes the app.
 */
export function OrgSettingsForm<K extends SettingsKey>({ section, fields, children, header }: { section: SectionKey; fields: readonly K[]; children: (form: OrgForm<K>) => ReactNode; header?: ReactNode }) {
  const q = useOrgSettings();
  const qc = useQueryClient();
  const def = SECTIONS.find(s => s.key === section)!;
  const fieldKey = fields.join(',');
  const saved = useMemo(() => (q.data ? (Object.fromEntries(fields.map(f => [f, q.data.settings[f as keyof OrgSettings]])) as Pick<OrgSettings, K>) : null), [q.data, fieldKey]);
  const form = useDraft(`org:${section}`, saved as Record<string, unknown> | null);
  const [pending, setPending] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const allErrors = useMemo(() => (form.draft ? validateSettings(form.draft as SettingsDraft) : {}), [form.draft]);
  const errors = useMemo(() => {
    if (showAll) return allErrors;
    const out: Partial<Record<SettingsKey, string>> = {};
    const lateTouched = ['lateFeeType', 'lateFeeAmount', 'lateFeePercent', 'lateFeeMax'].some(k => k in form.changed);
    for (const [k, v] of Object.entries(allErrors)) if (k in form.changed || (lateTouched && k.startsWith('lateFee'))) out[k as SettingsKey] = v;
    return out;
  }, [allErrors, form.changed, showAll]);
  useUnsavedGuard({ key: `org:${section}`, label: def.label, dirty: form.dirty, draft: form.draft, changed: form.changed as Record<string, unknown>, discard: form.discard });

  useEffect(() => {
    if (!form.dirty) setShowAll(false);
  }, [form.dirty]);

  const save = async () => {
    const errorKeys = Object.keys(allErrors);
    if (errorKeys.length) {
      setShowAll(true);
      document.querySelector<HTMLElement>(`[data-field="${errorKeys[0]}"] input, [data-field="${errorKeys[0]}"] textarea, [data-field="${errorKeys[0]}"] button`)?.focus();
      return;
    }
    setPending(true);
    try {
      const patch = form.changed as SettingsDraft;
      await updateOrgSettings({ patch: patch as never });
      qc.setQueryData<OrgSettingsData>(sk.org, old => (old ? { ...old, settings: { ...old.settings, ...(patch as Partial<OrgSettings>) } } : old));
      form.commit();
      invalidate(qc, 'bootstrap', 'settings');
      toast.success('Changes saved');
    } catch (e) {
      toast.error(errorMessage(e, 'Your changes weren’t saved. Try again.'));
    } finally {
      setPending(false);
    }
  };

  if (q.isPending) return <SectionSkeleton />;
  if (q.isError || !q.data) return <SectionError error={q.error} onRetry={() => void q.refetch()} />;
  if (!form.draft || !form.saved) return <SectionSkeleton />;

  return (
    <>
      {header ?? <SectionHeader title={def.label} description={def.description} />}
      {children({
        data: q.data,
        draft: form.draft as unknown as Pick<OrgSettings, K>,
        saved: form.saved as unknown as Pick<OrgSettings, K>,
        set: (k, v) => form.set(k as string, v as never),
        setMany: p => form.setMany(p as Record<string, unknown>),
        errors,
      })}
      <SaveBar dirty={form.dirty} pending={pending} errorCount={showAll ? Object.keys(allErrors).length : 0} onSave={() => void save()} onDiscard={form.discard} />
    </>
  );
}
