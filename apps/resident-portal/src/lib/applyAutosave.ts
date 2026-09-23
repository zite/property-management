import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, errorStatus } from './errors';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline';

const RETRY_MS = [2000, 5000, 10000, 20000, 30000];

/**
 * Debounced autosave that never loses typing (the rental application).
 *
 * Every change bumps a version; saves run one at a time and loop until the
 * newest version is on the server. A failed save retries with backoff and
 * again the moment the connection returns. Each change is also copied to
 * localStorage until the server has it, so closing the tab mid-save loses
 * nothing — the page restores the copy on the next visit.
 */
export function useAutosave<T>(opts: {
  save: (value: T) => Promise<unknown>;
  delay?: number;
  storageKey?: string | null;
  /** A save the server refused for good (already submitted, not found). Retrying won't help. */
  onFatal?: (e: unknown) => void;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef(opts.save);
  saveRef.current = opts.save;
  const fatalRef = useRef(opts.onFatal);
  fatalRef.current = opts.onFatal;
  const keyRef = useRef(opts.storageKey);
  keyRef.current = opts.storageKey;
  const delay = opts.delay ?? 1000;

  const s = useRef({ version: 0, saved: 0, value: undefined as T | undefined, timer: 0, retry: 0, attempts: 0, running: null as Promise<void> | null, stopped: false });

  const run = useCallback((): Promise<void> => {
    const cur = s.current;
    if (cur.running) return cur.running;
    const job = (async () => {
      while (cur.version > cur.saved && !cur.stopped) {
        const version = cur.version;
        const value = cur.value as T;
        setState('saving');
        try {
          await saveRef.current(value);
          cur.saved = Math.max(cur.saved, version);
          cur.attempts = 0;
          setError(null);
          if (cur.saved >= cur.version) {
            setState('saved');
            setSavedAt(Date.now());
            clearBackup(keyRef.current);
          }
        } catch (e) {
          const status = errorStatus(e);
          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
            cur.stopped = true;
            setState('error');
            setError(errorMessage(e, "Your changes couldn't be saved."));
            fatalRef.current?.(e);
            break;
          }
          setState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
          setError(errorMessage(e, "Your changes couldn't be saved yet."));
          const wait = RETRY_MS[Math.min(cur.attempts, RETRY_MS.length - 1)];
          cur.attempts++;
          window.clearTimeout(cur.retry);
          cur.retry = window.setTimeout(() => void run(), wait);
          break;
        }
      }
    })();
    cur.running = job.finally(() => {
      cur.running = null;
    });
    return cur.running;
  }, []);

  const change = useCallback(
    (value: T) => {
      const cur = s.current;
      cur.version++;
      cur.value = value;
      setState(prev => (prev === 'offline' || prev === 'error' ? prev : 'dirty'));
      writeBackup(keyRef.current, value);
      window.clearTimeout(cur.timer);
      cur.timer = window.setTimeout(() => void run(), delay);
    },
    [delay, run],
  );

  /** Save now and resolve once the server has the latest version. Throws if it can't. */
  const flush = useCallback(async () => {
    const cur = s.current;
    window.clearTimeout(cur.timer);
    for (let i = 0; i < 3 && cur.version > cur.saved && !cur.stopped; i++) {
      await run();
      if (cur.version > cur.saved && !cur.stopped) {
        window.clearTimeout(cur.retry);
        await new Promise(r => setTimeout(r, 400 * (i + 1)));
      }
    }
    if (cur.version > cur.saved) throw new Error("Your latest changes haven't saved yet. Check your connection and try again.");
  }, [run]);

  const retryNow = useCallback(() => {
    const cur = s.current;
    cur.attempts = 0;
    window.clearTimeout(cur.retry);
    void run();
  }, [run]);

  useEffect(() => {
    const cur = s.current;
    const online = () => {
      if (cur.version > cur.saved && !cur.stopped) retryNow();
    };
    const offline = () => {
      if (cur.version > cur.saved) setState('offline');
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (cur.version > cur.saved && !cur.stopped) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('beforeunload', beforeUnload);
      // Leaving the page within the debounce window still saves.
      window.clearTimeout(cur.timer);
      window.clearTimeout(cur.retry);
      if (cur.version > cur.saved && !cur.stopped) void run();
    };
  }, [retryNow, run]);

  const pending = () => s.current.version > s.current.saved;
  return { state, savedAt, error, change, flush, retryNow, pending };
}

type Backup<T> = { value: T; at: number };

function writeBackup<T>(key: string | null | undefined, value: T) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ value, at: Date.now() }));
  } catch {
    /* storage full or blocked — the server save still runs */
  }
}

function clearBackup(key: string | null | undefined) {
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** A local copy newer than what the server last saved, if the tab closed before a save landed. */
export function readBackup<T>(key: string, serverSavedAt: string | null | undefined): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup<T>;
    const server = serverSavedAt ? Date.parse(serverSavedAt) : 0;
    if (!b || typeof b.at !== 'number' || b.at <= server) {
      localStorage.removeItem(key);
      return null;
    }
    return b.value;
  } catch {
    return null;
  }
}
