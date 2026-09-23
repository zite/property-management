import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { Pdf } from 'zitejs/pdf';
import { logActivity } from '@project/shared/server/activity';
import { parseInput } from '../server/input';
import { openReport, periodOf, ReportInput } from '../server/reports/common';
import { reportHtml } from '../server/reports/html';
import { BUILDERS } from '../server/reports/registry';

/**
 * Save any report as a PDF. The report is rebuilt on the server from the same
 * parameters (never from numbers the browser sends), rendered to print HTML
 * and turned into a PDF. An owner statement is also filed once to the
 * owner's documents — not shared — so it can be shared from there.
 */

const Input = z.object({ report: z.string().min(1).max(60), params: ReportInput.default({}) });

export default createEndpoint({
  description: 'Render a report to PDF with the same parameters as on screen',
  authenticated: true,
  inputSchema: Input,
  execute: async ({ input, context }) => {
    const { report, params } = parseInput(Input, input);
    const build = BUILDERS[report];
    if (!build) throw new ZiteError('That report doesn’t exist.', 'NOT_FOUND');
    const scope = await openReport(report, context, params);
    const doc = await build(scope);
    const html = reportHtml(doc, { currency: scope.settings.currency, timezone: scope.settings.timezone });
    const stamp = scope.def.params.period ? `${periodOf(scope).from} to ${periodOf(scope).to}` : scope.def.params.year ? String(params.year ?? scope.today.slice(0, 4)) : params.asOf ?? scope.today;
    const base = `${doc.title} ${stamp}`.replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
    const filename = `${base || 'Report'}.pdf`;
    const pdf = await Pdf.renderHtml({ html, filename });

    let documentId: string | null = null;
    const ownerId = doc.resolved?.ownerId ?? null;
    if (report === 'owner-statement' && ownerId && doc.sections.length) {
      const { from, to } = periodOf(scope);
      const single = scope.properties.filter(p => p.ownerId === ownerId);
      const created = await zite.documents.create({
        record: {
          name: `${doc.title} (${from} to ${to})`.slice(0, 200),
          url: pdf.url,
          category: 'Statement',
          ownerId,
          propertyId: single.length === 1 ? single[0].id : null,
          sharedWithOwner: false,
          sharedWithTenant: false,
          mimeType: 'application/pdf',
          uploadedById: scope.actor.id,
          uploadedByName: scope.actor.name,
          uploadedAt: new Date().toISOString(),
          notes: `Generated from Reports: ${doc.subtitle}`.slice(0, 2000),
        },
      });
      documentId = created.id;
      await logActivity({ entityType: 'owner', entityId: ownerId, action: 'document_added', summary: `saved ${doc.title} as a PDF`, actorId: scope.actor.id, actorName: scope.actor.name, ownerId }).catch(() => undefined);
    }
    return { url: pdf.url, filename: pdf.filename || filename, documentId };
  },
});
