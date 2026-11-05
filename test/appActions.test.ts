import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { commandFromIntent } from '../src/domain/commands';
import {
  createDispatcher,
  type ActionHost,
  type DispatchRecord,
} from '../apps/client/src/model/actions';
import type { AppState } from '../apps/client/src/model/controller';
import { browseActions } from '../apps/client/src/devtools/catalog';
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
    lastYouName: () => 'Ana',
    refresh: () => record('refresh'),
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
    // Records the command the SDK would queue, without generated identifiers.
    submit: (intent) => {
      const snapshot = state.group?.projected_snapshot;

      if (!snapshot) throw new Error('no_group_selected');
      const command = commandFromIntent(intent, snapshot, () => 'generated');

      const values = Object.values(command.payload).filter((value) => value !== 'generated');

      return record([command.type, ...values.map((value) => JSON.stringify(value).replace(/^"|"$/g, ''))].join(' '));
    },
    regenerateInvite: () => record('regenerateInvite'),
    retryNotice: (id) => record(`retryNotice ${id}`),
    dismissNotice: (id) => record(`dismissNotice ${id}`),
    client: {
      previewInvite: async (groupId) => {
        await record(`previewInvite ${groupId}`);

        return { group: { id: groupId ?? 'codeGroup_____________', name: 'Trip' }, members: [] };
      },
    },
  };

  return {
    host,
    state,
    calls,
    fail: (code: string) => {
      failure = code;
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: Error) => void = () => undefined;

  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

describe('app actions', () => {
  it('offers split controls for people an existing expense names even after they are hidden', async () => {
    const { host, state } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('showExpense', {});

    for (const member of state.group!.projected_snapshot!.members) member.status = 'hidden';

    const [ana, ben] = actions.inputOptions('expenseMember');

    expect(await actions.dispatch('increaseExpenseShare', { memberId: ana!.value })).toMatchObject({ status: 'done' });
    expect(await actions.dispatch('setExpenseFixedAmount', { memberId: ben!.value, amount: '20' })).toMatchObject({ status: 'done' });
    expect(actions.inputOptions('expenseMember')).toHaveLength(2);
    expect(await actions.dispatch('decreaseExpenseShare', { memberId: ben!.value })).toMatchObject({ status: 'done' });
  });

  it('edits mixed expense splits offline and protects the last person sharing the remainder', async () => {
    const { host, calls } = createHost({ connection: 'offline' });
    const actions = createDispatcher(host);
    const ana = 'member-1______________';
    const ben = 'member-2______________';

    expect(await actions.dispatch('showExpense', {})).toMatchObject({ status: 'done' });
    await actions.dispatch('changeDraft', { field: 'expense.amount', value: '100' });
    await actions.dispatch('changeDraft', { field: 'expense.description', value: 'Dinner' });
    expect(await actions.dispatch('increaseExpenseShare', { memberId: ben })).toMatchObject({ status: 'done' });
    expect(actions.ui.snapshot().expense.parts).toEqual([{ kind: 'shares', member_id: ana, shares: 1 }, { kind: 'shares', member_id: ben, shares: 2 }]);
    const fixed = await actions.dispatch('setExpenseFixedAmount', { memberId: ana, amount: '20' });

    expect(fixed.status, JSON.stringify(fixed)).toBe('done');
    expect(actions.ui.snapshot().expense.parts).toEqual([{ kind: 'exact', member_id: ana, amount: '20' }, { kind: 'shares', member_id: ben, shares: 1 }]);
    expect(actions.availability('toggleExpenseParticipant', { memberId: ben })).toMatchObject({ available: false, error: 'last_share' });
    expect(await actions.dispatch('decreaseExpenseShare', { memberId: ben })).toMatchObject({ status: 'failed', error: 'last_share' });
    expect(await actions.dispatch('setExpenseFixedAmount', { memberId: ben, amount: '30' })).toMatchObject({ status: 'failed', error: 'last_share' });
    expect(actions.inputOptions('expenseMember').map((option) => option.value)).toEqual([ana, ben]);
    expect(await actions.dispatch('saveExpense', {})).toMatchObject({ status: 'done' });
    expect(calls.at(-1)).toContain('"kind":"exact","member_id":"member-1______________","amount":2000');
    expect(calls.at(-1)).toContain('"kind":"shares","member_id":"member-2______________","shares":1');
  });

  it('protects a pending member save across callers while unrelated offline edits remain available', async () => {
    const { host, calls } = createHost({ connection: 'offline' });
    const request = deferred<void>();
    const target = 'member-1______________';
    const other = 'member-2______________';

    const actions = createDispatcher({
      ...host,
      submit: (intent) => intent.type === 'member.rename' && intent.payload.member_id === target ? request.promise : host.submit(intent),
    });

    const updates: number[] = [];
    const unsubscribe = actions.executions.subscribe(() => updates.push(actions.executions.snapshot().length));

    await actions.dispatch('beginEditMember', { memberId: target });
    await actions.dispatch('changeDraft', { field: 'member.name', value: 'Anita' });
    const save = actions.dispatch('saveMemberEdit', {}, { origin: 'ui' });

    expect(actions.state().executions).toMatchObject([{ name: 'saveMemberEdit', origin: 'ui' }]);
    expect(actions.availability('saveMemberEdit', {})).toMatchObject({ available: false, error: 'operation_busy' });
    expect(await actions.dispatchJson('saveMemberEdit', {}, { origin: 'devtools' })).toMatchObject({ status: 'failed', error: 'operation_busy' });
    expect(await actions.dispatch('removeMember', { memberId: target })).toMatchObject({ status: 'failed', error: 'operation_busy' });
    expect(await actions.dispatch('changeDraft', { field: 'member.name', value: 'Lost draft' })).toMatchObject({ status: 'failed', error: 'operation_busy' });
    expect(await actions.dispatch('cancelMemberEdit', {})).toMatchObject({ status: 'failed', error: 'operation_busy' });
    expect(await actions.dispatch('showGroups', {})).toMatchObject({ status: 'failed', error: 'operation_busy' });
    expect(await actions.dispatch('beginEditMember', { memberId: other })).toMatchObject({ status: 'failed', error: 'operation_busy' });
    expect(await actions.dispatch('createMember', { name: 'Dev' })).toMatchObject({ status: 'done' });
    expect(await actions.dispatch('renameMember', { memberId: other, name: 'Benjamin' })).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['member.create Dev', `member.rename ${other} Benjamin Ben`]);
    request.reject(new Error('request_failed'));
    expect(await save).toMatchObject({ status: 'failed', error: 'request_failed' });
    expect(actions.state().ui.memberEdit).toMatchObject({ memberId: target, name: 'Anita', expectedName: 'Ana' });
    expect(actions.state().executions).toEqual([]);
    expect(actions.availability('saveMemberEdit', {}).available).toBe(true);
    expect(updates).toContain(1);
    expect(updates.at(-1)).toBe(0);
    unsubscribe();
  });

  it('makes workflow steps wait while a navigation loads its group', async () => {
    const { host, state } = createHost();
    const opening = deferred<void>();
    const actions = createDispatcher({ ...host, openGroup: () => opening.promise });
    const open = actions.dispatch('openGroup', { groupId: state.group?.group_id ?? '' });

    expect(actions.availability('showCreateGroup', {})).toMatchObject({ available: false, error: 'operation_busy' });
    expect(await actions.dispatch('createGroup', { name: 'Ski', yourName: 'Ana' })).toMatchObject({ status: 'failed', error: 'operation_busy' });
    opening.resolve();
    expect(await open).toMatchObject({ status: 'done' });
    expect(actions.availability('showCreateGroup', {}).available).toBe(true);
  });

  it('returns from a panel or member editor whose group goes away', async () => {
    const { host, state } = createHost();
    const listeners = new Set<() => void>();
    let current = state;

    const actions = createDispatcher({
      ...host,
      snapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    });

    // Another tab left the group; this one learns of it by synchronizing.
    const publish = (hidden: boolean) => {
      current = { ...state, group: state.group && { ...state.group, hidden } };

      for (const listener of listeners) listener();
    };

    await actions.dispatch('showSettings', {});
    publish(true);
    expect(actions.state().ui).toMatchObject({ view: 'home', navigation: { mode: 'replace' } });

    publish(false);
    await actions.dispatch('beginAddMember', {});
    publish(true);
    expect(actions.state().ui.memberEdit).toBeNull();
  });

  it('finishes a leave without moving the view another running step decides', async () => {
    const { host } = createHost();
    const leaving = deferred<void>();
    const creating = deferred<void>();

    const actions = createDispatcher({
      ...host,
      submit: (intent) => (intent.type === 'group.leave' ? leaving.promise : host.submit(intent)),
      createGroup: () => creating.promise,
    });

    const leave = actions.dispatch('leaveGroup', {}, { confirmed: true });
    const create = actions.dispatch('createGroup', { name: 'Ski', yourName: 'Ana' });

    expect(actions.state().ui.phase).toBe('creating');
    leaving.resolve();
    expect(await leave).toMatchObject({ status: 'done' });
    expect(actions.state().ui.phase).toBe('creating');
    creating.resolve();
    expect(await create).toMatchObject({ status: 'done' });
  });

  it('releases successful operations and exposes input choices and a live workflow map', async () => {
    const { host } = createHost();
    const request = deferred<void>();
    const actions = createDispatcher({ ...host, createGroup: () => request.promise });
    const original = actions.state().ui;

    expect(actions.inputOptions('member')).toEqual([
      { value: 'member-1______________', label: 'Ana (you)' },
      { value: 'member-2______________', label: 'Ben' },
    ]);
    await actions.dispatch('showCreateGroup', {});
    await actions.dispatch('changeDraft', { field: 'create.name', value: 'Trip' });
    const map = actions.stateActionMap();

    expect(map.current).toEqual({ view: 'create', phase: 'editing' });
    expect(map.actions.find((entry) => entry.name === 'submitCreateGroup')).toMatchObject({
      availability: { available: true },
      workflowEffect: { kind: 'phase', view: 'create', phase: 'creating' },
    });
    expect(actions.state().ui).not.toBe(original);
    const beforeInspection = actions.state().ui;

    actions.stateActionMap();
    expect(actions.state().ui).toBe(beforeInspection);
    const creation = actions.dispatch('submitCreateGroup', {}, { origin: 'devtools' });
    const pending = actions.stateActionMap();

    expect(pending.current).toEqual({ view: 'create', phase: 'creating' });
    expect(pending.completions).toEqual([
      { event: 'succeeded', view: 'home', phase: 'ready' },
      { event: 'failed', view: 'create', phase: 'editing' },
    ]);
    expect(pending.actions.find((entry) => entry.name === 'submitCreateGroup')?.running).toMatchObject([{ origin: 'devtools' }]);
    request.resolve();
    await creation;
    expect(actions.stateActionMap().executions).toEqual([]);
    expect(actions.stateActionMap().current).toEqual({ view: 'home', phase: 'ready' });
  });

  it('shares creation state across callers and restores the draft after a failed request', async () => {
    const { host, calls } = createHost();
    const request = deferred<void>();
    let creations = 0;

    const actions = createDispatcher({
      ...host,
      createGroup: () => {
        creations += 1;

        return request.promise;
      },
    });

    await actions.dispatch('showCreateGroup', {});
    await actions.dispatch('changeDraft', {
      field: 'create.name',
      value: 'Trip',
    });
    const running = actions.dispatch('submitCreateGroup', {}, { origin: 'ui' });
    expect(actions.state().ui).toMatchObject({
      view: 'create',
      phase: 'creating',
    });

    for (const name of [
      'submitCreateGroup',
      'showGroups',
      'showSettings',
    ] as const)
      expect(actions.availability(name)).toMatchObject({
        available: false,
        error: 'workflow_busy',
      });
    expect(
      await actions.dispatch('submitCreateGroup', {}, { origin: 'devtools' }),
    ).toMatchObject({ status: 'failed', error: 'workflow_busy' });
    expect(
      await actions.dispatch('createGroup', {
        name: 'Second',
        yourName: 'Ana',
      }),
    ).toMatchObject({ status: 'failed', error: 'workflow_busy' });
    expect(
      await actions.dispatch('changeDraft', {
        field: 'create.name',
        value: 'Changed during request',
      }),
    ).toMatchObject({ status: 'failed', error: 'workflow_busy' });
    // Domain edits remain independent of the visible workflow.
    expect(
      await actions.dispatch('renameMember', {
        memberId: 'member-2______________',
        name: 'Benji',
      }),
    ).toMatchObject({ status: 'done' });
    expect(creations).toBe(1);
    request.reject(new Error('request_failed'));
    expect(await running).toMatchObject({
      status: 'failed',
      error: 'request_failed',
    });
    expect(actions.state().ui).toMatchObject({
      view: 'create',
      phase: 'editing',
      create: { name: 'Trip', yourName: 'Ana' },
    });
    expect(Object.hasOwn(actions.state().ui, 'requestId')).toBe(false);
    expect(actions.availability('submitCreateGroup').available).toBe(true);
    expect(calls).toEqual(['member.rename member-2______________ Benji Ben']);
  });

  it('restores join choices on failure and blocks duplicate direct joins', async () => {
    const { host } = createHost();
    const request = deferred<void>();
    let joins = 0;

    const actions = createDispatcher({
      ...host,
      joinGroup: () => {
        joins += 1;

        return request.promise;
      },
    });

    const groupId = 'uy9ogmKJRD2VRfbN4PDsAw';
    await actions.dispatch('checkInvite', {
      link: `https://app.test/join/${groupId}#${'w'.repeat(43)}`,
    });
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    const running = actions.dispatch('submitJoin', {});

    expect(actions.state().ui).toMatchObject({
      view: 'join',
      phase: 'joining',
    });
    expect(actions.availability('chooseJoinMember')).toMatchObject({ available: false, error: 'workflow_busy' });
    expect(
      await actions.dispatch('joinGroup', {
        groupId,
        as: { kind: 'new', name: 'Dev' },
        token: 'token',
      }),
    ).toMatchObject({ status: 'failed', error: 'workflow_busy' });
    expect(actions.availability('chooseJoinMember').available).toBe(false);
    expect(actions.availability('closePanel').available).toBe(false);
    request.reject(new Error('request_failed'));
    await running;
    expect(actions.state().ui).toMatchObject({
      view: 'join',
      phase: 'choosing',
      join: { chosen: 'new', name: 'Ana' },
    });
    expect(actions.availability('submitJoin').available).toBe(true);
    expect(joins).toBe(1);
  });

  it('ignores an obsolete invite failure while a newer preview succeeds', async () => {
    const { host } = createHost();

    const older =
      deferred<Awaited<ReturnType<ActionHost['client']['previewInvite']>>>();

    const newer =
      deferred<Awaited<ReturnType<ActionHost['client']['previewInvite']>>>();

    const firstToken = 'a'.repeat(43);
    const secondToken = 'b'.repeat(43);
    const groupId = 'uy9ogmKJRD2VRfbN4PDsAw';

    const actions = createDispatcher({
      ...host,
      client: {
        previewInvite: (group, token) =>
          token === firstToken ? older.promise : newer.promise,
      },
    });

    const first = actions.dispatch('checkInvite', {
      link: `https://app.test/join/${groupId}#${firstToken}`,
    });

    expect(actions.state().ui.phase).toBe('checking');
    expect(actions.availability('checkInvite').available).toBe(false);
    expect(actions.availability('closePanel').available).toBe(true);
    await actions.dispatch('changeDraft', {
      field: 'join.link',
      value: `https://app.test/join/${groupId}#${secondToken}`,
    });
    expect(actions.state().ui.phase).toBe('link');

    const second = actions.dispatch('checkInvite', {
      link: actions.state().ui.join.link,
    });

    await Promise.resolve();
    newer.resolve({ group: { id: groupId, name: 'New preview' }, members: [] });
    await second;
    older.reject(new Error('invite_replaced'));
    await first;
    expect(actions.state().ui).toMatchObject({
      view: 'join',
      phase: 'choosing',
      join: { preview: { group: { name: 'New preview' } } },
    });
    expect(Object.hasOwn(actions.state().ui, 'requestId')).toBe(false);
  });

  it('runs direct creation without opening a form and returns to ready state', async () => {
    const { host } = createHost();
    const request = deferred<void>();

    const actions = createDispatcher({
      ...host,
      createGroup: () => request.promise,
    });

    const running = actions.dispatch('createGroup', {
      name: 'Trip',
      yourName: 'Ana',
    });

    expect(actions.state().ui).toMatchObject({
      view: 'home',
      phase: 'creating',
    });
    request.resolve();
    await running;
    expect(actions.state().ui).toMatchObject({ view: 'home', phase: 'ready' });
    expect(Object.hasOwn(actions.state().ui, 'resume')).toBe(false);
  });

  it('tracks settings saving while preserving offline ledger behavior', async () => {
    const { host, calls } = createHost({ connection: 'offline' });
    const request = deferred<void>();

    const actions = createDispatcher({
      ...host,
      submit: (intent) => intent.type === 'group.rename' ? request.promise : host.submit(intent),
    });

    await actions.dispatch('showSettings', {});
    await actions.dispatch('changeDraft', {
      field: 'settings.name',
      value: 'Offline rename',
    });
    const saving = actions.dispatch('saveGroupSettings', {});

    expect(actions.state().ui.phase).toBe('saving');
    expect(actions.availability('saveGroupSettings').available).toBe(false);
    expect(actions.availability('closePanel').available).toBe(false);
    expect(await actions.dispatch('createMember', { name: 'Dev' })).toMatchObject({
      status: 'done',
    });
    request.reject(new Error('request_failed'));
    await saving;
    expect(actions.state().ui).toMatchObject({
      view: 'settings',
      phase: 'editing',
      settings: { name: 'Offline rename' },
    });
    expect(actions.availability('saveGroupSettings').available).toBe(true);
    expect(calls).toEqual(['member.create Dev']);
  });

  it('keeps the member editor during direct creation and restores it on failure', async () => {
    const { host, state } = createHost();
    const request = deferred<void>();

    const actions = createDispatcher({
      ...host,
      createGroup: () => request.promise,
    });

    await actions.dispatch('beginAddMember', {});
    await actions.dispatch('changeDraft', {
      field: 'member.name',
      value: 'Dev',
    });

    const running = actions.dispatch('createGroup', {
      name: 'Trip',
      yourName: 'Ana',
    });

    state.syncError = new Error('request_failed');
    expect(actions.state().ui).toMatchObject({
      view: 'home',
      phase: 'creating',
    });
    expect(actions.availability('refreshGroups').available).toBe(true);
    expect(actions.availability('saveMemberEdit').available).toBe(true);
    expect(actions.availability('showGroups')).toMatchObject({ available: false, error: 'workflow_busy' });

    request.reject(new Error('request_failed'));
    await running;
    expect(actions.availability('showGroups').available).toBe(true);
    expect(actions.state().ui.memberEdit?.name).toBe('Dev');
  });

  it('allows leaving a pending invite check, then offers member choices', async () => {
    const { host, state } = createHost();

    const preview =
      deferred<Awaited<ReturnType<ActionHost['client']['previewInvite']>>>();

    const actions = createDispatcher({
      ...host,
      client: { previewInvite: () => preview.promise },
    });

    const groupId = 'uy9ogmKJRD2VRfbN4PDsAw';
    const link = `https://splitnext.test/join/${groupId}#${'w'.repeat(43)}`;

    const running = actions.dispatch('checkInvite', { link });
    state.syncError = new Error('request_failed');
    expect(actions.state().ui.phase).toBe('checking');
    expect(actions.availability('refreshGroups').available).toBe(true);
    expect(actions.availability('showGroups').available).toBe(true);
    expect(actions.availability('checkInvite', { link }).available).toBe(false);
    expect(actions.availability('chooseJoinMember').available).toBe(false);

    preview.resolve({ group: { id: groupId, name: 'Trip' }, members: [] });
    await running;
    expect(actions.availability('chooseJoinMember').available).toBe(true);
    expect(actions.availability('submitJoin').available).toBe(false);
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    expect(actions.availability('submitJoin').available).toBe(true);
  });

  it('classifies actions by purpose without secondary categories', () => {
    const actions = createDispatcher(createHost().host).describe();

    const group = (name: string) =>
      actions.find((action) => action.name === name)?.group;

    expect(group('showSettings')).toBe('UI');
    expect(group('copyInviteLink')).toBe('UI');
    expect(group('confirmAction')).toBe('UI');
    expect(group('saveMemberEdit')).toBe('Ledger changes');
    expect(group('saveGroupSettings')).toBe('Ledger changes');
    expect(group('submitCreateGroup')).toBe('Access & sync');
    expect(group('submitJoin')).toBe('Access & sync');
    expect(group('regenerateInvite')).toBe('Access & sync');
    expect(
      actions
        .filter((action) => action.group === 'Ledger changes')
        .every(
          (action) =>
            !action.requires.includes('online') &&
            !action.requires.includes('reachable'),
        ),
    ).toBe(true);
    expect(
      actions
        .filter((action) => action.group === 'Access & sync')
        .every(
          (action) =>
            action.requires.includes('online') ||
            action.requires.includes('reachable'),
        ),
    ).toBe(true);
    expect(actions.every((action) => !Object.hasOwn(action, 'category'))).toBe(
      true,
    );
  });

  it('puts unavailable actions last in each group and updates order with state', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);
    const filters = { group: 'UI' } as const;
    const before = browseActions(actions.describe(), filters);
    const available = before.filter((action) => action.availability.available);

    const unavailable = before.filter(
      (action) => !action.availability.available,
    );

    expect(before.map((action) => action.name)).toEqual([
      ...available.map((action) => action.name),
      ...unavailable.map((action) => action.name),
    ]);
    expect(available.map((action) => action.name)).toEqual(
      actions
        .describe()
        .filter(
          (action) => action.group === 'UI' && action.availability.available,
        )
        .map((action) => action.name),
    );
    expect(unavailable.map((action) => action.name)).toContain('closePanel');
    await actions.dispatch('showSettings', {});
    const after = browseActions(actions.describe(), filters);

    expect(
      after
        .filter((action) => action.availability.available)
        .map((action) => action.name),
    ).toContain('closePanel');
  });

  it('reports live group requirements without dispatching or logging', () => {
    const { host, state, calls } = createHost();
    const actions = createDispatcher(host);
    const records: DispatchRecord[] = [];
    actions.observe((record) => records.push(record));
    const group = state.group;
    state.group = null;
    expect(actions.availability('showSettings')).toMatchObject({
      available: false,
      error: 'no_open_group',
      reason: 'Open a group first.',
    });
    expect(
      actions.describe().find((entry) => entry.name === 'showSettings')
        ?.availability.available,
    ).toBe(false);
    state.group = group;
    expect(actions.availability('showSettings')).toEqual({ available: true });
    expect(calls).toEqual([]);
    expect(records).toEqual([]);
  });

  it('enables draft submission only in its open form with valid changed input', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);
    expect(actions.availability('submitCreateGroup')).toMatchObject({
      available: false,
      error: 'form_not_open',
    });
    await actions.dispatch('showCreateGroup', {});
    expect(actions.availability('submitCreateGroup')).toMatchObject({
      available: false,
      reason: 'Enter a valid group name.',
    });
    expect(await actions.dispatch('submitCreateGroup', {})).toMatchObject({
      status: 'failed',
      error: 'invalid_input',
    });
    await actions.dispatch('changeDraft', {
      field: 'create.name',
      value: 'Trip',
    });
    expect(actions.availability('submitCreateGroup')).toEqual({
      available: true,
    });
    await actions.dispatch('closePanel', {});
    expect(actions.availability('submitCreateGroup').available).toBe(false);
    await actions.dispatch('showSettings', {});
    expect(actions.availability('saveGroupSettings')).toMatchObject({
      available: false,
      error: 'draft_unchanged',
    });
    await actions.dispatch('changeDraft', {
      field: 'settings.name',
      value: 'Changed',
    });
    expect(actions.availability('saveGroupSettings').available).toBe(true);
    expect(
      actions.availability('changeDraft', {
        field: 'create.name',
        value: 'Hidden',
      }),
    ).toMatchObject({ available: false, error: 'form_not_open' });
    expect(calls).toEqual([]);
  });

  it('keeps offline ledger edits available and rejects stale member choices', async () => {
    const { host, calls, state } = createHost({ connection: 'offline' });
    const actions = createDispatcher(host);
    expect(actions.availability('createMember')).toEqual({ available: true });
    expect(actions.availability('createMember', { name: '' })).toMatchObject({
      available: false,
      error: 'invalid_input',
    });
    expect(actions.availability('createMember', { name: 'Dev' })).toEqual({
      available: true,
    });
    expect(actions.availability('regenerateInvite')).toMatchObject({
      available: false,
      error: 'client_offline',
    });
    const snapshot = state.group?.projected_snapshot;

    if (!snapshot) throw new Error('missing_fixture');
    snapshot.members[1]!.status = 'hidden';
    const input = { memberId: 'member-2______________' };
    expect(actions.availability('beginEditMember', input)).toMatchObject({
      available: false,
      error: 'member_not_found',
    });
    expect(await actions.dispatch('beginEditMember', input)).toMatchObject({
      status: 'failed',
      error: 'member_not_found',
    });
    expect(calls).toEqual([]);
  });

  it('checks platform support and empty editors, notices, and confirmations', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);

    for (const name of [
      'copyInviteLink',
      'shareInviteLink',
      'showHomepage',
    ] as const)
      expect(actions.availability(name)).toMatchObject({
        available: false,
        error: 'platform_unavailable',
      });
    expect(actions.availability('saveMemberEdit')).toMatchObject({
      available: false,
      error: 'no_member_edit',
    });
    expect(actions.availability('confirmAction')).toMatchObject({
      available: false,
      error: 'confirmation_not_found',
    });
    await actions.dispatch('beginAddMember', {});
    expect(actions.availability('saveMemberEdit').available).toBe(true);
    await actions.dispatch('cancelMemberEdit', {});
    expect(actions.availability('saveMemberEdit').available).toBe(false);

    const supported = createDispatcher(host, {
      appUrl: 'https://splitnext.test',
      copyText: async () => undefined,
    });

    expect(supported.availability('copyInviteLink').available).toBe(true);
  });

  it('updates join availability as a preview, choice, and name become ready', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);
    expect(actions.availability('submitJoin')).toMatchObject({
      available: false,
      error: 'join_not_open',
    });
    await actions.dispatch('showJoinGroup', {});
    expect(actions.availability('chooseJoinMember').available).toBe(false);
    await actions.dispatch('checkInvite', {
      link: `https://splitnext.test/join/uy9ogmKJRD2VRfbN4PDsAw#${'w'.repeat(43)}`,
    });
    expect(actions.availability('chooseJoinMember').available).toBe(true);
    expect(actions.availability('submitJoin')).toMatchObject({
      available: false,
      reason: 'Choose a name first.',
    });
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    await actions.dispatch('changeDraft', { field: 'join.name', value: '' });
    expect(actions.availability('submitJoin')).toMatchObject({
      available: false,
      error: 'invalid_input',
    });
    await actions.dispatch('changeDraft', { field: 'join.name', value: 'Dev' });
    expect(actions.availability('submitJoin').available).toBe(true);
    await actions.dispatch('clearInvitePreview', {});
    expect(actions.availability('submitJoin').available).toBe(false);
  });

  it('joins through a short link, whose preview names the group', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('checkInvite', { link: 'https://splitnext.test/j#Xk3m9QpL2vT7' });
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    await actions.dispatch('changeDraft', { field: 'join.name', value: 'Dev' });
    await actions.dispatch('submitJoin', {});
    expect(calls).toEqual([
      'previewInvite null',
      'openJoinedGroup codeGroup_____________',
      'joinGroup codeGroup_____________ Dev Xk3m9QpL2vT7',
    ]);
  });

  it('fades approval when its original action becomes unavailable but still allows cancellation', async () => {
    const { host, state, calls } = createHost();
    const actions = createDispatcher(host);
    await actions.dispatch('regenerateInvite', {});
    const requestId = actions.state().ui.confirmation?.id ?? '';
    const input = { requestId };
    expect(actions.availability('confirmAction', input).available).toBe(true);
    state.online = false;
    expect(actions.availability('confirmAction', input)).toMatchObject({
      available: false,
      reason: 'Go online first.',
    });
    expect(await actions.dispatch('confirmAction', input)).toMatchObject({
      status: 'failed',
      error: 'client_offline',
    });
    expect(actions.availability('cancelConfirmation', input).available).toBe(
      true,
    );
    state.online = true;
    expect(actions.availability('confirmAction', input).available).toBe(true);
    await actions.dispatch('cancelConfirmation', input);
    expect(actions.availability('confirmAction', input).available).toBe(false);
    expect(calls).toEqual([]);
  });

  it('shares navigation and drafts between UI and devtools callers', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);
    const views: string[] = [];

    const stop = actions.ui.subscribe(() =>
      views.push(actions.ui.snapshot().view),
    );

    await actions.dispatchJson('showSettings', {}, { origin: 'devtools' });
    expect(actions.state().ui.settings.expectedName).toBe('Workbench trip');
    await actions.dispatch(
      'changeDraft',
      { field: 'settings.name', value: 'New trip' },
      { origin: 'ui' },
    );
    expect(actions.state().ui.settings.name).toBe('New trip');
    await actions.dispatchJson('saveGroupSettings', {}, { origin: 'devtools' });
    expect(calls).toEqual(['group.rename New trip Workbench trip']);
    expect(actions.ui.snapshot().view).toBe('home');
    expect(views).toContain('settings');
    stop();
  });

  it('keeps settled people folded when adding or renaming a member', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('beginEditMember', { memberId: 'member-2______________' });
    await actions.dispatch('changeDraft', { field: 'member.name', value: 'Benjamin' });
    await actions.dispatch('saveMemberEdit', {});
    expect(actions.state().ui.balancesExpanded).toBe(false);

    await actions.dispatch('beginAddMember', {});
    await actions.dispatch('changeDraft', { field: 'member.name', value: 'Cy' });
    expect(await actions.dispatch('saveMemberEdit', {})).toMatchObject({ status: 'done' });
    expect(calls).toContain('member.create Cy');
    expect(actions.state().ui.balancesExpanded).toBe(false);
  });

  it('retains failed drafts and discards cancelled member edits without saving', async () => {
    const { host, calls, fail } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('beginEditMember', { memberId: 'member-2______________' });
    await actions.dispatch('changeDraft', {
      field: 'member.name',
      value: 'Benjamin',
    });
    fail('member_name_taken');
    expect(await actions.dispatch('saveMemberEdit', {})).toMatchObject({
      status: 'failed',
    });
    expect(actions.state().ui.memberEdit).toMatchObject({
      memberId: 'member-2______________',
      name: 'Benjamin',
      expectedName: 'Ben',
    });
    await actions.dispatch('cancelMemberEdit', {});
    expect(actions.state().ui.memberEdit).toBeNull();
    expect(calls).toEqual(['member.rename member-2______________ Benjamin Ben']);
  });

  it('protects the saving editor and permits another editor after completion', async () => {
    const { host } = createHost();
    let release: () => void = () => undefined;

    const saved = new Promise<void>((resolve) => {
      release = resolve;
    });

    const actions = createDispatcher({ ...host, submit: () => saved });

    await actions.dispatch('beginEditMember', { memberId: 'member-2______________' });
    await actions.dispatch('changeDraft', {
      field: 'member.name',
      value: 'Benjamin',
    });
    const save = actions.dispatch('saveMemberEdit', {});
    expect(await actions.dispatch('beginEditMember', { memberId: 'member-1______________' })).toMatchObject({ status: 'failed', error: 'operation_busy' });
    release();
    await save;
    expect(actions.state().ui.memberEdit).toBeNull();
    await actions.dispatch('beginEditMember', { memberId: 'member-1______________' });
    expect(actions.state().ui.memberEdit).toMatchObject({
      memberId: 'member-1______________',
      name: 'Ana',
    });
  });

  it('creates using the current form draft and prefills the remembered name', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('showCreateGroup', {});
    expect(actions.state().ui.create.yourName).toBe('Ana');
    await actions.dispatch('changeDraft', {
      field: 'create.name',
      value: 'Trip',
    });
    await actions.dispatch('submitCreateGroup', {});
    expect(calls).toEqual(['createGroup Trip Ana']);
    expect(actions.state().ui.view).toBe('home');
  });

  it('keeps delayed invite previews from reopening a closed view', async () => {
    const { host } = createHost();
    let release: () => void = () => undefined;

    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });

    const actions = createDispatcher({
      ...host,
      client: {
        previewInvite: async (groupId) => {
          await delayed;

          return { group: { id: groupId ?? 'codeGroup_____________', name: 'Trip' }, members: [] };
        },
      },
    });

    const link = `https://splitnext.test/join/uy9ogmKJRD2VRfbN4PDsAw#${'w'.repeat(43)}`;
    const checking = actions.dispatch('checkInvite', { link });
    await Promise.resolve();
    await actions.dispatch('closePanel', {});
    release();
    await checking;
    expect(actions.state().ui.view).toBe('home');
    expect(actions.state().ui.join.preview).toBeNull();
  });

  it('lets any caller approve or cancel the same pending confirmation', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('regenerateInvite', {}, { origin: 'ui' });
    const first = actions.state().ui.confirmation;
    expect(first?.name).toBe('regenerateInvite');
    await actions.dispatch(
      'cancelConfirmation',
      { requestId: first?.id ?? '' },
      { origin: 'devtools' },
    );
    expect(actions.state().ui.confirmation).toBeNull();
    expect(calls).toEqual([]);
    await actions.dispatch('regenerateInvite', {}, { origin: 'devtools' });
    const second = actions.state().ui.confirmation;
    expect(
      await actions.dispatch('confirmAction', { requestId: first?.id ?? '' }),
    ).toMatchObject({ status: 'failed', error: 'confirmation_not_found' });
    expect(
      await actions.dispatch(
        'confirmAction',
        { requestId: second?.id ?? '' },
        { origin: 'ui' },
      ),
    ).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['regenerateInvite']);
  });

  it('joins using the shared preview, member choice, and name draft', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);
    const groupId = 'uy9ogmKJRD2VRfbN4PDsAw';
    const token = 'w'.repeat(43);
    await actions.dispatch('checkInvite', {
      link: `https://splitnext.test/join/${groupId}#${token}`,
    });
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    await actions.dispatch('changeDraft', { field: 'join.name', value: 'Dev' });
    expect(await actions.dispatch('submitJoin', {})).toMatchObject({
      status: 'done',
    });
    expect(calls.at(-1)).toBe(`joinGroup ${groupId} Dev ${token}`);
    expect(actions.state().ui.view).toBe('home');
  });

  it('opens a rejoin form for left groups and can return from it', async () => {
    const { host, state, calls } = createHost();

    if (!state.group) throw new Error('missing_fixture');
    state.group = { ...state.group, hidden: true };
    const actions = createDispatcher(host);
    await actions.dispatch('openGroup', { groupId: state.group.group_id });
    expect(actions.state().ui.view).toBe('rejoin');
    await actions.dispatch('chooseJoinMember', {
      as: { kind: 'existing', memberId: 'member-1______________' },
    });
    expect(await actions.dispatch('submitJoin', {})).toMatchObject({
      status: 'done',
    });
    expect(calls.at(-1)).toBe(`joinGroup ${state.group.group_id} member-1______________ -`);
    await actions.dispatch('showRejoin', {});
    await actions.dispatch('closePanel', {});
    expect(actions.state().ui.view).toBe('home');
  });

  it('rechecks requirements when approving an action from another caller', async () => {
    const { host, state, calls } = createHost();
    const actions = createDispatcher(host);
    await actions.dispatch('regenerateInvite', {});
    const requestId = actions.state().ui.confirmation?.id ?? '';
    state.online = false;
    expect(
      await actions.dispatch('confirmAction', { requestId }),
    ).toMatchObject({ status: 'failed', error: 'client_offline' });
    expect(calls).toEqual([]);
  });

  it('cannot submit a draft after closing its form', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);
    await actions.dispatch('showSettings', {});
    await actions.dispatch('changeDraft', {
      field: 'settings.name',
      value: 'Unsaved',
    });
    await actions.dispatch('closePanel', {});
    expect(await actions.dispatch('saveGroupSettings', {})).toMatchObject({
      status: 'failed',
      error: 'form_not_open',
    });
    expect(await actions.dispatch('submitCreateGroup', {})).toMatchObject({
      status: 'failed',
      error: 'form_not_open',
    });
    expect(calls).toEqual([]);
  });

  it('copies a diagnostics report of recent actions without names, links, or inputs', async () => {
    const { host } = createHost();
    let copied = '';

    const actions = createDispatcher(host, {
      appUrl: 'https://splitnext.test',
      copyText: async (text) => {
        copied = text;
      },
    });

    await actions.dispatch('createMember', { name: 'Private Name' });
    await actions.dispatch('renameMember', { memberId: 'member-404____________', name: 'Other' });
    expect(await actions.dispatch('copyDiagnostics', {})).toMatchObject({ status: 'done' });

    const report = z.object({
      open_group: z.object({ group_id: z.string() }),
      dispatches: z.array(z.object({ name: z.string(), status: z.string(), detail: z.string().nullable(), invocationId: z.string() })),
    }).parse(JSON.parse(copied));

    expect(report.dispatches.map((entry) => [entry.name, entry.status, entry.detail])).toEqual([
      ['renameMember', 'failed', 'member_not_found'],
      ['createMember', 'done', null],
    ]);

    for (const hidden of ['Private Name', 'Workbench trip', 'Ana', 'w'.repeat(43)]) expect(copied).not.toContain(hidden);
    expect(actions.diagnostics.snapshot().dispatches[0]).toMatchObject({ name: 'copyDiagnostics', status: 'done' });
  });

  it('uses platform adapters for copy and share while reporting copied state', async () => {
    const { host } = createHost();
    const copied: string[] = [];
    const shared: string[] = [];

    const actions = createDispatcher(host, {
      appUrl: 'https://splitnext.test',
      copyText: async (link) => {
        copied.push(link);
      },
      shareLink: async (link) => {
        shared.push(link);
      },
    });

    await actions.dispatch('copyInviteLink', {});
    await actions.dispatch('shareInviteLink', {});
    expect(copied).toEqual(shared);
    expect(actions.state().ui.copiedInviteId).toBe('workbench-invite______');
    expect(
      await createDispatcher(host).dispatch('copyInviteLink', {}),
    ).toMatchObject({ status: 'failed', error: 'platform_unavailable' });
  });

  it('describes groups and removes the misleading closeGroup action', () => {
    const actions = createDispatcher(createHost().host);
    expect(
      actions.describe().find((entry) => entry.name === 'showSettings')?.group,
    ).toBe('UI');
    expect(actions.describe().every((entry) => entry.group.length > 0)).toBe(
      true,
    );
    expect(actions.describe().map((entry) => entry.name)).toContain(
      'showGroups',
    );
    expect(actions.describe().map((entry) => entry.name)).not.toContain(
      'closeGroup',
    );
  });

  it('validates input with the same schema for every caller', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    expect(await actions.dispatch('createMember', { name: '   ' })).toMatchObject({
      status: 'failed',
      error: 'invalid_input',
    });
    expect(await actions.dispatchJson('createMember', { name: 42 })).toMatchObject(
      { status: 'failed', error: 'invalid_input' },
    );
    expect(await actions.dispatch('createMember', { name: ' Ben ' })).toEqual({
      status: 'done',
      value: undefined,
    });
    expect(calls).toEqual(['member.create Ben']);
  });

  it('checks preconditions before running', async () => {
    const offline = createHost({ connection: 'offline' });
    const closed = createHost({ open: false });

    expect(
      await createDispatcher(offline.host).dispatch('regenerateInvite', {}),
    ).toMatchObject({ status: 'failed', error: 'client_offline' });
    expect(
      await createDispatcher(closed.host).dispatch('createMember', {
        name: 'Ben',
      }),
    ).toMatchObject({ status: 'failed', error: 'no_open_group' });
    expect([...offline.calls, ...closed.calls]).toEqual([]);
  });

  it('returns a confirmation request until the call is confirmed', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    expect(await actions.dispatch('regenerateInvite', {})).toMatchObject({
      status: 'needs_confirmation',
      message: 'Regenerate the invite link to create a new one. The old link will stop working. Everyone already in the group keeps their access.',
    });
    expect(calls).toEqual([]);
    expect(
      await actions.dispatch('regenerateInvite', {}, { confirmed: true }),
    ).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['regenerateInvite']);
  });

  it('opens a person from the group screen and goes back to it', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);

    await actions.dispatch('showPerson', { memberId: 'member-2______________' });
    expect(actions.ui.snapshot()).toMatchObject({ view: 'person', person: 'member-2______________', trail: ['home'] });
    await actions.dispatch('closePanel', {});
    expect(actions.ui.snapshot()).toMatchObject({ view: 'home', trail: [] });
  });

  it('reports failures as outcomes instead of throwing', async () => {
    const { host, fail } = createHost();
    const actions = createDispatcher(host);

    fail('member_name_taken');

    expect(await actions.dispatch('createMember', { name: 'Ben' })).toEqual({
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

    await actions.dispatch('renameMember', {
      memberId: 'member-2______________',
      name: 'Benji',
    });
    await actions.dispatch('joinGroup', {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Dev' },
      token: 't'.repeat(43),
    });

    expect(calls).toEqual([
      'member.rename member-2______________ Benji Ben',
      `joinGroup uy9ogmKJRD2VRfbN4PDsAw Dev ${'t'.repeat(43)}`,
    ]);

    // A malformed token is rejected before anything is stored.
    expect(await actions.dispatch('joinGroup', {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Dev' },
      token: 'Trip',
    })).toMatchObject({ status: 'failed', error: 'invalid_input' });
  });

  it('tells observers what ran and who asked, without changing behaviour', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);
    const records: DispatchRecord[] = [];

    const stop = actions.observe((record) => records.push(record));

    await actions.dispatch('leaveGroup', {}, { origin: 'assistant' });
    await actions.dispatch('showGroups', {}, { origin: 'ui' });
    stop();
    await actions.dispatch('showGroups', {});

    expect(records).toMatchObject([
      {
        name: 'leaveGroup',
        origin: 'assistant',
        status: 'needs_confirmation',
        detail: 'Leave this group?',
      },
      { name: 'showGroups', origin: 'ui', status: 'done', detail: null },
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
      described
        .filter((action) => action.confirms)
        .map((action) => action.name),
    ).toEqual(['regenerateInvite', 'leaveGroup']);
  });
});
