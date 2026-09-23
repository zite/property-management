import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, type WorkOrderCategory, type WorkOrderPriority } from '@project/shared/constants';
import { getActor } from '@project/shared/server/actor';
import { isConfigured, structured, truncate } from '../server/ai';
import { parseInput } from '../server/input';

/**
 * Suggest a category, priority and a clear title for a maintenance request.
 * Claude when the workspace has it; otherwise keyword rules that handle the
 * common cases. Always a suggestion — the person creating it decides.
 */

const Input = z.object({ text: z.string().trim().min(3).max(4000) });

const RULES: Array<[RegExp, WorkOrderCategory]> = [
  [/\b(leak\w*|drip\w*|clog\w*|toilet|faucet|sink|drain\w*|water|pipes?|shower|tub|sewer|backing up|flood\w*)\b/i, 'Plumbing'],
  [/\b(outlets?|breakers?|spark\w*|power|lights?|switch\w*|electric\w*|wiring|gfci|fans?)\b/i, 'Electrical'],
  [/\b(heat|heating|furnace|a\/?c|air condition\w*|thermostat|hvac|boiler|radiators?)\b/i, 'HVAC'],
  [/\b(fridge|refrigerator|dishwasher|oven|stove|range|washer|dryer|microwave|disposal)\b/i, 'Appliance'],
  [/\b(ants?|roach(es)?|mice|mouse|rats?|bed ?bugs?|pests?|wasps?|termites?)\b/i, 'Pest control'],
  [/\b(locks?|keys?|deadbolt|fob|lockout|locked out)\b/i, 'Locks & keys'],
  [/\b(doors?|windows?|screens?|glass|blinds?)\b/i, 'Doors & windows'],
  [/\b(smoke|carbon monoxide|co detector|fire|alarm)\b/i, 'Safety'],
  [/\b(roof\w*|gutters?|shingles?)\b/i, 'Roofing'],
  [/\b(paint\w*|walls?|drywall|patch)\b/i, 'Painting'],
  [/\b(carpet|floor\w*|tiles?)\b/i, 'Flooring'],
  [/\b(snow|lawn|trees?|landscap\w*|sprinklers?)\b/i, 'Landscaping'],
];

function heuristic(text: string): { category: WorkOrderCategory; priority: WorkOrderPriority; title: string; reason: string } {
  const category = RULES.find(([re]) => re.test(text))?.[1] ?? 'General';
  const emergency = /flood|pouring|gushing|gas smell|smells? (like )?gas|smell gas|no heat|sparking|burning|fire|smoke|sewage|burst|no water|carbon monoxide|locked out/i.test(text);
  const high = /leak|not working|broken|no hot water|won.?t (lock|close)|ceiling|mold/i.test(text);
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  return {
    category,
    priority: emergency ? 'Emergency' : high ? 'High' : 'Normal',
    title: firstSentence.length > 8 && firstSentence.length < 90 ? firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1) : text.slice(0, 80),
    reason: emergency ? 'Mentions a safety or habitability issue.' : high ? 'Could get worse or cause damage if it waits.' : 'Routine repair.',
  };
}

export default createEndpoint({
  description: 'Suggest category, priority and title for a maintenance request',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ category: z.enum(WORK_ORDER_CATEGORIES), priority: z.enum(WORK_ORDER_PRIORITIES), title: z.string(), reason: z.string(), ai: z.boolean() }),
  execute: async ({ input, context }) => {
    await getActor(context);
    const { text } = parseInput(Input, input);
    const fallback = heuristic(text);
    if (!isConfigured()) return { ...fallback, ai: false };
    try {
      const result = await structured<{ category: WorkOrderCategory; priority: WorkOrderPriority; title: string; reason: string }>({
        system:
          'You triage residential maintenance requests for a property manager. Emergency means risk to safety or severe damage now (flooding, gas, no heat in cold weather, electrical hazard, sewage, security breach). High means it will worsen or affects habitability soon. Normal is routine. Low is cosmetic. Titles are short, specific and in sentence case, like "Kitchen sink leaking under cabinet".',
        prompt: `Request:\n${truncate(text, 2000)}`,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'priority', 'title', 'reason'],
          properties: {
            category: { type: 'string', enum: [...WORK_ORDER_CATEGORIES] },
            priority: { type: 'string', enum: [...WORK_ORDER_PRIORITIES] },
            title: { type: 'string', description: 'At most 70 characters' },
            reason: { type: 'string', description: 'One short sentence explaining the priority' },
          },
        },
        maxTokens: 400,
      });
      if (!result) return { ...fallback, ai: false };
      return { category: result.category, priority: result.priority, title: result.title.slice(0, 120), reason: result.reason.slice(0, 200), ai: true };
    } catch (e) {
      console.error('AI triage failed', e instanceof Error ? e.message : e);
      return { ...fallback, ai: false };
    }
  },
});
