import { Check, ChevronRight } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { cn } from '@project/components/lib/utils';
import { Tip } from '../primitives/bits';

export type ListGroup<T> = {
  key: string;
  label: string;
  icon?: ReactNode;
  items: T[];
  /** Right-aligned hint in the header, e.g. a total. */
  hint?: ReactNode;
};

/**
 * Sticky, collapsible group headers with rows underneath. Rows are rendered by
 * the area (`renderRow`) and should use <RowShell> for consistent focus,
 * selection, hover and context-menu behaviour.
 */
function GroupedListInner<T>({ groups, renderRow, getId, collapsed, onToggleCollapse, onSelectGroup, single, label, footer }: {
  groups: ListGroup<T>[];
  renderRow: (item: T, group: ListGroup<T>) => ReactNode;
  getId: (item: T) => string;
  collapsed: Set<string>;
  onToggleCollapse: (key: string) => void;
  onSelectGroup?: (group: ListGroup<T>) => void;
  /** No headers (grouping "none"). */
  single?: boolean;
  label: string;
  footer?: ReactNode;
}) {
  return (
    <div role="grid" aria-label={label} className="pb-24">
      {groups.map(group => {
        const isCollapsed = collapsed.has(group.key);
        return (
          <section key={group.key} aria-label={group.label}>
            {!single && (
              <div className="group/header sticky top-0 z-10 flex h-9 cursor-default items-center gap-2 border-b bg-subtle/95 pl-2 pr-3 backdrop-blur supports-[backdrop-filter]:bg-subtle/80" onClick={() => onToggleCollapse(group.key)}>
                <button type="button" aria-label={isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`} className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
                </button>
                {group.icon && <span className="flex h-5 items-center">{group.icon}</span>}
                <span className="truncate text-[14px] font-medium">{group.label}</span>
                <span className="text-[13.5px] tabular-nums text-muted-foreground">{group.items.length}</span>
                {group.hint && <span className="hidden truncate text-sm tabular-nums text-muted-foreground sm:inline">· {group.hint}</span>}
                {onSelectGroup && group.items.length > 0 && (
                  <div className="ml-auto opacity-0 transition-opacity group-hover/header:opacity-100">
                    <Tip label={`Select everything in ${group.label}`}>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onSelectGroup(group);
                        }}
                        className="rounded px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Select
                      </button>
                    </Tip>
                  </div>
                )}
              </div>
            )}
            {!isCollapsed && group.items.map(item => <div key={`${group.key}:${getId(item)}`}>{renderRow(item, group)}</div>)}
          </section>
        );
      })}
      {footer}
    </div>
  );
}

export const GroupedList = memo(GroupedListInner) as typeof GroupedListInner;

/**
 * The row every list uses: 40px, a checkbox that appears on hover (and stays
 * while anything is selected), a left accent bar on the focused row, and the
 * row's context menu on right-click.
 */
export function RowShell({ id, selected, focused, selecting, onClick, onHover, onToggleSelect, menu, children, className, muted, height = 40 }: {
  id: string;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  onClick: (e: MouseEvent) => void;
  onHover: () => void;
  onToggleSelect: (e: MouseEvent) => void;
  menu?: ReactNode;
  children: ReactNode;
  className?: string;
  muted?: boolean;
  height?: number;
}) {
  const row = (
    <div
      role="row"
      data-row-id={id}
      aria-selected={selected}
      onClick={onClick}
      onMouseMove={() => !focused && onHover()}
      style={{ height }}
      className={cn(
        'group/row relative flex cursor-default select-none items-center gap-2 border-b border-border/60 pl-2 pr-4 text-[14px] transition-colors duration-75',
        focused ? 'bg-accent/80' : 'hover:bg-accent/50',
        selected && 'bg-primary/[0.07] hover:bg-primary/10 dark:bg-primary/[0.1]',
        muted && 'text-muted-foreground',
        className,
      )}
    >
      {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary/70" aria-hidden />}
      <RowCheckbox selected={selected} selecting={selecting} onToggle={onToggleSelect} />
      {children}
    </div>
  );
  if (!menu) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

export function RowCheckbox({ selected, selecting, onToggle }: { selected: boolean; selecting: boolean; onToggle: (e: MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label={selected ? 'Deselect' : 'Select'}
      onClick={e => {
        e.stopPropagation();
        onToggle(e);
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-opacity',
        selected ? 'border-primary bg-primary text-primary-foreground opacity-100' : 'border-input bg-background',
        !selected && (selecting ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'),
      )}
    >
      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}

/**
 * A row slot that is a plain button until clicked and only then mounts its
 * picker — mounting a popover per row would re-render hundreds of them on
 * every selection change.
 */
export function Slot({ label, active, onActivate, picker, children, className }: { label: string; active: boolean; onActivate: () => void; picker: (trigger: ReactNode) => ReactNode; children: ReactNode; className?: string }) {
  const trigger = (
    <button
      type="button"
      aria-label={label}
      onClick={e => {
        e.stopPropagation();
        onActivate();
      }}
      className={cn('inline-flex max-w-full shrink-0 items-center rounded-[5px] outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent', className)}
    >
      {children}
    </button>
  );
  return <>{active ? picker(trigger) : trigger}</>;
}
