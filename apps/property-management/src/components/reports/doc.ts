/**
 * The shape every report returns, shared by the endpoints (which build it),
 * the report frame (which renders it with DataTable), CSV export and the PDF
 * renderer. Pure types and tiny helpers only — no React, no server imports —
 * so both sides can import it.
 *
 * A report is a title, a line saying what it covers, a strip of headline
 * figures, integrity checks ("debits equal credits"), and one or more
 * sections. A section is a table: typed columns and rows. Rows are data,
 * group headings, subtotals or totals, so a financial statement and a flat
 * list render through the same table.
 */

export type CellKind = 'text' | 'money' | 'number' | 'percent' | 'date' | 'days';

export type CellTone = 'danger' | 'warning' | 'success' | 'info' | 'muted';

export type PillTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger';

export type ReportCell = string | number | null;

export type ReportColumn = {
  key: string;
  label: string;
  kind: CellKind;
  width?: number;
  /** Hide on narrow screens (the CSV and PDF always include it). */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  /** Only in the CSV export — on screen and in the PDF the value is folded into another cell. */
  exportOnly?: boolean;
  /** Money shown without cents (round figures like market rent), to keep wide tables readable. */
  wholeDollars?: boolean;
};

export type ReportRow = {
  id: string;
  kind?: 'data' | 'group' | 'subtotal' | 'total';
  /** Indent level for the first column (0 = flush). */
  depth?: number;
  cells: Record<string, ReportCell>;
  /** Column key → staff-app hash route, for drill-down. */
  links?: Record<string, string>;
  tones?: Record<string, CellTone>;
  /** A status pill rendered in place of (or after) the cell's text. */
  pills?: Record<string, { label: string; tone: PillTone }>;
  /** Quiet secondary text after the value ("Leased from Oct 1"). */
  hints?: Record<string, string>;
};

export type ReportSection = {
  id: string;
  title?: string;
  description?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Rendered as the table footer. */
  totals?: ReportRow | null;
  /** Flat lists can be re-sorted by clicking headers; statements keep their order. */
  sortable?: boolean;
  /** What to say when there are no rows. */
  empty?: string;
  /** Long registers scroll inside their own box on screen (never in print). */
  tall?: boolean;
};

export type ReportFigure = { label: string; value: ReportCell; kind: CellKind; hint?: string; tone?: CellTone };

export type ReportCheck = { label: string; ok: boolean; detail: string };

export type ReportChart = {
  title: string;
  kind: 'percent' | 'money';
  points: Array<{ label: string; value: number }>;
};

export type ReportDoc = {
  key: string;
  title: string;
  /** "Sep 1 – Sep 14, 2026 · All properties · Cash basis" */
  subtitle: string;
  organizationName: string;
  generatedAt: string;
  figures: ReportFigure[];
  checks: ReportCheck[];
  warnings: string[];
  sections: ReportSection[];
  notes: string[];
  chart?: ReportChart | null;
  /** For paged registers (general ledger). */
  page?: { page: number; pages: number; totalRows: number; pageSize: number } | null;
  /** Parameters the server filled in (e.g. the owner it defaulted to), so the frame can show them. */
  resolved?: { ownerId?: string | null };
};

/** Round to cents without float drift. */
export const cents = (n: number) => Math.round(n * 100) / 100;

/** A percentage 0–100 with one decimal, or null when the whole is zero. */
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
