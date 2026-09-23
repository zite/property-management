import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { fullDate } from '../../lib/format';
import { DataTable, type Column } from '../list/DataTable';
import { Money } from '../primitives/data';
import { Pill } from '../primitives/glyphs';
import type { CellTone, ReportColumn, ReportRow, ReportSection } from './doc';

/**
 * One report section as a DataTable: typed cells (money through <Money>,
 * dates, percents), group headings, subtotal and total rows, drill-down links
 * and status pills. Statements keep their row order; flat lists sort.
 */

const NUMERIC = new Set(['money', 'number', 'percent', 'days']);

const TONE_CLASS: Record<CellTone, string> = {
  danger: 'text-tone-danger',
  warning: 'text-tone-warning',
  success: 'text-tone-success',
  info: 'text-tone-info',
  muted: 'text-muted-foreground',
};

const ROW_CLASS: Record<string, string> = {
  data: '[&>td:first-child]:bg-card hover:[&>td:first-child]:shadow-[inset_0_0_0_999px_hsl(var(--accent)/0.4)]',
  group: 'font-medium [&>td]:bg-muted hover:[&>td]:bg-muted [&>td]:pt-1.5',
  subtotal: 'font-medium [&>td]:border-t [&>td]:border-t-border [&>td:first-child]:bg-card hover:[&>td:first-child]:shadow-[inset_0_0_0_999px_hsl(var(--accent)/0.4)]',
  total: 'font-semibold [&>td]:bg-subtle [&>td]:border-t [&>td]:border-t-foreground/25',
};

const fmtNumber = (v: number, digits = 0) => v.toLocaleString('en-US', { maximumFractionDigits: digits });

function formatValue(col: ReportColumn, value: string | number | null | undefined, tone: string | undefined, kind: ReportRow['kind'], hasHint: boolean): ReactNode {
  const empty = value == null || value === '';
  if (empty) return (kind && kind !== 'data') || hasHint ? null : NUMERIC.has(col.kind) || col.kind === 'date' ? <span className="text-muted-foreground/60">—</span> : null;
  switch (col.kind) {
    case 'money':
      return <Money value={Number(value)} className={tone} muted0 cents={!col.wholeDollars || Math.round(Number(value) * 100) % 100 !== 0} />;
    case 'percent':
      return <span className={cn('num', tone)}>{fmtNumber(Number(value), 1)}%</span>;
    case 'number':
      return <span className={cn('num', tone)}>{fmtNumber(Number(value))}</span>;
    case 'days':
      return <span className={cn('num', tone)}>{fmtNumber(Number(value), 1)}</span>;
    case 'date':
      return <span className={cn('whitespace-nowrap tabular-nums', tone)}>{fullDate(String(value))}</span>;
    default:
      return <span className={tone}>{String(value)}</span>;
  }
}

export function ReportCell({ row, col, first }: { row: ReportRow; col: ReportColumn; first?: boolean }) {
  const tone = row.tones?.[col.key] ? TONE_CLASS[row.tones[col.key]!] : undefined;
  const pill = row.pills?.[col.key];
  const hint = row.hints?.[col.key];
  const link = row.links?.[col.key];
  const numeric = NUMERIC.has(col.kind);
  let content = pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : formatValue(col, row.cells[col.key], tone, row.kind, Boolean(hint));
  if (link && content != null) {
    content = (
      <Link to={link} onClick={e => e.stopPropagation()} className="rounded-sm underline-offset-2 decoration-muted-foreground/40 hover:underline focus-visible:underline print:no-underline">
        {content}
      </Link>
    );
  }
  if (numeric) {
    return (
      <span className="whitespace-nowrap">
        {hint && <span className="mr-1.5 text-sm font-normal text-muted-foreground">{hint}</span>}
        {content}
      </span>
    );
  }
  const text = typeof row.cells[col.key] === 'string' ? (row.cells[col.key] as string) : undefined;
  return (
    <span className={cn('flex min-w-0 items-center gap-2', first && row.depth ? (row.depth > 1 ? 'pl-8' : 'pl-4') : '')} title={text && text.length > 32 ? text : undefined}>
      <span className={cn('min-w-0', pill ? 'shrink-0' : 'truncate')}>{content}</span>
      {hint && <span className="hidden min-w-0 truncate text-sm font-normal text-muted-foreground sm:inline">{hint}</span>}
    </span>
  );
}

const sortValue = (row: ReportRow, col: ReportColumn) => {
  const v = row.cells[col.key];
  if (v == null || v === '') return row.pills?.[col.key]?.label ?? null;
  return NUMERIC.has(col.kind) ? Number(v) : String(v);
};

export function ReportTable({ section, onClearFilters }: { section: ReportSection; onClearFilters?: () => void }) {
  const columns = useMemo<Column<ReportRow>[]>(
    () =>
      section.columns.filter(c => !c.exportOnly).map((c, i) => ({
        key: c.key,
        header: c.label,
        align: NUMERIC.has(c.kind) ? 'right' : 'left',
        width: c.width,
        hideBelow: c.hideBelow,
        // The first column stays put while wide statements scroll sideways — from tablet width up; on a phone it would cover the numbers.
        className: cn(
          i === 0 && 'max-w-[190px] sm:sticky sm:left-0 sm:z-[1] sm:max-w-[380px] print:static print:max-w-none',
          // Long free text (memos, titles) truncates with a tooltip instead of widening the table.
          i > 0 && c.kind === 'text' && 'max-w-[300px] print:max-w-none',
          'print:table-cell',
        ),
        sort: section.sortable ? (r: ReportRow) => sortValue(r, c) : undefined,
        cell: (r: ReportRow) => <ReportCell row={r} col={c} first={i === 0} />,
        footer: section.totals ? <ReportCell row={section.totals} col={c} first={i === 0} /> : undefined,
      })),
    [section],
  );

  return (
    <div className="overflow-hidden rounded-lg border bg-card print:overflow-visible print:rounded-none print:border-0 print:bg-transparent">
      <DataTable
        rows={section.rows}
        columns={columns}
        getId={r => r.id}
        dense
        stickyHeader={Boolean(section.tall)}
        maxHeight={section.tall ? 'min(70vh, 720px)' : undefined}
        className="print:!max-h-none print:!overflow-visible"
        rowClassName={r => cn(ROW_CLASS[r.kind ?? 'data'], 'print:break-inside-avoid')}
        caption={section.title}
        empty={
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[14px] text-muted-foreground">
            <span>{section.empty ?? 'Nothing to show.'}</span>
            {onClearFilters && (
              <button type="button" onClick={onClearFilters} className="ghost-chip h-8 text-sm text-foreground print:hidden">
                Clear filters
              </button>
            )}
          </div>
        }
      />
    </div>
  );
}
