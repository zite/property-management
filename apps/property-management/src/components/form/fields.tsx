import { forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@project/components/lib/utils';
import { Switch } from '@project/components/ui/switch';
import { toCents } from '@project/shared/money';

/**
 * Form fields sized for the 13px UI. A field is a label, a control and an
 * optional hint or error; `Field` wires the ids so screen readers announce
 * the hint and error with the control.
 */

export function Field({ label, hint, error, children, className, optional, htmlFor, action }: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  optional?: boolean;
  htmlFor?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-[13.5px] font-medium text-foreground/90">
              {label}
              {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
            </label>
          )}
          {action}
        </div>
      )}
      {children}
      {error ? <p role="alert" className="text-sm text-tone-danger">{error}</p> : hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={cn('field', invalid && 'border-tone-danger focus-visible:border-tone-danger', className)} {...props} />
));
TextInput.displayName = 'TextInput';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <textarea ref={ref} aria-invalid={invalid || undefined} className={cn('field resize-y', invalid && 'border-tone-danger', className)} {...props} />
));
TextArea.displayName = 'TextArea';

/**
 * Currency input that keeps what the person typed while focused ("1,2") and
 * commits a clean number on blur. `value` is a number or null.
 */
export function MoneyInput({ value, onChange, id, placeholder = '0.00', invalid, disabled, className, autoFocus, prefix = '$', min }: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  prefix?: string;
  min?: number;
}) {
  const fmt = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '' : (toCents(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const parse = (s: string) => {
    const cleaned = s.replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  // Follow the value when it changes from outside (a dialog prefilling an autofocused field),
  // but never rewrite what someone is typing: while focused, only an external change counts.
  useEffect(() => {
    if (!focused || parse(text) !== (value ?? null)) setText(fmt(value));
  }, [value, focused]);
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[14px] text-muted-foreground">{prefix}</span>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={text}
        placeholder={placeholder}
        onFocus={e => {
          setFocused(true);
          // Typing over a prefilled amount replaces it instead of appending.
          e.currentTarget.select();
        }}
        onChange={e => {
          setText(e.target.value);
          const n = parse(e.target.value);
          onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          setText(fmt(parse(text)));
        }}
        className={cn('field num pl-6 text-right', invalid && 'border-tone-danger')}
      />
    </div>
  );
}

export function NumberInput({ value, onChange, id, min, max, step = 1, invalid, className, placeholder, suffix }: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  id?: string;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={cn('field num', suffix && 'pr-10', invalid && 'border-tone-danger')}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** A native date input (`YYYY-MM-DD`), styled to match — reliable on every device, keyboard included. */
export function DateInput({ value, onChange, id, min, max, invalid, className, disabled }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; min?: string; max?: string; invalid?: boolean; className?: string; disabled?: boolean }) {
  return (
    <input
      id={id}
      type="date"
      value={value ?? ''}
      min={min}
      max={max}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={e => onChange(e.target.value || null)}
      className={cn('field num [color-scheme:light] dark:[color-scheme:dark]', invalid && 'border-tone-danger', className)}
    />
  );
}

export function DateTimeInput({ value, onChange, id, invalid, className }: { value: string | null | undefined; onChange: (iso: string | null) => void; id?: string; invalid?: boolean; className?: string }) {
  // datetime-local speaks local wall time; convert to and from ISO at the edges.
  const local = value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
  return (
    <input
      id={id}
      type="datetime-local"
      value={local}
      aria-invalid={invalid || undefined}
      onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      className={cn('field num [color-scheme:light] dark:[color-scheme:dark]', invalid && 'border-tone-danger', className)}
    />
  );
}

export function SwitchRow({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[14px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

/** A compact segmented control for 2–5 choices. */
export function Segmented<V extends string>({ value, onChange, options, className, size = 'md' }: { value: V; onChange: (v: V) => void; options: ReadonlyArray<{ value: V; label: ReactNode }>; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex items-center rounded-md border bg-muted/50 p-0.5', size === 'sm' ? 'h-8' : 'h-9', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-full items-center rounded-[5px] px-2.5 text-[13.5px] transition-colors',
            value === o.value ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Two or three fields side by side on wide screens, stacked on phones. */
export function FieldRow({ children, className, cols = 2 }: { children: ReactNode; className?: string; cols?: 2 | 3 }) {
  return <div className={cn('grid gap-3', cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3', className)}>{children}</div>;
}
