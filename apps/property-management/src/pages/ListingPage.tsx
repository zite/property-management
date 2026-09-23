import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, KeyRound, Link2, MoreHorizontal, Pause, Play, Send, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveListing } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { DetailLayout } from '../components/detail/DetailLayout';
import { afterLeasingWrite, useListing, useListingActions } from '../components/leasing/data';
import { ListingMain, ListingRail, publishGaps } from '../components/leasing/ListingDetail';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';

const ghost = 'inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-2xs hover:bg-accent disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5';
const primary = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5';

/**
 * A listing, edited in place: every field saves as you leave it, and the
 * header moves it between draft, live, paused and leased.
 */
export function ListingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const app = useAppActions();
  const { data, isPending, isError, error } = useListing(id);
  const { setStatus } = useListingActions();
  const [busy, setBusy] = useState(false);
  const l = data?.listing;
  useDocumentTitle(l ? l.title : 'Listing');
  useHotkeys({ esc: () => navigate('/leasing/listings') });

  const change = async (status: 'Draft' | 'Published' | 'Paused' | 'Leased') => {
    if (!l) return;
    if (status === 'Leased' && !(await app.confirm({ title: 'Mark this listing leased?', description: 'It comes off the portal’s homes page and stops taking applications. Open applications stay as they are.', confirmLabel: 'Mark leased' }))) return;
    if (status === 'Paused' && l.openApplicationCount > 0 && !(await app.confirm({ title: 'Pause this listing?', description: `It’s hidden from the portal until you resume it. ${l.openApplicationCount} open ${l.openApplicationCount === 1 ? 'application stays' : 'applications stay'} in review.`, confirmLabel: 'Pause listing' }))) return;
    setBusy(true);
    await setStatus(l, status).catch(() => undefined);
    setBusy(false);
  };

  const header = (
    <PageHeader
      breadcrumb={{ to: '/leasing/listings', label: 'Listings' }}
      icon={<FileText />}
      title={l ? l.title : 'Listing'}
      actions={
        l && (
          <>
            <Tip label="Copy link to this page"><IconButton aria-label="Copy link" onClick={() => void copyText(appUrl(`/listings/${l.id}`), 'Link copied')}><Link2 /></IconButton></Tip>
            {l.publicUrl && l.status === 'Published' && <Tip label="Open the public listing"><a href={l.publicUrl} target="_blank" rel="noreferrer" aria-label="Open the public listing" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><ExternalLink className="h-4 w-4" /></a></Tip>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconButton aria-label="More actions"><MoreHorizontal /></IconButton></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {l.publicUrl && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(l.publicUrl!, 'Listing link copied')}><Link2 className="h-3.5 w-3.5" /> Copy public link</DropdownMenuItem>}
                {(l.status === 'Published' || l.status === 'Paused') && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void change('Leased')}><KeyRound className="h-3.5 w-3.5" /> Mark leased</DropdownMenuItem>}
                {l.status !== 'Draft' && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void change('Draft')}><Undo2 className="h-3.5 w-3.5" /> Move back to draft</DropdownMenuItem>}
                {l.status === 'Draft' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger"
                      disabled={l.applicationCount > 0}
                      onSelect={async () => {
                        if (!(await app.confirm({ title: `Delete “${l.title}”?`, description: 'The draft and its photos are removed. Leads that mention it are kept.', confirmLabel: 'Delete draft', destructive: true }))) return;
                        try {
                          await saveListing({ action: 'delete', id: l.id });
                          afterLeasingWrite(qc);
                          toast.success('Draft deleted');
                          navigate('/leasing/listings');
                        } catch (e) {
                          toast.error(errorMessage(e, 'Couldn’t delete the draft'));
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete draft
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {l.status === 'Published' && <button type="button" className={ghost} disabled={busy} onClick={() => void change('Paused')}><Pause /> Pause</button>}
            {l.status === 'Paused' && <button type="button" className={primary} disabled={busy} onClick={() => void change('Published')}><Play /> Resume</button>}
            {l.status === 'Draft' && (
              <Tip label={publishGaps(l).length ? `Add ${publishGaps(l).join(', ')} first` : 'Put it on the portal’s homes page'}>
                <span><button type="button" className={primary} disabled={busy || publishGaps(l).length > 0} onClick={() => void change('Published')}><Send /> Publish</button></span>
              </Tip>
            )}
            {l.status === 'Leased' && <button type="button" className={ghost} disabled={busy} onClick={() => void change('Published')}><Send /> Relist</button>}
            {l.status === 'Published' && <button type="button" className={ghost} disabled={busy} onClick={() => void change('Leased')}><KeyRound /> <span className="hidden sm:inline">Mark leased</span></button>}
          </>
        )
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header}>
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton mt-2 h-4 w-72" />
        <div className="mt-8 grid grid-cols-3 gap-2">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton aspect-[3/2]" />)}</div>
        <SkeletonRows rows={5} className="mt-6 -mx-5" />
      </DetailLayout>
    );
  }
  if (isError || !data || !l) {
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<FileText />} title="Listing not found" description={errorMessage(error, 'It may have been deleted, or the link is wrong.')} action={<button type="button" className="ghost-chip h-9" onClick={() => navigate('/leasing/listings')}>Back to listings</button>} />
      </DetailLayout>
    );
  }
  return (
    <DetailLayout header={header} rail={<ListingRail detail={data} />}>
      <ListingMain detail={data} />
    </DetailLayout>
  );
}
