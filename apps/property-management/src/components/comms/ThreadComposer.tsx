import { useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, Mail, MessageSquare, PenLine, Reply, TriangleAlert, UserRound, Wrench } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { previewMessage, sendMessages } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { errorMessage } from '../../lib/errors';
import { MOD } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { MemberAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { afterMessage, mk, summarizeResults, type ThreadDetail, type ThreadMessage, type ThreadParty } from './data';
import { AttachmentChips, FieldChips, hasTags, insertAt, ToolButtons, useAttachments } from './MessageTools';

/**
 * Reply in a thread. Modes: reply to the person (or, on a work order, to its
 * resident or vendor) by email + portal or portal only, or an internal note
 * with @mentions. Templates arrive filled in for this person, with any field
 * that has no value left as a token to complete. ⌘↵ sends; Esc leaves.
 */

type Mode = 'reply' | 'tenant' | 'vendor' | 'note';

export type ThreadComposerHandle = { focus: () => void };

const baseSubject = (messages: ThreadMessage[]) => {
  const last = [...messages].reverse().find(m => m.direction !== 'Internal' && m.channel !== 'Note' && !m.announcementId && m.subject);
  return last ? last.subject.replace(/^((re|fwd?):\s*)+/i, '').trim() : '';
};

export const ThreadComposer = forwardRef<ThreadComposerHandle, { detail: ThreadDetail; onEscape?: () => void; className?: string }>(({ detail, onEscape, className }, ref) => {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const isWo = detail.kind === 'work_order';
  const tenantParty = detail.parties.find(p => p.kind === 'tenant');
  const vendorParty = detail.parties.find(p => p.kind === 'vendor');
  const modes = useMemo(() => {
    const list: Array<{ value: Mode; label: string; icon: JSX.Element; party: ThreadParty | null }> = [];
    if (isWo) {
      if (tenantParty) list.push({ value: 'tenant', label: `Resident · ${tenantParty.label.split(' ')[0]}`, icon: <UserRound />, party: tenantParty });
      if (vendorParty) list.push({ value: 'vendor', label: `Vendor · ${vendorParty.label}`, icon: <Wrench />, party: vendorParty });
    } else if (detail.parties[0]) {
      list.push({ value: 'reply', label: 'Reply', icon: <Reply />, party: detail.parties[0] });
    }
    list.push({ value: 'note', label: 'Internal note', icon: <Lock />, party: null });
    return list;
  }, [detail.thread, detail.parties]);

  const [mode, setMode] = useState<Mode>(modes[0].value);
  const current = modes.find(m => m.value === mode) ?? modes[0];
  const party = current.party;
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [byEmail, setByEmail] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const files = useAttachments();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const isNote = mode === 'note';
  const defaultSubject = isWo ? '' : baseSubject(detail.messages) ? `Re: ${baseSubject(detail.messages)}` : '';

  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

  // A different thread starts a fresh draft.
  useEffect(() => {
    setMode(modes[0].value);
    setBody('');
    setSubject('');
    setTemplateId(null);
    setMissing([]);
    setPreview(null);
    files.reset();
  }, [detail.thread]);

  useEffect(() => setByEmail(Boolean(party?.hasEmail)), [party?.id, party?.hasEmail]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = '0px';
    // Grow with the draft, but never squeeze the conversation out of view.
    el.style.height = `${Math.min(Math.max(120, window.innerHeight * 0.28), Math.max(64, el.scrollHeight))}px`;
  }, [body, preview]);

  const candidates = mentionQuery == null ? [] : ws.activeMembers.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5);

  const insertTemplate = async (id: string) => {
    if (!party) return;
    try {
      const res = await previewMessage({ recipients: [{ kind: party.kind, id: party.id }], templateId: id, keepMissing: true, context: isWo ? { workOrderId: detail.refId } : null });
      if (!res.preview) return;
      setSubject(res.preview.subject);
      setBody(res.preview.body);
      setTemplateId(id);
      setMissing(res.preview.missingTags);
      setPreview(null);
      window.setTimeout(() => textarea.current?.focus(), 0);
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t load that template'));
    }
  };

  const togglePreview = async () => {
    if (preview) return setPreview(null);
    if (!party) return;
    try {
      const res = await previewMessage({ recipients: [{ kind: party.kind, id: party.id }], subject: subject || defaultSubject, body, context: isWo ? { workOrderId: detail.refId } : null });
      if (res.preview) {
        setPreview({ subject: res.preview.subject, body: res.preview.body });
        setMissing(res.preview.missingTags);
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t render the preview'));
    }
  };

  const send = async () => {
    const text = body.trim();
    if (!text || sending || files.busy) return;
    setSending(true);
    const attachments = files.files;
    try {
      let summary = '';
      if (isNote) {
        await sendMessages({ mode: 'note', thread: detail.thread, body: text, attachments });
      } else if (isWo && party) {
        const res = await sendMessages({ mode: 'workOrder', workOrderId: detail.refId, to: party.kind as 'tenant' | 'vendor', subject: subject.trim() || null, body: text, byEmail: byEmail && party.hasEmail, templateId, attachments });
        summary = summarizeResults(res.results).text;
      } else if (party) {
        const res = await sendMessages({ mode: 'people', recipients: [{ kind: party.kind, id: party.id }], subject: subject.trim() || defaultSubject || text.split('\n')[0].slice(0, 80), body: text, byEmail: byEmail && party.hasEmail, templateId, attachments });
        const s = summarizeResults(res.results);
        if (s.errors) throw new Error(res.results[0]?.error ?? 'Couldn’t send');
        summary = s.text;
      }
      setBody('');
      setSubject('');
      setTemplateId(null);
      setMissing([]);
      setPreview(null);
      files.reset();
      await qc.invalidateQueries({ queryKey: mk.thread(detail.thread) });
      afterMessage(qc);
      if (summary && /failed/.test(summary)) toast.warning(summary, { description: 'The message is in their portal; the email didn’t go through.' });
      else if (!isNote) toast.success(summary || 'Message sent');
    } catch (e) {
      toast.error(errorMessage(e, isNote ? 'Couldn’t add the note' : 'Couldn’t send the message'));
    } finally {
      setSending(false);
    }
  };

  const emailOff = !party?.hasEmail;

  return (
    <div className={cn('relative rounded-xl border bg-card shadow-xs focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15', isNote && 'border-tone-warning/30 bg-tone-warning/[0.03] focus-within:border-tone-warning/50 focus-within:ring-tone-warning/15', className)}>
      {files.picker}
      <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5 scrollbar-none">
        {modes.map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => { setMode(m.value); setPreview(null); window.setTimeout(() => textarea.current?.focus(), 0); }}
            className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm transition-colors [&_svg]:h-3 [&_svg]:w-3', mode === m.value ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            aria-pressed={mode === m.value}
          >
            {m.icon}
            <span className="max-w-[180px] truncate">{m.label}</span>
          </button>
        ))}
        {!isNote && party && (
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
            {emailOff ? (
              <Tip label="There’s no valid email on file, so this goes to their portal only.">
                <span className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-sm text-tone-warning"><MessageSquare className="h-3 w-3" /> Portal only · no email</span>
              </Tip>
            ) : (
              <div role="radiogroup" aria-label="Delivery" className="inline-flex h-6 items-center rounded-md border bg-muted/40 p-0.5">
                {[{ v: true, label: 'Email + portal', icon: <Mail className="h-3 w-3" /> }, { v: false, label: 'Portal only', icon: <MessageSquare className="h-3 w-3" /> }].map(o => (
                  <button key={String(o.v)} type="button" role="radio" aria-checked={byEmail === o.v} onClick={() => setByEmail(o.v)} className={cn('inline-flex h-full items-center gap-1 rounded-[4px] px-1.5 text-2xs transition-colors', byEmail === o.v ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
                    {o.icon}
                    <span className="hidden sm:inline">{o.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!isNote && (
        <div className="flex items-center gap-2 border-b px-3">
          <span className="text-sm text-muted-foreground">Subject</span>
          <input
            value={preview ? preview.subject : subject}
            readOnly={Boolean(preview)}
            onChange={e => setSubject(e.target.value)}
            placeholder={isWo ? `WO-${detail.workOrder?.number}: ${detail.workOrder?.title ?? ''}` : defaultSubject || 'What’s this about?'}
            className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70"
            aria-label="Subject"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
              if (e.key === 'Escape') onEscape?.();
            }}
          />
        </div>
      )}

      {preview ? (
        <div className="max-h-[28vh] min-h-[64px] overflow-y-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[14px] leading-relaxed">{preview.body || <span className="text-muted-foreground">Nothing to preview</span>}</div>
      ) : (
        <textarea
          ref={textarea}
          data-composer-input
          value={body}
          onChange={e => {
            setBody(e.target.value);
            const match = isNote ? /@(\w*)$/.exec(e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length)) : null;
            setMentionQuery(match ? match[1] : null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
            if (e.key === 'Escape') {
              if (mentionQuery != null) setMentionQuery(null);
              else onEscape?.();
            }
          }}
          onPaste={e => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void files.add(e.clipboardData.files);
            }
          }}
          rows={3}
          placeholder={isNote ? 'Add a note for your team — type @ to mention someone' : party ? `Write to ${party.label}…` : 'There’s no one to message on this thread'}
          disabled={!isNote && !party}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/75"
          aria-label={isNote ? 'Internal note' : 'Message'}
        />
      )}
      {candidates.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-56 overflow-hidden rounded-md border bg-popover p-1 shadow-lg">
          {candidates.map(m => (
            <button
              key={m.id}
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                setBody(b => b.replace(/@(\w*)$/, `@[${m.name}](${m.id}) `));
                setMentionQuery(null);
              }}
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-[14px] hover:bg-accent"
            >
              <MemberAvatar member={m} size={16} /> {m.name}
            </button>
          ))}
        </div>
      )}

      {!preview && hasTags(`${subject}\n${body}`) && <FieldChips text={`${subject}\n${body}`} missing={missing} className="border-t border-dashed px-3 py-1.5" />}
      {missing.length > 0 && !isNote && hasTags(`${subject}\n${body}`) && (
        <p className="flex items-start gap-1.5 border-t px-3 py-1.5 text-sm text-tone-warning">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>No value for {missing.join(', ')} — fill {missing.length === 1 ? 'it' : 'them'} in, or {missing.length === 1 ? 'it' : 'they'}’ll be left blank.</span>
        </p>
      )}
      <AttachmentChips files={files.files} uploading={files.uploading} onRemove={files.remove} className="px-3 pb-1 pt-1.5" />

      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <ToolButtons
          compact
          onAttach={files.open}
          templateKinds={party ? [party.kind] : undefined}
          onTemplate={isNote || !party ? undefined : id => void insertTemplate(id)}
          onField={token => insertAt(textarea.current, body, token, setBody)}
        />
        {!isNote && party && hasTags(`${subject}\n${body}`) && (
          <Tip label={preview ? 'Back to editing' : `Preview for ${party.label}`}>
            <button type="button" onClick={() => void togglePreview()} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:h-3.5 [&_svg]:w-3.5', preview && 'bg-accent text-foreground')}>
              {preview ? <PenLine /> : <Eye />} <span className="hidden sm:inline">{preview ? 'Edit' : 'Preview'}</span>
            </button>
          </Tip>
        )}
        <span className="ml-auto hidden truncate text-sm text-muted-foreground md:inline">
          {isNote ? 'Only your team sees notes' : party ? (byEmail && party.hasEmail ? `Emails ${party.email} and posts to their portal` : 'Shows in their portal next time they sign in') : ''}
        </span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!body.trim() || sending || files.busy || (!isNote && !party)}
          className={cn('ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium shadow-xs disabled:opacity-40 md:ml-0', isNote ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-primary text-primary-foreground hover:bg-primary/90')}
        >
          {sending ? (isNote ? 'Adding…' : 'Sending…') : isNote ? 'Add note' : 'Send'} <span className="opacity-70">{MOD}↵</span>
        </button>
      </div>
    </div>
  );
});
ThreadComposer.displayName = 'ThreadComposer';
