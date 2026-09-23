import { z } from 'zod';
import { createEndpoint } from 'zitejs/backend';
import { zite } from 'zitejs/db';
import { getActor } from '@project/shared/server/actor';
import { parseInput } from '../server/input';

/** Anyone on the team can change how they appear to everyone else: name, title, phone and photo. */

const Input = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(80, 'Keep your name under 80 characters.'),
  title: z.string().trim().max(80, 'Keep your title under 80 characters.'),
  phone: z.string().trim().max(40, 'Keep the phone number under 40 characters.'),
  avatarUrl: z
    .string()
    .max(2000)
    .nullable()
    .refine(v => !v || /^https?:\/\//i.test(v), { message: 'Upload the photo again.' }),
});

export default createEndpoint({
  description: 'Update your own name, title, phone and photo',
  authenticated: true,
  inputSchema: Input,
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const actor = await getActor(context);
    const data = parseInput(Input, input);
    await zite.members.update({ id: actor.id, record: { name: data.name, title: data.title || null, phone: data.phone || null, avatarUrl: data.avatarUrl || null } });
    return { id: actor.id };
  },
});
