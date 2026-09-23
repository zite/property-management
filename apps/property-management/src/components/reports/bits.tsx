import {
  ArrowLeftRight, BookOpen, Building2, CalendarClock, ClipboardList, DoorOpen, FileText, Filter, HandCoins, Hourglass, ListChecks, PiggyBank, Receipt, Scale, TrendingUp, Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@project/components/lib/utils';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import type { ReportChart, ReportDoc, ReportSection } from './doc';

export const REPORT_ICONS: Record<string, ReactNode> = {
  'income-statement': <TrendingUp />,
  'balance-sheet': <Scale />,
  'cash-flow': <ArrowLeftRight />,
  'trial-balance': <ListChecks />,
  'general-ledger': <BookOpen />,
  'owner-statement': <FileText />,
  'rent-roll': <ClipboardList />,
  aging: <Hourglass />,
  payments: <HandCoins />,
  deposits: <PiggyBank />,
  vacancy: <DoorOpen />,
  'lease-expirations': <CalendarClock />,
  'leasing-funnel': <Filter />,
  'work-orders': <Wrench />,
  'vendor-spend': <Receipt />,
  occupancy: <Building2 />,
};

// ── CSV ──────────────────────────────────────────────────────────────────────

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';

function sectionRows(section: ReportSection) {
  const rowOf = (r: ReportSection['rows'][number]) =>
    section.columns.map((c, i) => {
      const v = r.cells[c.key];
      if (v == null || v === '') return r.pills?.[c.key]?.label ?? '';
      return i === 0 && r.depth ? `${'  '.repeat(r.depth)}${v}` : v;
    });
  const rows = section.rows.map(rowOf);
  if (section.totals) rows.push(rowOf(section.totals));
  return rows;
}

/**
 * Export a report as CSV: raw numbers (no currency symbols), ISO dates. One
 * section exports as a plain table; the whole report exports each section
 * under its title, separated by a blank line.
 */
export function exportReportCsv(doc: ReportDoc, sectionId?: string) {
  const date = new Date().toISOString().slice(0, 10);
  const sections = sectionId ? doc.sections.filter(s => s.id === sectionId) : doc.sections;
  if (sections.length === 1) {
    const s = sections[0];
    const name = s.title && doc.sections.length > 1 ? `${doc.title} ${s.title}` : doc.title;
    downloadText(`${slug(name)}-${date}.csv`, `﻿${toCsv(s.columns.map(c => c.label || 'Line'), sectionRows(s))}`);
    return;
  }
  const blocks = [toCsv([doc.title], [[doc.subtitle]])];
  for (const s of sections) {
    const heading = s.title ? `${toCsv([s.title], [])}\r\n` : '';
    blocks.push(heading + toCsv(s.columns.map(c => c.label || 'Line'), sectionRows(s)));
  }
  downloadText(`${slug(doc.title)}-${date}.csv`, `﻿${blocks.join('\r\n\r\n')}`);
}

// ── Chart ────────────────────────────────────────────────────────────────────

/**
 * A single-series column chart for a short trend (12 months of occupancy).
 * One hue, thin columns with rounded tops on a quiet baseline, a direct label
 * on the latest value and a tooltip per column; the section below it is the
 * table view of the same numbers.
 */
export function TrendColumns({ chart, format }: { chart: ReportChart; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = chart.kind === 'percent' ? 100 : Math.max(1, ...chart.points.map(p => p.value));
  const last = chart.points.length - 1;
  return (
    <figure className="rounded-lg border bg-card px-4 pb-3 pt-3 print:break-inside-avoid">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium">{chart.title}</span>
        <span className="num text-sm text-muted-foreground">{hover != null ? `${chart.points[hover].label}: ${format(chart.points[hover].value)}` : `Now ${format(chart.points[last]?.value ?? 0)}`}</span>
      </figcaption>
      <div className="relative mt-3 h-28" role="img" aria-label={`${chart.title}: ${chart.points.map(p => `${p.label} ${format(p.value)}`).join(', ')}`}>
        {[0.5, 1].map(f => (
          <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -top-2 right-0 translate-y-[-50%] bg-card pl-1 text-2xs text-muted-foreground">{format(max * f)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-foreground/20 pr-9">
          {chart.points.map((p, i) => (
            <div key={i} className="group relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div
                className={cn('w-full max-w-[28px] rounded-t-[4px] transition-colors', i === last ? 'bg-primary' : 'bg-primary/55', hover === i && 'bg-primary')}
                style={{ height: `${Math.max(p.value > 0 ? 2 : 0, (p.value / max) * 100)}%` }}
              />
              {hover === i && <div className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-sm text-popover-foreground shadow-md">{p.label} · {format(p.value)}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex gap-[2px] pr-9">
        {chart.points.map((p, i) => (
          <span key={i} className={cn('flex-1 text-center text-2xs text-muted-foreground', i % 2 === 1 && 'invisible sm:visible')}>{p.label}</span>
        ))}
      </div>
    </figure>
  );
}
