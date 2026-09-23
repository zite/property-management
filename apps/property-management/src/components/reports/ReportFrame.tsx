import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, Download, FileDown, Link2, Loader2, Printer } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { reportPdf } from 'zitejs/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { cn } from '@project/components/lib/utils';
import { copyText } from '../../lib/clipboard';
import { errorMessage } from '../../lib/errors';
import { appUrl, dateTime, timeAgo } from '../../lib/format';
import { invalidate } from '../../lib/queries';
import { useWorkspace } from '../../lib/workspace';
import { EmptyState, IconButton, SkeletonRows, Tip } from '../primitives/bits';
import { Money } from '../primitives/data';
import { PageHeader, useDocumentTitle } from '../shell/PageHeader';
import { exportReportCsv, REPORT_ICONS, TrendColumns } from './bits';
import { readUrlState, toInput, type ReportDef } from './catalog';
import { rememberReport, useReport } from './data';
import type { CellTone, ReportDoc, ReportFigure } from './doc';
import { ParamBar, type ParamPatch } from './ParamBar';
import { ReportTable } from './ReportTable';

/**
 * The frame every report renders in: header with export, print and PDF; the
 * parameter bar (kept in the URL so a report link is shareable); headline
 * figures; integrity checks; the report's sections as tables; notes.
 *
 * Printing hides the app shell and the controls and lets the report flow onto
 * paper in the light theme (the rules live in PRINT_CSS below, scoped to this
 * page while it's mounted).
 */

const TONE: Record<CellTone, string> = { danger: 'text-tone-danger', warning: 'text-tone-warning', success: 'text-tone-success', info: 'text-tone-info', muted: 'text-muted-foreground' };

const PRINT_CSS = `
@media print {
  @page { margin: 12mm 10mm; }
  html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
  .h-\\[100dvh\\] { height: auto !important; overflow: visible !important; display: block !important; }
  main { overflow: visible !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important; display: block !important; }
  [data-report-root], [data-report-scroll] { overflow: visible !important; height: auto !important; display: block !important; }
  .bg-canvas { background: #fff !important; }
  [data-sonner-toaster] { display: none !important; }
  [data-report-root] td, [data-report-root] th { height: auto !important; padding-top: 3px !important; padding-bottom: 3px !important; font-size: 10.5px !important; }
  [data-report-root] td .text-sm, [data-report-root] td .text-\\[11\\.5px\\] { font-size: 9.5px !important; }
}`;

/** Paper is white: drop the dark theme for the duration of a print, then restore it. */
function usePrintInLight() {
  useEffect(() => {
    let wasDark = false;
    const before = () => {
      wasDark = document.documentElement.classList.contains('dark');
      if (wasDark) document.documentElement.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) document.documentElement.classList.add('dark');
      wasDark = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

export function ReportView({ def }: { def: ReportDef }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const state = useMemo(() => readUrlState(def, search, ws.today), [def, search, ws.today]);
  const input = useMemo(() => toInput(def, state), [def, state]);
  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData, dataUpdatedAt } = useReport(def.key, input);
  useDocumentTitle(def.title);
  usePrintInLight();

  useEffect(() => {
    rememberReport(def.key, search.toString());
  }, [def.key, search]);

  const update = (patch: ParamPatch) =>
    setSearch(
      prev => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  const reset = () => setSearch(new URLSearchParams(), { replace: true });
  const dirty = [...search.keys()].length > 0;
  const clearFilters = state.propertyIds.length ? () => update({ properties: null, page: null }) : undefined;

  const pdf = useMutation({
    mutationFn: () => reportPdf({ report: def.key, params: input }),
    onSuccess: res => {
      if (res.documentId) invalidate(qc, 'documents', 'owners');
      // A "noopener" feature string makes window.open return null, so detach the opener by hand to know whether a popup blocker stopped it.
      const opened = window.open(res.url, '_blank');
      if (opened) opened.opener = null;
      toast.success(res.documentId ? 'PDF saved to the owner’s documents' : 'Your PDF is ready', {
        description: res.documentId ? 'It isn’t shared with the owner until you share it from their page.' : res.filename,
        action: opened ? undefined : { label: 'Open', onClick: () => window.open(res.url, '_blank', 'noopener') },
      });
    },
    onError: e => toast.error(errorMessage(e, 'The PDF couldn’t be made. Try again.')),
  });

  const sections = data?.sections ?? [];
  const exportable = sections.filter(s => s.rows.length || s.totals);

  const actions = (
    <>
      {isFetching && !isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Updating" />}
      <Tip label="Copy link to this report">
        <IconButton aria-label="Copy link to this report" onClick={() => void copyText(appUrl(`${location.pathname}${location.search}`), 'Link copied')}>
          <Link2 />
        </IconButton>
      </Tip>
      {exportable.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ghost-chip h-8 text-[13.5px]" disabled={!data}>
              <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Export CSV</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-sm font-normal text-muted-foreground">Export as CSV</DropdownMenuLabel>
            <DropdownMenuItem className="h-9 text-[14px]" onSelect={() => data && exportReportCsv(data)}>Whole report</DropdownMenuItem>
            <DropdownMenuSeparator />
            {exportable.map(s => (
              <DropdownMenuItem key={s.id} className="h-9 text-[14px]" onSelect={() => data && exportReportCsv(data, s.id)}>
                <span className="truncate">{s.title ?? 'Table'}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Tip label="Export CSV">
          <button type="button" className="ghost-chip h-8 text-[13.5px] disabled:opacity-50" disabled={!data} onClick={() => data && exportReportCsv(data)}>
            <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Export CSV</span>
          </button>
        </Tip>
      )}
      <Tip label="Print">
        <button type="button" className="ghost-chip h-8 text-[13.5px] disabled:opacity-50" disabled={!data} onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Print</span>
        </button>
      </Tip>
      <button
        type="button"
        onClick={() => pdf.mutate()}
        disabled={!data || pdf.isPending}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[13.5px] font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-60"
      >
        {pdf.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{pdf.isPending ? 'Preparing PDF…' : 'Save PDF'}</span>
      </button>
    </>
  );

  const page = data?.page && data.page.pages > 1 ? data.page : null;
  const pager = page ? (
    <div className="flex items-center gap-1 text-sm text-muted-foreground">
      <span className="num hidden sm:inline">
        Lines {((page.page - 1) * page.pageSize + 1).toLocaleString()}–{Math.min(page.totalRows, page.page * page.pageSize).toLocaleString()} of {page.totalRows.toLocaleString()}
      </span>
      <IconButton size="sm" aria-label="Previous page" disabled={page.page <= 1} onClick={() => update({ page: page.page - 1 > 1 ? String(page.page - 1) : null })}>
        <ChevronLeft />
      </IconButton>
      <span className="num">
        {page.page} / {page.pages}
      </span>
      <IconButton size="sm" aria-label="Next page" disabled={page.page >= page.pages} onClick={() => update({ page: String(page.page + 1) })}>
        <ChevronRight />
      </IconButton>
    </div>
  ) : null;

  let body: ReactNode;
  if (isPending) body = <ReportSkeleton />;
  else if (isError || !data) {
    body = (
      <EmptyState
        className="py-20"
        icon={<BarChart3 />}
        title="This report didn’t load"
        description={errorMessage(error, 'Something went wrong while building it. Try again in a moment.')}
        action={
          <div className="flex gap-2">
            <button type="button" className="ghost-chip h-9 border-border bg-background" onClick={() => void refetch()}>Try again</button>
            {dirty && <button type="button" className="ghost-chip h-9" onClick={reset}>Reset parameters</button>}
          </div>
        }
      />
    );
  } else {
    body = <ReportBody doc={data} onClearFilters={clearFilters} pager={pager} stale={isPlaceholderData} updatedAt={dataUpdatedAt} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-report-root>
      <style>{PRINT_CSS}</style>
      <PageHeader className="print:hidden" icon={REPORT_ICONS[def.key] ?? <BarChart3 />} breadcrumb={{ to: '/reports', label: 'Reports' }} title={def.title} actions={actions} />
      <ParamBar def={def} state={state} today={ws.today} resolvedOwnerId={data?.resolved?.ownerId} onChange={update} onReset={reset} dirty={dirty} fetching={isFetching} end={pager} />
      <div data-report-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1480px] px-3 pb-24 pt-4 sm:px-5 print:max-w-none print:p-0">{body}</div>
      </div>
    </div>
  );
}

function FigureValue({ f }: { f: ReportFigure }) {
  const tone = f.tone ? TONE[f.tone] : undefined;
  if (f.value == null || f.value === '') return <span className="text-muted-foreground/70">—</span>;
  if (f.kind === 'money') return <Money value={Number(f.value)} className={tone} />;
  if (f.kind === 'percent') return <span className={cn('num', tone)}>{Number(f.value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%</span>;
  if (f.kind === 'days') return <span className={cn('num', tone)}>{Number(f.value).toLocaleString('en-US', { maximumFractionDigits: 1 })} <span className="text-[14px] font-normal text-muted-foreground">{Number(f.value) === 1 ? 'day' : 'days'}</span></span>;
  return <span className={cn('num', tone)}>{typeof f.value === 'number' ? f.value.toLocaleString('en-US') : f.value}</span>;
}

const LG_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1 print:grid-cols-1',
  2: 'lg:grid-cols-2 print:grid-cols-2',
  3: 'lg:grid-cols-3 print:grid-cols-3',
  4: 'lg:grid-cols-4 print:grid-cols-4',
  5: 'lg:grid-cols-5 print:grid-cols-5',
  6: 'lg:grid-cols-6 print:grid-cols-6',
};

function ReportBody({ doc, onClearFilters, pager, stale, updatedAt }: { doc: ReportDoc; onClearFilters?: () => void; pager: ReactNode; stale: boolean; updatedAt: number }) {
  const ws = useWorkspace();
  const odd = doc.figures.length % 2 === 1;
  return (
    <div className={cn('space-y-5 transition-opacity print:space-y-3', stale && 'opacity-60')} aria-busy={stale}>
      {/* On paper the header is the report's letterhead. */}
      <div className="hidden border-b-2 border-foreground pb-2 print:block">
        <div className="text-[12px] text-muted-foreground">{doc.organizationName}</div>
        <div className="text-[20px] font-semibold tracking-tight">{doc.title}</div>
        <div className="flex justify-between gap-4 text-[13px]">
          <span>{doc.subtitle}</span>
          <span className="text-muted-foreground">Generated {dateTime(doc.generatedAt)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 print:hidden">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-[16px] font-semibold tracking-tight">{doc.title}</h2>
          <span className="text-[14px] text-muted-foreground">{doc.subtitle}</span>
        </div>
        <span className="text-sm text-muted-foreground" title={dateTime(doc.generatedAt)}>
          Updated {timeAgo(new Date(updatedAt || Date.parse(doc.generatedAt)).toISOString())}
        </span>
      </div>

      {doc.figures.length > 0 && (
        <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3', LG_COLS[Math.min(6, doc.figures.length)])}>
          {doc.figures.map((f, i) => (
            <div key={f.label} className={cn('min-w-0 bg-card px-4 py-3 print:px-2 print:py-1.5', odd && i === doc.figures.length - 1 && 'col-span-2 sm:col-span-1')}>
              <div className="truncate text-sm text-muted-foreground">{f.label}</div>
              <div className="mt-0.5 truncate text-[18px] font-semibold leading-7 tracking-tight print:text-[15px] print:leading-5">
                <FigureValue f={f} />
              </div>
              {f.hint && <div className="truncate text-sm text-muted-foreground" title={f.hint}>{f.hint}</div>}
            </div>
          ))}
        </div>
      )}

      {doc.checks.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card" aria-label="Checks">
          {doc.checks.map(c => (
            <li key={c.label} className="flex items-start gap-2.5 px-3 py-2 text-[14px]">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-tone-success" aria-label="Passed" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tone-danger" aria-label="Needs attention" />}
              <p className="min-w-0">
                <span className={cn('font-medium', !c.ok && 'text-tone-danger')}>{c.label}.</span> <span className="text-muted-foreground">{c.detail}</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {doc.warnings.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-tone-warning/30 bg-tone-warning/10 px-3 py-2 text-[14px] text-tone-warning">
          {doc.warnings.map(w => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {doc.chart && doc.chart.points.length > 0 && <TrendColumns chart={doc.chart} format={v => (doc.chart!.kind === 'percent' ? `${Math.round(v * 10) / 10}%` : ws.money(v, { compact: true }))} />}

      {doc.sections.map(s => (
        <section key={s.id} className="space-y-2" aria-label={s.title ?? doc.title}>
          {(s.title || s.description) && (
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-0.5">
              <div className="min-w-0">
                {s.title && <h3 className="text-[14.5px] font-medium">{s.title}</h3>}
                {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
              </div>
              {s.sortable && s.rows.length > 0 && <span className="num text-sm text-muted-foreground print:hidden">{s.rows.length.toLocaleString()} {s.rows.length === 1 ? 'row' : 'rows'}</span>}
            </div>
          )}
          <ReportTable section={s} onClearFilters={onClearFilters} />
        </section>
      ))}

      {pager && <div className="flex justify-end print:hidden">{pager}</div>}

      {doc.notes.length > 0 && (
        <div className="space-y-1 border-t pt-3 text-sm text-muted-foreground">
          {doc.notes.map(n => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading report">
      <div className="flex items-baseline gap-3">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-3 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card px-4 py-3">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-2 h-5 w-28" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="h-9 border-b bg-subtle" />
        <SkeletonRows rows={10} />
      </div>
    </div>
  );
}
