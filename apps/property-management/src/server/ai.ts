import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude access for the app's AI assists.
 *
 * Every AI feature degrades rather than fails: `isConfigured` is false when the
 * workspace has no Anthropic connection, and each endpoint returns a useful
 * non-AI answer in that case. A template that hard-fails on a missing
 * integration looks broken to whoever installed it.
 */

export const MODEL = 'claude-opus-5';

export function isConfigured() {
  return Boolean(process.env.ZITE_ANTHROPIC_ACCESS_TOKEN);
}

function client() {
  return new Anthropic({ apiKey: process.env.ZITE_ANTHROPIC_ACCESS_TOKEN });
}

/**
 * A schema-constrained call.
 *
 * The SDK's `zodOutputFormat` helper needs zod v4 (`z.toJSONSchema`) and the
 * Zite framework pins zod 3, so schemas are written by hand. The accepted shape
 * is exactly `{ type: 'json_schema', schema }` — adding a `name` is a 400.
 */
export async function structured<T>(opts: {
  system?: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}): Promise<T | null> {
  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2000,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: {
      effort: opts.effort ?? 'low',
      format: { type: 'json_schema', schema: opts.schema as never },
    },
    messages: [{ role: 'user', content: opts.prompt }],
  } as never);

  // A decline returns 200 with stop_reason 'refusal' and no parsed output.
  const r = response as unknown as { stop_reason?: string; parsed_output?: T };
  if (r.stop_reason === 'refusal') return null;
  return r.parsed_output ?? null;
}

/** Keep prompts bounded — descriptions and threads can be long. */
export function truncate(text: string | null | undefined, max = 600) {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
