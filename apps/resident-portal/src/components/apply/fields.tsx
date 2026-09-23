import { Minus, Plus } from 'lucide-react';
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { FieldRow, inputClass, textareaClass } from '../ui';

/**
 * The rental application's inputs. Each wraps the portal's FieldRow, carries a
 * `data-field` so "fix this" can scroll to it, and wires its error to the
 * input with aria-invalid and aria-describedby.
 */

export const fieldId = (name: string) => `apply-${name.replace(/[^a-zA-Z0-9]+/g, '-')}`;

type Base = { name: string; label: string; hint?: ReactNode; error?: string; optional?: boolean; className?: string; disabled?: boolean };

function a11y(name: string, error: string | undefined, hint: ReactNode) {
  const id = fieldId(name);
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [error ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined,
  } as const;
}

export function Field({ name, label, hint, error, optional, className, children }: Base & { children: ReactNode }) {
  return (
    <div data-field={name} className={className}>
      <FieldRow id={fieldId(name)} label={label} hint={hint} error={error} optional={optional}>
        {children}
      </FieldRow>
    </div>
  );
}

export function TextField({ value, onChange, inputProps, ...base }: Base & { value: string; onChange: (v: string) => void; inputProps?: InputHTMLAttributes<HTMLInputElement> }) {
  return (
    <Field {...base}>
      <input {...a11y(base.name, base.error, base.hint)} value={value} onChange={e => onChange(e.target.value)} disabled={base.disabled} className={inputClass()} {...inputProps} />
    </Field>
  );
}

export function TextAreaField({ value, onChange, rows = 3, maxLength = 1000, placeholder, ...base }: Base & { value: string; onChange: (v: string) => void; rows?: number; maxLength?: number; placeholder?: string }) {
  return (
    <Field {...base}>
      <textarea {...a11y(base.name, base.error, base.hint)} value={value} onChange={e => onChange(e.target.value)} rows={rows} maxLength={maxLength} placeholder={placeholder} disabled={base.disabled} className={textareaClass('min-h-[88px]')} />
      {value.length > maxLength * 0.8 && <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{value.length.toLocaleString()} / {maxLength.toLocaleString()}</p>}
    </Field>
  );
}

/** US-style numbers are tidied when you leave the field; anything international is left as typed. */
export function formatPhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw.trim();
}

export function PhoneField({ value, onChange, ...base }: Base & { value: string; onChange: (v: string) => void }) {
  return (
    <Field {...base}>
      <input
        {...a11y(base.name, base.error, base.hint)}
        type="tel"
        inputMode="tel"
        autoComplete={base.name === 'phone' ? 'tel' : 'off'}
        value={value}
        maxLength={40}
        placeholder="(303) 555-0142"
        onChange={e => onChange(e.target.value)}
        onBlur={() => {
          const tidy = formatPhone(value);
          if (tidy !== value) onChange(tidy);
        }}
        disabled={base.disabled}
        className={inputClass('sm:max-w-xs')}
      />
    </Field>
  );
}

export function DateField({ value, onChange, min, max, ...base }: Base & { value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <Field {...base}>
      <input {...a11y(base.name, base.error, base.hint)} type="date" value={value} min={min} max={max} onChange={e => onChange(e.target.value)} disabled={base.disabled} className={inputClass('sm:max-w-xs')} />
    </Field>
  );
}

const moneyText = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** Dollars, with thousands separators as you'd write them, stored as a number. */
export function MoneyField({ value, onChange, suffix, ...base }: Base & { value: number | null; onChange: (v: number | null) => void; suffix?: string }) {
  const [text, setText] = useState(moneyText(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text.replace(/[$,\s]/g, ''));
    if (parsed !== value && !(Number.isNaN(parsed) && value == null)) setText(moneyText(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field {...base}>
      <div className="relative sm:max-w-xs">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground" aria-hidden>
          $
        </span>
        <input
          {...a11y(base.name, base.error, base.hint)}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={e => {
            const t = e.target.value.replace(/[^\d.,]/g, '');
            setText(t);
            const n = t.trim() === '' ? null : Number(t.replace(/,/g, ''));
            onChange(n == null || Number.isNaN(n) ? null : Math.round(n * 100) / 100);
          }}
          onBlur={() => setText(moneyText(value))}
          disabled={base.disabled}
          className={inputClass(cn('pl-7 tabular-nums', suffix && 'pr-16'))}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

/** A small whole number with − and + for thumbs. */
export function CountField({ value, onChange, min = 1, max = 20, ...base }: Base & { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number }) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, (value ?? min - (d > 0 ? 1 : 0)) + d)));
  const btn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground shadow-2xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-40';
  return (
    <Field {...base}>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={base.disabled || value == null || value <= min} aria-label={`Fewer — ${base.label}`}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          {...a11y(base.name, base.error, base.hint)}
          inputMode="numeric"
          value={value ?? ''}
          onChange={e => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 3);
            onChange(d === '' ? null : Number(d));
          }}
          disabled={base.disabled}
          className={inputClass('w-20 text-center tabular-nums')}
        />
        <button type="button" className={btn} onClick={() => step(1)} disabled={base.disabled || (value != null && value >= max)} aria-label={`More — ${base.label}`}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </Field>
  );
}

/** Years and months, stored as total months. */
export function DurationField({ value, onChange, ...base }: Base & { value: number | null; onChange: (v: number | null) => void }) {
  const years = value == null ? '' : String(Math.floor(value / 12));
  const months = value == null ? '' : String(value % 12);
  const [y, setY] = useState(years);
  const [m, setM] = useState(months);
  useEffect(() => {
    const current = y === '' && m === '' ? null : Number(y || 0) * 12 + Number(m || 0);
    if (current !== value) {
      setY(years);
      setM(months);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const emit = (ny: string, nm: string) => onChange(ny === '' && nm === '' ? null : Number(ny || 0) * 12 + Number(nm || 0));
  const ids = a11y(base.name, base.error, base.hint);
  return (
    <Field {...base}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <input
            {...ids}
            inputMode="numeric"
            value={y}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setY(v);
              emit(v, m);
            }}
            disabled={base.disabled}
            className={inputClass('w-20 text-center tabular-nums')}
          />
          <span className="text-[15px] text-muted-foreground">years</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            id={`${ids.id}-months`}
            aria-invalid={ids['aria-invalid']}
            aria-label={`${base.label}, months`}
            inputMode="numeric"
            value={m}
            onChange={e => {
              const raw = e.target.value.replace(/\D/g, '').slice(0, 2);
              const v = raw === '' ? '' : String(Math.min(11, Number(raw)));
              setM(v);
              emit(y, v);
            }}
            disabled={base.disabled}
            className={inputClass('w-20 text-center tabular-nums')}
          />
          <span className="text-[15px] text-muted-foreground">months</span>
        </label>
      </div>
    </Field>
  );
}

/** Two big choices, as a radio group. */
export function YesNoField({ value, onChange, yes = 'Yes', no = 'No', ...base }: Base & { value: boolean | null; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  const id = fieldId(base.name);
  const choice = (v: boolean, text: string) => {
    const on = value === v;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        tabIndex={on || (value == null && v) ? 0 : -1}
        onClick={() => onChange(v)}
        onKeyDown={e => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            onChange(!v);
            (e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-v="${!v}"]`))?.focus();
          }
        }}
        data-v={String(v)}
        disabled={base.disabled}
        className={cn(
          'flex h-11 min-w-[6.5rem] items-center gap-2.5 rounded-lg border px-4 text-[15px] font-medium shadow-2xs transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
          on ? 'border-primary bg-primary/[0.07] text-foreground ring-1 ring-inset ring-primary' : 'bg-background text-foreground hover:border-foreground/25 hover:bg-accent',
          base.error && !on && 'border-tone-danger',
        )}
      >
        <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border-2', on ? 'border-primary' : 'border-input')} aria-hidden>
          {on && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        {text}
      </button>
    );
  };
  return (
    <div data-field={base.name} className={base.className}>
      <p id={`${id}-label`} className="text-[15px] font-medium">
        {base.label}
      </p>
      {base.hint && <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted-foreground">{base.hint}</p>}
      <div id={id} role="radiogroup" aria-labelledby={`${id}-label`} aria-invalid={base.error ? true : undefined} aria-describedby={base.error ? `${id}-error` : undefined} className="mt-2 flex flex-wrap gap-2">
        {choice(true, yes)}
        {choice(false, no)}
      </div>
      {base.error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
          {base.error}
        </p>
      )}
    </div>
  );
}

/** Scroll a field into view and put the cursor in it — used whenever we say "this needs fixing". */
export function focusField(name: string) {
  const wrap = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`);
  if (!wrap) return false;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const target = wrap.querySelector<HTMLElement>('input:not([tabindex="-1"]), textarea, button[role=radio][tabindex="0"], button[role=radio], select');
  window.setTimeout(() => target?.focus({ preventScroll: true }), 300);
  return true;
}
