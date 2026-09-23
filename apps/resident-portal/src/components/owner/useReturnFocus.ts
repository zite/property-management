import { useCallback, useEffect, useRef } from 'react';

/**
 * Dialogs opened from state (no Radix `DialogTrigger`) have nothing to hand
 * focus back to, so closing one drops focus on <body>. This remembers what was
 * focused when the dialog opened and restores it on close — pass the returned
 * handler to `DialogContent`'s `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean) {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) previous.current = document.activeElement;
  }, [open]);
  return useCallback((e: Event) => {
    const el = previous.current;
    if (el && el.isConnected) {
      e.preventDefault();
      el.focus();
    }
  }, []);
}
