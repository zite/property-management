import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Mail, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveEmailTemplate, sendTemplateTest } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Switch } from '@project/components/ui/switch';
import { TEMPLATE_AUDIENCES, type TemplateAudience, type TemplateTrigger } from '@project/shared/constants';
import { renderMerge, sampleMergeContext } from '@project/shared/merge';
import { DEFAULT_TEMPLATES } from '@project/shared/templates';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { Field, Segmented, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { EmptyState, Tip } from '../primitives/bits';
import { Pill } from '../primitives/glyphs';
import { insertAtCaret, MergeTagMenu, Note, unknownTags } from './controls';
import { sk, useEmailTemplates, useOrgSettings, type EmailTemplate, type OrgSettingsData } from './data';
import { Group, Row, SaveBar, SectionError, SectionHeader, SectionSkeleton, useDraft, useUnsavedGuard } from './form';

type Settings = OrgSettingsData['settings'];

/** When each automatic email goes out, in plain words. */
function whenSent(trigger: string, s: Settings): string {
  switch (trigger as TemplateTrigger) {
    case 'Rent reminder': return s.rentReminderDays > 0 ? `${s.rentReminderDays} ${s.rentReminderDays === 1 ? 'day' : 'days'} before rent is due` : 'Rent reminders are off in Rent & fees';
    case 'Payment receipt': return 'When a payment is recorded';
    case 'Late notice': return s.lateFeeType === 'None' ? 'Late fees are off in Rent & fees' : 'When a late fee is added';
    case 'Lease expiring': return 'As a lease nears its end';
    case 'Renewal offer': return 'When you offer a renewal';
    case 'Signature request': return 'When a lease is sent for signature';
    case 'Welcome': return 'When a lease becomes active';
    case 'Move-out': return 'When a security deposit is settled';
    case 'Application received': return 'When someone applies';
    case 'Application approved': return 'When an application is approved';
    case 'Application denied': return 'When an application is denied';
    case 'Work order received': return 'When a resident submits a request';
    case 'Work order scheduled': return 'When a request is scheduled';
    case 'Work order completed': return 'When a request is completed';
    case 'Vendor assigned': return 'When a vendor is assigned a work order';
    case 'Owner statement': return 'When an owner statement is ready';
    case 'Owner approval': return 'When a repair needs the owner’s approval';
    default: return 'Written by hand when messaging someone';
  }
}

const AUDIENCE_GROUP: Record<string, string> = { Tenant: 'Residents', Applicant: 'Applicants', Owner: 'Owners', Vendor: 'Vendors' };

const defaultFor = (t: Pick<EmailTemplate, 'trigger'>) => DEFAULT_TEMPLATES.find(d => d.trigger === t.trigger && t.trigger !== 'Manual');
const isEdited = (t: EmailTemplate) => {
  const d = defaultFor(t);
  return Boolean(d && (d.subject.trim() !== t.subject.trim() || d.body.trim() !== t.body.trim()));
};

/** Settings → Email templates: the list, or one template's editor when `?template=` is set. */
export default function TemplatesSection() {
  const [params] = useSearchParams();
  const templates = useEmailTemplates();
  const org = useOrgSettings();
  const id = params.get('template');

  if (templates.isPending || org.isPending) return <SectionSkeleton rows={8} />;
  if (templates.isError || org.isError || !templates.data || !org.data) {
    return <SectionError error={templates.error ?? org.error} onRetry={() => { void templates.refetch(); void org.refetch(); }} />;
  }
  const current = id ? templates.data.templates.find(t => t.id === id) : null;
  if (id && !current) {
    return (
      <EmptyState icon={<Mail />} title="That template no longer exists" description="It may have been deleted." action={<Link to="/settings/templates" className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-[14px] shadow-xs hover:bg-accent">Back to email templates</Link>} />
    );
  }
  return current ? <TemplateEditor key={current.id} template={current} org={org.data} /> : <TemplateList templates={templates.data.templates} org={org.data} />;
}

function useToggle() {
  const qc = useQueryClient();
  return async (t: EmailTemplate, enabled: boolean) => {
    const prev = qc.getQueryData<{ templates: EmailTemplate[] }>(sk.templates);
    qc.setQueryData<{ templates: EmailTemplate[] }>(sk.templates, old => (old ? { templates: old.templates.map(x => (x.id === t.id ? { ...x, enabled } : x)) } : old));
    try {
      await saveEmailTemplate({ action: 'toggle', id: t.id, enabled });
      invalidate(qc, 'bootstrap');
      toast.success(`${t.name} ${enabled ? 'switched on' : 'switched off'}`);
    } catch (e) {
      qc.setQueryData(sk.templates, prev);
      toast.error(errorMessage(e, 'That change didn’t save. Try again.'));
    }
  };
}

function TemplateList({ templates, org }: { templates: EmailTemplate[]; org: OrgSettingsData }) {
  const [creating, setCreating] = useState(false);
  const toggle = useToggle();
  const automatic = templates.filter(t => t.trigger !== 'Manual');
  const manual = templates.filter(t => t.trigger === 'Manual');
  const groups = TEMPLATE_AUDIENCES.map(a => ({ audience: a, items: automatic.filter(t => t.audience === a) })).filter(g => g.items.length);

  return (
    <>
      <SectionHeader
        title="Email templates"
        description="These are sent automatically when things happen. Edit the wording, or switch one off to stop sending it."
        action={
          <button type="button" onClick={() => setCreating(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-[14px] shadow-xs hover:bg-accent">
            <Plus className="h-3.5 w-3.5" /> New template
          </button>
        }
      />
      {groups.map(g => (
        <Group key={g.audience} title={`To ${AUDIENCE_GROUP[g.audience].toLowerCase()}`}>
          {g.items.map(t => (
            <TemplateRow key={t.id} template={t} when={whenSent(t.trigger, org.settings)} onToggle={v => void toggle(t, v)} />
          ))}
        </Group>
      ))}
      <Group title="Your templates" description="Starting points for messages your team writes by hand.">
        {manual.length ? (
          manual.map(t => <TemplateRow key={t.id} template={t} when={`To ${AUDIENCE_GROUP[t.audience]?.toLowerCase() ?? 'anyone'}`} onToggle={v => void toggle(t, v)} manual />)
        ) : (
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <p className="min-w-0 flex-1 text-[14px] text-muted-foreground">No templates of your own yet — useful for the notices you send often, like a water shut-off or an inspection visit.</p>
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent">
              <Plus className="h-3.5 w-3.5" /> New template
            </button>
          </div>
        )}
      </Group>
      <NewTemplateDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function TemplateRow({ template: t, when, onToggle, manual }: { template: EmailTemplate; when: string; onToggle: (v: boolean) => void; manual?: boolean }) {
  return (
    <div className={cn('group flex items-center gap-3 px-4 hover:bg-accent/40', !t.enabled && 'bg-subtle/40')}>
      <Tip label={manual ? (t.enabled ? 'Shown when writing messages' : 'Hidden when writing messages') : t.enabled ? 'Sending' : 'Not sending'}>
        <span className="flex">
          <Switch checked={t.enabled} onCheckedChange={onToggle} aria-label={`${t.enabled ? 'Switch off' : 'Switch on'} ${t.name}`} className="scale-90" />
        </span>
      </Tip>
      <Link to={`/settings/templates?template=${t.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[14px] font-medium', !t.enabled && 'text-muted-foreground')}>{t.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{when}</span>
        </span>
        {isEdited(t) && <Pill tone="neutral">Edited</Pill>}
        {!t.enabled && !manual && <Pill tone="warning">Off</Pill>}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground" />
      </Link>
    </div>
  );
}

function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<TemplateAudience>('Tenant');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName('');
      setAudience('Tenant');
      setError(null);
    }
  }
  const submit = async () => {
    if (!name.trim()) return setError('Name the template.');
    setPending(true);
    try {
      const res = await saveEmailTemplate({ action: 'create', name: name.trim(), audience, subject: name.trim(), body: 'Hi {{recipient_first_name}},\n\n\n\n{{organization_name}}' });
      await qc.invalidateQueries({ queryKey: sk.templates });
      invalidate(qc, 'bootstrap');
      onOpenChange(false);
      navigate(`/settings/templates?template=${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e, 'The template wasn’t created. Try again.'));
    } finally {
      setPending(false);
    }
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New email template" description="A starting point your team can pick when writing a message." size="sm" onSubmit={submit} pending={pending} submitLabel="Create template">
      <div className="space-y-4">
        <Field label="Name" htmlFor="tpl-name" error={error}>
          <TextInput id="tpl-name" value={name} invalid={Boolean(error)} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Water shut-off notice" />
        </Field>
        <Field label="Usually sent to">
          <Segmented value={audience} onChange={v => setAudience(v as TemplateAudience)} options={TEMPLATE_AUDIENCES.map(a => ({ value: a, label: AUDIENCE_GROUP[a] }))} />
        </Field>
      </div>
    </FormDialog>
  );
}

type TemplateDraft = { name: string; subject: string; body: string; audience: string };

function TemplateEditor({ template: t, org }: { template: EmailTemplate; org: OrgSettingsData }) {
  const qc = useQueryClient();
  const app = useAppActions();
  const ws = useWorkspace();
  const navigate = useNavigate();
  const toggle = useToggle();
  const manual = t.trigger === 'Manual';
  const def = defaultFor(t);
  const saved = useMemo<TemplateDraft>(() => ({ name: t.name, subject: t.subject, body: t.body, audience: t.audience }), [t.name, t.subject, t.body, t.audience]);
  const form = useDraft<TemplateDraft>(`template:${t.id}`, saved);
  useUnsavedGuard({ key: `template:${t.id}`, label: t.name, dirty: form.dirty, draft: form.draft, changed: form.changed, discard: form.discard });
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');
  const d = form.draft ?? saved;

  const errors = {
    name: !d.name.trim() ? 'Name the template.' : d.name.length > 80 ? 'Keep the name under 80 characters.' : null,
    subject: !d.subject.trim() ? 'Add a subject line.' : d.subject.length > 200 ? 'Keep the subject under 200 characters.' : null,
    body: !d.body.trim() ? 'The email needs a body.' : d.body.length > 10_000 ? 'Keep the email under 10,000 characters.' : null,
  };
  const visible = (k: keyof typeof errors) => (showErrors || k in form.changed ? errors[k] : null);
  const errorCount = Object.values(errors).filter(Boolean).length;
  const unknown = useMemo(() => unknownTags([d.subject, d.body]), [d.subject, d.body]);
  const edited = Boolean(def && (def.subject.trim() !== d.subject.trim() || def.body.trim() !== d.body.trim()));

  const ctx = useMemo(() => {
    const s = org.settings;
    const base = sampleMergeContext();
    return {
      ...base,
      organization_name: s.organizationName,
      grace_period_days: String(s.gracePeriodDays),
      ...(s.phone ? { office_phone: s.phone } : {}),
      ...(s.supportEmail ? { support_email: s.supportEmail } : {}),
      ...(s.emergencyPhone || s.phone ? { emergency_phone: s.emergencyPhone || s.phone } : {}),
      ...(org.portalUrl ? { portal_link: org.portalUrl } : {}),
    };
  }, [org]);

  const insertTag = (tag: string) => {
    const text = `{{${tag}}}`;
    if (lastFocused.current === 'subject') form.set('subject', insertAtCaret(subjectRef.current, d.subject, text));
    else form.set('body', insertAtCaret(bodyRef.current, d.body, text));
  };

  const save = async () => {
    if (errorCount) {
      setShowErrors(true);
      return;
    }
    setPending(true);
    try {
      const c = form.changed;
      await saveEmailTemplate({
        action: 'update',
        id: t.id,
        ...(c.name !== undefined ? { name: d.name.trim() } : {}),
        ...(c.subject !== undefined ? { subject: d.subject.trim() } : {}),
        ...(c.body !== undefined ? { body: d.body } : {}),
        ...(manual && c.audience !== undefined ? { audience: d.audience as TemplateAudience } : {}),
      });
      qc.setQueryData<{ templates: EmailTemplate[] }>(sk.templates, old => (old ? { templates: old.templates.map(x => (x.id === t.id ? { ...x, name: d.name.trim(), subject: d.subject.trim(), body: d.body, audience: d.audience } : x)) } : old));
      form.commit();
      setShowErrors(false);
      invalidate(qc, 'bootstrap');
      toast.success('Template saved');
    } catch (e) {
      toast.error(errorMessage(e, 'The template wasn’t saved. Try again.'));
    } finally {
      setPending(false);
    }
  };

  const sendTest = async () => {
    if (errors.subject || errors.body) {
      setShowErrors(true);
      return;
    }
    setTesting(true);
    try {
      const res = await sendTemplateTest({ subject: d.subject, body: d.body });
      toast.success(`Test sent to ${res.to}`, { description: form.dirty ? 'It uses your unsaved changes.' : undefined });
    } catch (e) {
      toast.error(errorMessage(e, 'The test email didn’t send. Try again.'));
    } finally {
      setTesting(false);
    }
  };

  const reset = async () => {
    if (!def) return;
    const ok = await app.confirm({ title: `Reset “${t.name}” to the default wording?`, description: 'The subject and body are replaced with the default. Nothing changes until you save.', confirmLabel: 'Reset' });
    if (ok) form.setMany({ subject: def.subject, body: def.body });
  };

  const remove = async () => {
    const ok = await app.confirm({ title: `Delete “${t.name}”?`, description: 'Your team won’t be able to pick it when writing messages. Messages already sent aren’t affected.', confirmLabel: 'Delete template', destructive: true });
    if (!ok) return;
    try {
      await saveEmailTemplate({ action: 'delete', id: t.id });
      form.discard();
      qc.setQueryData<{ templates: EmailTemplate[] }>(sk.templates, old => (old ? { templates: old.templates.filter(x => x.id !== t.id) } : old));
      invalidate(qc, 'settings', 'bootstrap');
      navigate('/settings/templates', { replace: true });
      toast.success(`Deleted “${t.name}”`);
    } catch (e) {
      toast.error(errorMessage(e, 'The template wasn’t deleted. Try again.'));
    }
  };

  const renderedSubject = renderMerge(d.subject, ctx);
  const renderedBody = renderMerge(d.body, ctx);

  return (
    <>
      <Link to="/settings/templates" className="-ml-1.5 mb-3 inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Email templates
      </Link>
      <SectionHeader
        title={t.name}
        description={manual ? 'A template your team can pick when writing a message.' : `Sent automatically: ${whenSent(t.trigger, org.settings).replace(/^When/, 'when').replace(/^As/, 'as')}.`}
        action={
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 text-[14px] shadow-2xs">
            <Switch checked={t.enabled} onCheckedChange={v => void toggle(t, v)} className="scale-90" />
            {manual ? (t.enabled ? 'Available' : 'Hidden') : t.enabled ? 'Sending' : 'Not sending'}
          </label>
        }
      />
      {!t.enabled && !manual && (
        <div className="mb-6 overflow-hidden rounded-lg border">
          <Note tone="warning" icon={<AlertTriangle />}>This email is switched off, so it won’t be sent. Conversations still record the event.</Note>
        </div>
      )}

      <Group
        title="Message"
        action={
          <>
            {def && edited && (
              <button type="button" onClick={() => void reset()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground">
                <RotateCcw className="h-3.5 w-3.5" /> Reset to default
              </button>
            )}
            <MergeTagMenu onPick={insertTag} />
          </>
        }
      >
        <Row label="Name" htmlFor="tpl-edit-name" error={visible('name')} description={manual ? undefined : 'Only your team sees this.'}>
          <TextInput id="tpl-edit-name" value={d.name} invalid={Boolean(visible('name'))} onChange={e => form.set('name', e.target.value)} maxLength={80} />
        </Row>
        {manual && (
          <Row label="Usually sent to">
            <Segmented size="sm" value={d.audience} onChange={v => form.set('audience', v)} options={TEMPLATE_AUDIENCES.map(a => ({ value: a, label: AUDIENCE_GROUP[a] }))} className="flex-wrap" />
          </Row>
        )}
        <Row label="Subject" htmlFor="tpl-subject" error={visible('subject')} stacked>
          <TextInput ref={subjectRef} id="tpl-subject" value={d.subject} invalid={Boolean(visible('subject'))} onFocus={() => (lastFocused.current = 'subject')} onChange={e => form.set('subject', e.target.value)} />
        </Row>
        <Row label="Body" htmlFor="tpl-body" error={visible('body')} description="Plain text. Leave a blank line between paragraphs. Your email signature is added below." stacked>
          <TextArea ref={bodyRef} id="tpl-body" rows={14} value={d.body} invalid={Boolean(visible('body'))} onFocus={() => (lastFocused.current = 'body')} onChange={e => form.set('body', e.target.value)} className="min-h-[260px] leading-relaxed" />
        </Row>
        {unknown.length > 0 && (
          <Note tone="warning" icon={<AlertTriangle />}>
            There’s no value for {unknown.map(x => `{{${x}}}`).join(', ')}, so {unknown.length === 1 ? 'it' : 'they'} would send blank. Pick tags from Insert merge tag.
          </Note>
        )}
      </Group>

      <Group
        title="Preview"
        description="With sample details for the resident, lease and work order, and your real company details."
        action={
          <button type="button" onClick={() => void sendTest()} disabled={testing} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] shadow-2xs hover:bg-accent disabled:opacity-60">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 text-muted-foreground" />} Send test to me
          </button>
        }
        flush
      >
        <EmailPreview from={org.settings.organizationName} to={`Maya Chen <maya.chen@example.com>`} subject={renderedSubject} body={renderedBody} signature={org.settings.emailSignature} button={org.portalUrl ? 'Open the portal' : null} me={ws.me.email} />
      </Group>

      {manual && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => void remove()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-tone-danger hover:bg-tone-danger/10">
            <Trash2 className="h-3.5 w-3.5" /> Delete template
          </button>
        </div>
      )}

      <SaveBar dirty={form.dirty} pending={pending} errorCount={showErrors ? errorCount : 0} onSave={() => void save()} onDiscard={form.discard} />
    </>
  );
}

function EmailPreview({ from, to, subject, body, signature, button, me }: { from: string; to: string; subject: string; body: string; signature: string; button: string | null; me: string }) {
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const meta = (label: string, value: ReactNode) => (
    <div className="flex gap-3 text-sm">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
  return (
    <div className="bg-subtle/40 p-3 sm:p-5">
      <div className="mx-auto max-w-[600px] overflow-hidden rounded-lg border bg-background shadow-xs">
        <div className="space-y-1 border-b px-5 py-3">
          {meta('From', from)}
          {meta('To', to)}
          <div className="pt-1 text-[15px] font-semibold [overflow-wrap:anywhere]">{subject || <span className="font-normal text-muted-foreground">No subject</span>}</div>
        </div>
        <div className="space-y-3 px-5 py-5 text-[14.5px] leading-relaxed">
          {paragraphs.length ? paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">{p}</p>) : <p className="text-muted-foreground">Nothing written yet.</p>}
          {button && <span className="inline-flex h-9 items-center rounded-md bg-foreground px-3.5 text-[14px] font-medium text-background">{button}</span>}
          {signature.trim() && (
            <div className="border-t pt-3 text-[14px] text-muted-foreground">
              <p className="whitespace-pre-line">{signature.trim()}</p>
            </div>
          )}
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-[600px] text-center text-sm text-muted-foreground">A test goes to {me}, with “[Test]” in the subject.</p>
    </div>
  );
}
