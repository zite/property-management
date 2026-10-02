import { zite } from 'zitejs/db';
import { DEFAULT_TEMPLATES } from '../templates';
import { ensureChartOfAccounts } from './accounts';
import { isDemo } from './demoPreview';
import { chunked } from './sql';

/**
 * What every install needs before anyone can work, demo or not: a chart of
 * accounts the posting engine can find its system accounts in, and email
 * templates for every event the app sends. Both are only ever added to —
 * an organization's edits are never overwritten.
 */

export async function ensureTemplates() {
  const { rows } = await zite.sql({ query: `SELECT "trigger" FROM "EmailTemplates"`, params: [] });
  const have = new Set(rows.map(r => String(r.trigger)));
  const missing = DEFAULT_TEMPLATES.filter(t => !have.has(t.trigger));
  if (!missing.length || isDemo()) return 0;
  await chunked(missing, async batch => {
    await zite.emailTemplates.bulkCreate({
      records: batch.map(t => ({ name: t.name, trigger: t.trigger, audience: t.audience, subject: t.subject, body: t.body, enabled: t.enabled, position: DEFAULT_TEMPLATES.indexOf(t) })),
    });
  });
  return missing.length;
}

export async function ensureWorkspaceDefaults() {
  await ensureChartOfAccounts();
  await ensureTemplates();
}
