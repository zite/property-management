import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';

function systemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  return dark ? 'dark' : 'light';
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem('property-management:theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));

  useEffect(() => {
    setResolved(apply(pref));
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(apply('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  // Keep every hook instance (sidebar, palette, settings) in sync.
  useEffect(() => {
    const onStorage = () => setPrefState(readPref());
    window.addEventListener('property-management:theme', onStorage);
    return () => window.removeEventListener('property-management:theme', onStorage);
  }, []);

  const setPref = useCallback((next: ThemePref) => {
    try {
      localStorage.setItem('property-management:theme', next);
    } catch {
      /* ignore */
    }
    setPrefState(next);
    window.dispatchEvent(new Event('property-management:theme'));
  }, []);

  const toggle = useCallback(() => setPref(resolved === 'dark' ? 'light' : 'dark'), [resolved, setPref]);

  return { pref, resolved, setPref, toggle };
}
