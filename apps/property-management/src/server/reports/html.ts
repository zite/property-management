import { formatDay } from '@project/shared/dates';
import { formatMoney } from '@project/shared/money';
import type { CellKind, CellTone, ReportCell, ReportColumn, ReportDoc, ReportRow, ReportSection } from '../../components/reports/doc';

/**
 * A report as a self-contained, print-quality HTML page for `Pdf.renderHtml`:
 * inline CSS only, system fonts, tabular figures, landscape when the tables
 * are wide. Mirrors the on-screen frame so a PDF reads like the page.
 */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function formatCell(value: ReportCell, kind: CellKind, currency = 'USD', wholeDollars = false): string {
  if (value == null || value === '') return '';
  switch (kind) {
    case 'money':
      return formatMoney(Number(value), currency, { cents: !wholeDollars || Math.round(Number(value) * 100) % 100 !== 0 });
    case 'percent':
      return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    case 'number':
      return Number(value).toLocaleString('en-US');
    case 'days':
      return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
    case 'date':
      return formatDay(String(value));
    default:
      return String(value);
  }
}

const TONE: Record<CellTone, string> = { danger: '#b4232c', warning: '#9a4d06', success: '#15703d', info: '#0b5f8f', muted: '#6b7280' };
const PILL: Record<string, string> = { danger: '#b4232c', warning: '#9a4d06', success: '#15703d', info: '#0b5f8f', accent: '#0f766e', neutral: '#4b5563' };

function cellHtml(row: ReportRow, col: ReportColumn, currency: string) {
  const key = col.key;
  const pill = row.pills?.[key];
  const text = pill ? pill.label : formatCell(row.cells[key] ?? null, col.kind, currency, col.wholeDollars);
  const hint = row.hints?.[key];
  const tone = row.tones?.[key];
  const color = pill ? PILL[pill.tone] : tone ? TONE[tone] : '';
  return `${color ? `<span style="color:${color}">${esc(text)}</span>` : esc(text)}${hint ? `<span class="hint"> ${esc(hint)}</span>` : ''}`;
}

const align = (kind: CellKind) => (kind === 'text' ? '' : kind === 'date' ? 'd' : 'r');

function sectionHtml(section: ReportSection, currency: string) {
  const cols = section.columns.filter(c => !c.exportOnly);
  const head = cols.map(c => `<th class="${align(c.kind)}"${c.width ? ` style="width:${Math.round(c.width * 0.8)}px"` : ''}>${esc(c.label)}</th>`).join('');
  const body = section.rows.length
    ? section.rows
        .map(r => {
          const cls = r.kind && r.kind !== 'data' ? r.kind : '';
          return `<tr class="${cls}">${cols
            .map((c, i) => `<td class="${align(c.kind)}"${i === 0 && r.depth ? ` style="padding-left:${6 + r.depth * 12}px"` : ''}>${cellHtml(r, c, currency)}</td>`)
            .join('')}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${cols.length}" class="empty">${esc(section.empty ?? 'Nothing to show.')}</td></tr>`;
  const foot = section.totals ? `<tfoot><tr class="total">${cols.map(c => `<td class="${align(c.kind)}">${cellHtml(section.totals!, c, currency)}</td>`).join('')}</tr></tfoot>` : '';
  return `<section>${section.title ? `<h2>${esc(section.title)}</h2>` : ''}${section.description ? `<p class="desc">${esc(section.description)}</p>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></section>`;
}

export function reportHtml(doc: ReportDoc, opts: { currency?: string; timezone?: string } = {}) {
  const currency = opts.currency || 'USD';
  const wide = doc.sections.some(s => s.columns.filter(c => !c.exportOnly).length > 7);
  const generated = new Date(doc.generatedAt);
  let when = doc.generatedAt;
  try {
    when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: opts.timezone || 'UTC' }).format(generated);
  } catch {
    /* keep ISO */
  }
  const figures = doc.figures.length
    ? `<div class="figures">${doc.figures
        .map(f => `<div class="figure"><div class="fl">${esc(f.label)}</div><div class="fv"${f.tone ? ` style="color:${TONE[f.tone]}"` : ''}>${esc(formatCell(f.value, f.kind, currency) || '—')}</div>${f.hint ? `<div class="fh">${esc(f.hint)}</div>` : ''}</div>`)
        .join('')}</div>`
    : '';
  const checks = doc.checks.length
    ? `<div class="checks">${doc.checks.map(c => `<div class="check ${c.ok ? 'ok' : 'bad'}"><strong>${c.ok ? '✓' : '✕'} ${esc(c.label)}.</strong> ${esc(c.detail)}</div>`).join('')}</div>`
    : '';
  const warnings = doc.warnings.length ? `<div class="warnings">${doc.warnings.map(w => `<p>${esc(w)}</p>`).join('')}</div>` : '';
  const chart = doc.chart?.points.length
    ? `<section><h2>${esc(doc.chart.title)}</h2><table class="chart"><tbody><tr>${doc.chart.points.map(p => `<td class="r">${esc(doc.chart!.kind === 'percent' ? `${p.value}%` : formatMoney(p.value, currency))}<br/><span class="hint">${esc(p.label)}</span></td>`).join('')}</tr></tbody></table></section>`
    : '';
  const notes = doc.notes.length ? `<div class="notes">${doc.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(doc.title)}</title><style>
@page { size: letter ${wide ? 'landscape' : 'portrait'}; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #14171f; font-size: 10.5px; line-height: 1.4; margin: 0; font-variant-numeric: tabular-nums; }
header { border-bottom: 1.5px solid #14171f; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
.org { font-size: 10px; color: #4b5563; letter-spacing: .02em; }
h1 { font-size: 18px; margin: 2px 0 2px; font-weight: 650; letter-spacing: -.01em; }
.sub { color: #374151; font-size: 11px; }
.gen { color: #6b7280; font-size: 9.5px; text-align: right; white-space: nowrap; }
.figures { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.figure { border: 1px solid #e3e5ea; border-radius: 5px; padding: 6px 9px; min-width: 110px; flex: 1 1 0; }
.fl { color: #4b5563; font-size: 9px; }
.fv { font-size: 13.5px; font-weight: 650; margin-top: 1px; }
.fh { color: #6b7280; font-size: 8.5px; }
.checks { margin: 0 0 10px; }
.check { font-size: 10px; padding: 3px 0; }
.check.ok strong { color: #15703d; }
.check.bad strong { color: #b4232c; }
.warnings { border: 1px solid #f0c9a4; background: #fff7ed; border-radius: 5px; padding: 4px 9px; margin-bottom: 10px; color: #7c3a06; }
.warnings p { margin: 3px 0; }
section { margin: 0 0 14px; }
h2 { font-size: 12px; margin: 0 0 3px; font-weight: 650; }
.desc { color: #4b5563; margin: 0 0 5px; font-size: 9.5px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tfoot { display: table-row-group; }
tr { page-break-inside: avoid; }
th { text-align: left; font-weight: 600; color: #4b5563; font-size: 9px; border-bottom: 1px solid #c9cdd4; padding: 4px 6px; white-space: nowrap; }
td { padding: 3.5px 6px; border-bottom: 1px solid #eceef1; vertical-align: top; }
.r { text-align: right; white-space: nowrap; }
.d { white-space: nowrap; }
tr.group td { font-weight: 650; background: #f4f5f7; border-bottom-color: #e3e5ea; padding-top: 5px; }
tr.subtotal td { font-weight: 600; border-top: 1px solid #c9cdd4; }
tr.total td { font-weight: 700; border-top: 1.5px solid #14171f; border-bottom: none; background: #f8f9fa; }
.hint { color: #6b7280; font-weight: 400; font-size: 9px; }
.empty { color: #6b7280; text-align: center; padding: 14px; }
.notes { color: #4b5563; font-size: 9px; border-top: 1px solid #e3e5ea; padding-top: 6px; margin-top: 8px; }
.notes p { margin: 2px 0; }
table.chart td { border: none; text-align: center; font-weight: 600; }
</style></head><body>
<header><div><div class="org">${esc(doc.organizationName)}</div><h1>${esc(doc.title)}</h1><div class="sub">${esc(doc.subtitle)}</div></div><div class="gen">Generated ${esc(when)}${doc.page && doc.page.pages > 1 ? `<br/>Page ${doc.page.page} of ${doc.page.pages} of the ledger` : ''}</div></header>
${figures}${checks}${warnings}${chart}${doc.sections.map(s => sectionHtml(s, currency)).join('')}${notes}
</body></html>`;
}
