import { describe, expect, it } from 'vitest';
import {
  createDispatcher,
  type ActionHost,
  type DispatchRecord,
} from '../apps/client/src/model/actions';
import type { AppState } from '../apps/client/src/model/controller';
import {
  fixtureState,
  scenarioReplica,
  type Connection,
} from '../apps/client/src/workbench/memberListFixture';

type Setup = { connection?: Connection; open?: boolean; others?: string[] };

/** A host that records calls and can be told to fail, without React or I/O. */
function createHost(setup: Setup = {}) {
  const calls: string[] = [];
  let failure: string | null = null;

  const replica = scenarioReplica({
    members: ['Ana', 'Ben'],
    you: 'Ana',
    others: setup.others ?? [],
    presence: 'realtime',
    othersOnline: true,
    connection: 'online',
  });

  const state: AppState = fixtureState(
    setup.connection ?? 'online',
    setup.open === false ? null : replica,
  );

  async function record(call: string): Promise<void> {
    calls.push(call);

    if (failure) throw new Error(failure);
  }

  const host: ActionHost = {
    snapshot: () => state,
    createGroup: (input) =>
      record(`createGroup ${input.name} ${input.creator_member_name}`),
    joinGroup: (groupId, choice, token) =>
      record(
        `joinGroup ${groupId} ${choice.kind === 'new' ? choice.display_name : choice.member_id} ${token ?? '-'}`,
      ),
    openGroup: (groupId) => record(`openGroup ${groupId}`),
    openJoinedGroup: async (groupId) => {
      await record(`openJoinedGroup ${groupId}`);

      return false;
    },
    showGroups: () => {
      calls.push('showGroups');
    },
    renameGroup: (name, observed) => record(`renameGroup ${name} ${observed}`),
    addPerson: (name) => record(`addPerson ${name}`),
    renamePerson: (id, name, observed) =>
      record(`renamePerson ${id} ${name} ${observed}`),
    archivePerson: (id) => record(`archivePerson ${id}`),
    selectPerson: (id) => record(`selectPerson ${id}`),
    regenerateInvite: () => record('regenerateInvite'),
    leaveGroup: () => record('leaveGroup'),
    applyAgain: (id) => record(`applyAgain ${id}`),
    dismissNotice: (id) => record(`dismissNotice ${id}`),
    client: {
      previewInvite: async (groupId) => {
        await record(`previewInvite ${groupId}`);

        return { group: { id: groupId, name: 'Trip' }, members: [] };
      },
    },
  };

  return {
    host,
    calls,
    fail: (code: string) => {
      failure = code;
    },
  };
}

describe('app actions', () => {
  it('validates input with the same schema for every caller', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    expect(await actions.dispatch('addMember', { name: '   ' })).toMatchObject({
      status: 'failed',
      error: 'invalid_input',
    });
    expect(
      await actions.dispatchJson('addMember', { name: 42 }),
    ).toMatchObject({ status: 'failed', error: 'invalid_input' });
    expect(await actions.dispatch('addMember', { name: ' Ben ' })).toEqual({
      status: 'done',
      value: undefined,
    });
    expect(calls).toEqual(['addPerson Ben']);
  });

  it('checks preconditions before running', async () => {
    const offline = createHost({ connection: 'offline' });
    const closed = createHost({ open: false });

    expect(
      await createDispatcher(offline.host).dispatch('replaceInviteLink', {}),
    ).toMatchObject({ status: 'failed', error: 'client_offline' });
    expect(
      await createDispatcher(closed.host).dispatch('addMember', { name: 'Ben' }),
    ).toMatchObject({ status: 'failed', error: 'no_open_group' });
    expect([...offline.calls, ...closed.calls]).toEqual([]);
  });

  it('returns a confirmation request until the call is confirmed', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    expect(await actions.dispatch('replaceInviteLink', {})).toEqual({
      status: 'needs_confirmation',
      message: 'The current link will stop working.',
    });
    expect(calls).toEqual([]);
    expect(
      await actions.dispatch('replaceInviteLink', {}, { confirmed: true }),
    ).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['regenerateInvite']);
  });

  it('asks before choosing a member another participant uses', async () => {
    const { host, calls } = createHost({ others: ['Ben'] });
    const actions = createDispatcher(host);

    expect(
      await actions.dispatch('selectYou', { memberId: 'member-2' }),
    ).toEqual({
      status: 'needs_confirmation',
      message: 'Participant 1 already uses this name.',
    });
    expect(
      await actions.dispatch('selectYou', { memberId: 'member-1' }),
    ).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['selectPerson member-1']);
  });

  it('reports failures as outcomes instead of throwing', async () => {
    const { host, fail } = createHost();
    const actions = createDispatcher(host);

    fail('member_name_taken');

    expect(await actions.dispatch('addMember', { name: 'Ben' })).toEqual({
      status: 'failed',
      error: 'member_name_taken',
      issues: [],
    });
    expect(await actions.dispatchJson('nonexistent', {})).toMatchObject({
      status: 'failed',
      error: 'unknown_action',
    });
  });

  it('fills defaults from what the person saw', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('renameMember', { memberId: 'member-2', name: 'Benji' });
    await actions.dispatch('joinGroup', {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Dev' },
      token: 't',
    });

    expect(calls).toEqual([
      'renamePerson member-2 Benji Ben',
      'joinGroup uy9ogmKJRD2VRfbN4PDsAw Dev t',
    ]);
  });

  it('tells observers what ran and who asked, without changing behaviour', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);
    const records: DispatchRecord[] = [];

    const stop = actions.observe((record) => records.push(record));

    await actions.dispatch('leaveGroup', {}, { origin: 'assistant' });
    await actions.dispatch('closeGroup', {}, { origin: 'ui' });
    stop();
    await actions.dispatch('closeGroup', {});

    expect(records).toEqual([
      {
        name: 'leaveGroup',
        origin: 'assistant',
        status: 'needs_confirmation',
        detail: 'Leave this group?',
      },
      { name: 'closeGroup', origin: 'ui', status: 'done', detail: null },
    ]);
  });

  it('describes every action with a JSON Schema and a valid example', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);
    const described = actions.describe();

    expect(described.map((action) => action.name)).toContain('createGroup');
    expect(
      described.find((action) => action.name === 'createGroup')?.inputSchema,
    ).toMatchObject({
      type: 'object',
      required: ['name', 'yourName'],
    });
    expect(
      described.filter((action) => action.confirms).map((action) => action.name),
    ).toEqual(['selectYou', 'replaceInviteLink', 'leaveGroup']);
  });
});
