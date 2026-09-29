import { zite } from 'zitejs/db';
import type { OrgSettings } from '@project/shared/server/settings';
import { num, str } from '@project/shared/server/sql';

/**
 * Sample data: the demo company an admin can load into an empty workspace
 * from Settings → Organization, and remove again from Settings → Demo data.
 * Nothing loads it automatically.
 *
 * `Settings.seededAt` is when loading started, and it stays set until the
 * demo is removed. `Settings.seedStatus` is the last phase that finished, or
 * `<phase>:running@<ISO time>` while one runs, so a phase that died can be
 * told apart from one another tab is still running.
 *
 * Real content is anything in the portfolio, the people it's rented to or
 * serviced by, or the books: a property, unit, owner, resident, lease, vendor
 * or transaction. Teammates, tasks, saved views, email templates and the chart
 * of accounts don't count, and are never removed with the demo.
 */

const REAL_CONTENT = ['Properties', 'Units', 'Owners', 'Tenants', 'Leases', 'Vendors', 'Transactions'];

/** Every demo row is written within this long of `seededAt`; removal looks no further. */
export const SAMPLE_WINDOW_MS = 30 * 60_000;
/** A load that stopped can be picked up again only while its rows still fit in the window. */
export const RESUME_WITHIN_MS = 20 * 60_000;
/** A running phase that hasn't finished in this long died, and is run again. */
export const PHASE_STALE_MS = 10 * 60_000;

export type SeedPhase = { phase: string; running: boolean; since: number };

export function parseSeedStatus(raw: unknown): SeedPhase {
  const [phase, at] = (str(raw) ?? '').split('@');
  const since = at ? Date.parse(at) : NaN;
  return { phase, running: phase.endsWith(':running'), since: Number.isFinite(since) ? since : 0 };
}

export const runningStatus = (phase: string) => `${phase}:running@${new Date().toISOString()}`;

export type SampleDataState = {
  /** The demo (or part of it) is in the workspace. */
  loaded: boolean;
  /** Loading started and hasn't finished. */
  unfinished: boolean;
  /** The workspace has properties, people or books of its own. */
  hasContent: boolean;
  /** Loading may start now. */
  canLoad: boolean;
  /** A load that stopped partway may be continued now. */
  resumable: boolean;
  /** The last finished phase, or the one running and when it started. */
  status: SeedPhase;
};

export async function sampleDataState(settings: Pick<OrgSettings, 'id' | 'seededAt'>): Promise<SampleDataState> {
  const { rows } = await zite.sql({
    query: `SELECT "seedStatus", CASE WHEN ${REAL_CONTENT.map(t => `EXISTS (SELECT 1 FROM "${t}")`).join(' OR ')} THEN 1 ELSE 0 END AS "hasContent" FROM "Settings" WHERE id::text = $1`,
    params: [settings.id],
  });
  const status = parseSeedStatus(rows[0]?.seedStatus);
  const { phase } = status;
  const loaded = Boolean(settings.seededAt);
  const unfinished = phase !== '' && phase !== 'done';
  const hasContent = num(rows[0]?.hasContent) > 0;
  const startedAt = settings.seededAt ? Date.parse(settings.seededAt) : 0;
  return {
    loaded,
    unfinished,
    hasContent,
    canLoad: !loaded && !unfinished && !hasContent,
    resumable: unfinished && Date.now() - startedAt < RESUME_WITHIN_MS,
    status,
  };
}
