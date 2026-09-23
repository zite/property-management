import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, Copy, Mail, PanelRight, Phone, UserRoundCheck, XCircle } from 'lucide-react';
import { memo, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { replyToInquiry, scheduleShowing } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@project/components/ui/context-menu';
import { INQUIRY_STATUSES } from '@project/shared/constants';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { firstName, shortDateTime, timeAgo } from '../../lib/format';
import { useWorkspace } from '../../lib/workspace';
import { DateTimeInput, Field, SwitchRow, TextArea } from '../form/fields';
import { FormDialog } from '../form/FormDialog';
import { BoardCard } from '../list/Board';
import { RowShell, Slot } from '../list/GroupedList';
import { FieldButton, MemberPicker } from '../pickers/pickers';
import { OptionPicker } from '../pickers/OptionPicker';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { PropertySwatch } from '../primitives/glyphs';
import { InquiryStatusGlyph } from './bits';
import { afterLeasingWrite, lk, useInquiryActions, type Inquiry } from './data';
import { LOST_REASONS } from './rules';

/** Rows, cards, menus, pickers and dialogs for leads, shared by the list and the lead sheet. */

export type LeadPickerKind = 'status' | 'assignee';
export type LeadDialog = { kind: 'showing' | 'lost'; lead: Inquiry } | null;

export function LeadPicker({ kind, targets, trigger, open, onOpenChange, align = 'start', onDialog }: {
  kind: LeadPickerKind;
  targets: Inquiry[];
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'center' | 'end';
  onDialog: (d: LeadDialog) => void;
}) {
  const ws = useWorkspace();
  const { update } = useInquiryActions();
  const first = targets[0];
  const same = <K extends keyof Inquiry>(key: K) => (targets.every(t => t[key] === first?.[key]) ? first?.[key] : undefined);
  const options = useMemo(() => INQUIRY_STATUSES.map((s, i) => ({ value: s, label: s === 'Applied' ? 'Applied (converted)' : s === 'Closed' ? 'Closed (lost)…' : s === 'Showing scheduled' && targets.length === 1 ? 'Showing scheduled…' : s, icon: <InquiryStatusGlyph status={s} />, shortcut: String(i + 1) })), [targets.length]);
  if (kind === 'assignee') {
    return <MemberPicker trigger={trigger} open={open} onOpenChange={onOpenChange} align={align} value={(same('assigneeId') as string | null) ?? null} onChange={id => void update(targets, { assigneeId: id }, { toast: targets.length === 1 ? (id ? `Assigned to ${id === ws.me.id ? 'you' : ws.memberName(id)}` : 'Unassigned') : undefined }).catch(() => undefined)} filter={m => ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)} />;
  }
  return (
    <OptionPicker
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      align={align}
      width={240}
      options={options}
      value={(same('status') as string) ?? null}
      placeholder={targets.length > 1 ? `Status for ${targets.length}…` : 'Change status…'}
      onChange={v => {
        if (!v) return;
        if (targets.length === 1 && v === 'Showing scheduled') return onDialog({ kind: 'showing', lead: first });
        if (targets.length === 1 && v === 'Closed') return onDialog({ kind: 'lost', lead: first });
        const moving = targets.filter(t => t.status !== v);
        if (moving.length) void update(moving, { status: v as Inquiry['status'] as never }, { toast: moving.length === 1 ? `${moving[0].name} → ${v}` : undefined }).catch(() => undefined);
      }}
    />
  );
}

export function ShowingChip({ at, className }: { at: string | null; className?: string }) {
  if (!at) return null;
  const upcoming = at >= new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const soon = upcoming && at <= new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  return (
    <Tip label={`${upcoming ? 'Showing' : 'Showed'} ${shortDateTime(at)}`}>
      <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap px-1 text-sm', soon ? 'font-medium text-tone-info' : upcoming ? 'text-foreground/80' : 'text-muted-foreground', className)}>
        <CalendarClock className="h-3 w-3" /> {shortDateTime(at).replace(/^\w+, /, '')}
      </span>
    </Tip>
  );
}

/** "Contacted 2d ago", or a warning when a new lead has waited more than a day. */
export function ContactedLabel({ lead, className }: { lead: Inquiry; className?: string }) {
  if (lead.lastContactedAt) return <span className={cn('whitespace-nowrap text-sm text-muted-foreground', className)}>Contacted {timeAgo(lead.lastContactedAt)}</span>;
  if (lead.status === 'Applied' || lead.status === 'Closed') return null;
  const stale = Date.now() - Date.parse(lead.receivedAt) > 24 * 60 * 60 * 1000;
  return <span className={cn('whitespace-nowrap text-sm', stale ? 'text-tone-warning' : 'text-muted-foreground', className)}>{stale ? 'No reply yet' : 'Not contacted'}</span>;
}

type RowProps = {
  lead: Inquiry;
  properties: Set<string>;
  selected: boolean;
  focused: boolean;
  selecting: boolean;
  picker: LeadPickerKind | null;
  onPicker: (id: string, kind: LeadPickerKind | null) => void;
  onClick: (q: Inquiry, e: MouseEvent) => void;
  onHover: (q: Inquiry) => void;
  onToggleSelect: (q: Inquiry, e: MouseEvent) => void;
  targetsFor: (q: Inquiry) => Inquiry[];
  onDialog: (d: LeadDialog) => void;
  onOpen: (q: Inquiry) => void;
};

function LeadRowInner({ lead: q, properties, selected, focused, selecting, picker, onPicker, onClick, onHover, onToggleSelect, targetsFor, onDialog, onOpen }: RowProps) {
  const ws = useWorkspace();
  const has = (k: string) => properties.has(k);
  const property = q.propertyId ? ws.propertyById.get(q.propertyId) : undefined;
  const assignee = q.assigneeId ? ws.memberById.get(q.assigneeId) : undefined;
  const slot = (kind: LeadPickerKind, label: string, children: ReactNode) => (
    <Slot label={label} active={picker === kind} onActivate={() => onPicker(q.id, kind)} picker={trigger => <LeadPicker kind={kind} targets={targetsFor(q)} open onOpenChange={o => !o && onPicker(q.id, null)} trigger={trigger} onDialog={onDialog} />}>
      {children}
    </Slot>
  );
  return (
    <RowShell id={q.id} selected={selected} focused={focused} selecting={selecting} onClick={e => onClick(q, e)} onHover={() => onHover(q)} onToggleSelect={e => onToggleSelect(q, e)} menu={<LeadMenu targets={targetsFor(q)} onDialog={onDialog} onOpen={onOpen} />} muted={q.status === 'Closed'}>
      {slot('status', `Status: ${q.status}`, <span className="flex h-6 w-6 items-center justify-center"><InquiryStatusGlyph status={q.status} /></span>)}
      <span className="min-w-0 max-w-[40%] shrink-0 truncate font-medium sm:max-w-[220px]">{q.name}</span>
      {has('source') && <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{q.source}</span>}
      {has('message') ? <span className="hidden min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground md:inline">{q.message.replace(/\s+/g, ' ')}</span> : <span className="flex-1" />}
      <span className="min-w-2 flex-1 md:hidden" />
      <span className="hidden shrink-0 items-center gap-3 md:flex">
        {has('interest') && property && (
          <Tip label={q.listingTitle ?? ws.unitLabel(q.unitId, q.propertyId)}>
            <span className="chip max-w-[180px]"><PropertySwatch color={property.color} /><span className="truncate">{ws.unitLabel(q.unitId, q.propertyId)}</span></span>
          </Tip>
        )}
        {has('showing') && q.showingAt && <ShowingChip at={q.showingAt} />}
        {has('lastContact') && <ContactedLabel lead={q} className="hidden w-[108px] text-right lg:inline" />}
        {has('received') && <Tip label={`Received ${shortDateTime(q.receivedAt)}`}><span className="w-14 text-right text-sm tabular-nums text-muted-foreground">{timeAgo(q.receivedAt)}</span></Tip>}
      </span>
      {has('assignee') && slot('assignee', assignee ? `Assigned to ${assignee.name}` : 'Unassigned', <span className="flex h-6 w-6 items-center justify-center">{assignee ? <MemberAvatar member={assignee} size={20} /> : <UnassignedAvatar size={20} />}</span>)}
    </RowShell>
  );
}

export const LeadRow = memo(LeadRowInner);

export function LeadCard({ lead: q, selected, focused, overlay }: { lead: Inquiry; selected: boolean; focused: boolean; overlay: boolean }) {
  const ws = useWorkspace();
  const property = q.propertyId ? ws.propertyById.get(q.propertyId) : undefined;
  const assignee = q.assigneeId ? ws.memberById.get(q.assigneeId) : undefined;
  return (
    <BoardCard selected={selected} focused={focused} overlay={overlay}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>{q.source}</span>
        {property && (
          <>
            <span aria-hidden>·</span>
            <PropertySwatch color={property.color} size={7} />
            <span className="min-w-0 truncate">{ws.unitLabel(q.unitId, q.propertyId)}</span>
          </>
        )}
        <span className="ml-auto shrink-0">{assignee ? <MemberAvatar member={assignee} size={18} /> : <UnassignedAvatar size={18} />}</span>
      </div>
      <p className="mt-1.5 truncate text-[14px] font-medium">{q.name}</p>
      {q.message && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{q.message}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {q.showingAt && <ShowingChip at={q.showingAt} className="px-0 text-[12.5px]" />}
        <ContactedLabel lead={q} className="text-[12.5px]" />
        <span className="ml-auto text-[12.5px] tabular-nums text-muted-foreground">{timeAgo(q.receivedAt)}</span>
      </div>
    </BoardCard>
  );
}

const item = 'h-9 gap-2 text-[14px]';

export function LeadMenu({ targets, onDialog, onOpen }: { targets: Inquiry[]; onDialog: (d: LeadDialog) => void; onOpen: (q: Inquiry) => void }) {
  const ws = useWorkspace();
  const { update } = useInquiryActions();
  if (!targets.length) return null;
  const single = targets.length === 1 ? targets[0] : null;
  return (
    <div onClick={e => e.stopPropagation()}>
      {!single && <div className="px-2 pb-1 pt-1.5 text-2xs font-medium text-muted-foreground">{targets.length} leads selected</div>}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => onOpen(single)}><PanelRight className="h-3.5 w-3.5" /> Open <ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className={item}><InquiryStatusGlyph status={single?.status ?? 'Contacted'} /> Status</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-[200px]">
          {INQUIRY_STATUSES.filter(s => (single ? true : s !== 'Showing scheduled')).map(s => (
            <ContextMenuItem key={s} className={item} onSelect={() => (single && s === 'Showing scheduled' ? onDialog({ kind: 'showing', lead: single }) : single && s === 'Closed' ? onDialog({ kind: 'lost', lead: single }) : void update(targets.filter(t => t.status !== s), { status: s }).catch(() => undefined))}>
              <InquiryStatusGlyph status={s} /> {s}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {!targets.every(t => t.assigneeId === ws.me.id) && (
        <ContextMenuItem className={item} onSelect={() => void update(targets, { assigneeId: ws.me.id }, { toast: single ? `${single.name} assigned to you` : undefined }).catch(() => undefined)}>
          <UserRoundCheck className="h-3.5 w-3.5" /> Assign to me <ContextMenuShortcut>I</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {single && (
        <>
          <ContextMenuItem className={item} onSelect={() => onDialog({ kind: 'showing', lead: single })}><CalendarClock className="h-3.5 w-3.5" /> {single.showingAt ? 'Reschedule showing…' : 'Schedule showing…'}</ContextMenuItem>
          {single.status !== 'Closed' && <ContextMenuItem className={item} onSelect={() => onDialog({ kind: 'lost', lead: single })}><XCircle className="h-3.5 w-3.5" /> Mark lost…</ContextMenuItem>}
          <ContextMenuSeparator />
          {single.email && <ContextMenuItem className={item} onSelect={() => void copyText(single.email, 'Email copied')}><Copy className="h-3.5 w-3.5" /> Copy email</ContextMenuItem>}
          {single.phone && <ContextMenuItem className={item} onSelect={() => void copyText(single.phone, 'Phone number copied')}><Phone className="h-3.5 w-3.5" /> Copy phone</ContextMenuItem>}
        </>
      )}
    </div>
  );
}

/** Book, move or cancel a showing. Creates a task for whoever shows the home and (optionally) emails the lead. */
export function ShowingDialog({ lead, open, onOpenChange }: { lead: Inquiry | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const [at, setAt] = useState<string | null>(null);
  const [assigneeId, setAssignee] = useState<string | null>(null);
  const [notifyLead, setNotify] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    setAt(lead.showingAt && lead.showingAt > new Date().toISOString() ? lead.showingAt : d.toISOString());
    setAssignee(lead.assigneeId ?? (ws.can('leasing.manage') ? ws.me.id : null));
    setNotify(Boolean(lead.email));
    setMessage('');
    setError(null);
  }, [open, lead?.id]);

  if (!lead) return null;
  const first = firstName(lead.name) || lead.name;
  const run = async (showingAt: string | null) => {
    setPending(true);
    try {
      const res = await scheduleShowing({ inquiryId: lead.id, showingAt, assigneeId, notifyLead: notifyLead && Boolean(lead.email), message: message.trim() || undefined });
      afterLeasingWrite(qc);
      void qc.invalidateQueries({ queryKey: lk.inquiryDetail(lead.id) });
      if (!showingAt) toast.success('Showing canceled');
      else toast.success(`Showing booked for ${shortDateTime(showingAt)}`, { description: res.delivery === 'Sent' ? `${first} was emailed the details. A task is on ${assigneeId === ws.me.id ? 'your' : `${ws.memberName(assigneeId)}’s`} list.` : res.delivery === 'Failed' ? `The email to ${first} couldn’t be delivered.` : 'A task was added for the showing.' });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e, 'The showing wasn’t saved. Try again.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={lead.showingAt ? `Reschedule ${first}’s showing` : `Schedule a showing with ${first}`}
      description={lead.listingTitle ?? (lead.propertyId ? ws.unitLabel(lead.unitId, lead.propertyId) : undefined)}
      submitLabel={lead.showingAt ? 'Reschedule' : 'Book showing'}
      pending={pending}
      onSubmit={() => {
        if (!at) return setError('Choose a date and time.');
        return run(at);
      }}
      footerStart={
        error ? <span className="text-tone-danger">{error}</span> : lead.showingAt ? (
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-2 hover:text-tone-danger hover:underline"
            onClick={async () => {
              if (await app.confirm({ title: 'Cancel this showing?', description: `The showing task is canceled and ${first} goes back to Contacted. ${first} isn’t emailed — let them know yourself.`, confirmLabel: 'Cancel showing', destructive: true })) void run(null);
            }}
          >
            Cancel showing
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <Field label="When" htmlFor="showing-at" hint={lead.message ? `They wrote: “${lead.message.slice(0, 140)}${lead.message.length > 140 ? '…' : ''}”` : undefined}>
          <DateTimeInput id="showing-at" value={at} onChange={setAt} />
        </Field>
        <Field label="Shown by">
          <MemberPicker
            value={assigneeId}
            onChange={setAssignee}
            allowNone={false}
            filter={m => ['Admin', 'Property Manager', 'Leasing Agent'].includes(m.role)}
            trigger={<FieldButton icon={assigneeId ? <MemberAvatar member={ws.memberById.get(assigneeId)} size={16} /> : <UnassignedAvatar size={16} />} placeholder="Who’s showing the home?">{assigneeId ? ws.memberName(assigneeId) : null}</FieldButton>}
          />
        </Field>
        <SwitchRow label={`Email ${first} the time and address`} description={lead.email ? `Sent to ${lead.email}.` : 'This lead has no email address — call them instead.'} checked={notifyLead && Boolean(lead.email)} onChange={setNotify} disabled={!lead.email} />
        {notifyLead && lead.email && (
          <Field label="Add a note to the email" optional>
            <TextArea rows={2} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Park on the street and ring unit 1 — I’ll meet you at the front door." maxLength={3000} />
          </Field>
        )}
      </div>
    </FormDialog>
  );
}

/** Close a lead with a reason, so the team can see where leads drop off. */
export function LostDialog({ lead, open, onOpenChange }: { lead: Inquiry | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { update } = useInquiryActions();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
    }
  }, [open]);
  if (!lead) return null;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${lead.name} as lost`}
      description="The lead is closed and leaves your open list. You can reopen it any time."
      submitLabel="Mark lost"
      pending={pending}
      disabled={!reason}
      onSubmit={async () => {
        if (!reason) return;
        setPending(true);
        try {
          await update([lead], { status: 'Closed' }, { lostReason: reason, toast: `${lead.name} marked lost` });
          if (note.trim()) await replyToInquiry({ mode: 'note', inquiryId: lead.id, body: `Lost — ${reason}: ${note.trim()}` });
          void qc.invalidateQueries({ queryKey: lk.inquiryDetail(lead.id) });
          onOpenChange(false);
        } catch {
          /* update() already explained the failure */
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Reason" className="grid gap-1 sm:grid-cols-2">
          {LOST_REASONS.map(r => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={cn('flex h-9 items-center gap-2 rounded-md border px-2.5 text-left text-[14px] transition-colors', reason === r ? 'border-primary/50 bg-primary/[0.06]' : 'hover:bg-accent')}>
              <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', reason === r ? 'border-primary' : 'border-input')}>{reason === r && <Check className="h-2.5 w-2.5 text-primary" strokeWidth={3} />}</span>
              {r}
            </button>
          ))}
        </div>
        <Field label="Note" optional>
          <TextArea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth remembering if they come back." maxLength={2000} />
        </Field>
      </div>
    </FormDialog>
  );
}

/** Send the listing's application link, with a confirm that says exactly what goes out. */
export function useSendApplicationLink() {
  const app = useAppActions();
  const qc = useQueryClient();
  return async (lead: Pick<Inquiry, 'id' | 'name' | 'email' | 'listingTitle'>) => {
    const first = firstName(lead.name) || lead.name;
    if (!(await app.confirm({ title: `Send ${first} the application link?`, description: `Emails ${lead.email} a link to apply for ${lead.listingTitle ?? 'the listing'} online. It’s saved on the lead’s conversation.`, confirmLabel: 'Send link' }))) return;
    try {
      const res = await replyToInquiry({ mode: 'application_link', inquiryId: lead.id });
      afterLeasingWrite(qc);
      void qc.invalidateQueries({ queryKey: lk.inquiryDetail(lead.id) });
      if (res.delivery === 'Failed') toast.error(`The email to ${lead.email} couldn’t be delivered`, { description: 'It’s saved on the lead as not delivered.' });
      else toast.success(`Application link sent to ${first}`);
    } catch (e) {
      toast.error(errorMessage(e, 'The link wasn’t sent'));
    }
  };
}

export function ContactLinks({ lead }: { lead: Pick<Inquiry, 'email' | 'phone'> }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
      {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{lead.email}</span></a>}
      {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Phone className="h-3.5 w-3.5" />{lead.phone}</a>}
    </span>
  );
}

