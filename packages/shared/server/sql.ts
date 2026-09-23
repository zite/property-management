/**
 * Small, boring helpers for reading `zite.sql()` rows.
 *
 * Three runtime facts shape all of them — none of which a typecheck can see:
 *
 *   - Unset TEXT fields are stored as '' and are NEVER NULL in SQL, even after
 *     writing an explicit null. So "has no assignee" is `COALESCE(col, '') = ''`,
 *     never `col IS NULL` — the latter silently matches nothing.
 *   - Numbers, counts and sums arrive as strings.
 *   - Date-only fields arrive as full ISO timestamps.
 */

/** A text value, or null. */
export const str = (v: unknown): string | null => (v == null ? null : String(v));

/** A foreign-key text column: '' means "not set", so it becomes null. */
export const ref = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/** A number that must be present. */
export const num = (v: unknown, fallback = 0): number => {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** A number that may legitimately be unset. */
export const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Date-only fields: keep the calendar day. */
export const day = (v: unknown): string | null => (v == null || v === '' ? null : String(v).slice(0, 10));

/** Datetime fields, normalised to ISO. */
export const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

export const bool = (v: unknown): boolean => v === true || v === 'true';

/** "Is this text column empty" in SQL, given the '' storage rule above. */
export const isBlank = (col: string) => `COALESCE(${col}, '') = ''`;
export const isSet = (col: string) => `COALESCE(${col}, '') <> ''`;

/** Accumulates bound parameters so a clause never interpolates a value. */
export class Params {
  values: unknown[] = [];

  add(v: unknown) {
    this.values.push(v);
    return `$${this.values.length}`;
  }

  list(vs: unknown[]) {
    return `(${vs.map(v => this.add(v)).join(', ')})`;
  }
}

/** `($1, $2, …)` for a list of ids when there is nothing else bound. */
export function placeholders(count: number, offset = 0) {
  return `(${Array.from({ length: count }, (_, i) => `$${i + offset + 1}`).join(', ')})`;
}

/** bulkCreate takes at most 100 records per call. */
export async function chunked<T>(records: T[], insert: (batch: T[]) => Promise<void>, size = 100) {
  for (let i = 0; i < records.length; i += size) {
    await insert(records.slice(i, i + size));
  }
}

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** A JSON text column, parsed, or the fallback when empty or malformed. */
export function json<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v as T;
  try {
    const parsed = JSON.parse(String(v));
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** `COALESCE(col, false) = false` — checkboxes that were never set read NULL. */
export const notTrue = (col: string) => `COALESCE(${col}, false) = false`;

/** Retry a write that the platform rate-limited, with a short backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!/too many requests|rate.?limit|429|ECONNRESET|socket hang up/i.test(String((e as Error)?.message ?? e))) throw e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

/** Run async work over items with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
