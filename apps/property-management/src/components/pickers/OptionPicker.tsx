import { Check, Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@project/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';

export type Option<V> = {
  value: V;
  label: string;
  icon?: ReactNode;
  keywords?: string[];
  group?: string;
  hint?: ReactNode;
  /** A single key that picks this option while the search box is empty. */
  shortcut?: string;
  disabled?: boolean;
};

type Common<V> = {
  options: Option<V>[];
  placeholder?: string;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  width?: number;
  emptyText?: string;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  footer?: ReactNode;
  disabled?: boolean;
};

type Single<V> = Common<V> & { multiple?: false; value: V | null | undefined; onChange: (value: V) => void };
type Multi<V> = Common<V> & { multiple: true; value: V[]; onChange: (value: V[]) => void };

/**
 * The one picker every property uses: a searchable, keyboard-first popover.
 * Arrow keys move, Enter picks, typing filters, and — like the trackers people
 * are used to — a digit picks directly while the search box is empty.
 */
export function OptionPicker<V extends string | number | null>(props: Single<V> | Multi<V>) {
  const { options, placeholder = 'Search…', trigger, align = 'start', side = 'bottom', width = 248, emptyText = 'No results', onCreate, createLabel, footer, disabled } = props;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = props.open ?? innerOpen;
  const setOpen = (v: boolean) => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInnerOpen(v);
    if (!v) setQuery('');
  };
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set<V>(props.multiple ? props.value : props.value === undefined ? [] : [props.value as V]), [props.value, props.multiple]);

  const groups = useMemo(() => {
    const m = new Map<string, Option<V>[]>();
    for (const o of options) {
      const g = o.group ?? '';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(o);
    }
    return [...m.entries()];
  }, [options]);

  const pick = (o: Option<V>) => {
    if (o.disabled) return;
    if (props.multiple) {
      const next = selected.has(o.value) ? props.value.filter(v => v !== o.value) : [...props.value, o.value];
      props.onChange(next);
    } else {
      props.onChange(o.value);
      setOpen(false);
    }
  };

  const exact = options.some(o => o.label.toLowerCase() === query.trim().toLowerCase());
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) {
      const v = `${o.label} ${String(o.value)}`;
      m.set(v, o.label);
      m.set(v.toLowerCase(), o.label);
      m.set(v.trim(), o.label);
    }
    return m;
  }, [options]);

  return (
    <Popover open={open} onOpenChange={v => !disabled && setOpen(v)}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="overflow-hidden p-0 shadow-lg"
        style={{ width }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <Command
          loop
          // Substring matching on labels first, keywords (emails, expertise) last. cmdk's default fuzzy
          // match let "Nadia" select Grace Liu via "visual aND publIc Art", and matched inside record ids.
          filter={(value, search, keywords) => {
            const q = search.trim().toLowerCase();
            if (!q) return 1;
            const label = (labelOf.get(value) ?? labelOf.get(value.toLowerCase()) ?? value).toLowerCase();
            if (label.startsWith(q)) return 1;
            if (label.split(/[\s·(),/-]+/).some(w => w.startsWith(q))) return 0.9;
            if (label.includes(q)) return 0.75;
            if ((keywords ?? []).some(k => k && k.toLowerCase().includes(q))) return 0.4;
            return 0;
          }}
          // Open with the current value highlighted, so Enter on an untouched picker is a no-op, not a change.
          defaultValue={(() => {
            const current = !props.multiple ? options.find(o => o.value === props.value) : undefined;
            return current ? `${current.label} ${String(current.value)}` : undefined;
          })()}
          onKeyDown={e => {
            if (query || e.metaKey || e.ctrlKey || e.altKey) return;
            const hit = options.find(o => o.shortcut && o.shortcut === e.key);
            if (hit) {
              e.preventDefault();
              pick(hit);
            }
          }}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            className="h-9 text-[14px]"
          />
          <CommandList className="max-h-[320px] p-1">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">{emptyText}</CommandEmpty>
            {groups.map(([group, items], gi) => (
              <div key={group || gi}>
                {gi > 0 && <CommandSeparator className="my-1" />}
                <CommandGroup heading={group || undefined} className="p-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-2xs">
                  {items.map(o => {
                    const isOn = selected.has(o.value);
                    return (
                      <CommandItem
                        key={String(o.value)}
                        value={`${o.label} ${String(o.value)}`}
                        keywords={o.keywords}
                        disabled={o.disabled}
                        onSelect={() => pick(o)}
                        className="h-9 gap-2 rounded-[5px] px-2 text-[14px]"
                      >
                        {props.multiple && (
                          <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border', isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                            {isOn && <Check className="!h-2.5 !w-2.5" strokeWidth={3} />}
                          </span>
                        )}
                        {o.icon && <span className="flex w-4 shrink-0 items-center justify-center">{o.icon}</span>}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.hint && <span className="shrink-0 text-sm text-muted-foreground">{o.hint}</span>}
                        {!props.multiple && isOn && <Check className="!h-3.5 !w-3.5 shrink-0 text-muted-foreground" />}
                        {o.shortcut && !query && <span className="w-3 shrink-0 text-right text-2xs text-muted-foreground">{o.shortcut}</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
            ))}
            {onCreate && query.trim() && !exact && (
              <CommandGroup className="p-0">
                <CommandItem value={`__create__ ${query}`} onSelect={() => { onCreate(query.trim()); setQuery(''); }} className="h-9 gap-2 rounded-[5px] px-2 text-[14px]">
                  <Plus className="!h-3.5 !w-3.5 text-muted-foreground" />
                  <span className="truncate">{createLabel ? createLabel(query.trim()) : `Create “${query.trim()}”`}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          {footer && <div className="border-t p-1">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
