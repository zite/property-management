import { createEndpoint } from 'zitejs/backend';
import { Pdf } from 'zitejs/pdf';
import { ownerStatement, statementPeriod, statementTransactions } from '@project/shared/server/ownerStatement';
import { parseInput } from '../server/identity';
import { StatementInput, ownerScope, statementHtml, statementRequest } from '../server/owner';

/**
 * The same statement as a typeset PDF: company and owner, the period, a
 * section per property with combined totals, and the transaction detail.
 */

export default createEndpoint({
  description: 'Download an owner statement as a PDF',
  authenticated: true,
  inputSchema: StatementInput,
  execute: async ({ input, context }) => {
    const req = parseInput(StatementInput, input, 'Choose a month to download its statement.');
    const scope = await ownerScope(context);
    const { propertyIds } = statementRequest(scope, req);
    const range = statementPeriod(req.period, scope.today);
    const [statement, transactions] = await Promise.all([
      ownerStatement({ propertyIds, periodStart: range.periodStart, periodEnd: range.periodEnd }),
      statementTransactions({ propertyIds, periodStart: range.periodStart, periodEnd: range.periodEnd, limit: 1000, organizationName: scope.settings.organizationName }),
    ]);
    const html = statementHtml({ settings: scope.settings, owner: scope.owner, label: range.label, statement, transactions: transactions.rows, truncated: transactions.truncated, generatedOn: scope.today });
    const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const who = statement.properties.length === 1 ? statement.properties[0].propertyName : scope.owner.name;
    const filename = `Owner statement ${slug(who)} ${req.period === 'ytd' ? `YTD-${scope.today.slice(0, 4)}` : req.period}.pdf`.replace(/ /g, '-');
    const { url } = await Pdf.renderHtml({ html, filename });
    return { url, filename };
  },
});
