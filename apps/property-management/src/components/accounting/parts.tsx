import { ArrowDown, ArrowUp, FileText, Loader2, MoreHorizontal, Paperclip, Wallet, X } from 'lucide-react';
import { forwardRef, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { Kbd, IconButton, Tip } from '../primitives/bits';
import { PageHeader } from '../shell/PageHeader';

/** The six accounting areas, in header order. */
export const ACCOUNTING_TABS = [
  { key: 'receivables', label: 'Receivables' },
  { key: 'payables', label: 'Payables' },
  { key: 'banking', label: 'Banking' },
  { key: 'owners', label: 'Owners' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'chart', label: 'Chart of accounts' },
] as const;
export type AccountingTab = (typeof ACCOUNTING_TABS)[number]['key'];

export function AccountingHeader({ tab, actions, children }: { tab: AccountingTab; actions?: ReactNode; children?: ReactNode }) {
  const ws = useWorkspace();
  return (
    <PageHeader
      icon={<Wallet />}
      title="Accounting"
      tabs={ACCOUNTING_TABS.map(t => ({ to: `/accounting/${t.key}`, label: t.label, active: t.key === tab, count: t.key === 'payables' && ws.can('payables.manage') ? ws.counts.billsDue : null }))}
      actions={actions}
    >
      {children}
    </PageHeader>
  );
}

export const primaryButton = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50';
export const secondaryButton = 'ghost-chip h-8 shrink-0 gap-1.5 text-[13.5px] disabled:pointer-events-none disabled:opacity-50';

/** A header action: icon + label (label hides on phones) + optional shortcut hint. */
export const HeaderButton = forwardRef<HTMLButtonElement, { icon: ReactNode; label: string; onClick: () => void; primary?: boolean; keys?: string[]; disabled?: boolean }>(
  ({ icon, label, onClick, primary, keys, disabled }, ref) => {
    const button = (
      <button ref={ref} type="button" onClick={onClick} disabled={disabled} className={primary ? primaryButton : secondaryButton} aria-label={label}>
        <span className="flex [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        <span className="hidden sm:inline">{label}</span>
        {keys && primary && <Kbd className="ml-0.5 hidden border-white/20 bg-white/15 text-current shadow-none lg:inline-flex">{keys.join('')}</Kbd>}
      </button>
    );
    return keys ? <Tip label={label} keys={keys}>{button}</Tip> : button;
  },
);
HeaderButton.displayName = 'HeaderButton';

// ── Sorting ──────────────────────────────────────────────────────────────────

export type Sort = { key: string; dir: 'asc' | 'desc' };
type Sorter<T> = (row: T) => string | number | null | undefined;

/**
 * Controlled sorting, so keyboard navigation walks rows in the order they're
 * shown. Money columns start descending.
 */
export function useSorted<T>(rows: T[], sorters: Record<string, Sorter<T>>, initial: Sort) {
  const [sort, setSort] = useState<Sort>(initial);
  const sorted = useMemo(() => {
    const val = sorters[sort.key];
    if (!val) return rows;
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, sorters]);
  const toggle = (key: string, numeric?: boolean) => setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numeric ? 'desc' : 'asc' }));
  return { sorted, sort, toggle };
}

export function SortHeader({ label, sortKey, sort, onToggle, align, numeric }: { label: ReactNode; sortKey: string; sort: Sort; onToggle: (key: string, numeric?: boolean) => void; align?: 'right'; numeric?: boolean }) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey, numeric)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground', active && 'text-foreground', align === 'right' && 'flex-row-reverse')}
    >
      {label}
      {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
}

// ── Summary strip ────────────────────────────────────────────────────────────

export type StripItem = { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'success' | 'warning' | 'muted'; onClick?: () => void; active?: boolean; /** Leave out on phones, where the strip would push the list off screen. */ secondary?: boolean };

/** A dense row of figures above a list — the numbers you'd otherwise scroll to the footer for. */
export function SummaryStrip({ items, className }: { items: StripItem[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 border-b sm:flex sm:overflow-x-auto sm:scrollbar-none', className)}>
      {[...items.filter(i => !i.secondary), ...items.filter(i => i.secondary)].map((i, n) => {
        const Comp = i.onClick ? 'button' : 'div';
        return (
          <Comp
            key={i.label}
            type={i.onClick ? 'button' : undefined}
            onClick={i.onClick}
            className={cn(
              'min-w-0 border-border px-4 py-2.5 text-left sm:min-w-[130px] sm:shrink-0 sm:border-r',
              n % 2 === 0 && 'border-r sm:border-r',
              n >= 2 && 'border-t sm:border-t-0',
              i.onClick && 'transition-colors hover:bg-accent/50',
              i.active && 'bg-accent/60',
              i.secondary && 'hidden sm:block',
            )}
          >
            <div className="truncate text-sm text-muted-foreground">{i.label}</div>
            <div className={cn('num mt-0.5 truncate text-[16px] font-semibold leading-5', i.tone === 'danger' && 'text-tone-danger', i.tone === 'success' && 'text-tone-success', i.tone === 'warning' && 'text-tone-warning', i.tone === 'muted' && 'text-muted-foreground')}>{i.value}</div>
            {i.hint && <div className="truncate text-sm text-muted-foreground">{i.hint}</div>}
          </Comp>
        );
      })}
    </div>
  );
}

// ── Row menu ─────────────────────────────────────────────────────────────────

/** The "…" on a table row. Stops the click reaching the row. */
export function RowMenu({ label, children, width = 'w-56' }: { label: string; children: ReactNode; width?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label={label} className="opacity-60 group-hover/row:opacity-100 data-[state=open]:opacity-100" onClick={e => e.stopPropagation()}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={width} onClick={e => e.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const menuItem = 'h-9 gap-2 text-[14px] [&_svg]:h-3.5 [&_svg]:w-3.5';
export const menuItemDanger = `${menuItem} text-tone-danger focus:text-tone-danger`;

// ── Bank account label ───────────────────────────────────────────────────────

export function bankLabel(account: { name: string; accountLast4?: string | null } | undefined | null) {
  if (!account) return '';
  return `${account.name}${account.accountLast4 ? ` ··${account.accountLast4}` : ''}`;
}

// ── Attachments ──────────────────────────────────────────────────────────────

export function fileNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const named = u.searchParams.get('name');
    if (named) return named;
    return decodeURIComponent(u.pathname.split('/').pop() || 'Attachment');
  } catch {
    return 'Attachment';
  }
}

/** Upload one file (an invoice, a receipt) and hold its URL. */
export function AttachmentField({ value, onChange, disabled, placeholder = 'Attach the invoice (PDF or photo)' }: { value: string | null; onChange: (url: string | null) => void; disabled?: boolean; placeholder?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast.error('That file is over 20 MB. Attach a smaller copy.');
    setUploading(file.name);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      onChange(fileUrl);
    } catch (e) {
      toast.error(errorMessage(e, 'The file didn’t upload. Try again.'));
    } finally {
      setUploading(null);
      if (input.current) input.current.value = '';
    }
  };
  if (value) {
    return (
      <div className="field items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <a href={value} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{fileNameFromUrl(value)}</a>
        {!disabled && (
          <button type="button" aria-label="Remove attachment" onClick={() => onChange(null)} className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <input ref={input} type="file" className="sr-only" accept="application/pdf,image/*" onChange={e => void pick(e.target.files?.[0])} tabIndex={-1} />
      <button type="button" disabled={disabled || Boolean(uploading)} onClick={() => input.current?.click()} className="field items-center gap-2 text-left text-muted-foreground hover:text-foreground disabled:opacity-60">
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
        <span className="truncate">{uploading ? `Uploading ${uploading}…` : placeholder}</span>
      </button>
    </>
  );
}

/** A thin note above a form or list. */
export function Notice({ tone = 'info', children, className, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2 text-[14px]',
        tone === 'info' && 'border-tone-info/25 bg-tone-info/[0.06]',
        tone === 'warning' && 'border-tone-warning/30 bg-tone-warning/[0.07]',
        tone === 'danger' && 'border-tone-danger/30 bg-tone-danger/[0.06]',
        tone === 'success' && 'border-tone-success/30 bg-tone-success/[0.06]',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
