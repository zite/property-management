import { Building2, ChevronDown, Search, UserRound, X } from 'lucide-react';
import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { search } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@project/components/ui/command';
import { useWorkspace } from '../../lib/workspace';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { OccupancyGlyph, PropertySwatch } from '../primitives/glyphs';
import { OptionPicker, type Option } from './OptionPicker';

/**
 * Pickers for the things the app links together. All are keyboard-first
 * popovers built on OptionPicker; pass any element as `trigger` (a form field
 * button, a ghost chip in a detail rail, a row slot).
 */

/** A button that looks like a form field — the default trigger inside dialogs. */
export const FieldButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { placeholder?: string; icon?: ReactNode; invalid?: boolean; onClear?: () => void }>(
  ({ children, placeholder, icon, className, invalid, onClear, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-invalid={invalid || undefined}
      className={cn(
        'field group relative items-center justify-between gap-2 text-left data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20',
        invalid && 'border-tone-danger',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        {children ? <span className="truncate">{children}</span> : <span className="truncate text-muted-foreground/80">{placeholder ?? 'Select…'}</span>}
      </span>
      {onClear && children ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Clear"
          onClick={e => {
            e.stopPropagation();
            onClear();
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </span>
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  ),
);
FieldButton.displayName = 'FieldButton';

type Common = { trigger: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: 'start' | 'center' | 'end'; disabled?: boolean };

export function MemberPicker({ value, onChange, allowNone = true, noneLabel = 'Unassigned', filter, ...rest }: Common & { value: string | null | undefined; onChange: (id: string | null) => void; allowNone?: boolean; noneLabel?: string; filter?: (m: ReturnType<typeof useWorkspace>['members'][number]) => boolean }) {
  const ws = useWorkspace();
  const options = useMemo(() => {
    const people = ws.activeMembers.filter(m => !filter || filter(m)).sort((a, b) => (a.id === ws.me.id ? -1 : b.id === ws.me.id ? 1 : a.name.localeCompare(b.name)));
    const out: Option<string | null>[] = [];
    if (allowNone) out.push({ value: null, label: noneLabel, icon: <UnassignedAvatar size={16} /> });
    for (const m of people) out.push({ value: m.id, label: m.id === ws.me.id ? `${m.name} (you)` : m.name, icon: <MemberAvatar member={m} size={16} />, keywords: [m.email, m.role, m.title], hint: m.role });
    return out;
  }, [ws, allowNone, noneLabel, filter]);
  return <OptionPicker options={options} value={value ?? null} onChange={v => onChange(v)} placeholder="Assign to…" {...rest} />;
}

export function PropertyPicker({ value, onChange, allowNone = false, ...rest }: Common & { value: string | null | undefined; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const ws = useWorkspace();
  const options = useMemo(() => {
    const out: Option<string | null>[] = allowNone ? [{ value: null, label: 'No property', icon: <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> }] : [];
    for (const p of ws.orderedProperties.filter(p => p.status !== 'Archived' || p.id === value)) {
      out.push({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, keywords: [p.code, p.city, p.street], hint: `${p.unitCount} ${p.unitCount === 1 ? 'unit' : 'units'}` });
    }
    return out;
  }, [ws, allowNone, value]);
  return <OptionPicker options={options} value={value ?? null} onChange={v => onChange(v)} placeholder="Choose a property…" width={280} {...rest} />;
}

/** Units, grouped by property; restrict to one property with `propertyId`. */
export function UnitPicker({ value, onChange, propertyId, allowNone = false, onlyVacant, ...rest }: Common & { value: string | null | undefined; onChange: (id: string | null, propertyId: string | null) => void; propertyId?: string | null; allowNone?: boolean; onlyVacant?: boolean }) {
  const ws = useWorkspace();
  const options = useMemo(() => {
    const out: Option<string | null>[] = allowNone ? [{ value: null, label: propertyId ? 'Whole property / common area' : 'No unit' }] : [];
    const props = propertyId ? ws.orderedProperties.filter(p => p.id === propertyId) : ws.orderedProperties.filter(p => p.status !== 'Archived');
    for (const p of props) {
      for (const u of ws.unitsByProperty.get(p.id) ?? []) {
        if (u.archived && u.id !== value) continue;
        if (onlyVacant && u.occupancy === 'Occupied' && u.id !== value) continue;
        out.push({
          value: u.id,
          label: ws.unitLabel(u.id),
          group: propertyId ? undefined : p.name,
          icon: <OccupancyGlyph occupancy={u.occupancy} />,
          keywords: [p.name, p.code, u.residentNames],
          hint: u.residentNames ? <span className="max-w-[110px] truncate">{u.residentNames.split(',')[0]}</span> : u.occupancy,
        });
      }
    }
    return out;
  }, [ws, propertyId, allowNone, onlyVacant, value]);
  return <OptionPicker options={options} value={value ?? null} onChange={v => onChange(v, v ? ws.unitById.get(v)?.propertyId ?? null : propertyId ?? null)} placeholder="Find a unit…" width={320} {...rest} />;
}

export function VendorPicker({ value, onChange, allowNone = true, trade, ...rest }: Common & { value: string | null | undefined; onChange: (id: string | null) => void; allowNone?: boolean; trade?: string | null }) {
  const ws = useWorkspace();
  const options = useMemo(() => {
    const out: Option<string | null>[] = allowNone ? [{ value: null, label: 'No vendor (in-house)' }] : [];
    const list = [...ws.activeVendors].sort((a, b) => Number(b.trade === trade) - Number(a.trade === trade) || a.name.localeCompare(b.name));
    for (const v of list) {
      const expired = v.insuranceExpiresOn && v.insuranceExpiresOn < ws.today;
      out.push({ value: v.id, label: v.name, keywords: [v.trade, v.contactName, v.email], hint: expired ? <span className="text-tone-danger">COI expired</span> : v.trade, group: trade && v.trade === trade ? 'Suggested' : trade ? 'Other vendors' : undefined });
    }
    return out;
  }, [ws, allowNone, trade]);
  return <OptionPicker options={options} value={value ?? null} onChange={v => onChange(v)} placeholder="Choose a vendor…" width={300} {...rest} />;
}

export function AccountPicker({ value, onChange, kind = 'all', ...rest }: Common & { value: string | null | undefined; onChange: (id: string) => void; kind?: 'charge' | 'expense' | 'bank' | 'income' | 'all' }) {
  const ws = useWorkspace();
  const options = useMemo(() => {
    const list = ws.accounts.filter(a => a.active || a.id === value).filter(a => {
      if (kind === 'charge') return a.tenantCharge;
      if (kind === 'expense') return a.accountType === 'Expense';
      if (kind === 'bank') return a.subtype === 'Bank';
      if (kind === 'income') return a.accountType === 'Income';
      return true;
    });
    return list.map(a => ({ value: a.id, label: a.name, hint: <span className="num">{a.number}</span>, keywords: [a.number, a.accountType, a.subtype], group: kind === 'all' ? a.accountType : undefined }));
  }, [ws, kind, value]);
  return <OptionPicker options={options} value={value ?? null} onChange={v => v && onChange(v)} placeholder="Choose an account…" width={300} {...rest} />;
}

/** A plain choice from a fixed list (statuses, categories, methods). */
export function ChoicePicker<V extends string>({ options, value, onChange, icon, ...rest }: Common & { options: readonly V[]; value: V | null | undefined; onChange: (v: V) => void; icon?: (v: V) => ReactNode }) {
  const opts = useMemo(() => options.map((o, i) => ({ value: o, label: o, icon: icon?.(o), shortcut: i < 9 ? String(i + 1) : undefined })), [options, icon]);
  return <OptionPicker options={opts} value={value ?? null} onChange={v => v && onChange(v as V)} {...rest} />;
}

export type SearchKind = 'tenants' | 'leases' | 'owners' | 'vendors' | 'applications';
type SearchHit = { id: string; label: string; sublabel: string; kind: string };

/**
 * Tenants and leases can number in the thousands, so they aren't in bootstrap:
 * this picker searches the server as you type.
 */
export function RecordSearchPicker({ kinds, value, valueLabel, onChange, placeholder = 'Search…', trigger, open: openProp, onOpenChange, width = 340, align = 'start' }: {
  kinds: SearchKind[];
  value: string | null | undefined;
  valueLabel?: string | null;
  onChange: (hit: SearchHit | null) => void;
  placeholder?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  width?: number;
  align?: 'start' | 'center' | 'end';
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInnerOpen(o));
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['search', 'picker', kinds.join(','), q],
    queryFn: () => search({ query: q, limit: 12, kinds }),
    enabled: open,
    staleTime: 15_000,
    placeholderData: prev => prev,
  });
  const hits: SearchHit[] = useMemo(() => {
    if (!data) return [];
    const out: SearchHit[] = [];
    if (kinds.includes('leases')) for (const l of data.leases) out.push({ id: l.id, label: l.name, sublabel: `${l.phase}${l.balance > 0 ? ` · owes ${l.balanceLabel}` : ''}`, kind: 'lease' });
    if (kinds.includes('tenants')) for (const t of data.tenants) out.push({ id: t.id, label: t.name, sublabel: t.subtitle, kind: 'tenant' });
    if (kinds.includes('owners')) for (const o of data.owners) out.push({ id: o.id, label: o.name, sublabel: o.subtitle, kind: 'owner' });
    if (kinds.includes('vendors')) for (const v of data.vendors) out.push({ id: v.id, label: v.name, sublabel: v.subtitle, kind: 'vendor' });
    if (kinds.includes('applications')) for (const a of data.applications) out.push({ id: a.id, label: a.name, sublabel: a.subtitle, kind: 'application' });
    return out;
  }, [data, kinds]);
  // Server results arrive after typing, so keep the first hit highlighted — otherwise Enter does nothing.
  const [active, setActive] = useState('');
  useEffect(() => {
    const first = hits[0] ? `${hits[0].kind}:${hits[0].id}` : '';
    if (first && !hits.some(h => `${h.kind}:${h.id}` === active)) setActive(first);
  }, [hits, active]);

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <FieldButton placeholder={placeholder} icon={<UserRound className="h-3.5 w-3.5 text-muted-foreground" />} onClear={value ? () => onChange(null) : undefined}>
            {value ? valueLabel ?? 'Selected' : null}
          </FieldButton>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="overflow-hidden p-0 shadow-lg" style={{ width }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Command shouldFilter={false} loop value={active} onValueChange={setActive}>
          <CommandInput value={q} onValueChange={setQ} placeholder={placeholder} className="h-9 text-[14px]" />
          <CommandList className="max-h-[320px] p-1">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">{isFetching ? 'Searching…' : q ? 'No matches' : 'Start typing to search'}</CommandEmpty>
            <CommandGroup className="p-0">
              {hits.map(h => (
                <CommandItem key={`${h.kind}:${h.id}`} value={`${h.kind}:${h.id}`} onSelect={() => { onChange(h); setOpen(false); setQ(''); }} className="flex h-auto min-h-9 items-start gap-2 rounded-[5px] px-2 py-1.5 text-[14px]">
                  <Search className="mt-0.5 !h-3.5 !w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{h.label}</span>
                    {h.sublabel && <span className="block truncate text-sm text-muted-foreground">{h.sublabel}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
