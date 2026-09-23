import { Columns3, List, Loader2, MoreHorizontal, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@project/components/ui/select';
import { Switch } from '@project/components/ui/switch';
import { cn } from '@project/components/lib/utils';
import { useHotkeys } from '../../lib/hotkeys';
import type { Layout, ListOptions } from '../../lib/listState';
import { IconButton, Tip } from '../primitives/bits';

/**
 * The strip above every list: filters on the left; search, count, layout,
 * display options and "more" on the right. `/` focuses search.
 */
export function ListToolbar({ start, count, countLabel, search, onSearch, searchPlaceholder = 'Search…', layout, layouts, onLayout, display, more, fetching, className }: {
  start?: ReactNode;
  count?: number | null;
  countLabel?: [string, string];
  search?: string;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  layout?: Layout;
  layouts?: Layout[];
  onLayout?: (l: Layout) => void;
  display?: ReactNode;
  more?: ReactNode;
  fetching?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(Boolean(search));
  const [text, setText] = useState(search ?? '');
  const ref = useRef<HTMLInputElement>(null);
  // Follow the search from outside ("Clear filters") without fighting what's being typed.
  useEffect(() => {
    if ((search ?? '') !== text.trim()) setText(search ?? '');
    if (!search && document.activeElement !== ref.current) setOpen(false);
  }, [search]);
  useEffect(() => {
    if (!onSearch) return;
    const t = window.setTimeout(() => onSearch(text.trim()), 200);
    return () => window.clearTimeout(t);
  }, [text]);
  useHotkeys({ '/': () => { setOpen(true); window.setTimeout(() => ref.current?.focus(), 0); } }, { enabled: Boolean(onSearch) });

  return (
    <div className={cn('flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5', className)}>
      {start}
      <div className="ml-auto flex items-center gap-1">
        {fetching && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Refreshing" />}
        {onSearch &&
          (open ? (
            <div className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 animate-fade-in">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={ref}
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setText('');
                    setOpen(false);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={searchPlaceholder}
                className="w-40 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground sm:w-52"
              />
              <button type="button" aria-label="Clear search" onClick={() => { setText(''); setOpen(false); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Tip label="Search" keys={['/']}>
              <IconButton onClick={() => setOpen(true)} aria-label="Search">
                <Search />
              </IconButton>
            </Tip>
          ))}
        {count != null && <span className="hidden px-1.5 text-sm tabular-nums text-muted-foreground sm:inline">{count.toLocaleString()} {countLabel ? (count === 1 ? countLabel[0] : countLabel[1]) : ''}</span>}
        {layout && layouts && layouts.length > 1 && onLayout && <LayoutToggle layout={layout} layouts={layouts} onChange={onLayout} />}
        {display}
        {more && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More actions">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {more}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

const LAYOUT_META: Record<Layout, { label: string; icon: ReactNode }> = {
  list: { label: 'List', icon: <List className="h-3.5 w-3.5" /> },
  board: { label: 'Board', icon: <Columns3 className="h-3.5 w-3.5" /> },
  table: { label: 'Table', icon: <Table2 className="h-3.5 w-3.5" /> },
};

export function LayoutToggle({ layout, layouts, onChange }: { layout: Layout; layouts: Layout[]; onChange: (l: Layout) => void }) {
  return (
    <div className="flex h-8 items-center rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Layout">
      {layouts.map(l => (
        <Tip key={l} label={LAYOUT_META[l].label}>
          <button
            type="button"
            role="radio"
            aria-checked={layout === l}
            aria-label={`${LAYOUT_META[l].label} layout`}
            onClick={() => onChange(l)}
            className={cn('flex h-full w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors', layout === l ? 'bg-accent text-foreground shadow-2xs' : 'hover:text-foreground')}
          >
            {LAYOUT_META[l].icon}
          </button>
        </Tip>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-3">
      <span className="text-[14px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function MiniSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[170px] text-[14px] shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value} className="text-[14px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Grouping, ordering, which properties rows show, and whether closed items appear. */
export function DisplayMenu<G extends string, O extends string>({ options, onChange, groupings, orderings, properties, layouts, closedLabel, onReset, isDirty, children }: {
  options: ListOptions<G, O>;
  onChange: (patch: Partial<ListOptions<G, O>>) => void;
  groupings?: ReadonlyArray<{ value: G; label: string }>;
  orderings?: ReadonlyArray<{ value: O; label: string }>;
  properties?: ReadonlyArray<{ key: string; label: string }>;
  layouts?: Layout[];
  /** e.g. "Show completed work orders" — omit to hide the toggle. */
  closedLabel?: string;
  onReset?: () => void;
  isDirty?: boolean;
  children?: ReactNode;
}) {
  const props = new Set(options.properties);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="ghost-chip h-8 gap-1.5 text-muted-foreground hover:text-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Display</span>
          {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Customized" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-[340px] overflow-y-auto p-0 shadow-lg">
        {layouts && layouts.length > 1 && (
          <div className="grid gap-1.5 p-3" style={{ gridTemplateColumns: `repeat(${layouts.length}, minmax(0, 1fr))` }}>
            {layouts.map(l => (
              <button
                key={l}
                type="button"
                onClick={() => onChange({ layout: l } as Partial<ListOptions<G, O>>)}
                className={cn('flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[13.5px] transition-colors', options.layout === l ? 'border-primary/50 bg-primary/[0.06] text-foreground' : 'text-muted-foreground hover:bg-accent')}
              >
                {LAYOUT_META[l].icon}
                {LAYOUT_META[l].label}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-0.5 border-t px-3 py-2 first:border-t-0">
          {groupings && options.layout !== 'table' && (
            <Row label={options.layout === 'board' ? 'Columns' : 'Grouping'}>
              <MiniSelect value={options.grouping} onChange={v => onChange({ grouping: v as G } as Partial<ListOptions<G, O>>)} options={options.layout === 'board' ? groupings.filter(g => g.value !== 'none') : groupings} />
            </Row>
          )}
          {orderings && (
            <Row label="Ordering">
              <MiniSelect value={options.ordering} onChange={v => onChange({ ordering: v as O } as Partial<ListOptions<G, O>>)} options={orderings} />
            </Row>
          )}
          {groupings && options.layout === 'list' && (
            <Row label="Show empty groups">
              <Switch checked={options.showEmptyGroups} onCheckedChange={v => onChange({ showEmptyGroups: v } as Partial<ListOptions<G, O>>)} />
            </Row>
          )}
          {closedLabel && (
            <Row label={closedLabel}>
              <Switch checked={options.showClosed} onCheckedChange={v => onChange({ showClosed: v } as Partial<ListOptions<G, O>>)} />
            </Row>
          )}
        </div>
        {properties && properties.length > 0 && (
          <div className="border-t px-3 pb-3 pt-2.5">
            <div className="mb-2 text-sm font-medium text-muted-foreground">Display properties</div>
            <div className="flex flex-wrap gap-1.5">
              {properties.map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    const next = new Set(props);
                    if (next.has(p.key)) next.delete(p.key);
                    else next.add(p.key);
                    onChange({ properties: properties.map(x => x.key).filter(k => next.has(k)) } as Partial<ListOptions<G, O>>);
                  }}
                  className={cn('h-6 rounded-md border px-2 text-sm transition-colors', props.has(p.key) ? 'border-foreground/15 bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {children}
        {isDirty && onReset && (
          <div className="flex justify-end border-t px-3 py-2">
            <button type="button" onClick={onReset} className="text-sm text-muted-foreground hover:text-foreground">
              Reset to default
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
