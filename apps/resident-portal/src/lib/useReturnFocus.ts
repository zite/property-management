import { useLayoutEffect, useRef } from 'react';

/**
 * Put focus back where it was when a dialog closes.
 *
 * Dialogs opened from state rather than a Radix `DialogTrigger` have no
 * trigger to return to, so closing one leaves focus on <body> and a keyboard
 * user starts over from the top of the page. A layout effect records the
 * focused element before the dialog's own focus trap moves it, and once the
 * dialog has left the DOM the element gets focus back.
 */
export function useReturnFocus(open: boolean) {
  const previous = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      if (!wasOpen.current && active instanceof HTMLElement && active !== document.body && !active.closest('[role="dialog"]')) previous.current = active;
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = previous.current;
    previous.current = null;
    if (!el) return;
    let tries = 0;
    let timer = 0;
    const restore = () => {
      // Wait out the closing animation: while the dialog is mounted its focus trap would take focus straight back.
      if (document.querySelector('[role="dialog"]') && tries++ < 40) {
        timer = window.setTimeout(restore, 25);
        return;
      }
      const active = document.activeElement;
      if (el.isConnected && (!active || active === document.body)) el.focus({ preventScroll: true });
    };
    timer = window.setTimeout(restore, 0);
    return () => window.clearTimeout(timer);
  }, [open]);
}
