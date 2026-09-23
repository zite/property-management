import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useHotkeys } from '../../lib/hotkeys';

/**
 * Focus, selection and keyboard navigation for any list, board or table.
 *
 *   J / K or ↓ / ↑   move focus          ⇧J / ⇧K   extend selection
 *   X                select focused      ⌘A        select all visible
 *   ↵                open focused        Space     peek focused
 *   Esc              clear selection, then focus
 *
 * Clicking a row opens it; ⌘/Ctrl/⇧-click or clicking while anything is
 * selected toggles selection (⇧ selects a range from the last toggled row).
 * Area-specific shortcuts use `targets()` — the selection if there is one,
 * else the focused row — so every action works on one item or many.
 */
export function useListNav<T>({ items, getId, onOpen, onPeek, enabled = true }: {
  items: T[];
  getId: (item: T) => string;
  onOpen?: (item: T) => void;
  onPeek?: (item: T) => void;
  enabled?: boolean;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(items.map(i => [getId(i), i])), [items, getId]);
  const index = useMemo(() => new Map(items.map((i, n) => [getId(i), n])), [items, getId]);

  // Drop selections that scrolled out of the data (deleted, filtered away).
  useEffect(() => {
    setSelection(prev => {
      const next = new Set([...prev].filter(id => byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byId]);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const toggleSelect = useCallback(
    (item: T, e?: { shiftKey?: boolean }) => {
      const id = getId(item);
      setSelection(prev => {
        const next = new Set(prev);
        if (e?.shiftKey && anchor.current && index.has(anchor.current)) {
          const a = index.get(anchor.current)!;
          const b = index.get(id) ?? a;
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) next.add(getId(items[n]));
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
      setFocusedId(id);
    },
    [getId, index, items],
  );

  const onRowClick = useCallback(
    (item: T, e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || selectionRef.current.size > 0) {
        e.preventDefault();
        toggleSelect(item, e);
        return;
      }
      onOpen?.(item);
    },
    [onOpen, toggleSelect],
  );

  const focusAt = (n: number, extend?: boolean) => {
    const next = items[Math.max(0, Math.min(items.length - 1, n))];
    if (!next) return;
    const id = getId(next);
    if (extend) setSelection(prev => new Set(prev).add(id).add(focusedId ?? id));
    setFocusedId(id);
    window.setTimeout(() => scrollRef.current?.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
  };
  const focusIndex = focusedId ? index.get(focusedId) ?? -1 : -1;
  const focused = focusedId ? byId.get(focusedId) : undefined;
  const selected = useMemo(() => items.filter(i => selection.has(getId(i))), [items, selection, getId]);
  const targets = useCallback((): T[] => (selectionRef.current.size ? items.filter(i => selectionRef.current.has(getId(i))) : focused ? [focused] : []), [items, focused, getId]);
  /** For a row's own menu: the selection if this row is part of it, else just this row. */
  const targetsFor = useCallback((item: T): T[] => {
    const sel = selectionRef.current;
    return sel.size > 1 && sel.has(getId(item)) ? items.filter(i => sel.has(getId(i))) : [item];
  }, [items, getId]);

  useHotkeys(
    {
      j: () => focusAt(focusIndex + 1),
      down: () => focusAt(focusIndex + 1),
      k: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
      up: () => focusAt(focusIndex < 0 ? 0 : focusIndex - 1),
      'shift+j': () => focusAt(focusIndex + 1, true),
      'shift+down': () => focusAt(focusIndex + 1, true),
      'shift+k': () => focusAt(focusIndex - 1, true),
      'shift+up': () => focusAt(focusIndex - 1, true),
      x: () => focused && toggleSelect(focused),
      'mod+a': () => setSelection(new Set(items.map(getId))),
      esc: () => (selectionRef.current.size ? setSelection(new Set()) : setFocusedId(null)),
      enter: () => focused && onOpen?.(focused),
      space: () => focused && (onPeek ?? onOpen)?.(focused),
    },
    { enabled },
  );

  return {
    selection,
    setSelection,
    clearSelection: () => setSelection(new Set()),
    selected,
    focusedId,
    setFocusedId,
    focused,
    toggleSelect,
    onRowClick,
    onHover: (item: T) => setFocusedId(getId(item)),
    targets,
    targetsFor,
    scrollRef,
    selecting: selection.size > 0,
  };
}

export type ListNav<T> = ReturnType<typeof useListNav<T>>;
