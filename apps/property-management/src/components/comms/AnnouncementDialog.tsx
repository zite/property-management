import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, ChevronDown, DoorOpen, Eye, FlaskConical, Mail, MessageSquare, Pin, Save, Send, TriangleAlert, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { previewAnnouncement, saveAnnouncement, sendAnnouncement } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { plural, shortDateTime } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, DateTimeInput, Field, FieldRow, Segmented, TextArea, TextInput } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { FieldButton } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { OccupancyGlyph, PropertySwatch } from '../primitives/glyphs';
import type { CreateDialogProps } from '../shell/CreateDialogs';
import { AUDIENCE_OPTIONS, mk, runAnnouncementSend, useAnnouncement, type AudienceKey } from './data';
import { FieldChips, hasTags, insertAt, KindIcon, MergeFieldPicker, toolButton } from './MessageTools';

/**
 * Write, schedule and send an announcement. Everyone in the audience gets
 * their own copy in their conversation (merge tags filled for them), by email
 * and in the portal or portal only. The count of who it reaches updates as
 * the audience changes; a test goes to you first.
 *
 * defaults: `id` (edit a draft or scheduled announcement), `audience`
 * (residents | residents_properties | residents_units | owners |
 * owners_properties | vendors), `propertyId`, `unitId`, `title`, `body`.
 */

type When = 'now' | 'schedule';

const AUDIENCE_KEYS = new Set<string>(AUDIENCE_OPTIONS.map(a => a.value));

export default function AnnouncementDialog({ open, onOpenChange, defaults }: CreateDialogProps) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const navigate = useNavigate();
  const editId = typeof defaults?.id === 'string' ? defaults.id : null;
  const existing = useAnnouncement(open ? editId : null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AudienceKey>('residents');
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [channel, setChannel] = useState<'Email and portal' | 'Portal only'>('Email and portal');
  const [pinnedUntil, setPinnedUntil] = useState<string | null>(null);
  const [when, setWhen] = useState<When>('now');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState<null | 'send' | 'draft' | 'test'>(null);
  const [showPreview, setShowPreview] = useState(false);
  const loaded = useRef<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      loaded.current = null;
      return;
    }
    if (editId) return;
    const aud = typeof defaults?.audience === 'string' && AUDIENCE_KEYS.has(defaults.audience) ? (defaults.audience as AudienceKey) : null;
    const propertyId = typeof defaults?.propertyId === 'string' ? defaults.propertyId : null;
    const unitId = typeof defaults?.unitId === 'string' ? defaults.unitId : null;
    setTitle(typeof defaults?.title === 'string' ? defaults.title : '');
    setBody(typeof defaults?.body === 'string' ? defaults.body : '');
    setAudience(aud ?? (unitId ? 'residents_units' : propertyId ? 'residents_properties' : 'residents'));
    setPropertyIds(propertyId ? [propertyId] : []);
    setUnitIds(unitId ? [unitId] : []);
    setChannel('Email and portal');
    setPinnedUntil(null);
    setWhen('now');
    setScheduledFor(null);
    setErrors({});
    setShowPreview(false);
  }, [open]);

  // Editing: fill from the saved announcement once it loads.
  useEffect(() => {
    const a = existing.data?.announcement;
    if (!open || !editId || !a || loaded.current === editId) return;
    loaded.current = editId;
    setTitle(a.title);
    setBody(a.body);
    setAudience(a.audience);
    setPropertyIds(a.propertyIds);
    setUnitIds(a.unitIds);
    setChannel(a.channel);
    setPinnedUntil(a.pinnedUntil);
    setWhen(a.state === 'Scheduled' ? 'schedule' : 'now');
    setScheduledFor(a.state === 'Scheduled' ? a.sentAt : null);
    setErrors({});
  }, [open, editId, existing.data]);

  const [debounced, setDebounced] = useState({ title: '', body: '' });
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced({ title, body }), 450);
    return () => window.clearTimeout(t);
  }, [title, body]);

  const scoped = audience === 'residents_properties' || audience === 'owners_properties' ? propertyIds.length > 0 : audience === 'residents_units' ? unitIds.length > 0 : true;
  const reach = useQuery({
    queryKey: [...mk.announcementList, 'reach', audience, propertyIds, unitIds, showPreview || hasTags(`${debounced.title}${debounced.body}`) ? debounced : null],
    queryFn: () => previewAnnouncement({ audience, propertyIds: audience.endsWith('properties') ? propertyIds : [], unitIds: audience === 'residents_units' ? unitIds : [], title: debounced.title, body: debounced.body }),
    enabled: open && scoped,
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });

  const kind = AUDIENCE_OPTIONS.find(a => a.value === audience)?.kind ?? 'tenant';
  const noun = kind === 'tenant' ? ['resident', 'residents'] : kind === 'owner' ? ['owner', 'owners'] : ['vendor', 'vendors'];
  const total = scoped ? reach.data?.total ?? null : 0;

  const propertyOptions = useMemo(() => ws.orderedProperties.filter(p => p.status !== 'Archived').map(p => ({ value: p.id, label: p.name, icon: <PropertySwatch color={p.color} />, hint: `${p.occupied} occupied`, keywords: [p.code] })), [ws]);
  const unitOptions = useMemo(
    () => ws.orderedProperties.filter(p => p.status !== 'Archived').flatMap(p => (ws.unitsByProperty.get(p.id) ?? []).filter(u => !u.archived).map(u => ({ value: u.id, label: ws.unitLabel(u.id), group: p.name, icon: <OccupancyGlyph occupancy={u.occupancy} />, hint: <span className="max-w-[120px] truncate">{u.residentNames.split(',')[0] || u.occupancy}</span>, keywords: [p.name, u.residentNames] }))),
    [ws],
  );

  const validate = (forSend: boolean) => {
    const next: Record<string, string | undefined> = {};
    if (!title.trim()) next.title = 'Give the announcement a title.';
    if (!body.trim()) next.body = 'Write the announcement first.';
    if (audience.endsWith('properties') && !propertyIds.length) next.audience = 'Choose at least one property.';
    if (audience === 'residents_units' && !unitIds.length) next.audience = 'Choose at least one unit.';
    if (when === 'schedule' && forSend) {
      if (!scheduledFor) next.when = 'Pick when to send it.';
      else if (Date.parse(scheduledFor) < Date.now() + 60_000) next.when = 'Pick a time at least a minute from now.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const content = () => ({
    title: title.trim(),
    body: body.trim(),
    audience,
    propertyIds: audience.endsWith('properties') ? propertyIds : [],
    unitIds: audience === 'residents_units' ? unitIds : [],
    channel,
    pinnedUntil: kind === 'tenant' ? pinnedUntil : null,
  });

  const save = async (scheduled: string | null) => {
    const input = { ...content(), scheduledFor: scheduled };
    const res = editId ? await saveAnnouncement({ action: 'update', id: editId, ...input }) : await saveAnnouncement({ action: 'create', ...input });
    invalidate(qc, 'announcements');
    return res.id;
  };

  const openDetail = (id: string) => navigate(`/announcements?id=${id}`);

  const submit = async () => {
    if (!validate(true) || pending) return;
    if (when === 'now') {
      if (!total) {
        setErrors(e => ({ ...e, audience: `No ${noun[1]} are in this audience yet.` }));
        return;
      }
      const ok = await app.confirm({
        title: `Send to ${plural(total, noun[0], noun[1])} now?`,
        description: channel === 'Email and portal' ? 'Each of them gets an email and a copy in their portal conversation. Sent announcements can’t be edited or unsent.' : 'Each of them gets a copy in their portal conversation. Sent announcements can’t be edited or unsent.',
        confirmLabel: `Send to ${total}`,
      });
      if (!ok) return;
    }
    setPending('send');
    try {
      const id = await save(when === 'schedule' ? scheduledFor : null);
      onOpenChange(false);
      if (when === 'schedule') {
        toast.success(`Scheduled for ${shortDateTime(scheduledFor)}`, { description: title.trim(), action: { label: 'View', onClick: () => openDetail(id) } });
      } else {
        void runAnnouncementSend(qc, id, title.trim(), 'send', () => openDetail(id));
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t save the announcement'));
    } finally {
      setPending(null);
    }
  };

  const saveDraft = async () => {
    if (!validate(false) || pending) return;
    setPending('draft');
    try {
      const id = await save(null);
      onOpenChange(false);
      toast.success(editId ? 'Draft updated' : 'Draft saved', { description: title.trim(), action: { label: 'View', onClick: () => openDetail(id) } });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t save the draft'));
    } finally {
      setPending(null);
    }
  };

  const sendTest = async () => {
    if (!title.trim() || !body.trim()) {
      setErrors({ title: title.trim() ? undefined : 'Give the announcement a title.', body: body.trim() ? undefined : 'Write the announcement first.' });
      return;
    }
    setPending('test');
    try {
      const res = await sendAnnouncement({ mode: 'test', ...content() });
      toast.success(`Test sent to ${res.testTo}`, { description: reach.data?.preview ? `Filled in as ${reach.data.preview.name} would see it` : undefined });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t send the test'));
    } finally {
      setPending(null);
    }
  };

  const audienceLabel = AUDIENCE_OPTIONS.find(a => a.value === audience)?.label ?? '';
  const scheduledLabel = when === 'schedule' && scheduledFor ? `Schedule for ${shortDateTime(scheduledFor)}` : 'Schedule';
  const submitLabel = when === 'schedule' ? scheduledLabel : total ? `Send to ${plural(total, noun[0], noun[1])}` : 'Send';
  const loadingEdit = Boolean(editId) && existing.isPending;
  const sentAlready = existing.data?.announcement.status === 'Sent';

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editId ? 'Edit announcement' : 'New announcement'}
      description={sentAlready ? 'This announcement was already sent, so it can’t be changed.' : undefined}
      size="lg"
      onSubmit={submit}
      pending={pending === 'send'}
      disabled={Boolean(pending) || loadingEdit || sentAlready}
      submitLabel={submitLabel}
      footerStart={
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void saveDraft()} disabled={Boolean(pending) || sentAlready} className={cn(toolButton, 'h-9 whitespace-nowrap px-2.5 text-[14px]')}>
            <Save /> {pending === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={() => void sendTest()} disabled={Boolean(pending)} aria-label="Send a test to me" className={cn(toolButton, 'h-9 whitespace-nowrap px-2.5 text-[14px]')}>
            <FlaskConical /> <span className="hidden sm:inline">{pending === 'test' ? 'Sending test…' : 'Send test to me'}</span>
          </button>
        </div>
      }
    >
      {loadingEdit ? (
        <div className="space-y-3">
          <div className="skeleton h-9 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Title" error={errors.title} hint="Also the email subject.">
            <TextInput value={title} onChange={e => { setTitle(e.target.value); setErrors(x => ({ ...x, title: undefined })); }} placeholder="Water shut-off Thursday, 9am–1pm" maxLength={200} invalid={Boolean(errors.title)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); bodyRef.current?.focus(); } }} />
          </Field>

          <Field
            label="Message"
            error={errors.body}
            action={<MergeFieldPicker announcement onPick={token => insertAt(bodyRef.current, body, token, setBody)} trigger={<button type="button" className={toolButton}><span className="font-mono text-[12px]">{'{ }'}</span> Insert field</button>} />}
          >
            <TextArea ref={bodyRef} value={body} onChange={e => { setBody(e.target.value); setErrors(x => ({ ...x, body: undefined })); }} rows={7} placeholder={'Hi {{recipient_first_name}},\n\nFront Range Plumbing will be replacing a main valve…'} invalid={Boolean(errors.body)} />
          </Field>
          <FieldChips text={`${title}\n${body}`} missing={reach.data?.preview?.missingTags ?? []} className="-mt-2" />

          <FieldRow>
            <Field label="Audience" error={errors.audience}>
              <OptionPicker
                options={AUDIENCE_OPTIONS.map((a, i) => ({ value: a.value, label: a.label, icon: a.value.endsWith('units') ? <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" /> : a.value.endsWith('properties') ? <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> : <KindIcon kind={a.kind} className="text-muted-foreground" />, group: a.kind === 'tenant' ? 'Residents' : a.kind === 'owner' ? 'Owners' : 'Vendors', shortcut: String(i + 1) }))}
                value={audience}
                onChange={v => { setAudience(v as AudienceKey); setErrors(x => ({ ...x, audience: undefined })); }}
                placeholder="Who gets it…"
                width={280}
                trigger={<FieldButton icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}>{audienceLabel}</FieldButton>}
              />
            </Field>
            <Field label="Delivery">
              <Segmented value={channel} onChange={v => setChannel(v as typeof channel)} className="w-full" options={[{ value: 'Email and portal', label: <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email + portal</span> }, { value: 'Portal only', label: <span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Portal only</span> }]} />
            </Field>
          </FieldRow>

          {audience.endsWith('properties') && (
            <Field label="Properties">
              <OptionPicker multiple options={propertyOptions} value={propertyIds} onChange={v => { setPropertyIds(v as string[]); setErrors(x => ({ ...x, audience: undefined })); }} placeholder="Find a property…" width={300}
                trigger={<FieldButton icon={<Building2 className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Choose properties…" invalid={Boolean(errors.audience)}>{propertyIds.length ? propertyIds.map(id => ws.propertyName(id)).join(', ') : null}</FieldButton>} />
            </Field>
          )}
          {audience === 'residents_units' && (
            <Field label="Units" hint="Residents of these units get it in their conversation; it isn’t posted to the building’s news.">
              <OptionPicker multiple options={unitOptions} value={unitIds} onChange={v => { setUnitIds(v as string[]); setErrors(x => ({ ...x, audience: undefined })); }} placeholder="Find a unit…" width={340}
                trigger={<FieldButton icon={<DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />} placeholder="Choose units…" invalid={Boolean(errors.audience)}>{unitIds.length ? (unitIds.length > 3 ? `${unitIds.length} units` : unitIds.map(id => ws.unitLabel(id)).join(', ')) : null}</FieldButton>} />
            </Field>
          )}

          <FieldRow>
            <Field label="When" error={errors.when}>
              <Segmented value={when} onChange={v => { setWhen(v as When); setErrors(x => ({ ...x, when: undefined })); }} className="w-full" options={[{ value: 'now', label: <span className="inline-flex items-center gap-1.5"><Send className="h-3.5 w-3.5" /> Send now</span> }, { value: 'schedule', label: <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Schedule</span> }]} />
              {when === 'schedule' && <DateTimeInput value={scheduledFor} onChange={v => { setScheduledFor(v); setErrors(x => ({ ...x, when: undefined })); }} invalid={Boolean(errors.when)} className="mt-2" />}
            </Field>
            {kind === 'tenant' && audience !== 'residents_units' && (
              <Field label="Pin in the resident portal" optional hint="Keeps it at the top of their home screen until this day.">
                <div className="flex items-center gap-2">
                  <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <DateInput value={pinnedUntil} onChange={setPinnedUntil} min={ws.today} />
                </div>
              </Field>
            )}
          </FieldRow>

          <div className="rounded-lg border bg-subtle/60">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-[14px]">
                {!scoped ? (
                  <span className="text-muted-foreground">Choose {audience === 'residents_units' ? 'units' : 'properties'} to see who it reaches</span>
                ) : reach.isPending ? (
                  <span className="text-muted-foreground">Counting…</span>
                ) : reach.isError ? (
                  <span className="text-tone-danger">{errorMessage(reach.error, 'Couldn’t count the audience')}</span>
                ) : (
                  <>
                    Reaches <span className="font-semibold tabular-nums">{plural(total ?? 0, noun[0], noun[1])}</span>
                    {channel === 'Email and portal' && reach.data && reach.data.withoutEmail > 0 && <span className="text-tone-warning"> · {reach.data.withoutEmail} without email get it in the portal only</span>}
                  </>
                )}
              </span>
              {reach.data?.preview && (
                <button type="button" onClick={() => setShowPreview(s => !s)} className={cn(toolButton, 'ml-auto')} aria-expanded={showPreview}>
                  <Eye /> Preview <ChevronDown className={cn('transition-transform', showPreview && 'rotate-180')} />
                </button>
              )}
            </div>
            {scoped && reach.data && reach.data.sample.length > 0 && !showPreview && (
              <p className="truncate border-t px-3 py-2 text-sm text-muted-foreground">
                {reach.data.sample.slice(0, 6).map(s => s.name).join(', ')}{reach.data.total > 6 ? ` and ${reach.data.total - 6} more` : ''}
              </p>
            )}
            {showPreview && reach.data?.preview && (
              <div className="border-t px-3 py-2.5">
                <p className="mb-1.5 text-sm text-muted-foreground">As {reach.data.preview.name} will see it</p>
                <p className="text-[14px] font-medium">{reach.data.preview.subject || <span className="text-muted-foreground">No title yet</span>}</p>
                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground/90">{reach.data.preview.body || <span className="text-muted-foreground">No message yet</span>}</p>
                {reach.data.preview.missingTags.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-sm text-tone-warning"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" /> No value for {reach.data.preview.missingTags.join(', ')} — {reach.data.preview.missingTags.length === 1 ? 'it' : 'they'}’ll be left blank.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </FormDialog>
  );
}
