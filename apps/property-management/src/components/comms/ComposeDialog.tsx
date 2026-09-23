import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Eye, Link2, PenLine, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { previewMessage } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { useAppActions, type ComposeOptions, type ComposeRecipient } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { Field, Segmented, SwitchRow, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { RecordSearchPicker } from '../pickers/pickers';
import { afterMessage, mk, sendToPeople, summarizeResults, threadPath, type PersonKind } from './data';
import { AttachmentChips, FieldChips, hasTags, insertAt, KindIcon, ToolButtons, useAttachments } from './MessageTools';

/**
 * Compose a message to one or many residents, owners, vendors and applicants
 * — from anywhere, via `openCompose`. Each person gets their own copy in their
 * own conversation, with merge tags filled in for them. Emails are looked up
 * on the server; people without one get it in their portal only, and the
 * dialog says so before anything is sent.
 *
 * Options: `recipients` (prefilled chips), `subject`, `body`, `context`
 * (`leaseId`, `workOrderId`, `propertyId`, `applicationId` — stored on each
 * message so it also shows on that record's timeline).
 */

type Chip = { kind: PersonKind; id: string; name: string };

const SEARCH_KIND: Record<string, PersonKind> = { tenant: 'tenant', owner: 'owner', vendor: 'vendor', application: 'applicant' };

export default function ComposeDialog({ open, onOpenChange, options }: { open: boolean; onOpenChange: (o: boolean) => void; options: ComposeOptions | null }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const navigate = useNavigate();
  const [recipients, setRecipients] = useState<Chip[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [byEmail, setByEmail] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errors, setErrors] = useState<{ recipients?: string; subject?: string; body?: string }>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const files = useAttachments();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setRecipients((options?.recipients ?? []).map((r: ComposeRecipient) => ({ kind: r.kind, id: r.id, name: r.name })));
    setSubject(options?.subject ?? '');
    setBody(options?.body ?? '');
    setByEmail(true);
    setTemplateId(null);
    setView('write');
    setErrors({});
    setProgress(null);
    files.reset();
    // Starting from nothing, the first thing to do is pick who it's for — open the search ready to type.
    if (!options?.recipients?.length) {
      const t = window.setTimeout(() => setPickerOpen(true), 180);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Debounce what we ask the server about, so typing doesn't fire a request per key.
  const [debounced, setDebounced] = useState({ subject: '', body: '' });
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced({ subject, body }), 400);
    return () => window.clearTimeout(t);
  }, [subject, body]);

  const context = options?.context ?? null;
  const refs = useMemo(() => recipients.map(r => ({ kind: r.kind, id: r.id })), [recipients]);
  const needsRender = hasTags(`${debounced.subject}\n${debounced.body}`);
  const preview = useQuery({
    queryKey: [...mk.preview, refs, needsRender ? debounced : null, context?.workOrderId ?? null, context?.propertyId ?? null],
    queryFn: () => previewMessage({ recipients: refs, subject: debounced.subject, body: debounced.body, context: { workOrderId: context?.workOrderId ?? null, propertyId: context?.propertyId ?? null } }),
    enabled: open && refs.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const known = new Map((preview.data?.recipients ?? []).map(r => [`${r.kind}:${r.id}`, r]));
  const noEmail = recipients.filter(r => known.get(`${r.kind}:${r.id}`)?.hasEmail === false);
  const first = recipients[0];

  const add = (hit: { id: string; label: string; kind: string } | null) => {
    if (!hit) return;
    const kind = SEARCH_KIND[hit.kind];
    if (!kind) return;
    setRecipients(list => (list.some(r => r.kind === kind && r.id === hit.id) ? list : [...list, { kind, id: hit.id, name: hit.label }]));
    setErrors(e => ({ ...e, recipients: undefined }));
  };

  const pickTemplate = async (id: string) => {
    try {
      const res = await previewMessage({ recipients: refs.slice(0, 1), templateId: id });
      if (!res.template) return;
      if (body.trim() && body.trim() !== res.template.body.trim() && !(await app.confirm({ title: `Use “${res.template.name}”?`, description: 'It replaces the subject and message you’ve written.', confirmLabel: 'Replace' }))) return;
      setSubject(res.template.subject);
      setBody(res.template.body);
      setTemplateId(id);
      setErrors({});
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t load that template'));
    }
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (!recipients.length) next.recipients = 'Add at least one person to send to.';
    if (!subject.trim()) next.subject = 'Add a subject.';
    if (!body.trim()) next.body = 'Write a message first.';
    setErrors(next);
    if (Object.keys(next).length || files.busy) return;
    setProgress({ done: 0, total: recipients.length });
    try {
      const results = await sendToPeople(
        { recipients: refs, subject: subject.trim(), body: body.trim(), byEmail, templateId, attachments: files.files, context: context ? { leaseId: context.leaseId ?? null, workOrderId: context.workOrderId ?? null, propertyId: context.propertyId ?? null, applicationId: context.applicationId ?? null } : null },
        (done, total) => setProgress({ done, total }),
      );
      const summary = summarizeResults(results);
      afterMessage(qc);
      const failedPeople = results.filter(r => !r.messageId);
      if (failedPeople.length) {
        // Keep only the people it didn't reach, so sending again can't double up.
        setRecipients(list => list.filter(r => failedPeople.some(f => f.kind === r.kind && f.id === r.id)));
        toast.error(summary.text, { description: failedPeople[0]?.error ?? undefined });
        return;
      }
      onOpenChange(false);
      const only = results.length === 1 ? results[0] : null;
      const message = summary.failed ? toast.warning : toast.success;
      message(summary.text, {
        description: summary.failed ? 'Those messages are in their portal; the emails didn’t go through.' : undefined,
        action: only ? { label: 'Open', onClick: () => navigate(threadPath(only.thread)) } : { label: 'Messages', onClick: () => navigate('/messages') },
      });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the message'));
    } finally {
      setProgress(null);
    }
  };

  const pending = Boolean(progress);
  const kinds = [...new Set(recipients.map(r => r.kind))];
  const contextChips = [
    context?.workOrderId && 'Work order',
    context?.leaseId && 'Lease',
    context?.propertyId && ws.propertyName(context.propertyId),
    context?.applicationId && 'Application',
  ].filter(Boolean) as string[];
  const p = preview.data?.preview;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New message"
      size="lg"
      onSubmit={submit}
      pending={pending}
      submitLabel={progress ? (progress.total > 1 ? `Sending ${progress.done} of ${progress.total}…` : 'Sending…') : recipients.length > 1 ? `Send to ${recipients.length}` : 'Send'}
      footerStart={contextChips.length ? <span className="inline-flex items-center gap-1.5"><Link2 className="h-3 w-3" /> Linked to {contextChips.join(', ')}</span> : byEmail ? 'Emailed and posted to their portal' : 'Posted to their portal only'}
    >
      {files.picker}
      <div className="space-y-4">
        <Field label="To" error={errors.recipients}>
          <div className={cn('flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input/70 bg-background px-1.5 py-1', errors.recipients && 'border-tone-danger')}>
            {recipients.map(r => {
              const info = known.get(`${r.kind}:${r.id}`);
              return (
                <span key={`${r.kind}:${r.id}`} className={cn('chip max-w-[260px] gap-1 bg-subtle pr-1', info?.hasEmail === false && 'border-tone-warning/50')} title={info ? (info.hasEmail ? info.email : 'No email on file — portal only') : undefined}>
                  <KindIcon kind={r.kind} className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{info?.label ?? r.name}</span>
                  {info?.hasEmail === false && <TriangleAlert className="h-3 w-3 shrink-0 text-tone-warning" aria-label="No email on file" />}
                  <button type="button" onClick={() => setRecipients(list => list.filter(x => !(x.kind === r.kind && x.id === r.id)))} aria-label={`Remove ${r.name}`} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <RecordSearchPicker
              kinds={['tenants', 'owners', 'vendors', 'applications']}
              value={null}
              onChange={add}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              placeholder="Search residents, owners, vendors, applicants…"
              trigger={
                <button type="button" data-autofocus={recipients.length ? undefined : true} className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" /> {recipients.length ? 'Add' : 'Add recipients'}
                </button>
              }
            />
          </div>
        </Field>
        {noEmail.length > 0 && (
          <p className="-mt-2 flex items-start gap-1.5 text-sm text-tone-warning">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{noEmail.length === 1 ? `${known.get(`${noEmail[0].kind}:${noEmail[0].id}`)?.label ?? noEmail[0].name} has` : `${plural(noEmail.length, 'person', 'people')} have`} no email on file, so {noEmail.length === 1 ? 'they’ll' : 'they’ll'} only see this in the portal.</span>
          </p>
        )}

        <Field label="Subject" error={errors.subject}>
          <TextInput value={view === 'preview' && p ? p.subject : subject} readOnly={view === 'preview'} onChange={e => { setSubject(e.target.value); setErrors(x => ({ ...x, subject: undefined })); }} placeholder="What’s this about?" invalid={Boolean(errors.subject)} maxLength={200} data-autofocus={recipients.length ? true : undefined}
            onKeyDown={e => {
              // Enter moves on to the message rather than sending half a message.
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                bodyRef.current?.focus();
              }
            }}
          />
        </Field>

        <Field
          label="Message"
          error={errors.body}
          action={
            <div className="flex items-center gap-1">
              {first && hasTags(`${subject}\n${body}`) && (
                <Segmented size="sm" value={view} onChange={v => setView(v as 'write' | 'preview')} options={[{ value: 'write', label: <span className="inline-flex items-center gap-1"><PenLine className="h-3 w-3" /> Write</span> }, { value: 'preview', label: <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> Preview</span> }]} />
              )}
            </div>
          }
        >
          {view === 'preview' && first ? (
            <div className="min-h-[180px] rounded-md border bg-subtle/60 px-3 py-2.5">
              <p className="mb-2 text-sm text-muted-foreground">As {p?.name ?? 'the first recipient'} will see it{recipients.length > 1 ? ` — each of the ${recipients.length} gets their own details` : ''}</p>
              {preview.isFetching && !p ? <div className="skeleton h-16 w-full" /> : <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{p?.body}</p>}
            </div>
          ) : (
            <TextArea ref={bodyRef} value={body} onChange={e => { setBody(e.target.value); setErrors(x => ({ ...x, body: undefined })); }} rows={9} placeholder="Write your message…" invalid={Boolean(errors.body)} className="min-h-[180px]" />
          )}
        </Field>
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-2">
          <ToolButtons templateKinds={kinds.length ? kinds : ['tenant']} onTemplate={id => void pickTemplate(id)} onField={token => insertAt(bodyRef.current, body, token, setBody)} onAttach={files.open} />
          {hasTags(body) && view === 'write' && <span className="text-sm text-muted-foreground">Fields fill in for each person</span>}
        </div>
        {p && p.missingTags.length > 0 && hasTags(`${subject}\n${body}`) && (
          <p className="flex items-start gap-1.5 text-sm text-tone-warning">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            <span>No value for {p.missingTags.join(', ')} for {p.name} — {p.missingTags.length === 1 ? 'it' : 'they'}’ll be left blank.</span>
          </p>
        )}
        {view === 'write' && <FieldChips text={`${subject}\n${body}`} missing={p?.missingTags ?? []} />}
        <AttachmentChips files={files.files} uploading={files.uploading} onRemove={files.remove} />

        <div className="rounded-md border px-3 py-2">
          <SwitchRow label="Also send by email" description={byEmail ? 'They get an email and it’s in their portal conversation.' : 'Posted to their portal only — they’ll see it next time they sign in.'} checked={byEmail} onChange={setByEmail} />
        </div>
        {recipients.some(r => r.kind === 'applicant') && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground"><ClipboardList className="mt-0.5 h-3 w-3 shrink-0" /> Applicants see this on their application in the portal.</p>
        )}
      </div>
    </FormDialog>
  );
}
