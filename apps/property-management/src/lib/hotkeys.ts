import { useEffect, useRef } from 'react';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

/** Typing in a field, or a menu/dialog owning the keyboard, must never trigger a shortcut. */
export function shouldIgnore(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.closest('[role="menu"], [role="listbox"], [cmdk-root]')) return true;
  return false;
}

export function hasOpenOverlay() {
  // Tooltips also mount popper wrappers, so match roles rather than the wrapper.
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]'));
}

function matches(e: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop()!;
  const needMod = parts.includes('mod');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  const mod = e.metaKey || e.ctrlKey;
  if (needMod !== mod) return false;
  if (needAlt !== e.altKey) return false;
  const k = e.key.toLowerCase();
  // "?" and other shifted symbols are matched on the produced character, not the shift flag.
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return k === key;
  if (needShift !== e.shiftKey) return false;
  if (key === 'space') return e.code === 'Space';
  if (key === 'esc' || key === 'escape') return k === 'escape';
  if (key === 'enter') return k === 'enter';
  if (key === 'backspace' || key === 'delete') return k === 'backspace' || k === 'delete';
  if (key === 'up') return k === 'arrowup';
  if (key === 'down') return k === 'arrowdown';
  if (key === 'left') return k === 'arrowleft';
  if (key === 'right') return k === 'arrowright';
  return k === key;
}

export type HotkeyMap = Record<string, (e: KeyboardEvent) => unknown>;

/**
 * Bindings like `{ 'mod+k': fn, 'shift+x': fn, s: fn }`. Handlers always see the
 * latest closure (kept in a ref), so callers needn't memoise.
 */
export function useHotkeys(map: HotkeyMap, opts: { enabled?: boolean; allowInOverlay?: boolean; allowInInputs?: string[] } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const { enabled = true, allowInOverlay = false, allowInInputs = [] } = opts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      for (const [combo, handler] of Object.entries(ref.current)) {
        if (!matches(e, combo)) continue;
        if (shouldIgnore(e) && !allowInInputs.includes(combo)) continue;
        if (!allowInOverlay && hasOpenOverlay() && !allowInInputs.includes(combo)) continue;
        // A handler that returns false declines (nothing to act on), so another binding may take the key.
        if (handler(e) === false) continue;
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, allowInOverlay, allowInInputs.join(',')]);
}
