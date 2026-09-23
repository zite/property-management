import { Ban, Check, CircleDashed, Hammer, ImagePlus, Loader2, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { COLORS, OCCUPANCY_COLOR, SWATCHES, UNIT_READINESS, type UnitReadiness } from '@project/shared/constants';
import { errorMessage } from '../../lib/errors';
import { percent } from '../../lib/format';
import { OptionPicker } from '../pickers/OptionPicker';
import { Tip } from '../primitives/bits';
import { Pill } from '../primitives/glyphs';
import { READINESS_META, type OccupancyCounts } from './data';

/**
 * Small pieces the portfolio screens share: readiness glyphs and picker, the
 * occupancy bar, property thumbnails, and the form controls the dialogs need
 * that the kit doesn't have (chips, colour swatches, a single photo).
 */

export function ReadinessGlyph({ readiness, size = 14, className }: { readiness: string; size?: number; className?: string }) {
  const meta = READINESS_META[readiness as UnitReadiness] ?? READINESS_META.Ready;
  const box = { width: size, height: size };
  const icon = { width: size * 0.62, height: size * 0.62 };
  if (readiness === 'Off market') return <CircleDashed style={{ ...box, color: meta.color }} className={cn('shrink-0', className)} aria-hidden strokeWidth={2.2} />;
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)} style={{ ...box, background: meta.color }} aria-hidden>
      {readiness === 'Ready' && <Check style={icon} className="text-white" strokeWidth={3.4} />}
      {readiness === 'Make ready' && <Hammer style={icon} className="text-white" strokeWidth={2.8} />}
      {readiness === 'Down' && <Ban style={icon} className="text-white" strokeWidth={3} />}
    </span>
  );
}

export function ReadinessPill({ readiness, className }: { readiness: string; className?: string }) {
  const meta = READINESS_META[readiness as UnitReadiness] ?? READINESS_META.Ready;
  return <Pill tone={meta.tone} className={className}><ReadinessGlyph readiness={readiness} size={11} /> {readiness}</Pill>;
}

export const readinessOptions = UNIT_READINESS.map((r, i) => ({ value: r, label: r, icon: <ReadinessGlyph readiness={r} />, hint: READINESS_META[r].hint, shortcut: String(i + 1) }));

export function ReadinessPicker({ value, onChange, trigger, open, onOpenChange, align = 'start', count }: {
  value: string | null;
  onChange: (r: UnitReadiness) => void;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'center' | 'end';
  count?: number;
}) {
  return (
    <OptionPicker
      options={readinessOptions}
      value={(value as UnitReadiness) ?? null}
      onChange={v => v && onChange(v)}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      align={align}
      width={260}
      placeholder={count && count > 1 ? `Readiness for ${count} units…` : 'Set readiness…'}
    />
  );
}

/** Occupied, on notice and vacant as one segmented bar. */
export function OccupancyBar({ counts, className, label = true, height = 6 }: { counts: OccupancyCounts; className?: string; label?: boolean; height?: number }) {
  const { total, occupied, notice, vacant } = counts;
  const seg = (n: number, color: string) => (n > 0 ? <span style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: color }} className="h-full" /> : null);
  const tip = total ? `${occupied} occupied · ${notice} on notice · ${vacant} vacant` : 'No units yet';
  return (
    <Tip label={tip}>
      <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
        <span className="flex w-full min-w-10 overflow-hidden rounded-full bg-muted" style={{ height }} role="img" aria-label={tip}>
          {seg(occupied, OCCUPANCY_COLOR.Occupied)}
          {seg(notice, OCCUPANCY_COLOR.Notice)}
          {seg(vacant, OCCUPANCY_COLOR.Vacant)}
        </span>
        {label && <span className="w-9 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{total ? `${percent(occupied + notice, total)}%` : '—'}</span>}
      </span>
    </Tip>
  );
}

/** A property's photo, or its colour with its code when there's no photo. */
export function PropertyThumb({ photoUrl, color, code, name, size = 32, className }: { photoUrl?: string | null; color?: string | null; code?: string; name?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (photoUrl && !failed) {
    return <img src={photoUrl} alt="" onError={() => setFailed(true)} loading="lazy" className={cn('shrink-0 rounded-md border object-cover', className)} style={style} />;
  }
  const letters = (code || name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white', className)} style={{ ...style, background: color || COLORS.gray, fontSize: Math.max(8, Math.round(size * (letters.length > 2 ? 0.28 : 0.34))) }}>
      {letters}
    </span>
  );
}

/** Free-text tags: Enter or comma adds, Backspace on an empty input removes the last. */
export function ChipsInput({ value, onChange, placeholder = 'Add…', suggestions = [], id, max = 40 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[]; id?: string; max?: number }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some(v => v.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p.slice(0, 60));
    onChange(next);
    setText('');
  };
  const unused = useMemo(() => suggestions.filter(s => !value.some(v => v.toLowerCase() === s.toLowerCase())).slice(0, 8), [suggestions, value]);
  return (
    <div>
      <div className="field flex h-auto min-h-9 flex-wrap items-center gap-1 py-1" onClick={() => input.current?.focus()}>
        {value.map(v => (
          <span key={v} className="chip h-6 max-w-full gap-1 bg-background pr-1">
            <span className="truncate">{v}</span>
            <button type="button" aria-label={`Remove ${v}`} onClick={e => { e.stopPropagation(); onChange(value.filter(x => x !== v)); }} className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          value={text}
          onChange={e => {
            if (e.target.value.includes(',')) add(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              e.stopPropagation();
              add(text);
            }
            if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? '' : placeholder}
          className="h-6 min-w-[90px] flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/80"
        />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {unused.map(s => (
            <button key={s} type="button" onClick={() => onChange([...value, s])} className="h-6 rounded-md border border-dashed px-2 text-sm text-muted-foreground hover:border-foreground/25 hover:text-foreground">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorSwatches({ value, onChange, label = 'Colour' }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {SWATCHES.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('flex h-6 w-6 items-center justify-center rounded-md ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', value.toLowerCase() === c && 'ring-2 ring-foreground/60')}
          style={{ background: c }}
        >
          {value.toLowerCase() === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** One photo: upload, preview, replace or remove. */
export function PhotoField({ value, onChange, fallback }: { value: string | null; onChange: (url: string | null) => void; fallback?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.error(`${file.name} isn’t an image`);
    if (file.size > 20 * 1024 * 1024) return toast.error(`${file.name} is larger than 20 MB`);
    setBusy(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      if (!fileUrl) throw new Error('The upload service did not return a link');
      onChange(fileUrl);
    } catch (e) {
      toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => input.current?.click()} className="group relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed bg-subtle text-muted-foreground hover:border-foreground/25 hover:text-foreground" aria-label={value ? 'Replace photo' : 'Upload a photo'}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : value ? <img src={value} alt="" className="h-full w-full object-cover" /> : fallback ?? <ImagePlus className="h-4 w-4" />}
      </button>
      <div className="flex flex-col items-start gap-0.5 text-sm">
        <button type="button" onClick={() => input.current?.click()} className="text-primary hover:underline" disabled={busy}>{value ? 'Replace photo' : 'Upload a photo'}</button>
        {value && <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">Remove</button>}
        {!value && <span className="text-muted-foreground">JPG or PNG, up to 20 MB</span>}
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
    </div>
  );
}
