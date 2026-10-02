export const DEMO_EMAIL = 'demo.user@zite.com';

/** The marketplace demo: read-only database, synthetic visitor. Never true for an installed app. */
export const isDemo = (context?: { user?: { email?: string | null } | null }) =>
  /\/\/zite-demo-/.test(process.env.ZITE_APP_URL ?? '') ||
  (context?.user?.email ?? '').trim().toLowerCase() === DEMO_EMAIL;
