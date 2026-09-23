import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { Pdf } from 'zitejs/pdf';
import { areaStats, parseAreas, type InspectionArea } from '@project/shared/inspections';
import { logActivity } from '@project/shared/server/activity';
import { getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { str } from '@project/shared/server/sql';
import { parseInput } from '../server/input';
import { assertMaintenance, CONDITION_RANK, FLAGGED_CONDITIONS, loadInspectionRow } from '../server/maintenance';

/**
 * The printable inspection report: every room and item with its condition,
 * notes and photos, the summary and overall condition, flagged items up
 * front, the move-in comparison for a move-out, and signature lines. Saved to
 * the unit's (and lease's) documents and set as the report residents open
 * from their portal. Regenerating replaces the previous report document.
 */

const Input = z.object({ id: z.string().min(1) });

const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const TONE: Record<string, string> = { Good: '#15803d', Excellent: '#15803d', Fair: '#b45309', Poor: '#c2410c', Damaged: '#be123c', Missing: '#be123c', 'N/A': '#6b7280' };

function pill(condition: string | null) {
  if (!condition) return '<span class="muted">Not checked</span>';
  const c = TONE[condition] ?? '#374151';
  return `<span class="pill" style="color:${c};border-color:${c}40;background:${c}10">${esc(condition)}</span>`;
}

export default createEndpoint({
  description: 'Render an inspection report PDF and save it to the unit’s documents',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ url: z.string(), documentId: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertMaintenance(actor, 'inspections');
    const { id } = parseInput(Input, input);
    const { inspection: i, areas } = await loadInspectionRow(id);
    if (i.status === 'Canceled') throw new ZiteError('This inspection was canceled, so there’s no report to print.', 'BAD_REQUEST');
    const settings = await getSettings();

    const [place, people, inspector, baselineRows] = await Promise.all([
      zite.sql({ query: `SELECT p."name" AS "propertyName", p."street", p."city", p."state", p."postalCode", u."name" AS "unitName" FROM "Units" u LEFT JOIN "Properties" p ON p.id::text = u."propertyId" WHERE u.id::text = $1`, params: [i.unitId ?? ''] }),
      i.leaseId
        ? zite.sql({ query: `SELECT t."name" FROM "LeaseTenants" lt JOIN "Tenants" t ON t.id::text = lt."tenantId" WHERE lt."leaseId" = $1 AND lt."role" IN ('Primary', 'Co-tenant') ORDER BY CASE lt."role" WHEN 'Primary' THEN 0 ELSE 1 END`, params: [i.leaseId] })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      i.inspectorId ? zite.sql({ query: `SELECT "name" FROM "Members" WHERE id::text = $1`, params: [i.inspectorId] }) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      i.type === 'Move-out' && i.unitId
        ? zite.sql({
            query: `SELECT "title", "completedAt", "areas" FROM "Inspections" WHERE id::text <> $1 AND "inspectionType" = 'Move-in' AND "status" = 'Completed' AND "unitId" = $2 AND ("leaseId" = $3 OR COALESCE("completedAt", "scheduledFor") <= $4::timestamptz) ORDER BY CASE WHEN "leaseId" = $3 THEN 0 ELSE 1 END, "completedAt" DESC NULLS LAST LIMIT 1`,
            params: [id, i.unitId, i.leaseId ?? '__none__', i.scheduledFor ?? new Date().toISOString()],
          })
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    const p = place.rows[0] ?? {};
    const address = [str(p.street), [str(p.city), [str(p.state), str(p.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    const residents = people.rows.map(r => str(r.name)).filter(Boolean).join(', ');
    const dateFmt = (v: string | null) => (v ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: settings.timezone }).format(new Date(v)) : '—');
    const stats = areaStats(areas);
    const flagged = areas.flatMap(a => a.items.filter(it => it.condition && FLAGGED_CONDITIONS.includes(it.condition)).map(it => ({ area: a.name, item: it })));

    const baseline = baselineRows.rows[0] ? parseAreas(baselineRows.rows[0].areas) : [];
    const before = new Map<string, string | null>();
    const beforeByName = new Map<string, string | null>();
    for (const a of baseline) for (const it of a.items) {
      before.set(it.id, it.condition);
      beforeByName.set(`${a.name}|${it.name}`.toLowerCase(), it.condition);
    }
    const worse = baseline.length
      ? areas.flatMap((a: InspectionArea) => a.items.map(it => {
          const was = before.has(it.id) ? before.get(it.id) ?? null : beforeByName.get(`${a.name}|${it.name}`.toLowerCase()) ?? null;
          return { area: a.name, item: it, was };
        })).filter(r => r.item.condition && r.was && CONDITION_RANK[r.item.condition] != null && CONDITION_RANK[r.was] != null && CONDITION_RANK[r.item.condition] > CONDITION_RANK[r.was])
      : [];

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; font-size: 11px; line-height: 1.45; margin: 32px 36px; }
      h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
      h2 { font-size: 13px; margin: 22px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
      .org { display: flex; justify-content: space-between; align-items: baseline; color: #4b5563; margin-bottom: 18px; border-bottom: 2px solid #111827; padding-bottom: 8px; }
      .org strong { color: #111827; font-size: 13px; }
      .muted { color: #6b7280; }
      .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin-top: 12px; }
      .meta div span { display: block; color: #6b7280; font-size: 10px; }
      .pill { display: inline-block; border: 1px solid; border-radius: 4px; padding: 0 5px; font-weight: 600; font-size: 10px; white-space: nowrap; }
      table { width: 100%; border-collapse: collapse; }
      td, th { text-align: left; vertical-align: top; padding: 5px 6px; border-bottom: 1px solid #f0f1f3; }
      th { font-size: 10px; color: #6b7280; font-weight: 500; }
      td.c { width: 84px; } td.n { width: 34%; }
      .area { page-break-inside: avoid; }
      .photos img { width: 64px; height: 64px; object-fit: cover; border-radius: 4px; margin: 3px 3px 0 0; border: 1px solid #e5e7eb; }
      .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
      .flag { background: #fff7ed; border-color: #fed7aa; }
      .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 44px; }
      .sig div { border-top: 1px solid #111827; padding-top: 4px; color: #4b5563; }
    </style></head><body>
      <div class="org"><strong>${esc(settings.organizationName)}</strong><span>${esc(settings.phone)}${settings.supportEmail ? ` · ${esc(settings.supportEmail)}` : ''}</span></div>
      <h1>${esc(i.title)}</h1>
      <div class="muted">${esc([str(p.propertyName), str(p.unitName)].filter(Boolean).join(' · '))}${address ? ` — ${esc(address)}` : ''}</div>
      <div class="meta">
        <div><span>Type</span>${esc(i.type)}</div>
        <div><span>Status</span>${esc(i.status)}</div>
        <div><span>Overall condition</span>${i.overallCondition ? pill(i.overallCondition) : '—'}</div>
        <div><span>Scheduled</span>${esc(dateFmt(i.scheduledFor))}</div>
        <div><span>Completed</span>${esc(dateFmt(i.completedAt))}</div>
        <div><span>Inspector</span>${esc(str(inspector.rows[0]?.name) ?? '—')}</div>
        <div><span>Residents</span>${esc(residents || '—')}</div>
        <div><span>Items checked</span>${stats.rated} of ${stats.total}</div>
        <div><span>Flagged</span>${stats.issues}</div>
      </div>
      ${i.summary ? `<h2>Summary</h2><div class="box">${esc(i.summary).replace(/\n/g, '<br>')}</div>` : ''}
      ${flagged.length ? `<h2>Needs attention</h2><div class="box flag"><table>${flagged.map(f => `<tr><td class="n"><strong>${esc(f.area)}</strong> · ${esc(f.item.name)}</td><td class="c">${pill(f.item.condition)}</td><td>${esc(f.item.notes)}</td></tr>`).join('')}</table></div>` : ''}
      ${worse.length ? `<h2>Worse than at move-in</h2><table><tr><th>Item</th><th>Move-in</th><th>Move-out</th><th>Notes</th></tr>${worse.map(w => `<tr><td class="n"><strong>${esc(w.area)}</strong> · ${esc(w.item.name)}</td><td class="c">${pill(w.was)}</td><td class="c">${pill(w.item.condition)}</td><td>${esc(w.item.notes)}</td></tr>`).join('')}</table>` : ''}
      ${areas.map(a => `<div class="area"><h2>${esc(a.name)}</h2><table>${a.items.map(it => `<tr><td class="n">${esc(it.name)}</td><td class="c">${pill(it.condition)}</td><td>${esc(it.notes)}${it.photos.length ? `<div class="photos">${it.photos.slice(0, 6).map(ph => `<img src="${esc(ph.url)}" alt="">`).join('')}</div>` : ''}</td></tr>`).join('') || '<tr><td class="muted">No items</td></tr>'}</table></div>`).join('')}
      <div class="sig"><div>Inspector signature and date</div><div>Resident signature and date</div></div>
    </body></html>`;

    const filename = `${i.title.replace(/[^\w\s—-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Inspection report'}.pdf`;
    const rendered = await Pdf.renderHtml({ html, filename });
    const url = (rendered as { url?: string }).url;
    if (!url) throw new ZiteError('The report couldn’t be generated. Try again in a moment.', 'BAD_REQUEST');

    // One report document per inspection: the previous one is replaced.
    if (i.reportUrl) {
      const { rows: old } = await zite.sql({ query: `SELECT id FROM "Documents" WHERE "url" = $1 AND "category" = 'Inspection' LIMIT 5`, params: [i.reportUrl] });
      for (const d of old) await zite.documents.delete({ id: String(d.id) });
    }
    const doc = await zite.documents.create({
      record: {
        name: `${i.title} — report.pdf`.slice(0, 240),
        url,
        category: 'Inspection',
        propertyId: i.propertyId,
        unitId: i.unitId,
        leaseId: i.leaseId,
        sharedWithTenant: false,
        sharedWithOwner: false,
        mimeType: 'application/pdf',
        uploadedById: actor.id,
        uploadedByName: actor.name,
        uploadedAt: new Date().toISOString(),
        notes: `Generated from the inspection on ${new Date().toISOString().slice(0, 10)}.`,
      },
    });
    await zite.inspections.update({ id: i.id, record: { reportUrl: url } });
    await logActivity({ entityType: 'inspection', entityId: i.id, propertyId: i.propertyId, unitId: i.unitId, leaseId: i.leaseId, action: 'report_generated', summary: 'generated the PDF report', actorId: actor.id, actorName: actor.name, data: { documentId: doc.id } });
    return { url, documentId: doc.id };
  },
});
