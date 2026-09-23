import { useEffect, useId, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@project/components/ui/dialog';
import { useReturnFocus } from '../lib/useReturnFocus';
import { Button, textareaClass } from './ui';

/**
 * A confirmation that says what will happen. Optionally asks for a short
 * note (a reason for withdrawing, recusing) before the action runs.
 */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, tone = 'primary', onConfirm, pending, note, error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: (note: string) => void;
  pending?: boolean;
  note?: { label: string; placeholder?: string; required?: boolean; requiredMessage?: string };
  error?: string | null;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  useReturnFocus(open);
  useEffect(() => {
    if (open) {
      setText('');
      setProblem(null);
    }
  }, [open]);

  const confirm = () => {
    if (note?.required && !text.trim()) {
      setProblem(note.requiredMessage ?? 'Add a short note before continuing.');
      return;
    }
    onConfirm(text.trim());
  };

  return (
    <Dialog open={open} onOpenChange={o => !pending && onOpenChange(o)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md gap-0 rounded-xl p-6">
        <DialogTitle className="pr-6 text-lg font-semibold leading-snug">{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</div>
        </DialogDescription>
        {note && (
          <div className="mt-4">
            <label htmlFor={id} className="text-[15px] font-medium">
              {note.label}
              {!note.required && <span className="ml-1.5 text-sm font-normal text-muted-foreground">(optional)</span>}
            </label>
            <textarea
              id={id}
              value={text}
              onChange={e => {
                setText(e.target.value);
                setProblem(null);
              }}
              placeholder={note.placeholder}
              maxLength={1000}
              aria-invalid={Boolean(problem) || undefined}
              aria-describedby={problem ? `${id}-error` : undefined}
              className={textareaClass('mt-2 min-h-[96px]')}
            />
            {problem && <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">{problem}</p>}
          </div>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg bg-tone-danger/[0.07] px-3 py-2 text-sm text-tone-danger">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={confirm} loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
