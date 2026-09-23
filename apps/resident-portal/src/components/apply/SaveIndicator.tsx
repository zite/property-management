import { AlertCircle, Check, CloudOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@project/components/lib/utils';
import type { SaveState } from '../../lib/applyAutosave';
import { timeAgo } from '../../lib/format';

/** A calm, always-truthful answer to "is my application saved?" */
export function SaveIndicator({ state, savedAt, serverSavedAt, onRetry, className }: { state: SaveState; savedAt: number | null; serverSavedAt?: string | null; onRetry: () => void; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick(x => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const last = savedAt ? new Date(savedAt).toISOString() : serverSavedAt ?? null;

  let content;
  if (state === 'saving' || state === 'dirty') {
    content = (
      <>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
      </>
    );
  } else if (state === 'offline') {
    content = (
      <>
        <CloudOff className="h-4 w-4 text-tone-warning" aria-hidden />
        <span>Offline — we’ll save when you reconnect</span>
      </>
    );
  } else if (state === 'error') {
    content = (
      <>
        <AlertCircle className="h-4 w-4 text-tone-danger" aria-hidden />
        <span>Not saved yet</span>
        <button type="button" onClick={onRetry} className="rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
          Retry
        </button>
      </>
    );
  } else if (last) {
    content = (
      <>
        <Check className="h-4 w-4 text-tone-success" aria-hidden />
        <span>Saved {timeAgo(last)}</span>
      </>
    );
  } else {
    content = <span>Your answers save as you go</span>;
  }
  return (
    <p role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
      {content}
    </p>
  );
}
