import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarX2, CheckCircle2, CircleDashed, Link2, Mail, MessageSquare, Pencil, Pin, RotateCcw, Send, Trash2, TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { saveAnnouncement, sendAnnouncement } from 'zitejs/api';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { cn } from '@project/components/lib/utils';
import { useAppActions } from '../../lib/app-actions';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, plural, shortDate, shortDateTime, timeAgo } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { DateInput, Segmented } from '../form/fields';
import { MemberAvatar } from '../primitives/Avatar';
import { EmptyState, IconButton, ProgressBar, ProgressRing, SkeletonRows, Tip } from '../primitives/bits';
import { StatTile } from '../primitives/data';
import { Pill } from '../primitives/glyphs';
import { AUDIENCE_OPTIONS, afterMessage, isSendingHere, labelTags, runAnnouncementSend, threadPath, useAnnouncement, type Announcement, type AnnouncementDetail } from './data';
import { KindIcon, PersonAvatar, TaggedText } from './MessageTools';

/** Announcement rows for the list, and the side sheet with delivery for each recipient. */

type Audienced = Pick<Announcement, 'audience' | 'propertyIds' | 'unitIds'>;

export function useAudienceLabel() {
  const ws = useWorkspace();
  return (a: Audienced) => {
    const names = (ids: string[]) => (ids.length <= 2 ? ids.map(id => ws.propertyName(id) || 'Former property').join(', ') : `${ids.length} properties`);
    switch (a.audience) {
      case 'residents':
        return 'All current residents';
      case 'residents_properties':
        return `Residents · ${names(a.propertyIds)}`;
      case 'residents_units':
        return `Residents · ${a.unitIds.length === 1 ? ws.unitLabel(a.unitIds[0]) || '1 unit' : `${a.unitIds.length} units`}`;
      case 'owners':
        return 'All owners';
      case 'owners_properties':
        return `Owners · ${names(a.propertyIds)}`;
      default:
        return 'All active vendors';
    }
  };
}

export function StateGlyph({ a, className }: { a: Pick<Announcement, 'state' | 'recipientCount' | 'stats'>; className?: string }) {
  if (a.state === 'Draft') return <CircleDashed className={cn('h-4 w-4 text-muted-foreground', className)} aria-label="Draft" />;
  if (a.state === 'Scheduled') return <CalendarClock className={cn('h-4 w-4 text-tone-info', className)} aria-label="Scheduled" />;
  if (a.state === 'Sending') return <ProgressRing value={a.recipientCount ? a.stats.total / a.recipientCount : 0} size={16} className={cn('text-tone-warning', className)} />;
  return <CheckCircle2 className={cn('h-4 w-4 text-tone-success', className)} aria-label="Sent" />;
}

const STATE_TONE = { Draft: 'neutral', Scheduled: 'info', Sending: 'warning', Sent: 'success' } as const;

export function AnnouncementRow({ a, focused, onOpen, onHover }: { a: Announcement; focused: boolean; onOpen: () => void; onHover: () => void }) {
  const ws = useWorkspace();
  const audienceLabel = useAudienceLabel();
  const kind = AUDIENCE_OPTIONS.find(o => o.value === a.audience)?.kind ?? 'tenant';
  const by = a.sentById ? ws.memberById.get(a.sentById) : undefined;
  const when =
    a.state === 'Scheduled' ? `Scheduled ${shortDateTime(a.sentAt)}` : a.state === 'Draft' ? `Draft · ${timeAgo(a.createdAt)}` : a.sentAt ? `Sent ${shortDate(a.sentAt)}` : 'Sent';
  const reach = a.state === 'Draft' || a.state === 'Scheduled' ? null : a.tracked ? a.stats.total : a.recipientCount;

  return (
    <li>
      <button
        type="button"
        data-row-id={a.id}
        onClick={onOpen}
        onMouseMove={onHover}
        className={cn('relative flex w-full items-center gap-3 border-b border-border/70 px-4 py-2.5 text-left transition-colors hover:bg-accent/50', focused && 'bg-accent/60')}
      >
        {focused && <span className="absolute inset-y-0 left-0 w-[2px] bg-primary" aria-hidden />}
        <StateGlyph a={a} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium">{a.title ? <TaggedText text={a.title} className="whitespace-nowrap" /> : 'Untitled announcement'}</span>
          <span className="block truncate text-sm text-muted-foreground"><TaggedText text={a.body.replace(/\s+/g, ' ').slice(0, 240)} className="whitespace-nowrap" /></span>
        </span>
        <span className="hidden w-[210px] shrink-0 items-center gap-1.5 truncate text-[13.5px] text-muted-foreground md:flex">
          <KindIcon kind={kind} /> <span className="truncate">{audienceLabel(a)}</span>
        </span>
        <span className="hidden w-[36px] shrink-0 justify-center text-muted-foreground lg:flex">
          <Tip label={a.channel === 'Email and portal' ? 'Email and portal' : 'Portal only'}>
            <span>{a.channel === 'Email and portal' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}</span>
          </Tip>
        </span>
        <span className="hidden w-[190px] shrink-0 text-sm tabular-nums text-muted-foreground lg:block">
          {reach == null ? (
            '—'
          ) : a.state === 'Sending' ? (
            <span className="text-tone-warning">Sending · {a.stats.total} of {a.recipientCount}</span>
          ) : a.tracked ? (
            <>
              {plural(reach, 'person', 'people')}
              {a.stats.failed > 0 && <span className="text-tone-danger"> · {a.stats.failed} failed</span>}
              {a.stats.read > 0 && <span> · {a.stats.read} read</span>}
            </>
          ) : (
            plural(reach, 'person', 'people')
          )}
        </span>
        <span className={cn('w-[140px] shrink-0 truncate text-right text-sm tabular-nums sm:w-[160px]', a.state === 'Scheduled' ? 'text-tone-info' : 'text-muted-foreground')}>{when}</span>
        <span className="hidden w-5 shrink-0 sm:block">{by && <MemberAvatar member={by} size={20} />}</span>
      </button>
    </li>
  );
}

// ── Detail sheet ────────────────────────────────────────────────────────────

type RecipientFilter = 'all' | 'failed' | 'unread';

export function AnnouncementSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isPending, isError, error } = useAnnouncement(id);
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[720px] [&>button:first-of-type]:hidden" onOpenAutoFocus={e => e.preventDefault()}>
        <SheetTitle className="sr-only">{data?.announcement.title ?? 'Announcement'}</SheetTitle>
        <SheetDescription className="sr-only">Announcement details and delivery</SheetDescription>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          {data && <Pill tone={STATE_TONE[data.announcement.state]}>{data.announcement.state === 'Sending' ? 'Sending' : data.announcement.state}</Pill>}
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{data && <TaggedText text={data.announcement.title} className="whitespace-nowrap" />}</span>
          <Tip label="Copy link">
            <IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/announcements?id=${id}`), 'Link copied')}><Link2 /></IconButton>
          </Tip>
          <Tip label="Close" keys={['Esc']}>
            <IconButton aria-label="Close" onClick={onClose}><X /></IconButton>
          </Tip>
        </div>
        {isPending ? (
          <SkeletonRows rows={8} className="p-5" />
        ) : isError || !data ? (
          <EmptyState className="flex-1" title="This announcement didn’t load" description={errorMessage(error, 'It may have been deleted.')} />
        ) : (
          <AnnouncementBody detail={data} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function AnnouncementBody({ detail, onClose }: { detail: AnnouncementDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const app = useAppActions();
  const audienceLabel = useAudienceLabel();
  const a = detail.announcement;
  const s = detail.stats;
  const [filter, setFilter] = useState<RecipientFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const by = a.sentById ? ws.memberById.get(a.sentById) : undefined;
  const kind = AUDIENCE_OPTIONS.find(o => o.value === a.audience)?.kind ?? 'tenant';
  const draft = a.status === 'Draft';
  const sendingHere = isSendingHere(a.id);

  const recipients = useMemo(() => detail.recipients.filter(r => (filter === 'failed' ? r.delivery === 'Failed' : filter === 'unread' ? !r.readAt : true)), [detail.recipients, filter]);
  const visible = showAll ? recipients : recipients.slice(0, 200);

  const refresh = () => {
    invalidate(qc, 'announcements');
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const sendNow = () =>
    run('send', async () => {
      const reach = detail.audienceNow?.total ?? 0;
      if (!reach) {
        toast.error('No one is in this audience yet, so there’s nobody to send it to.');
        return;
      }
      const ok = await app.confirm({ title: `Send to ${plural(reach, 'person', 'people')} now?`, description: a.channel === 'Email and portal' ? 'Each of them gets an email and a copy in their portal conversation. Sent announcements can’t be edited or unsent.' : 'Each of them gets a copy in their portal conversation. Sent announcements can’t be edited or unsent.', confirmLabel: `Send to ${reach}` });
      if (!ok) return;
      void runAnnouncementSend(qc, a.id, a.title, 'send');
    });

  const unschedule = () =>
    run('unschedule', async () => {
      try {
        await saveAnnouncement({ action: 'unschedule', id: a.id });
        refresh();
        toast.success('Schedule canceled — it’s a draft again');
      } catch (e) {
        toast.error(errorMessage(e, 'Couldn’t cancel the schedule'));
      }
    });

  const remove = () =>
    run('delete', async () => {
      const ok = await app.confirm({ title: `Delete “${labelTags(a.title)}”?`, description: a.state === 'Scheduled' ? 'The draft is deleted and won’t be sent.' : 'The draft is deleted. Nothing was sent, so nobody is affected.', confirmLabel: 'Delete draft', destructive: true });
      if (!ok) return;
      try {
        await saveAnnouncement({ action: 'delete', id: a.id });
        refresh();
        onClose();
        toast.success('Draft deleted');
      } catch (e) {
        toast.error(errorMessage(e, 'Couldn’t delete the draft'));
      }
    });

  const retryFailed = () =>
    run('retry', async () => {
      try {
        let fixed = 0;
        let still = 0;
        let noEmail = 0;
        for (let i = 0; i < 50; i++) {
          const r = await sendAnnouncement({ mode: 'retryFailed', id: a.id });
          fixed += r.sent;
          still += r.failed;
          noEmail += r.portalOnly;
          if (r.done) break;
        }
        afterMessage(qc);
        refresh();
        if (fixed && !still && !noEmail) toast.success(`Resent to ${plural(fixed, 'person', 'people')}`);
        else toast.warning([fixed ? `Resent to ${fixed}` : null, still ? `${still} still failing` : null, noEmail ? `${noEmail} no longer have an email` : null].filter(Boolean).join(' · '));
      } catch (e) {
        toast.error(errorMessage(e, 'Couldn’t resend the failed emails'));
      }
    });

  const pin = (day: string | null) =>
    run('pin', async () => {
      try {
        await saveAnnouncement({ action: 'pin', id: a.id, pinnedUntil: day });
        refresh();
        toast.success(day ? `Pinned in the resident portal until ${shortDate(day)}` : 'Unpinned');
      } catch (e) {
        toast.error(errorMessage(e, 'Couldn’t change the pin'));
      }
    });

  const meta = [
    audienceLabel(a),
    a.channel === 'Email and portal' ? 'Email + portal' : 'Portal only',
    a.state === 'Scheduled' ? `Sends ${shortDateTime(a.sentAt)}` : a.status === 'Sent' && a.sentAt ? `Sent ${dateTime(a.sentAt)}` : `Created ${timeAgo(a.createdAt)}`,
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 pb-16 pt-5">
        <h2 className="text-[18px] font-semibold leading-snug tracking-tight"><TaggedText text={a.title} /></h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground">
          <KindIcon kind={kind} />
          {meta.map((m, i) => <span key={i}>{i > 0 && <span className="mr-2 text-faint">·</span>}{m}</span>)}
          {by && <span className="inline-flex items-center gap-1.5"><span className="text-faint">·</span><MemberAvatar member={by} size={16} /> {by.name}</span>}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {draft && (
            <>
              <button type="button" onClick={() => void sendNow()} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
                <Send className="h-3.5 w-3.5" /> Send now{detail.audienceNow ? ` to ${detail.audienceNow.total}` : ''}
              </button>
              <button type="button" onClick={() => app.openCreate('announcement', { id: a.id })} className="ghost-chip h-9 border border-border"><Pencil className="h-3.5 w-3.5" /> Edit</button>
              {a.state === 'Scheduled' && <button type="button" onClick={() => void unschedule()} disabled={Boolean(busy)} className="ghost-chip h-9 border border-border"><CalendarX2 className="h-3.5 w-3.5" /> Cancel schedule</button>}
              <button type="button" onClick={() => void remove()} disabled={Boolean(busy)} className="ghost-chip h-9 text-tone-danger"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </>
          )}
          {a.state === 'Sending' && (
            <button type="button" onClick={() => void runAnnouncementSend(qc, a.id, a.title, 'resume')} disabled={a.busy || sendingHere} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" /> {a.busy || sendingHere ? 'Sending…' : `Resume sending to ${detail.audienceNow?.notYetSent ?? a.recipientCount - s.total}`}
            </button>
          )}
          {a.status === 'Sent' && s.failed > 0 && (
            <button type="button" onClick={() => void retryFailed()} disabled={Boolean(busy)} className="ghost-chip h-9 border border-tone-danger/40 text-tone-danger">
              <RotateCcw className="h-3.5 w-3.5" /> {busy === 'retry' ? 'Resending…' : `Resend ${plural(s.failed, 'failed email', 'failed emails')}`}
            </button>
          )}
          {a.status === 'Sent' && kind === 'tenant' && a.audience !== 'residents_units' && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Pin className="h-3.5 w-3.5" /> Pinned until
              <DateInput value={a.pinnedUntil} onChange={v => void pin(v)} min={ws.today} className="h-8 w-[140px]" />
            </span>
          )}
        </div>

        {a.status === 'Sent' && a.tracked && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Recipients" value={s.total.toLocaleString()} hint={a.state === 'Sending' ? `of ${a.recipientCount}` : undefined} />
              <StatTile label="Emailed" value={s.emailed.toLocaleString()} hint={s.portalOnly ? `${s.portalOnly} portal only` : undefined} />
              <StatTile label="Failed" value={s.failed.toLocaleString()} tone={s.failed ? 'danger' : 'default'} />
              <StatTile label="Read in portal" value={s.read.toLocaleString()} hint={s.total ? `${Math.round((s.read / s.total) * 100)}%` : undefined} />
            </div>
            {a.state === 'Sending' && (
              <div className="mt-3 rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-4 py-3">
                <div className="flex items-center justify-between text-[14px]">
                  <span className="font-medium">{a.busy || sendingHere ? 'Sending now' : 'Sending stopped part-way'}</span>
                  <span className="tabular-nums text-muted-foreground">{s.total} of {a.recipientCount}</span>
                </div>
                <ProgressBar value={a.recipientCount ? s.total / a.recipientCount : 0} tone="warning" className="mt-2" />
                {!a.busy && !sendingHere && <p className="mt-2 text-sm text-muted-foreground">Resume to reach the rest — nobody who already has it gets it twice. Unfinished sends also resume on their own within 15 minutes.</p>}
              </div>
            )}
          </>
        )}
        {a.status === 'Sent' && !a.tracked && (
          <p className="mt-5 rounded-lg border bg-subtle px-4 py-3 text-[14px] text-muted-foreground">Sent to {plural(a.recipientCount, 'person', 'people')}. Delivery for each person wasn’t recorded for this announcement.</p>
        )}
        {draft && detail.audienceNow && (
          <p className="mt-5 flex items-start gap-2 rounded-lg border bg-subtle px-4 py-3 text-[14px]">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              {a.state === 'Scheduled' ? `Goes out ${dateTime(a.sentAt)} to` : 'Would reach'} <span className="font-medium">{plural(detail.audienceNow.total, 'person', 'people')}</span> today
              {a.channel === 'Email and portal' && detail.audienceNow.withoutEmail > 0 && <span className="text-tone-warning"> · {detail.audienceNow.withoutEmail} without email get it in the portal only</span>}.
            </span>
          </p>
        )}

        <h3 className="mb-2 mt-6 text-[14px] font-medium">Message</h3>
        <div className="rounded-lg border bg-card px-4 py-3 text-[14.5px] leading-relaxed shadow-2xs">
          <TaggedText text={a.body} />
        </div>

        {a.status === 'Sent' && a.tracked && (
          <>
            <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-medium">Recipients <span className="ml-1 text-sm tabular-nums text-muted-foreground">{detail.recipients.length}</span></h3>
              <Segmented size="sm" value={filter} onChange={v => setFilter(v as RecipientFilter)} options={[{ value: 'all', label: 'All' }, { value: 'failed', label: `Failed${s.failed ? ` ${s.failed}` : ''}` }, { value: 'unread', label: 'Not read' }]} />
            </div>
            {recipients.length === 0 ? (
              <p className="rounded-lg border px-4 py-6 text-center text-[14px] text-muted-foreground">{filter === 'failed' ? 'No failed emails.' : filter === 'unread' ? 'Everyone has read it.' : 'No recipients yet.'}</p>
            ) : (
              <ul className="overflow-hidden rounded-lg border">
                {visible.map(r => {
                  const kindKey = (r.kind as 'tenant' | 'owner' | 'vendor' | 'applicant') ?? 'tenant';
                  return (
                    <li key={r.messageId} className="border-b last:border-b-0">
                      <Link to={r.thread ? threadPath(r.thread) : '/messages'} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50">
                        <PersonAvatar kind={kindKey} name={r.name} size={24} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px]">{r.name}</span>
                          {(r.unitId || r.propertyId) && <span className="block truncate text-sm text-muted-foreground">{ws.unitLabel(r.unitId, r.propertyId)}</span>}
                        </span>
                        {r.delivery === 'Failed' ? (
                          <Pill tone="danger"><TriangleAlert className="h-3 w-3" /> Email failed</Pill>
                        ) : r.delivery === 'Sent' ? (
                          <Pill tone="neutral"><Mail className="h-3 w-3" /> Emailed</Pill>
                        ) : (
                          <Pill tone="neutral"><MessageSquare className="h-3 w-3" /> Portal</Pill>
                        )}
                        <span className={cn('hidden w-[92px] shrink-0 text-right text-sm sm:block', r.readAt ? 'text-tone-success' : 'text-faint')}>{r.readAt ? `Read ${timeAgo(r.readAt)}` : 'Not read'}</span>
                      </Link>
                    </li>
                  );
                })}
                {recipients.length > visible.length && (
                  <li>
                    <button type="button" onClick={() => setShowAll(true)} className="h-9 w-full text-[14px] text-muted-foreground hover:bg-accent/50 hover:text-foreground">Show all {recipients.length}</button>
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
