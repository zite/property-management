import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Check, CheckCircle2, ClipboardCheck, FileDown, Link2, Loader2, MoreHorizontal, PanelRight, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { saveInspection } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@project/components/ui/sheet';
import { DetailLayout } from '../components/detail/DetailLayout';
import { CompleteInspectionDialog } from '../components/maintenance/CompleteInspectionDialog';
import { mk, useInspection } from '../components/maintenance/data';
import { CompletionCard, InspectionRail, InspectionTitle, useInspectionActions } from '../components/maintenance/InspectionDetail';
import { WhenLabel } from '../components/maintenance/InspectionsView';
import { InspectionWalkthrough } from '../components/maintenance/InspectionWalkthrough';
import { useInspectionAutosave } from '../components/maintenance/useInspectionAutosave';
import { MemberAvatar } from '../components/primitives/Avatar';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { SectionHeading } from '../components/detail/DetailLayout';
import { Timeline } from '../components/detail/Timeline';
import { useAppActions } from '../lib/app-actions';
import { copyText } from '../lib/clipboard';
import { errorMessage } from '../lib/errors';
import { appUrl } from '../lib/format';
import { invalidate } from '../lib/queries';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useWorkspace } from '../lib/workspace';

/**
 * An inspection — used on a phone during the walkthrough as much as at a
 * desk. The checklist autosaves item by item; completing it records the
 * overall condition and summary, and (for move-ins and move-outs) shares the
 * report with the residents on the lease. A move-out compares every item with
 * the move-in inspection.
 */
export function InspectionPage() {
  const { id = '' } = useParams();
  const ws = useWorkspace();
  const app = useAppActions();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 1024px)');
  const { data, isPending, isError, error, refetch } = useInspection(id);
  const autosave = useInspectionAutosave(id);
  const actions = useInspectionActions(data, autosave.settle);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const i = data?.inspection;
  useDocumentTitle(i ? `${i.type} inspection · ${ws.unitLabel(i.unitId, i.propertyId) || i.title}` : 'Inspection');
  const locked = !i || i.status === 'Completed' || i.status === 'Canceled';

  const complete = async (input: { summary: string; overallCondition: 'Excellent' | 'Good' | 'Fair' | 'Poor'; share: boolean }) => {
    try {
      await autosave.settle();
      if (autosave.errorCount) throw new Error('Some changes didn’t save. Retry them before completing the inspection.');
      const res = await saveInspection({ action: 'complete', id, ...input });
      await qc.invalidateQueries({ queryKey: mk.inspection(id) });
      invalidate(qc, 'inspections', 'messages', 'units', 'leases');
      const notified = 'notified' in res ? Number(res.notified ?? 0) : 0;
      toast.success('Inspection completed', {
        description: notified ? `The report was shared with ${notified === 1 ? 'the resident' : `${notified} residents`}.` : 'Generate the PDF report whenever you’re ready.',
        action: { label: 'Generate PDF', onClick: () => void actions.generateReport() },
      });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t complete the inspection'));
      throw e;
    }
  };

  const reopen = async () => {
    if (!i) return;
    const ok = await app.confirm({
      title: 'Reopen this inspection?',
      description: i.tenantAcknowledgedAt ? 'You can change the checklist again. The resident acknowledged the report, so they’ll need to acknowledge it again once you complete it.' : i.status === 'Canceled' ? 'It goes back on the schedule.' : 'You can change the checklist again, then complete it.',
      confirmLabel: 'Reopen',
    });
    if (!ok) return;
    try {
      await saveInspection({ action: 'reopen', id });
      await qc.invalidateQueries({ queryKey: mk.inspection(id) });
      invalidate(qc, 'inspections');
      toast.success('Inspection reopened');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t reopen the inspection'));
    }
  };

  const cancel = async () => {
    if (!i) return;
    if (!(await app.confirm({ title: 'Cancel this inspection?', description: 'It comes off the schedule and out of the inspector’s list. Anything already rated is kept, and you can reopen it later.', confirmLabel: 'Cancel inspection', destructive: true }))) return;
    try {
      await autosave.settle();
      await saveInspection({ action: 'update', id, patch: { status: 'Canceled' } });
      await qc.invalidateQueries({ queryKey: mk.inspection(id) });
      invalidate(qc, 'inspections');
      toast.success('Inspection canceled');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t cancel the inspection'));
    }
  };

  const remove = async () => {
    if (!i) return;
    if (!(await app.confirm({ title: 'Delete this inspection?', description: 'It hasn’t been started, so nothing is lost but the appointment. This can’t be undone.', confirmLabel: 'Delete inspection', destructive: true }))) return;
    try {
      await saveInspection({ action: 'delete', id });
      qc.removeQueries({ queryKey: mk.inspection(id) });
      invalidate(qc, 'inspections');
      navigate('/inspections');
      toast.success('Inspection deleted');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t delete the inspection'));
    }
  };

  const saveIndicator = i && i.status !== 'Completed' && i.status !== 'Canceled' && (
    <span className="mr-1 hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex" aria-live="polite">
      {autosave.errorCount ? (
        <span className="inline-flex items-center gap-1 text-tone-danger"><AlertTriangle className="h-3.5 w-3.5" /> {autosave.errorCount} not saved</span>
      ) : autosave.saving ? (
        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
      ) : i.stats.rated > 0 ? (
        <><Check className="h-3.5 w-3.5 text-tone-success" /> Saved</>
      ) : null}
    </span>
  );

  const primary = i && (
    i.status === 'Completed' ? (
      <button type="button" onClick={() => void actions.generateReport()} disabled={actions.generating} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-xs hover:bg-accent disabled:opacity-60">
        {actions.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} <span className="hidden sm:inline">{i.reportUrl ? 'Regenerate PDF' : 'Generate PDF'}</span>
      </button>
    ) : i.status === 'Canceled' ? (
      <button type="button" onClick={() => void reopen()} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-xs hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>
    ) : (
      <button type="button" onClick={() => setCompleteOpen(true)} disabled={i.stats.rated === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50">
        <CheckCircle2 className="h-3.5 w-3.5" /> Complete
      </button>
    )
  );

  const header = (
    <PageHeader
      breadcrumb={{ to: '/inspections', label: 'Inspections' }}
      icon={<ClipboardCheck />}
      title={i ? ws.unitLabel(i.unitId, i.propertyId) || i.title : 'Inspection'}
      actions={
        i && (
          <>
            {saveIndicator}
            {!wide && (
              <Tip label="Details">
                <IconButton aria-label="Inspection details" onClick={() => setSheetOpen(true)}><PanelRight /></IconButton>
              </Tip>
            )}
            {primary}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton aria-label="More inspection actions"><MoreHorizontal /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void copyText(appUrl(`/inspections/${id}`), 'Link copied')}><Link2 className="h-3.5 w-3.5" /> Copy link</DropdownMenuItem>
                {i.reportUrl && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => window.open(i.reportUrl!, '_blank', 'noopener')}><FileDown className="h-3.5 w-3.5" /> Open PDF report</DropdownMenuItem>}
                {i.status !== 'Completed' && i.status !== 'Canceled' && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void actions.generateReport()}><FileDown className="h-3.5 w-3.5" /> Preview PDF report</DropdownMenuItem>}
                {i.status === 'Completed' && <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void reopen()}><RotateCcw className="h-3.5 w-3.5" /> Reopen</DropdownMenuItem>}
                {(i.status === 'Scheduled' || i.status === 'In progress') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="h-9 gap-2 text-[14px]" onSelect={() => void cancel()}><Ban className="h-3.5 w-3.5" /> Cancel inspection…</DropdownMenuItem>
                    {i.stats.rated === 0 && <DropdownMenuItem className="h-9 gap-2 text-[14px] text-tone-danger focus:text-tone-danger" onSelect={() => void remove()}><Trash2 className="h-3.5 w-3.5" /> Delete…</DropdownMenuItem>}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )
      }
    />
  );

  if (isPending) {
    return (
      <DetailLayout header={header}>
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton mt-2 h-4 w-1/3" />
        <div className="skeleton mt-6 h-2 w-full rounded-full" />
        <SkeletonRows rows={8} className="mt-6" />
      </DetailLayout>
    );
  }
  if (isError || !data || !i) {
    const missing = /not found|no longer exists/i.test(errorMessage(error, ''));
    return (
      <DetailLayout header={header}>
        <EmptyState icon={<ClipboardCheck />} title={missing ? 'Inspection not found' : 'This inspection didn’t load'} description={errorMessage(error, 'Check your connection and try again.')} action={missing ? <button type="button" className="ghost-chip h-9" onClick={() => navigate('/inspections')}>Back to inspections</button> : <button type="button" className="ghost-chip h-9" onClick={() => void refetch()}>Try again</button>} />
      </DetailLayout>
    );
  }

  const inspector = i.inspectorId ? ws.memberById.get(i.inspectorId) : undefined;
  const rail = <InspectionRail detail={data} actions={actions} onReopen={() => void reopen()} />;

  return (
    <DetailLayout header={header} rail={wide ? rail : undefined}>
      <InspectionTitle value={i.title} onSave={title => void actions.update({ title }).catch(() => undefined)} />
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground">
        <span>{i.type}</span>
        <span aria-hidden>·</span>
        <WhenLabel inspection={i} className="text-[14px]" />
        {data.residents.length > 0 && <><span aria-hidden>·</span><span className="min-w-0 truncate">{data.residents.map(r => r.name).join(', ')}</span></>}
        {inspector && <span className="inline-flex items-center gap-1.5"><span aria-hidden>·</span><MemberAvatar member={inspector} size={16} /> {inspector.name}</span>}
        {!wide && <button type="button" onClick={() => setSheetOpen(true)} className="text-primary hover:underline">Details</button>}
      </div>

      {i.status === 'Canceled' && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-[14px]">
          <Ban className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">This inspection was canceled. Reopen it to put it back on the schedule.</span>
          <button type="button" className="ghost-chip h-9 border-border sm:h-8" onClick={() => void reopen()}><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>
        </div>
      )}
      {i.status === 'Completed' && <CompletionCard detail={data} actions={actions} />}

      <div className="mt-4">
        <InspectionWalkthrough detail={data} autosave={autosave} locked={locked} keyboard={wide && !completeOpen} />
      </div>

      {!locked && (
        <div className="mt-8 flex flex-col items-stretch gap-2 rounded-lg border bg-subtle/60 px-4 py-4 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-[14px] text-muted-foreground">
            {i.stats.rated === i.stats.total ? 'Every item is checked.' : `${i.stats.total - i.stats.rated} of ${i.stats.total} items left.`} {i.stats.issues ? `${i.stats.issues} flagged.` : ''}
          </p>
          <button type="button" onClick={() => setCompleteOpen(true)} disabled={i.stats.rated === 0} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50 sm:h-9 sm:text-[14px]">
            <CheckCircle2 className="h-4 w-4" /> Complete inspection
          </button>
        </div>
      )}

      <SectionHeading className="mt-10">Activity</SectionHeading>
      <Timeline activity={data.activity} emptyText="Nothing has happened on this inspection yet." />

      <CompleteInspectionDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        areas={data.areas}
        baseline={data.baseline?.areas}
        existingSummary={i.summary}
        canShare={Boolean(data.lease)}
        type={i.type}
        residentNames={data.residents.map(r => r.name).join(', ')}
        onComplete={complete}
      />

      {!wide && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="right" className="w-[340px] max-w-[92vw] overflow-y-auto p-0">
            <div className="border-b px-4 py-3">
              <SheetTitle className="text-[15px]">Inspection details</SheetTitle>
              <SheetDescription className="text-sm">{ws.unitLabel(i.unitId, i.propertyId)}</SheetDescription>
            </div>
            {rail}
          </SheetContent>
        </Sheet>
      )}
    </DetailLayout>
  );
}
