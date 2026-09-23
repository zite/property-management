import {
  closestCorners, DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@project/components/ui/context-menu';
import { cn } from '@project/components/lib/utils';

export type BoardColumn<T> = {
  key: string;
  label: string;
  icon?: ReactNode;
  items: T[];
  hint?: ReactNode;
  /** False for columns you can't drop into (e.g. a derived status). */
  droppable?: boolean;
  emptyText?: string;
};

/**
 * A kanban board. Collision uses the pointer (not the card's rectangle), edge
 * scrolling is keyed to the pointer so it can't run away, the source card is
 * never transformed while the overlay follows the pointer, and there is no drop
 * animation — moves are optimistic, the card is already in its new column.
 */
function BoardInner<T>({ columns, getId, renderCard, onMove, onCardClick, selection, focusedId, menuFor, disabled }: {
  columns: BoardColumn<T>[];
  getId: (item: T) => string;
  renderCard: (item: T, state: { selected: boolean; focused: boolean; overlay: boolean }) => ReactNode;
  onMove: (item: T, fromKey: string, toKey: string) => void;
  onCardClick: (item: T, e: MouseEvent) => void;
  selection: Set<string>;
  focusedId: string | null;
  menuFor?: (item: T) => ReactNode;
  disabled?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = new Map(columns.flatMap(c => c.items.map(i => [getId(i), i] as const)));
  const keyOf = (id: string) => columns.find(c => c.items.some(i => getId(i) === id))?.key;

  const collision: CollisionDetection = useCallback(args => {
    const hits = pointerWithin(args);
    return hits.length ? hits : closestCorners(args);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const onMoveEvt = (e: PointerEvent) => (pointer.current = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onMoveEvt);
    const timer = window.setInterval(() => {
      const el = scroller.current;
      const p = pointer.current;
      if (!el || !p) return;
      const r = el.getBoundingClientRect();
      const edge = 72;
      if (p.x < r.left + edge) el.scrollLeft -= Math.ceil((r.left + edge - p.x) / 4);
      else if (p.x > r.right - edge) el.scrollLeft += Math.ceil((p.x - (r.right - edge)) / 4);
    }, 16);
    return () => {
      window.removeEventListener('pointermove', onMoveEvt);
      window.clearInterval(timer);
    };
  }, [activeId]);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const id = String(active.id);
    const toKey = String(over.id).replace(/^col:/, '');
    const fromKey = keyOf(id);
    const item = byId.get(id);
    const target = columns.find(c => c.key === toKey);
    if (!fromKey || !item || !target || target.droppable === false || fromKey === toKey) return;
    onMove(item, fromKey, toKey);
  };
  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div ref={scroller} className="flex h-full gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4 pt-3">
        {columns.map(col => (
          <Column key={col.key} column={col}>
            {col.items.map(item => {
              const id = getId(item);
              return (
                <DraggableCard key={id} id={id} disabled={disabled} onClick={e => onCardClick(item, e)} menu={menuFor?.(item)}>
                  {renderCard(item, { selected: selection.has(id), focused: focusedId === id, overlay: false })}
                </DraggableCard>
              );
            })}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active ? renderCard(active, { selected: false, focused: false, overlay: true }) : null}</DragOverlay>
    </DndContext>
  );
}

export const Board = memo(BoardInner) as typeof BoardInner;

function Column<T>({ column, children }: { column: BoardColumn<T>; children: ReactNode }) {
  // The droppable is the whole column, header included — otherwise the header is a dead zone.
  const droppable = column.droppable !== false;
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}`, disabled: !droppable });
  return (
    <div ref={setNodeRef} className={cn('flex h-full w-[288px] shrink-0 flex-col rounded-xl bg-subtle/80 transition-colors dark:bg-subtle/60', isOver && droppable && 'bg-primary/[0.06] ring-1 ring-primary/30')}>
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        {column.icon}
        <span className="truncate text-[14px] font-medium">{column.label}</span>
        <span className="text-[13.5px] tabular-nums text-muted-foreground">{column.items.length}</span>
        {column.hint && <span className="ml-auto truncate text-sm tabular-nums text-muted-foreground">{column.hint}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex min-h-[64px] flex-col gap-2">{children}</div>
        {column.items.length === 0 && (
          <div className="mt-[-64px] flex h-16 items-center justify-center rounded-lg border border-dashed px-3 text-center text-sm text-muted-foreground/80">{column.emptyText ?? 'Nothing here'}</div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ id, disabled, onClick, menu, children }: { id: string; disabled?: boolean; onClick: (e: MouseEvent) => void; menu?: ReactNode; children: ReactNode }) {
  // No transform on the source while dragging: the overlay follows the pointer, moving both makes the card leap.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  const card = (
    <div ref={setNodeRef} data-row-id={id} style={{ touchAction: 'none' }} className={cn('cursor-default outline-none', isDragging && 'opacity-35')} onClick={onClick} {...attributes} {...listeners}>
      {children}
    </div>
  );
  if (!menu) return card;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

/** The standard card chrome for boards. */
export function BoardCard({ selected, focused, overlay, children, className }: { selected?: boolean; focused?: boolean; overlay?: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'group/card relative rounded-lg border bg-card px-3 py-2.5 text-[14px] shadow-xs transition-[border-color,box-shadow] duration-100 hover:border-foreground/15 hover:shadow-sm',
        selected && 'border-primary/60 ring-1 ring-primary/40',
        focused && !selected && 'border-foreground/25',
        overlay && 'rotate-[1.5deg] cursor-grabbing border-foreground/20 shadow-xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
