import type { z } from 'zod';
import { ZiteError } from 'zitejs/backend';

/**
 * Zite does not enforce an endpoint's `inputSchema` before `execute` runs, so
 * every staff endpoint re-parses its input here. Custom refinement messages
 * (full sentences) reach the person; zod's own wording ("Expected string,
 * received number") becomes a generic sentence instead.
 */
export function parseInput<T extends z.ZodTypeAny>(schema: T, raw: unknown, fallback = "That request wasn't valid. Reload the page and try again."): z.infer<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const readable = issue && (issue.code === 'custom' || /^[A-Z].*[.!?]$/.test(issue.message)) ? issue.message : null;
    throw new ZiteError(readable ?? fallback, 'BAD_REQUEST');
  }
  return parsed.data;
}

/** An optional id that may arrive as '' from a cleared picker. */
export const nullableId = (v: string | null | undefined) => (v ? v : null);
