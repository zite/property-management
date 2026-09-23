import { ChevronLeft, ListFilter, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@project/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import type { Filters } from '../../lib/listState';

/**
 * "Filter" → pick a property → pick values, applied as you click; active
 * filters show as chips you can edit or remove. Areas describe their filters
 * as data (`FilterDef`) and get identical behaviour everywhere.
 */

export type FilterOption = { value: string; label: string; icon?: ReactNode; keywords?: string[] };

export type FilterDef = {
  key: string;
  label: string;
  icon: ReactNode;
  /** Many values (checkboxes) or one (radio). */
  multi: boolean;
  options: () => FilterOption[];
  get: (f: Filters) => string[];
  set: (f: Filters, values: string[]) => Filters;
  hidden?: boolean;
};

/** The common case: `filters[field]` holds an array of option values. */
export function listFilter(field: string, label: string, icon: ReactNode, options: () => FilterOption[], extra: Partial<FilterDef> = {}): FilterDef {
  return {
    key: field,
    label,
    icon,
    multi: true,
    options,
    get: f => (Array.isArray(f[field]) ? (f[field] as string[]) : []),
    set: (f, values) => ({ ...f, [field]: values.length ? values : undefined }),
    ...extra,
  };
}

/** One value stored as a string (`filters[field] = 'overdue'`). */
export function singleFilter(field: string, label: string, icon: ReactNode, options: () => FilterOption[], extra: Partial<FilterDef> = {}): FilterDef {
  return {
    key: field,
    label,
    icon,
    multi: false,
    options,
    get: f => (typeof f[field] === 'string' && f[field] ? [f[field] as string] : f[field] === true ? ['true'] : []),
    set: (f, values) => ({ ...f, [field]: values[values.length - 1] || undefined }),
    ...extra,
  };
}

function OptionList({ def, filters, onChange, onBack }: { def: FilterDef; filters: Filters; onChange: (f: Filters) => void; onBack?: () => void }) {
  const [q, setQ] = useState('');
  const options = useMemo(() => def.options(), [def]);
  const current = def.get(filters);
  const labelOf = useMemo(() => new Map(options.map(o => [`${o.label} ${o.value}`.toLowerCase(), o.label])), [options]);
  return (
    <Command
      loop
      filter={(value, search, keywords) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return 1;
        const label = (labelOf.get(value.toLowerCase()) ?? value).toLowerCase();
        if (label.startsWith(needle)) return 1;
        if (label.includes(needle)) return 0.8;
        return (keywords ?? []).some(k => k && k.toLowerCase().includes(needle)) ? 0.4 : 0;
      }}
    >
      <div className="flex items-center border-b">
        {onBack && (
          <button type="button" onClick={onBack} className="ml-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent" aria-label="Back">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <div className="flex-1 [&>div]:border-0">
          <CommandInput value={q} onValueChange={setQ} placeholder={`${def.label}…`} className="h-9 text-[14px]" onKeyDown={e => e.key === 'Backspace' && !q && onBack?.()} />
        </div>
      </div>
      <CommandList className="max-h-[300px] p-1">
        <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">No options</CommandEmpty>
        <CommandGroup className="p-0">
          {options.map(o => {
            const on = current.includes(o.value);
            return (
              <CommandItem
                key={o.value}
                value={`${o.label} ${o.value}`}
                keywords={o.keywords}
                onSelect={() => onChange(def.set(filters, def.multi ? (on ? current.filter(v => v !== o.value) : [...current, o.value]) : on ? [] : [o.value]))}
                className="h-9 gap-2 rounded-[5px] px-2 text-[14px]"
              >
                <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center border', def.multi ? 'rounded-[4px]' : 'rounded-full', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                  {on && (def.multi ? <span className="text-[10px] font-bold leading-none">✓</span> : <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />)}
                </span>
                {o.icon && <span className="flex w-4 shrink-0 justify-center">{o.icon}</span>}
                <span className="truncate">{o.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function FilterMenu({ defs, filters, onChange }: { defs: FilterDef[]; filters: Filters; onChange: (f: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const visible = defs.filter(d => !d.hidden);
  const def = visible.find(d => d.key === step);
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setStep(null); }}>
      <PopoverTrigger asChild>
        <button type="button" className="ghost-chip h-8 gap-1.5 text-muted-foreground hover:text-foreground">
          <ListFilter className="h-3.5 w-3.5" /> Filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[270px] overflow-hidden p-0 shadow-lg">
        {def ? (
          <OptionList def={def} filters={filters} onChange={onChange} onBack={() => setStep(null)} />
        ) : (
          <Command loop>
            <CommandInput placeholder="Filter by…" className="h-9 text-[14px]" autoFocus />
            <CommandList className="max-h-[360px] p-1">
              <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">No filters</CommandEmpty>
              <CommandGroup className="p-0">
                {visible.map(d => {
                  const count = d.get(filters).length;
                  return (
                    <CommandItem key={d.key} value={d.label} onSelect={() => setStep(d.key)} className="h-9 gap-2 rounded-[5px] px-2 text-[14px]">
                      <span className="flex w-4 justify-center text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{d.icon}</span>
                      <span className="flex-1">{d.label}</span>
                      {count > 0 && <span className="text-sm tabular-nums text-muted-foreground">{count}</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterChips({ defs, filters, onChange }: { defs: FilterDef[]; filters: Filters; onChange: (f: Filters) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const active = defs.filter(d => !d.hidden && d.get(filters).length > 0);
  if (!active.length) return null;
  return (
    <>
      {active.map(d => {
        const values = d.get(filters);
        const options = d.options();
        const labels = values.map(v => options.find(o => o.value === v)?.label ?? v);
        const summary = labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`;
        const firstIcon = values.length === 1 ? options.find(o => o.value === values[0])?.icon : null;
        return (
          <Popover key={d.key} open={openKey === d.key} onOpenChange={o => setOpenKey(o ? d.key : null)}>
            <div className="flex h-8 max-w-[320px] items-center overflow-hidden rounded-md border bg-background text-[13.5px] shadow-2xs">
              <span className="flex h-full items-center gap-1.5 border-r px-2 text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
                {d.icon}
                {d.label}
              </span>
              <span className="border-r px-1.5 text-muted-foreground">{d.multi && values.length > 1 ? 'is any of' : 'is'}</span>
              <PopoverTrigger asChild>
                <button type="button" className="flex h-full min-w-0 items-center gap-1.5 px-2 hover:bg-accent">
                  {firstIcon && <span className="flex shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{firstIcon}</span>}
                  <span className="truncate">{summary}</span>
                </button>
              </PopoverTrigger>
              <button type="button" aria-label={`Remove ${d.label} filter`} onClick={() => onChange(d.set(filters, []))} className="flex h-full items-center border-l px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <PopoverContent align="start" className="w-[260px] overflow-hidden p-0 shadow-lg">
              <OptionList def={d} filters={filters} onChange={onChange} />
            </PopoverContent>
          </Popover>
        );
      })}
      {active.length > 1 && (
        <button type="button" onClick={() => onChange(Object.fromEntries(Object.entries(filters).filter(([k]) => k === 'search')))} className="h-8 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
          Clear
        </button>
      )}
    </>
  );
}
