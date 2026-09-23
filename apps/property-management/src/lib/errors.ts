/**
 * A message a person can read, from whatever an endpoint call threw.
 *
 * Failed calls arrive as `API call failed (400): {"message":"…"}`, so the
 * endpoint's own ZiteError text is buried in JSON. Anything that still looks
 * like an internal error (HTML, a stack, a wall of text) falls back to the
 * caller's wording instead.
 */
export function errorMessage(e: unknown, fallback: string) {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as { message?: string } | null)?.message ?? '';
  let msg = raw.replace(/^API call failed \(\d+\):\s*/, '');
  const start = msg.indexOf('{');
  if (start >= 0) {
    try {
      const body = JSON.parse(msg.slice(start)) as Record<string, unknown>;
      const nested = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>).message : body.error;
      const found = [body.message, nested, body.userFacingMessage].find(v => typeof v === 'string' && v.trim());
      if (typeof found === 'string') msg = found;
    } catch {
      /* not JSON — keep the text */
    }
  }
  // Schema failures read "Invalid input: key: Use letters…"; the field prefix means nothing to a person.
  if (/^Invalid input:/.test(msg)) msg = msg.replace(/^Invalid input:\s*/, '').replace(/^[A-Za-z0-9_.]+:\s+/, '');
  msg = msg.trim();
  return msg && msg.length < 200 && !msg.includes('<') ? msg : fallback;
}
