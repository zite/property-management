import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, CheckCircle2, ChevronDown, FileText, Link2, Lock, Mail, MoreHorizontal, RotateCcw, Send, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { replyToInquiry } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { applicationRef } from '@project/shared/leases';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, firstName, shortDate, shortDateTime, timeAgo } from '../../lib/format';
import { useHotkeys } from '../../lib/hotkeys';
import { useWorkspace } from '../../lib/workspace';
import { Composer, Timeline, type ComposerMode, type TimelineMessage } from '../detail/Timeline';
import { OptionPicker } from '../pickers/OptionPicker';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { PropertySwatch } from '../primitives/glyphs';
import { MoveInPicker } from './ApplicationPicker';
import { ApplicationStatusPill, InquiryStatusGlyph } from './bits';
import { afterLeasingWrite, lk, useInquiry, useInquiryActions, useListings } from './data';
import { ContactLinks, LeadPicker, LostDialog, ShowingDialog, useSendApplicationLink, type LeadDialog, type LeadPickerKind } from './LeadParts';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';
const action = 'inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-2xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <span className="w-[104px] shrink-0 text-[13.5px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

/** Notes that save when you click away, like everywhere else in the app. */
function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(56, el.scrollHeight)}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => text !== value && onSave(text)}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setText(value);
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      }}
      placeholder="What they’re looking for, budget, timing, who else is moving in…"
      maxLength={5000}
      className="block w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70 hover:border-input focus:border-ring focus:bg-background"
    />
  );
}

/**
 * A lead in a side sheet over the list: who they are, what they want, the
 * conversation, and the next step — reply, send the application link, book a
 * showing, or close it out.
 */
export function LeadSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useInquiry(id);
  const { update } = useInquiryActions();
  const sendLink = useSendApplicationLink();
  const listings = useListings();
  const [picker, setPicker] = useState<LeadPickerKind | 'listing' | 'moveIn' | null>(null);
  const [dialog, setDialog] = useState<LeadDialog>(null);
  const [mode, setMode] = useState<'reply' | 'note'>('note');
  const [composerKey, setComposerKey] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const q = data?.inquiry;
  const first = q ? firstName(q.name) || q.name : '';

  const focusComposer = (m: 'reply' | 'note') => {
    setMode(m);
    setComposerKey(k => k + 1);
    window.setTimeout(() => {
      composerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      composerRef.current?.querySelector('textarea')?.focus();
    }, 50);
  };

  useHotkeys(
    {
      r: () => q?.email && focusComposer('reply'),
      s: () => setPicker('status'),
      a: () => setPicker('assignee'),
    },
    { enabled: Boolean(q) && !picker && !dialog, allowInOverlay: true },
  );

  const messages: TimelineMessage[] = useMemo(() => {
    if (!q) return [];
    const original: TimelineMessage[] = q.message
      ? [{ id: `inquiry:${q.id}`, subject: q.listingTitle ? `About ${q.listingTitle}` : 'Inquiry', body: q.message, direction: 'Inbound', channel: q.source === 'Portal' ? 'Portal' : 'Email', senderMemberId: null, senderName: q.name, delivery: 'Received', sentAt: q.receivedAt, attachments: [] }]
      : [];
    return [...original, ...(data?.messages ?? []).map(m => ({ ...m, counterpart: m.direction === 'Outbound' ? q.name : m.counterpart }))];
  }, [q, data?.messages]);

  const listingOptions = useMemo(
    () => [
      { value: '__none__', label: 'No specific listing', icon: <FileText className="h-3.5 w-3.5 text-muted-foreground" /> },
      ...(listings.data?.listings ?? []).filter(l => l.status !== 'Leased' || l.id === q?.listingId).map(l => ({ value: l.id, label: l.title, hint: l.status === 'Published' ? undefined : l.status, keywords: [l.propertyName, l.unitName], icon: <PropertySwatch color={ws.propertyById.get(l.propertyId ?? '')?.color} /> })),
    ],
    [listings.data, q?.listingId, ws],
  );

  const modes: ComposerMode[] = [
    { value: 'note', label: 'Internal note', icon: <Lock />, placeholder: 'Add a note for your team…' },
    ...(q?.email && ws.can('communications.send') ? [{ value: 'reply', label: `Email ${first}`, icon: <Mail />, placeholder: `Write to ${q.name}…`, hint: `Sent to ${q.email} from your company’s address.` }] : []),
  ];

  const send = async ({ mode: m, body }: { mode: string; body: string }) => {
    if (!q) return;
    try {
      const res = await replyToInquiry(m === 'reply' ? { mode: 'reply', inquiryId: q.id, body } : { mode: 'note', inquiryId: q.id, body });
      await qc.invalidateQueries({ queryKey: lk.inquiryDetail(q.id) });
      afterLeasingWrite(qc, 300);
      if (m === 'reply') {
        if (res.delivery === 'Failed') toast.error(`The email to ${q.email} couldn’t be delivered`, { description: 'It’s saved on the conversation as not delivered.' });
        else toast.success(`Reply sent to ${first}`);
      }
    } catch (e) {
      toast.error(errorMessage(e, m === 'reply' ? 'The reply wasn’t sent' : 'The note wasn’t saved'));
      throw e;
    }
  };

  const closed = q?.status === 'Closed' || q?.status === 'Applied';
  const assignee = q?.assigneeId ? ws.memberById.get(q.assigneeId) : undefined;
  const property = q?.propertyId ? ws.propertyById.get(q.propertyId) : undefined;
  const upcomingShowing = q?.showingAt && q.showingAt > new Date(Date.now() - 2 * 3600_000).toISOString();

  return (
    <Sheet open onOpenChange={o => !o && !dialog && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px] [&>button:first-of-type]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
        <SheetTitle className="sr-only">{q ? `Lead: ${q.name}` : 'Lead'}</SheetTitle>
        <SheetDescription className="sr-only">Lead details and conversation</SheetDescription>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {q && (
            <>
              <InquiryStatusGlyph status={q.status} />
              <span className="text-[14px] text-muted-foreground">Lead</span>
              <span className="text-muted-foreground/60">›</span>
              <span className="min-w-0 truncate text-[14px] font-medium">{q.name}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Tip label="Copy link">
              <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/leasing/leads?lead=${id}`), 'Link copied')}><Link2 /></IconButton>
            </Tip>
            <Tip label="Close" keys={['Esc']}>
              <IconButton aria-label="Close" onClick={onClose}><X /></IconButton>
            </Tip>
          </div>
        </div>

        {isPending ? (
          <SkeletonRows rows={8} className="p-5" />
        ) : isError || !q || !data ? (
          <EmptyState className="flex-1" title="This lead didn’t load" description={errorMessage(error, 'It may have been removed.')} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-16 pt-5 sm:px-6">
            <h2 className="break-words text-[20px] font-semibold leading-7 tracking-tight">{q.name}</h2>
            <div className="mt-1.5"><ContactLinks lead={q} /></div>
            <p className="mt-1 text-sm text-muted-foreground">
              {q.source} lead · received <Tip label={dateTime(q.receivedAt)}><span>{timeAgo(q.receivedAt)}</span></Tip>
              {q.lastContactedAt ? ` · last contacted ${timeAgo(q.lastContactedAt)}` : ''}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <Tip label={q.email ? 'Reply by email' : 'No email address on this lead'} keys={q.email ? ['R'] : undefined}>
                <span><button type="button" className={action} disabled={!q.email || !ws.can('communications.send')} onClick={() => focusComposer('reply')}><Mail /> Reply</button></span>
              </Tip>
              <Tip label={!q.listingId ? 'Link the lead to a listing first' : !q.email ? 'No email address on this lead' : q.listingStatus !== 'Published' ? 'The listing isn’t published' : 'Email the listing’s application link'}>
                <span><button type="button" className={action} disabled={!q.listingId || !q.email || q.listingStatus !== 'Published' || !ws.can('communications.send')} onClick={() => void sendLink(q)}><Send /> Send application link</button></span>
              </Tip>
              <button type="button" className={action} onClick={() => setDialog({ kind: 'showing', lead: q })}><CalendarClock /> {q.showingAt && upcomingShowing ? 'Reschedule showing' : 'Schedule showing'}</button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={action} aria-label="More actions"><MoreHorizontal /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {q.status !== 'Applied' && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void update([q], { status: 'Applied' }, { toast: `${q.name} marked converted` }).catch(() => undefined)}><CheckCircle2 className="h-3.5 w-3.5" /> Mark converted</DropdownMenuItem>}
                  {q.status !== 'Closed' && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => setDialog({ kind: 'lost', lead: q })}><XCircle className="h-3.5 w-3.5" /> Mark lost…</DropdownMenuItem>}
                  {closed && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void update([q], { status: q.lastContactedAt ? 'Contacted' : 'New' }, { toast: `${q.name} reopened` }).catch(() => undefined)}><RotateCcw className="h-3.5 w-3.5" /> Reopen</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  {q.email && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(q.email, 'Email copied')}><Mail className="h-3.5 w-3.5" /> Copy email</DropdownMenuItem>}
                  {data.applyUrl && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(data.applyUrl!, 'Application link copied')}><Link2 className="h-3.5 w-3.5" /> Copy application link</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {q.showingAt && (
              <div className={cn('mt-4 flex items-center gap-3 rounded-lg border px-3.5 py-2.5', upcomingShowing ? 'border-tone-info/30 bg-tone-info/[0.05]' : 'bg-subtle/60')}>
                <CalendarClock className={cn('h-4 w-4 shrink-0', upcomingShowing ? 'text-tone-info' : 'text-muted-foreground')} />
                <div className="min-w-0 flex-1 text-[14px]">
                  <span className="font-medium">{upcomingShowing ? 'Showing' : 'Showed'} {shortDateTime(q.showingAt)}</span>
                  {q.assigneeId && <span className="text-muted-foreground"> · with {q.assigneeId === ws.me.id ? 'you' : ws.memberName(q.assigneeId)}</span>}
                </div>
                {upcomingShowing && <button type="button" className="ghost-chip h-8 text-sm" onClick={() => setDialog({ kind: 'showing', lead: q })}>Change</button>}
              </div>
            )}

            <div className="mt-5 rounded-lg border bg-subtle/40 px-3 py-1.5">
              <Row label="Status">
                <LeadPicker kind="status" targets={[q]} open={picker === 'status'} onOpenChange={o => setPicker(o ? 'status' : null)} onDialog={setDialog} trigger={<button type="button" className={chip}><InquiryStatusGlyph status={q.status} /> {q.status}<ChevronDown className="h-3 w-3 text-muted-foreground" /></button>} />
              </Row>
              <Row label="Assignee">
                <LeadPicker kind="assignee" targets={[q]} open={picker === 'assignee'} onOpenChange={o => setPicker(o ? 'assignee' : null)} onDialog={setDialog} trigger={<button type="button" className={chip}>{assignee ? <><MemberAvatar member={assignee} size={18} /><span className="truncate">{assignee.name}</span></> : <><UnassignedAvatar size={18} /><span className="text-muted-foreground">Unassigned</span></>}</button>} />
              </Row>
              <Row label="Interested in">
                <OptionPicker
                  options={listingOptions}
                  value={q.listingId ?? '__none__'}
                  open={picker === 'listing'}
                  onOpenChange={o => setPicker(o ? 'listing' : null)}
                  width={320}
                  placeholder="Find a listing…"
                  onChange={v => void update([q], { listingId: v === '__none__' ? null : v, ...(v === '__none__' ? { unitId: q.unitId } : {}) }, { toast: 'Updated what they’re interested in' }).catch(() => undefined)}
                  trigger={
                    <button type="button" className={chip}>
                      {property ? <PropertySwatch color={property.color} /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="truncate">{q.listingTitle ?? (q.unitId || q.propertyId ? ws.unitLabel(q.unitId, q.propertyId) : <span className="text-muted-foreground">Nothing specific</span>)}</span>
                    </button>
                  }
                />
              </Row>
              {q.listingId && q.unitId && (
                <Row label="Unit">
                  <Link to={`/units/${q.unitId}`} className={cn(chip, 'text-muted-foreground')}>{ws.unitLabel(q.unitId, q.propertyId)}</Link>
                </Row>
              )}
              <Row label="Move-in">
                <MoveInPicker value={q.desiredMoveIn} open={picker === 'moveIn'} onOpenChange={o => setPicker(o ? 'moveIn' : null)} onChange={d => void update([q], { desiredMoveIn: d }).catch(() => undefined)} trigger={<button type="button" className={chip}><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{q.desiredMoveIn ? shortDate(q.desiredMoveIn) : <span className="text-muted-foreground">Not given</span>}</button>} />
              </Row>
              {data.applications.length > 0 && (
                <Row label={data.applications.length === 1 ? 'Application' : 'Applications'}>
                  <span className="flex flex-wrap items-center gap-1">
                    {data.applications.map(a => (
                      <Link key={a.id} to={`/applications/${a.number}`} className={chip}>
                        <span className="tabular-nums">{applicationRef(a.number)}</span>
                        <ApplicationStatusPill status={a.status} />
                      </Link>
                    ))}
                  </span>
                </Row>
              )}
            </div>

            <div className="mt-5">
              <h3 className="mb-1 text-[14px] font-medium">Notes</h3>
              <div className="-mx-2">
                <NotesField value={q.notes} onSave={notes => void update([q], { notes }, { toast: 'Notes saved' }).catch(() => undefined)} />
              </div>
            </div>

            {data.showings.some(s => s.status !== 'Canceled') && (
              <div className="mt-4">
                <h3 className="mb-1.5 text-[14px] font-medium">Showing tasks</h3>
                <div className="overflow-hidden rounded-lg border">
                  {data.showings.filter(s => s.status !== 'Canceled').map(s => (
                    <Link key={s.id} to="/tasks" className="flex h-9 items-center gap-2.5 border-b px-3 text-[14px] last:border-b-0 hover:bg-accent/50">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="text-sm text-muted-foreground">{s.status}</span>
                      {s.assigneeId && <MemberAvatar member={ws.memberById.get(s.assigneeId)} size={16} />}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <h3 className="mb-2 mt-7 text-[14px] font-medium">Conversation</h3>
            <Timeline activity={data.activity} messages={messages} emptyText="No messages yet." />
            <div ref={composerRef}>
              <Composer key={composerKey} className="mt-4" modes={modes} defaultMode={mode} onSend={send} />
            </div>
          </div>
        )}
        <ShowingDialog lead={dialog?.kind === 'showing' ? dialog.lead : null} open={dialog?.kind === 'showing'} onOpenChange={o => !o && setDialog(null)} />
        <LostDialog lead={dialog?.kind === 'lost' ? dialog.lead : null} open={dialog?.kind === 'lost'} onOpenChange={o => !o && setDialog(null)} />
      </SheetContent>
    </Sheet>
  );
}

