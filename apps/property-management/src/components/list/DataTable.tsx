import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { RowCheckbox } from './GroupedList';

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Hide below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  footer?: ReactNode;
};

const HIDE: Record<string, string> = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

/**
 * Dense, sortable tables for ledgers, rent rolls and reports: sticky header,
 * tabular numbers, right-aligned money, optional totals footer, optional
 * selection and keyboard focus (pass `focusedId`/`onHover` from useListNav).
 */
export function DataTable<T>({
  rows, columns, getId, onRowClick, defaultSort, empty, className, selection, onToggleSelect, onSelectAll, focusedId, onHover, rowClassName, maxHeight, stickyHeader = true, dense, caption,
}: {
  rows: T[];
  columns: Column<T>[];
  getId: (row: T) => string;
  onRowClick?: (row: T, e: MouseEvent) => void;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  className?: string;
  selection?: Set<string>;
  onToggleSelect?: (row: T, e: MouseEvent) => void;
  onSelectAll?: (all: boolean) => void;
  focusedId?: string | null;
  onHover?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  maxHeight?: number | string;
  stickyHeader?: boolean;
  dense?: boolean;
  caption?: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col?.sort) return rows;
    const val = col.sort;
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);
  const hasFooter = columns.some(c => c.footer !== undefined);
  const selectable = Boolean(selection && onToggleSelect);
  const allSelected = selectable && rows.length > 0 && rows.every(r => selection!.has(getId(r)));

  if (!rows.length && empty) return <>{empty}</>;

  return (
    <div className={cn('relative overflow-auto', className)} style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 text-[14px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            {selectable && (
              <th className="w-9 border-b bg-subtle/95 pl-3 backdrop-blur">
                <span className="group/row flex">
                  <RowCheckbox selected={Boolean(allSelected)} selecting onToggle={() => onSelectAll?.(!allSelected)} />
                </span>
              </th>
            )}
            {columns.map(c => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('h-9 whitespace-nowrap border-b bg-subtle/95 px-3 text-left text-sm font-medium text-muted-foreground backdrop-blur', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.hideBelow && HIDE[c.hideBelow], c.className)}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => setSort(prev => (prev?.key === c.key ? (prev.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' }))}
                      className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground', c.align === 'right' && 'flex-row-reverse')}
                    >
                      {c.header}
                      {active && (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const id = getId(row);
            const selected = Boolean(selection?.has(id));
            const focused = focusedId === id;
            return (
              <tr
                key={id}
                data-row-id={id}
                onClick={onRowClick ? e => onRowClick(row, e) : undefined}
                onMouseMove={onHover && !focused ? () => onHover(row) : undefined}
                className={cn('group/row', onRowClick && 'cursor-default', focused ? 'bg-accent/70' : 'hover:bg-accent/40', selected && 'bg-primary/[0.07]', rowClassName?.(row))}
              >
                {selectable && (
                  <td className="border-b border-border/60 pl-3">
                    <RowCheckbox selected={selected} selecting={Boolean(selection?.size)} onToggle={e => onToggleSelect!(row, e)} />
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} className={cn('border-b border-border/60 px-3', dense ? 'h-9' : 'h-10', c.align === 'right' && 'num text-right', c.align === 'center' && 'text-center', c.hideBelow && HIDE[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {hasFooter && (
          <tfoot className={cn(stickyHeader && 'sticky bottom-0 z-10')}>
            <tr>
              {selectable && <td className="border-t bg-subtle/95" />}
              {columns.map(c => (
                <td key={c.key} className={cn('h-9 border-t bg-subtle/95 px-3 text-[14px] font-medium backdrop-blur', c.align === 'right' && 'num text-right', c.hideBelow && HIDE[c.hideBelow], c.className)}>
                  {c.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
