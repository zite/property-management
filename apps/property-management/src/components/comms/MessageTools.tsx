import { Braces, Building2, FileText, Loader2, Paperclip, UserRound, Wrench, X, ClipboardList, Megaphone } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { uploadFile } from 'zitejs/upload';
import { cn } from '@project/components/lib/utils';
import { MERGE_TAGS } from '@project/shared/merge';
import { errorMessage } from '../../lib/errors';
import { useWorkspace } from '../../lib/workspace';
import { Avatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { OptionPicker } from '../pickers/OptionPicker';
import type { PersonKind, ThreadRow } from './data';

/** Pieces every message surface shares: people glyphs, attachments, template and merge-field pickers. */

/** Mid-tone fills that carry white initials in both themes. */
const KIND_COLOR: Record<ThreadRow['kind'], string> = { tenant: '#0f766e', owner: '#4f46e5', vendor: '#b45309', applicant: '#0369a1', work_order: '#64748b' };

export function PersonAvatar({ kind, name, size = 28, className }: { kind: ThreadRow['kind']; name: string; size?: number; className?: string }) {
  if (kind === 'work_order') {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground', className)} style={{ width: size, height: size }} aria-hidden>
        <Wrench style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  }
  return <Avatar name={name} size={size} color={KIND_COLOR[kind]} className={className} />;
}

export function KindIcon({ kind, className }: { kind: ThreadRow['kind'] | 'announcement'; className?: string }) {
  const c = cn('h-3.5 w-3.5 shrink-0', className);
  if (kind === 'tenant') return <UserRound className={c} />;
  if (kind === 'owner') return <Building2 className={c} />;
  if (kind === 'vendor') return <Wrench className={c} />;
  if (kind === 'applicant') return <ClipboardList className={c} />;
  if (kind === 'announcement') return <Megaphone className={c} />;
  return <Wrench className={c} />;
}

// ── Attachments ─────────────────────────────────────────────────────────────

export type FileRef = { name: string; url: string };

export function useAttachments(max = 10) {
  const [files, setFiles] = useState<FileRef[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const add = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      if (files.length + uploading.length >= max) {
        toast.error(`Attach up to ${max} files`);
        break;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} is over 25 MB`);
        continue;
      }
      setUploading(u => [...u, file.name]);
      try {
        const { fileUrl } = await uploadFile({ data: file, filename: file.name });
        setFiles(f => [...f, { name: file.name, url: fileUrl }]);
      } catch (e) {
        toast.error(errorMessage(e, `Couldn’t upload ${file.name}`));
      } finally {
        setUploading(u => u.filter(n => n !== file.name));
      }
    }
  };
  const picker = <input ref={input} type="file" multiple className="hidden" onChange={e => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />;
  return {
    files,
    uploading,
    busy: uploading.length > 0,
    add,
    open: () => input.current?.click(),
    remove: (url: string) => setFiles(f => f.filter(x => x.url !== url)),
    reset: () => { setFiles([]); setUploading([]); },
    picker,
  };
}

export function AttachmentChips({ files, uploading = [], onRemove, className }: { files: FileRef[]; uploading?: string[]; onRemove?: (url: string) => void; className?: string }) {
  if (!files.length && !uploading.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {files.map(f => (
        <span key={f.url} className="chip max-w-[240px] bg-background pr-1">
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <a href={f.url} target="_blank" rel="noreferrer" className="truncate hover:underline">{f.name}</a>
          {onRemove && (
            <button type="button" onClick={() => onRemove(f.url)} aria-label={`Remove ${f.name}`} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {uploading.map(n => (
        <span key={n} className="chip max-w-[240px] text-muted-foreground">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> <span className="truncate">{n}</span>
        </span>
      ))}
    </div>
  );
}

// ── Templates and merge fields ──────────────────────────────────────────────

const AUDIENCE_FOR: Record<PersonKind, string> = { tenant: 'Tenant', owner: 'Owner', vendor: 'Vendor', applicant: 'Applicant' };

/** Email templates, the ones written for these recipients first. */
export function TemplatePicker({ kinds, onPick, trigger, disabled }: { kinds: PersonKind[]; onPick: (templateId: string) => void; trigger: ReactNode; disabled?: boolean }) {
  const ws = useWorkspace();
  const options = useMemo(() => {
    const wanted = new Set(kinds.map(k => AUDIENCE_FOR[k]));
    const sorted = [...ws.templates].sort((a, b) => Number(wanted.has(b.audience)) - Number(wanted.has(a.audience)) || Number(b.trigger === 'Manual') - Number(a.trigger === 'Manual'));
    return sorted.map(t => ({
      value: t.id,
      label: t.name,
      group: wanted.size && wanted.has(t.audience) ? `For ${[...wanted].map(a => (a === 'Tenant' ? 'residents' : `${a.toLowerCase()}s`)).join(' and ')}` : `${t.audience === 'Tenant' ? 'Resident' : t.audience} templates`,
      icon: <FileText className="h-3.5 w-3.5 text-muted-foreground" />,
      keywords: [t.trigger, t.audience],
      hint: t.trigger !== 'Manual' ? <span className="max-w-[120px] truncate">{t.trigger}</span> : undefined,
    }));
  }, [ws.templates, kinds.join(',')]);
  return <OptionPicker options={options} value={null} onChange={v => v && onPick(v)} placeholder="Find a template…" emptyText="No templates" width={320} trigger={trigger} disabled={disabled} />;
}

const ANNOUNCEMENT_TAGS = new Set(['recipient_first_name', 'recipient_name', 'property_name', 'unit_name', 'unit_address', 'organization_name', 'office_phone', 'support_email', 'emergency_phone', 'portal_link']);

export function MergeFieldPicker({ onPick, trigger, announcement }: { onPick: (token: string) => void; trigger: ReactNode; announcement?: boolean }) {
  const options = useMemo(
    () => MERGE_TAGS.filter(t => !announcement || ANNOUNCEMENT_TAGS.has(t.tag)).map(t => ({ value: t.tag, label: t.label, group: t.group, hint: <span className="font-mono text-2xs">{t.sample.length > 18 ? `${t.sample.slice(0, 17)}…` : t.sample}</span>, keywords: [t.tag] })),
    [announcement],
  );
  return <OptionPicker options={options} value={null} onChange={v => v && onPick(`{{${v}}}`)} placeholder="Insert a field…" width={300} trigger={trigger} />;
}

export const toolButton = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5';

export function ToolButtons({ onAttach, templateKinds, onTemplate, onField, announcement, compact }: { onAttach?: () => void; templateKinds?: PersonKind[]; onTemplate?: (id: string) => void; onField: (token: string) => void; announcement?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {onTemplate && templateKinds && (
        <TemplatePicker kinds={templateKinds} onPick={onTemplate} trigger={<button type="button" className={toolButton}><FileText /> {!compact && 'Template'}</button>} />
      )}
      <MergeFieldPicker announcement={announcement} onPick={onField} trigger={<button type="button" className={toolButton} aria-label="Insert a field"><Braces /> {!compact && 'Field'}</button>} />
      {onAttach && (
        <Tip label="Attach files">
          <button type="button" className={toolButton} onClick={onAttach} aria-label="Attach files"><Paperclip /> {!compact && 'Attach'}</button>
        </Tip>
      )}
    </div>
  );
}

/** Insert text at the caret of a textarea (or the end), keeping React's value in sync. */
export function insertAt(el: HTMLTextAreaElement | HTMLInputElement | null, current: string, token: string, set: (v: string) => void) {
  const start = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  set(next);
  window.setTimeout(() => {
    if (!el) return;
    el.focus();
    const caret = start + token.length;
    el.setSelectionRange(caret, caret);
  }, 0);
}

/** Merge tags shown as tokens, so a template reads as a template. */
export function TaggedText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    parts.push(text.slice(last, m.index));
    const label = MERGE_TAGS.find(t => t.tag === m[1].toLowerCase())?.label ?? m[1];
    parts.push(<span key={m.index} className="mx-px rounded bg-tone-info/10 px-1 py-px text-[0.92em] text-tone-info">{label}</span>);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <span className={cn('whitespace-pre-wrap break-words', className)}>{parts}</span>;
}

export const hasTags = (text: string) => /\{\{\s*[a-z_]+\s*\}\}/i.test(text);

/** The merge fields a draft uses, as tokens: "Fills in: Recipient first name · Balance due". */
export function FieldChips({ text, className, missing = [] }: { text: string; className?: string; missing?: string[] }) {
  const tags = [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(m => m[1].toLowerCase()))];
  if (!tags.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1 text-sm text-muted-foreground', className)}>
      <span>Fills in for each person:</span>
      {tags.map(tag => {
        const label = MERGE_TAGS.find(t => t.tag === tag)?.label ?? tag;
        const empty = missing.includes(label);
        return <span key={tag} className={cn('rounded px-1 py-px', empty ? 'bg-tone-warning/10 text-tone-warning' : 'bg-tone-info/10 text-tone-info')}>{label}</span>;
      })}
    </div>
  );
}
