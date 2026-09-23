/**
 * Print a rendered part of the page — the lease agreement, a deposit
 * statement — on its own, in a clean document. The app shell is a fixed,
 * scrolling layout that prints badly, so the markup is copied into a hidden
 * iframe with print typography and printed from there.
 */

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 12pt; line-height: 1.55; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 10pt; } h2 { font-size: 13pt; margin: 16pt 0 4pt; } h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; } ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
  table { width: 100%; border-collapse: collapse; font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 10.5pt; }
  td, th { padding: 5pt 0; border-bottom: 1px solid #ddd; text-align: left; } td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 600; border-bottom: 1.5px solid #111; }
  .meta { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #555; margin-bottom: 14pt; }
  [data-print-hide] { display: none !important; }
`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function printElement(el: HTMLElement | null, title: string, meta?: string) {
  if (!el) return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return iframe.remove();
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}${el.innerHTML}</body></html>`);
  doc.close();
  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1500);
    }
  }, 60);
}
