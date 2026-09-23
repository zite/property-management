import { downloadText } from './download';

type Cell = string | number | boolean | null | undefined;

const escape = (v: Cell) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Guard against spreadsheet formula injection from user-entered text.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(headers: string[], rows: Cell[][]) {
  return [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
}

/** Build and download a CSV; the filename gets today's date. */
export function downloadCsv(name: string, headers: string[], rows: Cell[][]) {
  const date = new Date().toISOString().slice(0, 10);
  downloadText(`${name}-${date}.csv`, `﻿${toCsv(headers, rows)}`);
}
