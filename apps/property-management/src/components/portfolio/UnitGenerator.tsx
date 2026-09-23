import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@project/components/lib/utils';
import { useWorkspace } from '../../lib/workspace';
import { Field, FieldRow, MoneyInput, NumberInput, Segmented, TextArea, TextInput } from '../form/fields';

/**
 * Quick unit creation: pick a naming pattern, set counts and the defaults
 * every unit starts with, and see exactly which units will be created before
 * saving. Used by the new-property dialog and "Add units" on a property.
 */

export type NamingPattern = 'numbers' | 'floors' | 'letters' | 'list';

export type GeneratorState = {
  pattern: NamingPattern;
  count: number | null;
  start: number | null;
  floors: number | null;
  perFloor: number | null;
  startFloor: number | null;
  buildings: number | null;
  perBuilding: number | null;
  startLetter: string;
  prefix: string;
  list: string;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  marketRent: number | null;
  depositAmount: number | null;
  unitType: string;
};

export type GeneratedUnit = { name: string; beds: number; baths: number; squareFeet: number | null; marketRent: number; depositAmount: number; unitType: string };

export const MAX_GENERATED = 500;

export function defaultGenerator(): GeneratorState {
  return { pattern: 'numbers', count: 8, start: 101, floors: 3, perFloor: 4, startFloor: 1, buildings: 2, perBuilding: 4, startLetter: 'A', prefix: '', list: '', beds: 1, baths: 1, squareFeet: null, marketRent: null, depositAmount: null, unitType: '' };
}

const clampInt = (n: number | null, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(n ?? 0)));

export function unitNames(s: GeneratorState): string[] {
  const prefix = s.prefix.trim() ? `${s.prefix.trim()} ` : '';
  switch (s.pattern) {
    case 'numbers': {
      const count = clampInt(s.count, 0, MAX_GENERATED + 1);
      const start = Math.floor(s.start ?? 1);
      return Array.from({ length: count }, (_, i) => `${prefix}${start + i}`);
    }
    case 'floors': {
      const floors = clampInt(s.floors, 0, 200);
      const per = clampInt(s.perFloor, 0, 99);
      const first = Math.floor(s.startFloor ?? 1);
      const out: string[] = [];
      for (let f = 0; f < floors && out.length <= MAX_GENERATED; f++) for (let n = 1; n <= per; n++) out.push(`${prefix}${(first + f) * 100 + n}`);
      return out;
    }
    case 'letters': {
      const buildings = clampInt(s.buildings, 0, 26);
      const per = clampInt(s.perBuilding, 0, 200);
      const base = (s.startLetter.trim().toUpperCase().charCodeAt(0) || 65) - 65;
      const out: string[] = [];
      for (let b = 0; b < buildings; b++) {
        const letter = String.fromCharCode(65 + ((base + b) % 26));
        for (let n = 1; n <= per && out.length <= MAX_GENERATED; n++) out.push(`${prefix}${letter}${n}`);
      }
      return out;
    }
    case 'list':
      return s.list.split(/[\n,]+/).map(x => x.trim()).filter(Boolean).map(x => x.slice(0, 40));
  }
}

export function generateUnits(s: GeneratorState): GeneratedUnit[] {
  return unitNames(s).slice(0, MAX_GENERATED).map(name => ({
    name,
    beds: Math.max(0, Math.floor(s.beds ?? 0)),
    baths: Math.max(0, s.baths ?? 1),
    squareFeet: s.squareFeet && s.squareFeet > 0 ? Math.floor(s.squareFeet) : null,
    marketRent: s.marketRent ?? 0,
    depositAmount: s.depositAmount ?? s.marketRent ?? 0,
    unitType: s.unitType.trim(),
  }));
}

/** Problems that block saving, as sentences. */
export function generatorProblems(s: GeneratorState, existingNames: string[] = []): string[] {
  const names = unitNames(s);
  const problems: string[] = [];
  if (names.length > MAX_GENERATED) problems.push(`That’s more than ${MAX_GENERATED} units. Add them in smaller batches.`);
  const lower = names.map(n => n.toLowerCase());
  const dupes = [...new Set(lower.filter((n, i) => lower.indexOf(n) !== i))];
  if (dupes.length) problems.push(`Some names repeat: ${dupes.slice(0, 4).map(d => names[lower.indexOf(d)]).join(', ')}.`);
  const taken = new Set(existingNames.map(n => n.toLowerCase()));
  const clash = names.filter(n => taken.has(n.toLowerCase()));
  if (clash.length) problems.push(`Already at this property: ${clash.slice(0, 5).join(', ')}${clash.length > 5 ? ` and ${clash.length - 5} more` : ''}.`);
  return problems;
}

export function UnitGenerator({ value: s, onChange, existingNames = [], compact }: { value: GeneratorState; onChange: (s: GeneratorState) => void; existingNames?: string[]; compact?: boolean }) {
  const ws = useWorkspace();
  const set = (patch: Partial<GeneratorState>) => onChange({ ...s, ...patch });
  const names = useMemo(() => unitNames(s), [s]);
  const problems = useMemo(() => generatorProblems(s, existingNames), [s, existingNames]);
  const taken = useMemo(() => new Set(existingNames.map(n => n.toLowerCase())), [existingNames]);
  const shown = names.slice(0, 48);
  const range = names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names[0] ?? '';

  return (
    <div className="space-y-3">
      <Field label="Naming">
        <Segmented
          value={s.pattern}
          onChange={v => set({ pattern: v as NamingPattern })}
          size="sm"
          className="flex-wrap"
          options={[
            { value: 'numbers', label: '101, 102…' },
            { value: 'floors', label: 'By floor' },
            { value: 'letters', label: 'A1, B1…' },
            { value: 'list', label: 'Custom list' },
          ]}
        />
      </Field>

      {s.pattern === 'numbers' && (
        <FieldRow cols={3}>
          <Field label="How many"><NumberInput value={s.count} onChange={v => set({ count: v })} min={0} max={MAX_GENERATED} /></Field>
          <Field label="Start at"><NumberInput value={s.start} onChange={v => set({ start: v })} min={0} /></Field>
          <Field label="Prefix" optional><TextInput value={s.prefix} onChange={e => set({ prefix: e.target.value })} placeholder="Unit" maxLength={20} /></Field>
        </FieldRow>
      )}
      {s.pattern === 'floors' && (
        <FieldRow cols={3}>
          <Field label="Floors"><NumberInput value={s.floors} onChange={v => set({ floors: v })} min={0} max={200} /></Field>
          <Field label="Units per floor"><NumberInput value={s.perFloor} onChange={v => set({ perFloor: v })} min={0} max={99} /></Field>
          <Field label="First floor"><NumberInput value={s.startFloor} onChange={v => set({ startFloor: v })} min={0} max={200} /></Field>
        </FieldRow>
      )}
      {s.pattern === 'letters' && (
        <FieldRow cols={3}>
          <Field label="Buildings"><NumberInput value={s.buildings} onChange={v => set({ buildings: v })} min={0} max={26} /></Field>
          <Field label="Units each"><NumberInput value={s.perBuilding} onChange={v => set({ perBuilding: v })} min={0} max={200} /></Field>
          <Field label="First letter"><TextInput value={s.startLetter} onChange={e => set({ startLetter: e.target.value.replace(/[^a-z]/gi, '').slice(-1).toUpperCase() })} maxLength={1} /></Field>
        </FieldRow>
      )}
      {s.pattern === 'list' && (
        <Field label="Unit names" hint="One per line, or separated by commas.">
          <TextArea value={s.list} onChange={e => set({ list: e.target.value })} rows={3} placeholder={'Garden\nUpper\nLower'} />
        </Field>
      )}

      <div className={cn('grid gap-3', compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-5')}>
        <Field label="Beds"><NumberInput value={s.beds} onChange={v => set({ beds: v })} min={0} max={20} /></Field>
        <Field label="Baths"><NumberInput value={s.baths} onChange={v => set({ baths: v })} min={0} max={20} step={0.5} /></Field>
        <Field label="Sq ft" optional><NumberInput value={s.squareFeet} onChange={v => set({ squareFeet: v })} min={0} /></Field>
        <Field label="Market rent"><MoneyInput value={s.marketRent} onChange={v => set({ marketRent: v })} /></Field>
        <Field label="Deposit" optional><MoneyInput value={s.depositAmount} onChange={v => set({ depositAmount: v })} placeholder={s.marketRent != null ? s.marketRent.toFixed(2) : '0.00'} /></Field>
      </div>

      <div className="rounded-lg border bg-subtle/60 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[14px] font-medium">
            {names.length === 0 ? 'No units will be created' : `${Math.min(names.length, MAX_GENERATED).toLocaleString()} ${names.length === 1 ? 'unit' : 'units'}${range ? ` · ${range}` : ''}`}
          </span>
          {names.length > 0 && s.marketRent ? <span className="num text-sm text-muted-foreground">{ws.money((s.marketRent ?? 0) * Math.min(names.length, MAX_GENERATED), { cents: false })}/mo at market rent</span> : null}
        </div>
        {names.length > 0 && (
          <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto" aria-label="Units to create">
            {shown.map((n, i) => (
              <span key={`${n}:${i}`} className={cn('chip h-6 bg-background tabular-nums', taken.has(n.toLowerCase()) && 'border-tone-danger/50 text-tone-danger')}>{n}</span>
            ))}
            {names.length > shown.length && <span className="chip h-6 text-muted-foreground">+{(names.length - shown.length).toLocaleString()} more</span>}
          </div>
        )}
        {problems.map(p => (
          <p key={p} role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-tone-danger">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> {p}
          </p>
        ))}
      </div>
    </div>
  );
}
