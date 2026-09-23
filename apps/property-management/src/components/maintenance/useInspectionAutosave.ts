import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveInspection } from 'zitejs/api';
import { areaStats, type InspectionItem } from '@project/shared/inspections';
import { errorMessage } from '../../lib/errors';
import { mk, type InspectionDetail } from './data';

export type ItemPatch = Partial<Pick<InspectionItem, 'condition' | 'notes' | 'photos'>>;
export type SaveState = 'saving' | 'saved' | 'error';

type Pending = { areaId: string; itemId: string; patch: ItemPatch };

/**
 * Item-by-item autosave for a walkthrough.
 *
 * Every change is applied to the cached inspection at once (the progress bar,
 * counts and comparison update as you tap). Changes to one item are merged
 * and sent after a short pause — immediately for a condition or a photo,
 * after typing stops for notes. Requests go out one at a time, in order: the
 * checklist is a single JSON document on the server, so two saves racing
 * would lose one of them (and the platform refuses bursts of parallel
 * writes). Anything waiting is flushed when the page is hidden or closed.
 * A failed save keeps what the person entered on screen and offers a retry.
 */
export function useInspectionAutosave(inspectionId: string) {
  const qc = useQueryClient();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(new Map<string, Pending>());
  const failed = useRef(new Map<string, Pending>());
  const timers = useRef(new Map<string, number>());
  const inFlight = useRef(0);
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [busy, setBusy] = useState(false);

  const setState = (key: string, state: SaveState | null) =>
    setStates(prev => {
      const next = { ...prev };
      if (state) next[key] = state;
      else delete next[key];
      return next;
    });

  const applyLocal = useCallback(
    (areaId: string, itemId: string, patch: ItemPatch) => {
      qc.setQueryData<InspectionDetail>(mk.inspection(inspectionId), old => {
        if (!old) return old;
        const areas = old.areas.map(a => (a.id !== areaId ? a : { ...a, items: a.items.map(i => (i.id === itemId ? { ...i, ...patch } : i)) }));
        const starting = old.inspection.status === 'Scheduled' && Boolean(patch.condition);
        return { ...old, areas, inspection: { ...old.inspection, status: starting ? 'In progress' : old.inspection.status, stats: areaStats(areas) } };
      });
    },
    [qc, inspectionId],
  );

  const send = useCallback(
    (key: string, entry: Pending) => {
      inFlight.current++;
      setBusy(true);
      setState(key, 'saving');
      queue.current = queue.current.then(async () => {
        try {
          await saveInspection({ action: 'item', id: inspectionId, areaId: entry.areaId, itemId: entry.itemId, patch: entry.patch });
          failed.current.delete(key);
          setState(key, pending.current.has(key) ? 'saving' : 'saved');
          window.setTimeout(() => setStates(prev => (prev[key] === 'saved' ? (({ [key]: _, ...rest }) => rest)(prev) : prev)), 1600);
        } catch (e) {
          const prior = failed.current.get(key);
          failed.current.set(key, { ...entry, patch: { ...prior?.patch, ...entry.patch } });
          setState(key, 'error');
          toast.error(errorMessage(e, 'A change didn’t save'), { id: `inspection-save-${inspectionId}`, description: 'It’s still on screen. Tap Retry on the item, or check your connection.' });
        } finally {
          inFlight.current--;
          if (inFlight.current === 0) {
            setBusy(false);
            // Lists only: refetching the open inspection mid-walkthrough could overwrite what's being typed.
            void qc.invalidateQueries({ queryKey: mk.inspectionLists });
          }
        }
      });
    },
    [inspectionId, qc],
  );

  const flush = useCallback(
    (key: string) => {
      const entry = pending.current.get(key);
      window.clearTimeout(timers.current.get(key));
      timers.current.delete(key);
      if (!entry) return;
      pending.current.delete(key);
      applyLocal(entry.areaId, entry.itemId, entry.patch);
      send(key, entry);
    },
    [send, applyLocal],
  );

  const flushAll = useCallback(() => {
    for (const key of [...pending.current.keys()]) flush(key);
  }, [flush]);

  const change = useCallback(
    (areaId: string, itemId: string, patch: ItemPatch, delay = 0) => {
      // Taps show everywhere at once; typing stays in the field until it's sent, so a keystroke doesn't re-render the checklist.
      if (delay <= 0) applyLocal(areaId, itemId, patch);
      const key = `${areaId}/${itemId}`;
      // A save that failed earlier rides along with the next change, so nothing on screen is left unsaved.
      const merged = { areaId, itemId, patch: { ...failed.current.get(key)?.patch, ...pending.current.get(key)?.patch, ...patch } };
      pending.current.set(key, merged);
      setState(key, 'saving');
      window.clearTimeout(timers.current.get(key));
      if (delay <= 0) flush(key);
      else timers.current.set(key, window.setTimeout(() => flush(key), delay));
    },
    [applyLocal, flush],
  );

  const retry = useCallback(
    (areaId: string, itemId: string) => {
      const key = `${areaId}/${itemId}`;
      const entry = failed.current.get(key);
      if (entry) send(key, entry);
    },
    [send],
  );

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flushAll();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushAll);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushAll);
      flushAll();
    };
  }, [flushAll]);

  /**
   * Run a whole-checklist change (add or remove an item or area, fill a room)
   * in line with item saves, after everything typed so far has been sent.
   */
  const enqueue = useCallback(
    function run<T>(fn: () => Promise<T>): Promise<T> {
      flushAll();
      const result = queue.current.then(fn);
      queue.current = result.then(() => undefined, () => undefined);
      return result;
    },
    [flushAll],
  );

  /** Resolves once everything typed so far has been sent and answered. */
  const settle = useCallback(async () => {
    flushAll();
    await queue.current;
  }, [flushAll]);

  const errorCount = Object.values(states).filter(s => s === 'error').length;
  const waiting = Object.values(states).some(s => s === 'saving');
  return { change, retry, settle, enqueue, states, saving: busy || waiting, errorCount };
}
