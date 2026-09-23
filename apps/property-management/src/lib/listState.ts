import { useCallback, useEffect, useMemo, useState } from 'react';

export type Layout = 'list' | 'board' | 'table';

export type ListOptions<G extends string = string, O extends string = string> = {
  layout: Layout;
  grouping: G;
  ordering: O;
  /** Display properties shown on rows/cards, in the order the area defines them. */
  properties: string[];
  showEmptyGroups: boolean;
  /** Include completed/closed/archived items. */
  showClosed: boolean;
};

export type Filters = Record<string, string[] | string | number | boolean | null | undefined>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return typeof fallback === 'object' && fallback && !Array.isArray(fallback) ? { ...fallback, ...parsed } : parsed;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be unavailable in embedded frames */
  }
}

/** Removes empty values so `{}` means "no filters" and dirty checks are exact. */
export function cleanFilters(f: Filters): Filters {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)));
}

export function countFilters(f: Filters, ignore: string[] = ['search']) {
  return Object.keys(cleanFilters(f)).filter(k => !ignore.includes(k)).length;
}

/**
 * A list surface's display options and filters, remembered per surface in
 * localStorage. A saved view seeds the defaults; edits on top stay local
 * until saved. Every list in the app uses this, so behaviour is uniform.
 */
export function useListState<G extends string, O extends string>(surfaceKey: string, defaults: ListOptions<G, O>, defaultFilters: Filters = {}) {
  const base = useMemo(() => defaults, [JSON.stringify(defaults)]);
  const baseFilters = useMemo(() => cleanFilters(defaultFilters), [JSON.stringify(defaultFilters)]);
  const optKey = `property-management:list:${surfaceKey}`;
  const filterKey = `property-management:filters:${surfaceKey}`;
  const [options, setOptionsState] = useState<ListOptions<G, O>>(() => read(optKey, base));
  const [filters, setFiltersState] = useState<Filters>(() => read(filterKey, baseFilters));

  useEffect(() => {
    setOptionsState(read(optKey, base));
    setFiltersState(read(filterKey, baseFilters));
  }, [optKey]);

  const setOptions = useCallback(
    (patch: Partial<ListOptions<G, O>>) =>
      setOptionsState(prev => {
        const next = { ...prev, ...patch };
        write(optKey, next);
        return next;
      }),
    [optKey],
  );

  const setFilters = useCallback(
    (next: Filters | ((prev: Filters) => Filters)) =>
      setFiltersState(prev => {
        const value = cleanFilters(typeof next === 'function' ? next(prev) : next);
        write(filterKey, value);
        return value;
      }),
    [filterKey],
  );

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(optKey);
      localStorage.removeItem(filterKey);
    } catch {
      /* ignore */
    }
    setOptionsState(base);
    setFiltersState(baseFilters);
  }, [optKey, filterKey, base, baseFilters]);

  const isDirty = useMemo(() => JSON.stringify(options) !== JSON.stringify(base) || JSON.stringify(filters) !== JSON.stringify(baseFilters), [options, filters, base, baseFilters]);

  return { options, setOptions, filters, setFilters, reset, isDirty };
}

/** Collapsed group keys for a grouped list, remembered per surface. */
export function useCollapsedGroups(surfaceKey: string) {
  const key = `property-management:collapsed:${surfaceKey}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(read<string[]>(key, [])));
  const toggle = useCallback(
    (group: string) =>
      setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(group)) next.delete(group);
        else next.add(group);
        write(key, [...next]);
        return next;
      }),
    [key],
  );
  return [collapsed, toggle] as const;
}
