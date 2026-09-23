import { Braces, ChevronDown, Copy, ExternalLink, ImagePlus, Loader2, Pipette, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { SWATCHES } from '@project/shared/constants';
import { MERGE_TAGS } from '@project/shared/merge';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { initials } from '../../lib/format';
import { FieldButton } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { contrastWithWhite } from './rules';

/** Small controls the Settings sections share. */

// ── Timezone and currency ────────────────────────────────────────────────

const COMMON_ZONES: Array<[string, string]> = [
  ['America/New_York', 'Eastern Time'],
  ['America/Chicago', 'Central Time'],
  ['America/Denver', 'Mountain Time'],
  ['America/Phoenix', 'Mountain Time — Arizona'],
  ['America/Los_Angeles', 'Pacific Time'],
  ['America/Anchorage', 'Alaska Time'],
  ['Pacific/Honolulu', 'Hawaii Time'],
];

function offsetLabel(tz: string) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName');
    return (part?.value ?? '').replace('GMT', 'UTC').replace('-', '−') || 'UTC';
  } catch {
    return '';
  }
}

export function timezoneLabel(tz: string) {
  const common = COMMON_ZONES.find(([z]) => z === tz);
  const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return common ? `${common[1]} (${city})` : city;
}

export function TimezonePicker({ value, onChange, id, invalid }: { value: string; onChange: (tz: string) => void; id?: string; invalid?: boolean }) {
  const options = useMemo(() => {
    const all: string[] = (() => {
      try {
        return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
      } catch {
        return COMMON_ZONES.map(([z]) => z);
      }
    })();
    const common = new Set(COMMON_ZONES.map(([z]) => z));
    return [
      ...COMMON_ZONES.map(([z, label]) => ({ value: z, label: `${label} (${z.split('/').pop()!.replace(/_/g, ' ')})`, hint: offsetLabel(z), group: 'United States', keywords: [z] })),
      ...all.filter(z => !common.has(z)).map(z => ({ value: z, label: z.replace(/_/g, ' '), hint: offsetLabel(z), group: 'All timezones', keywords: [z] })),
    ];
  }, []);
  return (
    <OptionPicker
      options={options}
      value={value}
      onChange={v => onChange(String(v))}
      placeholder="Search timezones…"
      width={320}
      align="end"
      trigger={
        <FieldButton id={id} invalid={invalid}>
          {timezoneLabel(value)} <span className="text-muted-foreground">{offsetLabel(value)}</span>
        </FieldButton>
      }
    />
  );
}

const CURRENCIES: Array<[string, string]> = [
  ['USD', 'US dollar'], ['CAD', 'Canadian dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['AUD', 'Australian dollar'], ['NZD', 'New Zealand dollar'],
  ['MXN', 'Mexican peso'], ['CHF', 'Swiss franc'], ['SGD', 'Singapore dollar'], ['ZAR', 'South African rand'], ['INR', 'Indian rupee'], ['AED', 'UAE dirham'],
];

export function CurrencyPicker({ value, onChange, id }: { value: string; onChange: (code: string) => void; id?: string }) {
  const options = CURRENCIES.map(([code, name]) => ({ value: code, label: `${code} — ${name}`, keywords: [name] }));
  const name = CURRENCIES.find(([c]) => c === value)?.[1];
  return (
    <OptionPicker
      options={options}
      value={value}
      onChange={v => onChange(String(v))}
      placeholder="Search currencies…"
      align="end"
      trigger={<FieldButton id={id}>{name ? `${value} — ${name}` : value}</FieldButton>}
    />
  );
}

// ── Brand colour ─────────────────────────────────────────────────────────

export function ColorField({ value, onChange, id, invalid }: { value: string; onChange: (hex: string) => void; id?: string; invalid?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value;
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  const swatches = [...new Set(['#0f766e', ...SWATCHES])];
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Brand colour presets">
        {swatches.map(c => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c.toLowerCase()}
            aria-label={c}
            onClick={() => {
              setText(null);
              onChange(c);
            }}
            className={cn('h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-110', value.toLowerCase() === c.toLowerCase() && 'ring-2 ring-foreground ring-offset-2 ring-offset-background')}
            style={{ background: c }}
          />
        ))}
        <label className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground hover:text-foreground" title="Pick any colour">
          <Pipette className="h-3 w-3" />
          <input type="color" value={valid ? value : '#0f766e'} onChange={e => { setText(null); onChange(e.target.value); }} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick any colour" />
        </label>
      </div>
      <div className="relative w-[124px]">
        <span className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-[4px] border border-black/10" style={{ background: valid ? value : 'transparent' }} />
        <input
          id={id}
          value={shown}
          aria-invalid={invalid || undefined}
          spellCheck={false}
          maxLength={7}
          onChange={e => {
            let v = e.target.value.trim();
            if (v && !v.startsWith('#')) v = `#${v}`;
            setText(v);
            onChange(v.toLowerCase());
          }}
          onBlur={() => setText(null)}
          className={cn('field num pl-8 font-mono text-[13.5px] uppercase', invalid && 'border-tone-danger')}
        />
      </div>
    </div>
  );
}

export function contrastNote(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const ratio = contrastWithWhite(hex);
  return ratio < 4.5 ? `White text on this colour is hard to read (${ratio.toFixed(1)}:1). Buttons in the portal will use it — a darker shade works better.` : null;
}

// ── Images ───────────────────────────────────────────────────────────────

const MAX_IMAGE = 5 * 1024 * 1024;

/** Upload a logo or photo: a preview, Upload/Replace and Remove. */
export function ImageUpload({ value, onChange, name, color, round, label }: { value: string | null; onChange: (url: string | null) => void; name: string; color?: string; round?: boolean; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return void toast.error(`${file.name} isn’t an image`);
    if (file.size > MAX_IMAGE) return void toast.error('Choose an image smaller than 5 MB');
    setPending(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      if (!fileUrl) throw new Error('The upload didn’t return a link');
      onChange(fileUrl);
    } catch (e) {
      toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
    } finally {
      setPending(false);
      if (input.current) input.current.value = '';
    }
  };
  const shape = round ? 'rounded-full' : 'rounded-lg';
  return (
    <div className="flex items-center gap-3">
      <div className={cn('relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border bg-subtle', shape)}>
        {value && broken !== value ? (
          <img src={value} alt="" onError={() => setBroken(value)} className="h-full w-full object-cover" />
        ) : (
          <span className={cn('flex h-full w-full items-center justify-center text-[16px] font-semibold text-white', shape)} style={{ background: color ?? '#8b8d98' }}>{initials(name)}</span>
        )}
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={pending} onClick={() => input.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-50">
          <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" /> {value ? 'Replace' : `Upload ${label}`}
        </button>
        {value && (
          <button type="button" disabled={pending} onClick={() => onChange(null)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => void pick(e.target.files?.[0])} />
    </div>
  );
}

/** The organization's logo for previews, falling back to a brand-colour square if it doesn't load. */
export function LogoMark({ url, color, className }: { url: string | null; color: string; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  return url && broken !== url ? <img src={url} alt="" onError={() => setBroken(url)} className={cn('rounded object-cover', className)} /> : <span className={cn('rounded', className)} style={{ background: color }} />;
}

// ── Merge tags ───────────────────────────────────────────────────────────

/** Insert text at the caret of an input or textarea, returning the new value; the caret lands after it. */
export function insertAtCaret(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  if (el) {
    const caret = start + text.length;
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    }, 0);
  }
  return next;
}

const TAG_OPTIONS = MERGE_TAGS.map(t => ({ value: t.tag, label: t.label, hint: <span className="font-mono text-[12px]">{`{{${t.tag}}}`}</span>, group: t.group, keywords: [t.tag, t.sample] }));

/** "Insert merge tag" — a searchable list; picking one types `{{tag}}` where the caret was. */
export function MergeTagMenu({ onPick, tags, trigger, align = 'end' }: { onPick: (tag: string) => void; tags?: readonly string[]; trigger?: ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const options = tags ? TAG_OPTIONS.filter(o => tags.includes(o.value)) : TAG_OPTIONS;
  return (
    <OptionPicker
      options={options}
      value={null}
      open={open}
      onOpenChange={setOpen}
      onChange={v => onPick(String(v))}
      placeholder="Search merge tags…"
      width={340}
      align={align}
      trigger={
        trigger ?? (
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 text-[13.5px] shadow-2xs hover:bg-accent data-[state=open]:bg-accent">
            <Braces className="h-3.5 w-3.5 text-muted-foreground" /> Insert merge tag <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        )
      }
    />
  );
}

/** Tags in a template that aren't recognized — they'd send as blanks. */
export function unknownTags(texts: string[], allowed: readonly string[] = MERGE_TAGS.map(t => t.tag)) {
  const known = new Set<string>(allowed);
  const found = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) if (!known.has(m[1].toLowerCase())) found.add(m[1]);
  return [...found];
}

// ── Read-only values ─────────────────────────────────────────────────────

export function CopyField({ value, placeholder, openLabel = 'Open' }: { value: string | null; placeholder: string; openLabel?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn('field min-w-0 flex-1 items-center truncate bg-subtle', !value && 'text-muted-foreground')} title={value ?? undefined}>
        <span className="truncate">{value ?? placeholder}</span>
      </div>
      {value && (
        <>
          <button type="button" onClick={() => void copyText(value, 'Link copied')} aria-label="Copy link" title="Copy link" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-2xs hover:bg-accent hover:text-foreground">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <a href={value} target="_blank" rel="noreferrer" aria-label={openLabel} title={openLabel} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-2xs hover:bg-accent hover:text-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </>
      )}
    </div>
  );
}

/** A plain-language callout under a group of settings. */
export function Note({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'info' | 'success'; icon?: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 px-4 py-3 text-[14px] [&_svg]:mt-0.5 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
        tone === 'neutral' && 'bg-subtle/70 text-foreground/90 [&_svg]:text-muted-foreground',
        tone === 'warning' && 'bg-tone-warning/[0.07] text-foreground [&_svg]:text-tone-warning',
        tone === 'info' && 'bg-tone-info/[0.06] text-foreground [&_svg]:text-tone-info',
        tone === 'success' && 'bg-tone-success/[0.07] text-foreground [&_svg]:text-tone-success',
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
