import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { assertCan, getActor } from '@project/shared/server/actor';
import { getSettings } from '@project/shared/server/settings';
import { parseInput } from '../server/input';
import { AUDIENCES, audiencePeople } from '../server/announcements';
import { mergeContexts, missingTags, personKey, render } from '../server/comms';

/** Who an announcement would reach right now, and how it reads for the first of them. */

const Id = z.string().min(1).max(64);
const Input = z.object({
  audience: z.enum(AUDIENCES),
  propertyIds: z.array(Id).max(500).default([]),
  unitIds: z.array(Id).max(2000).default([]),
  title: z.string().max(400).default(''),
  body: z.string().max(20000).default(''),
});

export default createEndpoint({
  description: 'Count an announcement audience and preview the message for one recipient',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({
    total: z.number(),
    withEmail: z.number(),
    withoutEmail: z.number(),
    sample: z.array(z.object({ kind: z.string(), id: z.string(), name: z.string(), hasEmail: z.boolean(), unitId: z.string().nullable(), propertyId: z.string().nullable() })),
    preview: z.object({ name: z.string(), subject: z.string(), body: z.string(), missingTags: z.array(z.string()) }).nullable(),
  }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    assertCan(actor, 'announcements.send');
    const data = parseInput(Input, input);
    const [settings, people] = await Promise.all([getSettings(), audiencePeople({ audience: data.audience, propertyIds: data.propertyIds, unitIds: data.unitIds })]);
    const first = people[0];
    let preview: { name: string; subject: string; body: string; missingTags: string[] } | null = null;
    if (first) {
      const ctx = (await mergeContexts([first], settings, { propertyIds: data.audience === 'owners_properties' ? data.propertyIds : null })).get(personKey(first.kind, first.id)) ?? {};
      preview = { name: first.label, subject: render(data.title, ctx), body: render(data.body, ctx), missingTags: missingTags(`${data.title}\n${data.body}`, ctx) };
    }
    const withEmail = people.filter(p => p.hasEmail).length;
    return {
      total: people.length,
      withEmail,
      withoutEmail: people.length - withEmail,
      sample: [...people].sort((a, b) => a.label.localeCompare(b.label)).slice(0, 12).map(p => ({ kind: p.kind, id: p.id, name: p.label, hasEmail: p.hasEmail, unitId: p.unitId, propertyId: p.propertyId })),
      preview,
    };
  },
});
