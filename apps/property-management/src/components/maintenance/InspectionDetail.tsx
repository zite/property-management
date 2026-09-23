import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ClipboardCheck, ExternalLink, FileDown, FileSignature, Loader2, RotateCcw, Share2, UserRound, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { inspectionReportPdf, saveInspection, type SaveInspectionInputType } from 'zitejs/api';
import { cn } from '@project/components/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@project/components/ui/popover';
import { Switch } from '@project/components/ui/switch';
import { CONDITIONS, INSPECTION_TYPES, type Role } from '@project/shared/constants';
import { workOrderRef } from '@project/shared/leases';
import { can } from '@project/shared/roles';
import { useAppActions } from '../../lib/app-actions';
import { errorMessage } from '../../lib/errors';
import { dateTime, shortDate, shortDateTime } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { RailRow, RailSection } from '../detail/DetailLayout';
import { DateTimeInput } from '../form/fields';
import { ChoicePicker, MemberPicker, RecordSearchPicker } from '../pickers/pickers';
import { MemberAvatar, UnassignedAvatar } from '../primitives/Avatar';
import { Tip } from '../primitives/bits';
import { Pill, PropertySwatch, WorkOrderStatusGlyph } from '../primitives/glyphs';
import { ConditionPill, InspectionStatusGlyph } from './bits';
import { INSPECTION_STATUS_TONE, mk, type InspectionDetail } from './data';

const chip = 'ghost-chip h-8 max-w-full justify-start gap-1.5 px-1.5 text-[14px] [&_svg]:shrink-0';
type Patch = Extract<SaveInspectionInputType, { action: 'update' }>['patch'];

/** Inspection writes that aren't item autosaves: details, completion, sharing, the PDF. */
export function useInspectionActions(detail: InspectionDetail | undefined, settle: () => Promise<void>) {
  const qc = useQueryClient();
  const id = detail?.inspection.id ?? '';
  /** Refetch the open inspection only once every autosave has landed, so nothing typed is overwritten. */
  const refresh = async () => {
    await settle();
    await qc.invalidateQueries({ queryKey: mk.inspection(id) });
  };

  const update = async (patch: Patch, message?: string) => {
    if (!detail) return;
    const key = mk.inspection(id);
    const prev = qc.getQueryData<InspectionDetail>(key);
    qc.setQueryData<InspectionDetail>(key, old => (old ? { ...old, inspection: { ...old.inspection, ...patch } } : old));
    try {
      await saveInspection({ action: 'update', id, patch });
      if (message) toast.success(message);
      if (patch.leaseId !== undefined || patch.type) await refresh();
      void qc.invalidateQueries({ queryKey: mk.inspectionLists });
    } catch (e) {
      if (prev) qc.setQueryData(key, prev);
      toast.error(errorMessage(e, 'Couldn’t update the inspection'));
      throw e;
    }
  };

  const share = async (shared: boolean) => {
    if (!detail) return;
    try {
      const res = await saveInspection({ action: 'share', id, shared });
      await refresh();
      void qc.invalidateQueries({ queryKey: mk.inspectionLists });
      invalidate(qc, 'messages');
      const notified = 'notified' in res ? Number(res.notified ?? 0) : 0;
      toast.success(shared ? (notified ? `Shared — ${notified === 1 ? 'the resident was' : `${notified} residents were`} notified` : detail.inspection.status === 'Completed' ? 'Shared with residents' : 'Residents will see the report once it’s complete') : 'No longer shared with residents');
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t change sharing'));
    }
  };

  const [generating, setGenerating] = useState(false);
  const generateReport = async () => {
    if (!detail || generating) return;
    setGenerating(true);
    try {
      await settle();
      const res = await inspectionReportPdf({ id });
      qc.setQueryData<InspectionDetail>(mk.inspection(id), old => (old ? { ...old, inspection: { ...old.inspection, reportUrl: res.url } } : old));
      void qc.invalidateQueries({ queryKey: mk.inspectionLists });
      invalidate(qc, 'documents');
      toast.success('Report ready', { description: 'Saved to the unit’s documents.', action: { label: 'Open', onClick: () => window.open(res.url, '_blank', 'noopener') } });
    } catch (e) {
      toast.error(errorMessage(e, 'Couldn’t generate the report'));
    } finally {
      setGenerating(false);
    }
  };

  return { update, share, generateReport, generating, refresh };
}

/** Title that edits in place. */
export function InspectionTitle({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly?: boolean }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      readOnly={readOnly}
      aria-label="Inspection title"
      onChange={e => setText(e.target.value.replace(/\n/g, ''))}
      onBlur={() => {
        const next = text.trim();
        if (!next) return setText(value);
        if (next !== value) onSave(next);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        if (e.key === 'Escape') { setText(value); (e.target as HTMLTextAreaElement).blur(); }
      }}
      maxLength={200}
      className="-mx-1.5 block w-full resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-1 text-[20px] font-semibold leading-7 tracking-tight outline-none focus:bg-accent/30 sm:text-[22px] sm:leading-8"
    />
  );
}

/** The properties rail (a sheet on phones): schedule, people, lease, report and sharing, work orders raised. */
export function InspectionRail({ detail, actions, onReopen }: { detail: InspectionDetail; actions: ReturnType<typeof useInspectionActions>; onReopen: () => void }) {
  const ws = useWorkspace();
  const app = useAppActions();
  const i = detail.inspection;
  const [whenOpen, setWhenOpen] = useState(false);
  const [leaseSearch, setLeaseSearch] = useState(false);
  const inspector = i.inspectorId ? ws.memberById.get(i.inspectorId) : undefined;
  const property = i.propertyId ? ws.propertyById.get(i.propertyId) : undefined;
  const unit = i.unitId ? ws.unitById.get(i.unitId) : undefined;
  const closed = i.status === 'Completed' || i.status === 'Canceled';
  const patch = (p: Patch, message?: string) => void actions.update(p, message).catch(() => undefined);

  return (
    <>
      <RailSection>
        <RailRow label="Status">
          <span className="flex items-center gap-1.5 px-1.5 text-[14px]"><InspectionStatusGlyph status={i.status} /> {i.status}</span>
        </RailRow>
        <RailRow label="Type">
          <ChoicePicker options={INSPECTION_TYPES} value={i.type as (typeof INSPECTION_TYPES)[number]} onChange={type => patch({ type }, `Changed to a ${type.toLowerCase()} inspection`)} align="end" disabled={i.status === 'Completed'} trigger={<button type="button" className={chip}><ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" /> {i.type}</button>} />
        </RailRow>
        <RailRow label={i.status === 'Completed' ? 'Scheduled' : 'When'}>
          <Popover open={whenOpen} onOpenChange={setWhenOpen}>
            <PopoverTrigger asChild>
              <button type="button" className={chip} disabled={closed}><CalendarClock className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{i.scheduledFor ? shortDateTime(i.scheduledFor).replace(/^\w+, /, '') : 'Not scheduled'}</span></button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="mb-2 text-sm font-medium">Reschedule</p>
              <DateTimeInput value={i.scheduledFor} onChange={v => v && patch({ scheduledFor: v }, `Rescheduled for ${shortDateTime(v)}`)} />
              <button type="button" onClick={() => setWhenOpen(false)} className="mt-2 w-full rounded-md border py-1.5 text-sm hover:bg-accent">Done</button>
            </PopoverContent>
          </Popover>
        </RailRow>
        {i.completedAt && <RailRow label="Completed"><Tip label={dateTime(i.completedAt)}><span className="px-1.5 text-[14px]">{shortDateTime(i.completedAt).replace(/^\w+, /, '')}</span></Tip></RailRow>}
        <RailRow label="Inspector">
          <MemberPicker
            value={i.inspectorId}
            onChange={inspectorId => patch({ inspectorId })}
            filter={m => can(m.role as Role, 'maintenance.manage')}
            noneLabel="No inspector"
            align="end"
            trigger={<button type="button" className={chip}>{inspector ? <><MemberAvatar member={inspector} size={18} /> <span className="truncate">{inspector.name}</span></> : <><UnassignedAvatar size={18} /> <span className="text-muted-foreground">No inspector</span></>}</button>}
          />
        </RailRow>
        {i.overallCondition && <RailRow label="Overall"><span className="px-1.5"><ConditionPill condition={i.overallCondition} /></span></RailRow>}
      </RailSection>

      <RailSection title="Location">
        <RailRow label="Property">{property ? <Link to={`/properties/${property.id}`} className={chip}><PropertySwatch color={property.color} /> <span className="truncate">{property.name}</span></Link> : <span className="px-1.5 text-muted-foreground">—</span>}</RailRow>
        <RailRow label="Unit">{unit ? <Link to={`/units/${unit.id}`} className={chip}><span className="truncate">{unit.name}</span></Link> : <span className="px-1.5 text-muted-foreground">—</span>}</RailRow>
      </RailSection>

      <RailSection
        title="Lease"
        action={
          i.status !== 'Completed' && unit ? (
            <RecordSearchPicker
              kinds={['leases']}
              value={i.leaseId}
              open={leaseSearch}
              onOpenChange={setLeaseSearch}
              onChange={hit => hit && patch({ leaseId: hit.id }, 'Lease linked')}
              placeholder={`Leases for ${ws.unitLabel(unit.id)}…`}
              align="end"
              trigger={<button type="button" className="text-sm text-muted-foreground hover:text-foreground">{i.leaseId ? 'Change' : 'Link lease'}</button>}
            />
          ) : undefined
        }
      >
        {detail.lease ? (
          <>
            <Link to={`/leases/${detail.lease.id}`} className={cn(chip, 'font-medium')}><FileSignature className="h-3.5 w-3.5 text-muted-foreground" /> <span className="truncate">{detail.lease.name || 'Lease'}</span></Link>
            {detail.residents.map(r => (
              <Link key={r.id} to={`/residents/${r.id}`} className={cn(chip, 'text-muted-foreground')}><UserRound className="h-3.5 w-3.5" /> <span className="truncate">{r.name}</span></Link>
            ))}
            {detail.lease.moveOutDate && <p className="px-1.5 text-sm text-muted-foreground">Moving out {shortDate(detail.lease.moveOutDate)}</p>}
          </>
        ) : (
          <p className="px-1.5 text-[14px] text-muted-foreground">{i.type === 'Move-in' || i.type === 'Move-out' ? 'Link the lease so residents can acknowledge the report.' : 'Not linked to a lease.'}</p>
        )}
        {detail.related && (
          <Link to={`/inspections/${detail.related.id}`} className={cn(chip, 'mt-1 text-muted-foreground')}><ExternalLink className="h-3.5 w-3.5" /> <span className="truncate">{detail.related.type} inspection · {detail.related.status.toLowerCase()}</span></Link>
        )}
      </RailSection>

      <RailSection title="Report">
        {i.reportUrl ? (
          <a href={i.reportUrl} target="_blank" rel="noreferrer" className={chip}><FileDown className="h-3.5 w-3.5 text-muted-foreground" /> Open PDF report</a>
        ) : null}
        {i.status !== 'Canceled' && (
          <button type="button" onClick={() => void actions.generateReport()} disabled={actions.generating} className={cn(chip, 'text-muted-foreground hover:text-foreground')}>
            {actions.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} {actions.generating ? 'Generating…' : i.reportUrl ? 'Regenerate PDF' : 'Generate PDF'}
          </button>
        )}
        <RailRow label="Residents">
          <label className={cn('flex h-8 items-center gap-2 px-1.5 text-[14px]', detail.lease ? 'cursor-pointer' : 'opacity-60')}>
            <Switch checked={i.sharedWithTenant} disabled={!detail.lease} onCheckedChange={v => void actions.share(v)} className="scale-90" aria-label="Share with residents" />
            <span>{i.sharedWithTenant ? 'Shared' : 'Not shared'}</span>
          </label>
        </RailRow>
        {i.sharedWithTenant && i.status === 'Completed' && (
          <p className={cn('flex items-center gap-1.5 px-1.5 text-sm', i.tenantAcknowledgedAt ? 'text-tone-success' : 'text-muted-foreground')}>
            {i.tenantAcknowledgedAt ? <><CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged {shortDate(i.tenantAcknowledgedAt)}</> : <><Share2 className="h-3.5 w-3.5" /> Waiting for the resident to acknowledge</>}
          </p>
        )}
        {i.sharedWithTenant && i.status !== 'Completed' && <p className="px-1.5 text-sm text-muted-foreground">Residents see it once it’s complete.</p>}
      </RailSection>

      <RailSection title="Work orders" action={detail.workOrders.length ? <span className="text-sm tabular-nums text-muted-foreground">{detail.workOrders.length}</span> : undefined}>
        {detail.workOrders.length ? (
          detail.workOrders.map(w => (
            <Link key={w.number} to={`/work-orders/${w.number}`} className={chip}><WorkOrderStatusGlyph status={w.status} /> <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{workOrderRef(w.number)}</span> <span className="truncate">{w.title}</span></Link>
          ))
        ) : (
          <p className="px-1.5 text-[14px] text-muted-foreground">Flag an item as poor, damaged or missing to raise one.</p>
        )}
        {i.unitId && ws.can('maintenance.create') && (
          <button type="button" onClick={() => app.openCreate('workOrder', { propertyId: i.propertyId, unitId: i.unitId, source: 'Inspection', inspectionId: i.id })} className={cn(chip, 'mt-1 text-muted-foreground hover:text-foreground')}><Wrench className="h-3.5 w-3.5" /> New work order</button>
        )}
      </RailSection>

      {i.status === 'Completed' && (
        <RailSection>
          <button type="button" onClick={onReopen} className={cn(chip, 'text-muted-foreground hover:text-foreground')}><RotateCcw className="h-3.5 w-3.5" /> Reopen inspection</button>
        </RailSection>
      )}
    </>
  );
}

/** What a completed inspection concluded: overall condition and summary (editable), plus the report actions. */
export function CompletionCard({ detail, actions }: { detail: InspectionDetail; actions: ReturnType<typeof useInspectionActions> }) {
  const i = detail.inspection;
  const [summary, setSummary] = useState(i.summary);
  useEffect(() => setSummary(i.summary), [i.summary]);
  return (
    <section className="mt-5 rounded-lg border bg-card shadow-2xs">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <CheckCircle2 className="h-4 w-4 text-tone-success" />
        <span className="text-[14px] font-medium">Completed{i.completedAt ? ` ${shortDateTime(i.completedAt)}` : ''}</span>
        <span className="ml-auto flex items-center gap-1">
          {CONDITIONS.map(c => (
            <button key={c} type="button" onClick={() => c !== i.overallCondition && void actions.update({ overallCondition: c }, `Overall condition set to ${c}`).catch(() => undefined)} className={cn('h-6 rounded-[5px] px-1.5 text-[12.5px] font-medium transition-colors', i.overallCondition === c ? 'bg-accent text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              {c}
            </button>
          ))}
        </span>
      </div>
      <textarea
        value={summary}
        onChange={e => setSummary(e.target.value)}
        onBlur={() => summary !== i.summary && void actions.update({ summary }).catch(() => undefined)}
        rows={Math.min(8, Math.max(2, summary.split('\n').length))}
        placeholder="Add a summary for the report…"
        className="block w-full resize-y bg-transparent px-4 py-3 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
        maxLength={10000}
      />
      <div className="flex flex-wrap items-center gap-2 border-t bg-subtle/50 px-4 py-2.5">
        {i.reportUrl && <a href={i.reportUrl} target="_blank" rel="noreferrer" className="ghost-chip h-9 gap-1.5 border-border bg-background text-[14px] sm:h-8"><FileDown className="h-3.5 w-3.5" /> Open report</a>}
        <button type="button" onClick={() => void actions.generateReport()} disabled={actions.generating} className="ghost-chip h-9 gap-1.5 border-border bg-background text-[14px] sm:h-8">
          {actions.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} {i.reportUrl ? 'Regenerate PDF' : 'Generate PDF'}
        </button>
        {detail.lease && (
          <button type="button" onClick={() => void actions.share(!i.sharedWithTenant)} className="ghost-chip h-9 gap-1.5 border-border bg-background text-[14px] sm:h-8">
            <Share2 className="h-3.5 w-3.5" /> {i.sharedWithTenant ? 'Stop sharing' : 'Share with residents'}
          </button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {i.sharedWithTenant ? (i.tenantAcknowledgedAt ? <span className="text-tone-success">Acknowledged by the resident {shortDate(i.tenantAcknowledgedAt)}</span> : 'Shared · not acknowledged yet') : detail.lease ? 'Not shared with residents' : ''}
        </span>
      </div>
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={INSPECTION_STATUS_TONE[status] ?? 'neutral'}>{status}</Pill>;
}
