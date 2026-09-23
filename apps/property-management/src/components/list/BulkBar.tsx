import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';

/** The floating bar that appears when rows are selected. Children are the actions. */
export function BulkBar({ count, noun = ['item', 'items'], onClear, children, className }: { count: number; noun?: [string, string]; onClear: () => void; children: ReactNode; className?: string }) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div role="toolbar" aria-label="Bulk actions" className={cn('pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 shadow-xl animate-fade-up', className)}>
        <div className="flex h-9 items-center gap-2 border-r pl-2.5 pr-2">
          <span className="whitespace-nowrap text-[14px] font-medium tabular-nums">
            {count} {count === 1 ? noun[0] : noun[1]}
          </span>
          <button type="button" onClick={onClear} aria-label="Clear selection" className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const bulkButton = 'ghost-chip h-9 gap-1.5 px-2.5 text-[14px] text-foreground/90 hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5';
