import { z } from 'zod';
import { groupNameSchema, identifierSchema, memberNameSchema } from '@splitnext/client';
import type { ActionHost } from './actions';

export const createGroupInputSchema = z.object({
  name: groupNameSchema.meta({ description: "The new group's name." }),
  yourName: memberNameSchema.meta({ description: 'Your member name in the group.' }),
});

export const memberChoiceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    memberId: identifierSchema.meta({ suggestions: 'member', description: 'An existing member to join as, from the invite preview.' }),
  }),
  z.object({ kind: z.literal('new'), name: memberNameSchema.meta({ description: 'Your new member name.' }) }),
]);

type JoinInput = {
  groupId: string;
  as: z.input<typeof memberChoiceSchema>;
  token?: string | undefined;
};

/** Form submissions and direct calls share input normalization and execution. */
export async function performCreate(
  host: ActionHost,
  input: z.input<typeof createGroupInputSchema>,
): Promise<void> {
  const parsed = createGroupInputSchema.parse(input);

  await host.createGroup({ name: parsed.name, creator_member_name: parsed.yourName });
}

export async function performJoin(
  host: ActionHost,
  input: JoinInput,
): Promise<void> {
  const groupId = identifierSchema.parse(input.groupId);
  const choice = memberChoiceSchema.parse(input.as);

  await host.joinGroup(
    groupId,
    choice.kind === 'new' ? { kind: 'new', display_name: choice.name } : { kind: 'existing', member_id: choice.memberId },
    input.token,
  );
}
