import { BookOpen, Building2, CalendarDays, CalendarRange, Check, ChevronDown, RotateCcw, UserRound } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { cn } from '@project/components/lib/utils';
import { formatDay } from '@project/shared/dates';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Segmented } from '../form/fields';
import { OptionPicker, type Option } from '../pickers/OptionPicker';
import { PropertySwatch } from '../primitives/glyphs';
import { AS_OF_PRESETS, PERIOD_PRESETS, type ReportDef, type ReportUrlState } from './catalog';

/**
 * The parameter strip under a report's header. Every control writes the URL
 * (see ReportFrame), so what you see is always a shareable link.
 */

export type ParamPatch = Record<string, string | null>;

const chip = 'ghost-chip h-8 gap-1.5 border-border/80 text-[13.5px] data-[state=open]:bg-accent';

/** Popover triggers pass a ref and open-state props through `asChild`, so this forwards both. */
const ChipTrigger = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; active?: boolean }>(({ icon, children, active, className, ...props }, ref) => (
  <button ref={ref} type="button" {...props} className={cn(chip, 'border', active ? 'bg-accent/60 text-foreground' : 'text-foreground', className)}>
    <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
    <span className="max-w-[240px] truncate">{children}</span>
    <ChevronDown className="h-3 w-3 text-muted-foreground" />
  </button>
));
ChipTrigger.displayName = 'ChipTrigger';

export function ParamBar({ def, state, today, resolvedOwnerId, onChange, onReset, dirty, fetching, end }: {
  def: ReportDef;
  state: ReportUrlState;
  today: string;
  resolvedOwnerId?: string | null;
  onChange: (patch: ParamPatch) => void;
  onReset: () => void;
  dirty: boolean;
  fetching?: boolean;
  end?: ReactNode;
}) {
  const p = def.params;
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 print:hidden" role="toolbar" aria-label="Report parameters">
      {p.owner && <OwnerParam value={state.ownerId || resolvedOwnerId || ''} onChange={v => onChange({ owner: v, page: null })} />}
      {p.period && <PeriodParam state={state} today={today} onChange={onChange} />}
      {p.asOf && <AsOfParam state={state} today={today} onChange={onChange} />}
      {p.year && <YearParam year={state.year} today={today} onChange={y => onChange({ year: String(y) })} />}
      {p.properties && <PropertiesParam value={state.propertyIds} onChange={ids => onChange({ properties: ids.length ? ids.join(',') : null, page: null })} />}
      {p.accounts && <AccountsParam value={state.accountIds} onChange={ids => onChange({ accounts: ids.length ? ids.join(',') : null, page: null })} />}
      {p.basis && (
        <Segmented
          size="sm"
          value={state.basis}
          onChange={v => onChange({ basis: v })}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'accrual', label: 'Accrual' },
          ]}
        />
      )}
      {p.groupBy && <Segmented size="sm" value={state.groupBy} onChange={v => onChange({ group: v })} options={p.groupBy.options} />}
      {p.months && <Segmented size="sm" value={String(state.months)} onChange={v => onChange({ months: v })} options={p.months.options.map(m => ({ value: String(m), label: `${m} months` }))} />}
      {p.zero && (
        <button type="button" aria-pressed={state.showZero} onClick={() => onChange({ zero: state.showZero ? null : 'show' })} className={cn(chip, 'border', state.showZero ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
          {state.showZero && <Check className="h-3.5 w-3.5" />} Zero balances
        </button>
      )}
      {dirty && (
        <button type="button" onClick={onReset} className="ghost-chip h-8 gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      )}
      <div className="ml-auto flex items-center gap-1">{end}</div>
      {fetching && <span className="sr-only">Updating</span>}
    </div>
  );
}

function PeriodParam({ state, today, onChange }: { state: ReportUrlState; today: string; onChange: (patch: ParamPatch) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(state.from);
  const [to, setTo] = useState(state.to);
  useEffect(() => {
    if (open) {
      setFrom(state.from);
      setTo(state.to);
    }
  }, [open, state.from, state.to]);
  const preset = PERIOD_PRESETS.find(x => x.value === state.period);
  const invalid = !from || !to || from > to;
  const apply = () => {
    if (invalid) return;
    onChange({ period: 'custom', from, to, page: null });
    setOpen(false);
  };
  const range = `${formatDay(state.from).replace(`, ${today.slice(0, 4)}`, '')} – ${formatDay(state.to).replace(`, ${today.slice(0, 4)}`, '')}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipTrigger icon={<CalendarRange />} aria-label={`Period: ${preset?.label ?? 'Custom'}, ${range}`}>
          {preset ? preset.label : 'Custom'}
          <span className="ml-1.5 hidden text-muted-foreground sm:inline">{range}</span>
        </ChipTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[288px] p-1 shadow-lg">
        <div role="listbox" aria-label="Period presets">
          {PERIOD_PRESETS.map(x => (
            <button
              key={x.value}
              type="button"
              role="option"
              aria-selected={x.value === state.period}
              onClick={() => {
                onChange({ period: x.value, from: null, to: null, page: null });
                setOpen(false);
              }}
              className="flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span className="flex w-4 justify-center">{x.value === state.period && <Check className="h-3.5 w-3.5 text-muted-foreground" />}</span>
              {x.label}
            </button>
          ))}
        </div>
        <form
          className="mt-1 space-y-2 border-t px-2 pb-2 pt-2.5"
          onSubmit={e => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="text-sm font-medium text-muted-foreground">Custom range</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-2xs text-muted-foreground">From</span>
              <DateInput value={from} onChange={v => setFrom(v ?? '')} max={to || undefined} className="h-8 px-1.5 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-2xs text-muted-foreground">To</span>
              <DateInput value={to} onChange={v => setTo(v ?? '')} min={from || undefined} className="h-8 px-1.5 text-sm" />
            </label>
          </div>
          {from && to && from > to && <p className="text-sm text-tone-danger">The start date is after the end date.</p>}
          <button type="submit" disabled={invalid} className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary text-[13.5px] font-medium text-primary-foreground disabled:opacity-50">
            Apply range
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AsOfParam({ state, today, onChange }: { state: ReportUrlState; today: string; onChange: (patch: ParamPatch) => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(state.asOf);
  useEffect(() => {
    if (open) setDate(state.asOf);
  }, [open, state.asOf]);
  const preset = AS_OF_PRESETS.find(x => x.value === state.asOfPreset);
  const label = state.asOfPreset === 'today' ? `Today` : preset ? preset.label : formatDay(state.asOf);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipTrigger icon={<CalendarDays />} aria-label={`As of ${formatDay(state.asOf)}`}>
          <span className="text-muted-foreground">As of</span> {label}
          {state.asOfPreset !== 'custom' && <span className="ml-1.5 hidden text-muted-foreground sm:inline">{formatDay(state.asOf)}</span>}
        </ChipTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[248px] p-1 shadow-lg">
        {AS_OF_PRESETS.map(x => (
          <button
            key={x.value}
            type="button"
            onClick={() => {
              onChange({ asOf: x.value === 'today' ? null : x.value });
              setOpen(false);
            }}
            className="flex h-9 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <span className="flex w-4 justify-center">{x.value === state.asOfPreset && <Check className="h-3.5 w-3.5 text-muted-foreground" />}</span>
            {x.label}
          </button>
        ))}
        <form
          className="mt-1 space-y-2 border-t px-2 pb-2 pt-2.5"
          onSubmit={e => {
            e.preventDefault();
            if (!date) return;
            onChange({ asOf: date === today ? null : date });
            setOpen(false);
          }}
        >
          <div className="text-sm font-medium text-muted-foreground">On a date</div>
          <DateInput value={date} onChange={v => setDate(v ?? '')} className="h-8 text-sm" />
          <button type="submit" disabled={!date} className="inline-flex h-8 w-full items-center justify-center rounded-md bg-primary text-[13.5px] font-medium text-primary-foreground disabled:opacity-50">
            Apply date
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function PropertiesParam({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const ws = useWorkspace();
  const options = useMemo<Option<string>[]>(
    () => ws.orderedProperties.map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code, p.city, p.street], hint: p.status === 'Archived' ? 'Archived' : `${p.unitCount}` })),
    [ws],
  );
  const known = value.filter(id => ws.propertyById.has(id));
  const label = !known.length ? 'All properties' : known.length === 1 ? ws.propertyName(known[0]) : `${known.length} properties`;
  return (
    <OptionPicker
      multiple
      options={options}
      value={known}
      onChange={onChange}
      placeholder="Filter properties…"
      emptyText="No properties match"
      width={280}
      trigger={<ChipTrigger icon={<Building2 />} active={known.length > 0}>{label}</ChipTrigger>}
      footer={known.length ? <button type="button" onClick={() => onChange([])} className="flex h-9 w-full items-center rounded-[5px] px-2 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground">Show all properties</button> : undefined}
    />
  );
}

function AccountsParam({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const ws = useWorkspace();
  const options = useMemo<Option<string>[]>(
    () =>
      [...ws.accounts]
        .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }))
        .map(a => ({ value: a.id, label: a.number ? `${a.number} · ${a.name}` : a.name, group: a.accountType === 'Liability' ? 'Liabilities' : a.accountType === 'Equity' || a.accountType === 'Income' ? a.accountType : `${a.accountType}s`, keywords: [a.subtype], hint: a.active ? undefined : 'Inactive' })),
    [ws],
  );
  const known = value.filter(id => ws.accountById.has(id));
  const one = known.length === 1 ? ws.accountById.get(known[0]) : null;
  const label = !known.length ? 'All accounts' : one ? `${one.number ? `${one.number} · ` : ''}${one.name}` : `${known.length} accounts`;
  return (
    <OptionPicker
      multiple
      options={options}
      value={known}
      onChange={onChange}
      placeholder="Find an account…"
      width={300}
      trigger={<ChipTrigger icon={<BookOpen />} active={known.length > 0}>{label}</ChipTrigger>}
      footer={known.length ? <button type="button" onClick={() => onChange([])} className="flex h-9 w-full items-center rounded-[5px] px-2 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground">Summary of all accounts</button> : undefined}
    />
  );
}

function OwnerParam({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const ws = useWorkspace();
  const options = useMemo<Option<string>[]>(
    () =>
      ws.owners.map(o => {
        const count = ws.properties.filter(p => p.ownerId === o.id).length;
        return { value: o.id, label: o.name, keywords: [o.email, o.contactName], hint: count ? `${count} ${count === 1 ? 'property' : 'properties'}` : 'No properties' };
      }),
    [ws],
  );
  const owner = ws.ownerById.get(value);
  return (
    <OptionPicker
      options={options}
      value={value || null}
      onChange={v => onChange(String(v))}
      placeholder="Find an owner…"
      width={280}
      trigger={<ChipTrigger icon={<UserRound />}>{owner?.name ?? 'Choose an owner'}</ChipTrigger>}
    />
  );
}

function YearParam({ year, today, onChange }: { year: number; today: string; onChange: (y: number) => void }) {
  const current = Number(today.slice(0, 4));
  const options = Array.from({ length: 6 }, (_, i) => ({ value: String(current - i), label: String(current - i), hint: i === 0 ? 'To date' : undefined }));
  return <OptionPicker options={options} value={String(year)} onChange={v => onChange(Number(v))} width={180} placeholder="Year…" trigger={<ChipTrigger icon={<CalendarDays />}>Calendar year {year}</ChipTrigger>} />;
}
