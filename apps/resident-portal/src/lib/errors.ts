/**
 * A message a person can read, from whatever an endpoint call threw.
 *
 * Failed calls arrive as `API call failed (400): {"message":"…"}`, so the
 * endpoint's own sentence is buried in JSON. Anything that still looks like
 * an internal error falls back to the caller's wording.
 */
export function errorMessage(e: unknown, fallback: string) {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as { message?: string } | null)?.message ?? '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return "You seem to be offline. Check your connection and try again.";
  let msg = raw.replace(/^API call failed \(\d+\):\s*/, '');
  const start = msg.indexOf('{');
  if (start >= 0) {
    try {
      const body = JSON.parse(msg.slice(start)) as Record<string, unknown>;
      const nested = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>).message : body.error;
      const found = [body.userFacingMessage, body.message, nested].find(v => typeof v === 'string' && v.trim());
      if (typeof found === 'string') msg = found;
    } catch {
      /* not JSON — keep the text */
    }
  }
  msg = msg.trim();
  if (/^unauthori[sz]ed$/i.test(msg)) return 'Your session has ended. Sign in again to continue.';
  return msg && msg.length < 280 && !msg.includes('<') && !/^(internal|error)$/i.test(msg) ? msg : fallback;
}

/** The HTTP status of a failed endpoint call, when there was one. */
export function errorStatus(e: unknown): number | null {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const m = raw.match(/^API call failed \((\d{3})\)/);
  return m ? Number(m[1]) : null;
}

export const isNotFound = (e: unknown) => errorStatus(e) === 404;
export const isUnauthorized = (e: unknown) => errorStatus(e) === 401;
