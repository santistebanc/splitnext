import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { identifierSchema } from '../domain/ids';
import { deviceSecretSchema } from '../domain/identities';
import { GroupIndex } from '../groupIndex';
import { IdentityDirectory, MockAccountSignInError } from '../identityDirectory';

const resetRequestSchema = z.object({}).strict();

export const debugRoutes = new OpenAPIHono<{ Bindings: Env }>()
  .get('/debug/identity-directory', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const directory = new IdentityDirectory(context.env.INDEX);

    return context.json(await directory.inspect(), 200);
  })
  .post('/debug/auth/mock/sign-in', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const body = z
      .object({
        account_name: z.string().trim().min(1).max(120),
        device_secret: deviceSecretSchema,
      })
      .strict()
      .safeParse(await context.req.json().catch(() => null));

    if (!body.success) {
      return context.json({ error: 'invalid_request' }, 400);
    }

    try {
      const groupIndex = new GroupIndex(context.env.INDEX);
      const directory = new IdentityDirectory(context.env.INDEX);
      let mergedDuringSignIn: string | null = null;

      const session = await directory.signInWithMockAccount(
        body.data.account_name,
        body.data.device_secret,
        async (sourceIdentityId, targetIdentityId) => {
          const groups = await groupIndex.list(sourceIdentityId);

          await mergeIdentityAcrossGroups(
            context.env,
            groups.map(({ group_id }) => group_id),
            sourceIdentityId,
            targetIdentityId,
          );
          mergedDuringSignIn = sourceIdentityId;

          return groupIndex.prepareIdentityMerge(sourceIdentityId, targetIdentityId);
        },
      );

      const [mergedSources, groups] = await Promise.all([
        directory.mergedSources(session.identity.id),
        groupIndex.list(session.identity.id),
      ]);

      const groupIds = groups.map(({ group_id }) => group_id);

      await Promise.all(
        mergedSources
          .filter((source) => source !== mergedDuringSignIn)
          .map((source) =>
            mergeIdentityAcrossGroups(
              context.env,
              groupIds,
              source,
              session.identity.id,
            ),
          ),
      );

      return context.json(session, 200);
    } catch (error) {
      if (error instanceof MockAccountSignInError) {
        return context.json({ error: error.code }, 409);
      }

      throw error;
    }
  })
  .get('/debug/groups', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const groupIds = await new GroupIndex(context.env.INDEX).listAllGroupIds();

    const groups = await Promise.all(
      groupIds.map(async (groupId) => {
        const group = context.env.GROUPS.get(
          context.env.GROUPS.idFromName(groupId),
        );

        const inspection = await group.inspectGroup(groupId);

        return inspection
          ? {
              group_id: groupId,
              name: inspection.snapshot.group.name,
              currency_code: inspection.snapshot.group.currency_code,
              revision: inspection.revision,
            }
          : null;
      }),
    );

    return context.json({ groups: groups.filter((group) => group !== null) }, 200);
  })
  .get('/debug/groups/:groupId', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const parsed = identifierSchema.safeParse(context.req.param('groupId'));

    if (!parsed.success) return context.json({ error: 'not_found' }, 404);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(parsed.data),
    );

    const inspection = await group.inspectGroup(parsed.data);

    return inspection
      ? context.json(inspection, 200)
      : context.json({ error: 'not_found' }, 404);
  })
  .post('/debug/reset', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const parsed = resetRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );

    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);

    const groupIds = await new GroupIndex(context.env.INDEX).listAllGroupIds();

    await Promise.all(
      groupIds.map((groupId) =>
        context.env.GROUPS.get(context.env.GROUPS.idFromName(groupId))
          .resetGroup(groupId),
      ),
    );
    await new GroupIndex(context.env.INDEX).clear();
    await new IdentityDirectory(context.env.INDEX).clear();

    return context.json({ cleared_group_ids: groupIds }, 200);
  });

function debugEnabled(env: Env): boolean {
  return String(env.ENABLE_DEBUG_INSPECTION) === 'true';
}

async function mergeIdentityAcrossGroups(
  env: Env,
  groupIds: string[],
  sourceIdentityId: string,
  targetIdentityId: string,
): Promise<void> {
  await Promise.all(
    groupIds.map(async (groupId) => {
      const result = await env.GROUPS.get(env.GROUPS.idFromName(groupId)).mergeIdentity(
        groupId,
        sourceIdentityId,
        targetIdentityId,
      );

      if (!result.ok && result.error !== 'group_not_found') {
        throw new Error(result.error);
      }
    }),
  );
}
