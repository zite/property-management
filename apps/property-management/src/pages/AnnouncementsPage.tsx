import { Megaphone, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppActions } from '../lib/app-actions';
import { errorMessage } from '../lib/errors';
import { useHotkeys } from '../lib/hotkeys';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { EmptyState, SkeletonRows, Tip } from '../components/primitives/bits';
import { AnnouncementRow, AnnouncementSheet } from '../components/comms/Announcements';
import { useAnnouncements, type Announcement } from '../components/comms/data';
import { useListNav } from '../components/list/useListNav';

/**
 * Announcements: drafts, scheduled and sent notices to residents, owners or
 * vendors, with who they reached. `?id=` opens one in a side sheet.
 *
 *   J / K move · ↵ open · N new announcement
 */

type View = 'all' | 'Draft' | 'Scheduled' | 'Sent';
const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Draft', label: 'Drafts' },
  { value: 'Scheduled', label: 'Scheduled' },
  { value: 'Sent', label: 'Sent' },
];

export function AnnouncementsPage() {
  useDocumentTitle('Announcements');
  const app = useAppActions();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some(v => v.value === params.get('view')) ? params.get('view') : 'all') as View;
  const openId = params.get('id');
  const { data, isPending, isError, error, refetch } = useAnnouncements();
  const all = data?.announcements ?? [];
  const inView = (a: Announcement) => view === 'all' || (view === 'Sent' ? a.state === 'Sent' || a.state === 'Sending' : a.state === view);
  const rows = useMemo(() => all.filter(inView), [all, view]);
  const counts = useMemo(() => ({ Draft: all.filter(a => a.state === 'Draft').length, Scheduled: all.filter(a => a.state === 'Scheduled').length, Sent: all.filter(a => a.state === 'Sent' || a.state === 'Sending').length }), [all]);

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: !id });
  };

  const nav = useListNav({ items: rows, getId: a => a.id, onOpen: a => setOpen(a.id), enabled: !openId });
  useHotkeys({ n: () => app.openCreate('announcement') }, { enabled: !openId });

  const tabs = VIEWS.map(v => {
    const next = new URLSearchParams();
    if (v.value !== 'all') next.set('view', v.value);
    const qs = next.toString();
    return { to: `/announcements${qs ? `?${qs}` : ''}`, label: v.label, count: v.value === 'all' ? null : v.value === 'Sent' ? null : counts[v.value], active: view === v.value };
  });

  return (
    <>
      <PageHeader
        icon={<Megaphone />}
        title="Announcements"
        tabs={tabs}
        actions={
          <Tip label="New announcement" keys={['N']}>
            <button type="button" onClick={() => app.openCreate('announcement')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[14px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New announcement</span>
            </button>
          </Tip>
        }
      />
      <div ref={nav.scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={6} className="px-3 pt-2" />
        ) : isError ? (
          <EmptyState className="py-20" title="Announcements didn’t load" description={errorMessage(error, 'Something went wrong.')} action={<button type="button" className="ghost-chip h-9 border border-border" onClick={() => void refetch()}>Try again</button>} />
        ) : rows.length === 0 ? (
          all.length === 0 ? (
            <EmptyState
              className="py-20"
              icon={<Megaphone />}
              title="No announcements yet"
              description="Tell a building about a water shut-off, remind every resident about the holiday hours, or update all your owners at once."
              action={<button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[14px] font-medium text-primary-foreground" onClick={() => app.openCreate('announcement')}><Plus className="h-3.5 w-3.5" /> New announcement</button>}
            />
          ) : (
            <EmptyState
              className="py-20"
              icon={<Megaphone />}
              title={view === 'Draft' ? 'No drafts' : view === 'Scheduled' ? 'Nothing scheduled' : 'Nothing sent yet'}
              description={view === 'Scheduled' ? 'Schedule an announcement to have it go out on its own.' : 'Try another tab.'}
              action={<button type="button" className="ghost-chip h-9 border border-border" onClick={() => setParams(new URLSearchParams())}>Show all announcements</button>}
            />
          )
        ) : (
          <ul aria-label="Announcements" className="pb-16">
            {rows.map(a => (
              <AnnouncementRow key={a.id} a={a} focused={nav.focusedId === a.id} onOpen={() => setOpen(a.id)} onHover={() => nav.setFocusedId(a.id)} />
            ))}
          </ul>
        )}
      </div>
      {openId && <AnnouncementSheet id={openId} onClose={() => setOpen(null)} />}
    </>
  );
}
