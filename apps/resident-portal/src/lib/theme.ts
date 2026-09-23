import { useEffect, useState } from 'react';

/** The portal follows the device's light or dark setting — applicants never have to find a toggle. */
const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function apply(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#0e1014' : '#f6f7f9'));
}

export function initSystemTheme() {
  if (typeof window === 'undefined') return;
  const mq = query();
  apply(mq.matches);
  mq.addEventListener('change', e => apply(e.matches));
}

export function useIsDark() {
  const [dark, setDark] = useState(() => typeof window !== 'undefined' && document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const mq = query();
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}
