import { Loader2 } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { cn } from '@project/components/lib/utils';
import { MOD } from '../../lib/hotkeys';
import { Kbd } from '../primitives/bits';

/**
 * The one dialog shape for creating and editing things.
 *
 * Header, scrollable body, footer with Cancel and the primary action. ⌘↵
 * submits from anywhere inside (including textareas), Enter submits from
 * single-line fields, Esc cancels. The first field is focused on open — not
 * the close button — and focus returns to whatever opened the dialog.
 */
export function FormDialog({
  open, onOpenChange, title, description, children, onSubmit, submitLabel = 'Save', pending, disabled, destructive, size = 'md', footerStart, className, hideFooter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footerStart?: ReactNode;
  className?: string;
  hideFooter?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  // Edit dialogs render their fields after data loads: once they appear, focus the first one —
  // but only if nothing inside the dialog has focus yet, so this never steals it.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const form = formRef.current;
      const active = document.activeElement;
      if (!form || (active && form.contains(active) && active !== form)) return;
      if (active && active !== document.body && active.getAttribute('role') !== 'dialog') return;
      const first = form.querySelector<HTMLElement>('[data-autofocus]') ?? form.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, button[aria-haspopup], [role=combobox]');
      first?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (pending || disabled) return;
    void onSubmit();
  };

  return (
    <Dialog open={open} onOpenChange={o => !pending && onOpenChange(o)}>
      <DialogContent
        className={cn(
          'flex max-h-[min(88vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl [&>button:last-child]:hidden',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
          size === 'xl' && 'max-w-4xl',
          className,
        )}
        onOpenAutoFocus={e => {
          const form = formRef.current;
          const first = form?.querySelector<HTMLElement>('[data-autofocus]') ?? form?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, button[aria-haspopup], [role=combobox]');
          if (first) {
            e.preventDefault();
            first.focus();
          }
        }}
        onCloseAutoFocus={e => {
          if (lastFocus.current && document.contains(lastFocus.current)) {
            e.preventDefault();
            lastFocus.current.focus();
          }
        }}
      >
        <form
          ref={formRef}
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        >
          <div className="border-b px-5 pb-3.5 pt-4">
            <DialogTitle className="text-[16px] font-semibold tracking-tight">{title}</DialogTitle>
            {description ? <DialogDescription className="mt-1 text-[14px] text-muted-foreground">{description}</DialogDescription> : <DialogDescription className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogDescription>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {!hideFooter && (
            <div className="flex items-center gap-2 border-t bg-subtle/60 px-5 py-3">
              <div className="min-w-0 flex-1 text-sm text-muted-foreground">{footerStart}</div>
              <button type="button" onClick={() => onOpenChange(false)} disabled={pending} className="h-9 rounded-md px-3 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || disabled}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-[14px] font-medium shadow-xs transition-colors disabled:pointer-events-none disabled:opacity-50',
                  destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {submitLabel}
                <Kbd className="hidden border-white/20 bg-white/15 text-current shadow-none sm:inline-flex">{MOD}↵</Kbd>
              </button>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
