import { describe, expect, it } from 'vitest';
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
  it('protects a pending member save across callers while unrelated offline edits remain available', async () => {
    const { host, calls } = createHost({ connection: 'offline' });
    const request = deferred<void>();
    const target = 'member-1______________';
    const other = 'member-2______________';

    const actions = createDispatcher({
      ...host,
      renamePerson: (id, name, observed) => id === target ? request.promise : host.renamePerson(id, name, observed),
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
    expect(await actions.dispatch('addMember', { name: 'Dev' })).toMatchObject({ status: 'done' });
    expect(await actions.dispatch('renameMember', { memberId: other, name: 'Benjamin' })).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['addPerson Dev', `renamePerson ${other} Benjamin Ben`]);
    request.reject(new Error('request_failed'));
    expect(await save).toMatchObject({ status: 'failed', error: 'request_failed' });
    expect(actions.state().ui.memberEdit).toMatchObject({ memberId: target, name: 'Anita', expectedName: 'Ana' });
    expect(actions.state().executions).toEqual([]);
    expect(actions.availability('saveMemberEdit', {}).available).toBe(true);
    expect(updates).toContain(1);
    expect(updates.at(-1)).toBe(0);
    unsubscribe();
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
      nextStep: 'submitCreate', availability: { available: true },
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
    expect(calls).toEqual(['renamePerson member-2______________ Benji Ben']);
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
    expect(browseActions(actions.describe(), { group: 'Suggested' })).toEqual(
      [],
    );
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
      renameGroup: () => request.promise,
    });

    await actions.dispatch('showSettings', {});
    await actions.dispatch('changeDraft', {
      field: 'settings.name',
      value: 'Offline rename',
    });
    const saving = actions.dispatch('saveGroupSettings', {});

    expect(actions.state().ui.phase).toBe('saving');
    expect(browseActions(actions.describe(), { group: 'Suggested' })).toEqual(
      [],
    );
    expect(actions.availability('saveGroupSettings').available).toBe(false);
    expect(actions.availability('closePanel').available).toBe(false);
    expect(await actions.dispatch('addMember', { name: 'Dev' })).toMatchObject({
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
    expect(calls).toEqual(['addPerson Dev']);
  });

  it('suspends ordinary suggestions during direct creation and restores editor focus on failure', async () => {
    const { host, state } = createHost();
    const request = deferred<void>();

    const actions = createDispatcher({
      ...host,
      createGroup: () => request.promise,
    });

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    await actions.dispatch('beginAddMember', {});
    await actions.dispatch('changeDraft', {
      field: 'member.name',
      value: 'Dev',
    });
    expect(next()).toEqual(['saveMemberEdit', 'cancelMemberEdit']);

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
    expect(next()).toEqual([]);

    request.reject(new Error('request_failed'));
    await running;
    expect(next()).toEqual([
      'refreshGroups',
      'saveMemberEdit',
      'cancelMemberEdit',
    ]);
    expect(actions.state().ui.memberEdit?.name).toBe('Dev');
  });

  it('suggests leaving a pending invite check, then moves to member choices', async () => {
    const { host, state } = createHost();

    const preview =
      deferred<Awaited<ReturnType<ActionHost['client']['previewInvite']>>>();

    const actions = createDispatcher({
      ...host,
      client: { previewInvite: () => preview.promise },
    });

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    const groupId = 'uy9ogmKJRD2VRfbN4PDsAw';
    const link = `https://splitnext.test/join/${groupId}#${'w'.repeat(43)}`;

    const running = actions.dispatch('checkInvite', { link });
    state.syncError = new Error('request_failed');
    expect(actions.state().ui.phase).toBe('checking');
    expect(actions.availability('refreshGroups').available).toBe(true);
    expect(next()).toEqual(['showGroups']);

    preview.resolve({ group: { id: groupId, name: 'Trip' }, members: [] });
    await running;
    expect(next()).toEqual(['refreshGroups', 'chooseJoinMember', 'showGroups']);
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    expect(next()).toEqual([
      'refreshGroups',
      'submitJoin',
      'chooseJoinMember',
      'showGroups',
    ]);
  });

  it('suggests logical group entry actions without dispatching anything', async () => {
    const { host, calls } = createHost({ open: false });
    const actions = createDispatcher(host);

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    expect(next()).toEqual(['showCreateGroup', 'showJoinGroup']);
    expect(calls).toEqual([]);
    await actions.dispatch('showCreateGroup', {});
    expect(next()).toEqual(['showGroups']);
    await actions.dispatch('changeDraft', {
      field: 'create.name',
      value: 'Trip',
    });
    expect(next()).toEqual(['submitCreateGroup', 'showGroups']);
    await actions.dispatch('closePanel', {});
    expect(next()).toEqual(['showCreateGroup', 'showJoinGroup']);
    expect(calls).toEqual([]);
  });

  it('prioritizes inviting from a solo group and member editing after others join', () => {
    const solo = createDispatcher(createHost().host);
    const joined = createDispatcher(createHost({ others: ['Ben'] }).host);

    const next = (actions: typeof solo) =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    expect(next(solo)).toEqual([
      'showInvite',
      'beginAddMember',
      'selectYou',
      'showSettings',
      'beginEditMember',
      'removeMember',
      'showGroups',
    ]);
    expect(next(joined)).toEqual([
      'beginAddMember',
      'showInvite',
      'selectYou',
      'showSettings',
      'beginEditMember',
      'removeMember',
      'showGroups',
    ]);
  });

  it('suggests removing any active member in the group view, including you and offline', async () => {
    const { host, state, calls } = createHost({ connection: 'offline' });
    const actions = createDispatcher(host);

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    const snapshot = state.group?.projected_snapshot;

    if (!snapshot) throw new Error('missing_fixture');

    expect(next()).toContain('removeMember');
    expect(next()).toContain('beginEditMember');
    expect(next().length).toBeGreaterThan(4);
    expect(calls).toEqual([]);
    snapshot.members[1]!.status = 'archived';
    expect(next()).toContain('removeMember');
    expect(next()).toContain('beginEditMember');
    expect(
      await actions.dispatch('removeMember', { memberId: 'member-1______________' }),
    ).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['archivePerson member-1______________']);
    snapshot.members[1]!.status = 'active';

    await actions.dispatch('beginEditMember', { memberId: 'member-2______________' });
    expect(next()).toEqual(['cancelMemberEdit']);
    await actions.dispatch('cancelMemberEdit', {});
    expect(next()).toContain('removeMember');
    await actions.dispatch('showSettings', {});
    expect(next()).not.toContain('removeMember');
  });

  it('prioritizes choosing you when unassigned and omits it without an alternative', async () => {
    const { host, state } = createHost();
    const actions = createDispatcher(host);
    const snapshot = state.group?.projected_snapshot;

    if (!snapshot) throw new Error('missing_fixture');

    const self = snapshot.access_grants.find(
      (grant) => grant.identity_id === state.group?.session?.identity.id,
    );

    if (!self) throw new Error('missing_fixture');
    self.preferred_member_id = null;

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    expect(next()[0]).toBe('selectYou');
    self.preferred_member_id = 'member-1______________';
    snapshot.members[1]!.status = 'archived';
    expect(next()).not.toContain('selectYou');
    snapshot.members[1]!.status = 'active';
    expect(next()).toContain('selectYou');
    await actions.dispatch('showSettings', {});
    expect(next()).not.toContain('selectYou');
    await actions.dispatch('closePanel', {});
    await actions.dispatch('beginEditMember', { memberId: 'member-1______________' });
    expect(next()).not.toContain('selectYou');
  });

  it('changes suggestions with drafts and excludes unavailable platform actions', async () => {
    const { host } = createHost();

    const actions = createDispatcher(host, {
      appUrl: 'https://splitnext.test',
      copyLink: async () => undefined,
    });

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    await actions.dispatch('showSettings', {});
    expect(next()).toEqual(['closePanel']);
    await actions.dispatch('changeDraft', {
      field: 'settings.name',
      value: 'New name',
    });
    expect(next()).toEqual(['saveGroupSettings', 'closePanel']);
    await actions.dispatch('changeDraft', {
      field: 'settings.name',
      value: '',
    });
    expect(next()).toEqual(['closePanel']);
    await actions.dispatch('showInvite', {});
    expect(next()).toEqual(['copyInviteLink', 'closePanel']);
    expect(next()).not.toContain('replaceInviteLink');
    await actions.dispatch('closePanel', {});
    await actions.dispatch('beginAddMember', {});
    expect(next()).toEqual(['cancelMemberEdit']);
    await actions.dispatch('changeDraft', {
      field: 'member.name',
      value: 'Dev',
    });
    expect(next()).toEqual(['saveMemberEdit', 'cancelMemberEdit']);
  });

  it('focuses suggestions on pending confirmation and respects offline availability', async () => {
    const { host, state } = createHost();
    const actions = createDispatcher(host);

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    await actions.dispatch('replaceInviteLink', {});
    expect(next()).toEqual(['confirmAction', 'cancelConfirmation']);
    state.online = false;
    expect(next()).toEqual(['cancelConfirmation']);
    await actions.dispatch('cancelConfirmation', {
      requestId: actions.state().ui.confirmation?.id ?? '',
    });
    expect(next()).toEqual([
      'showInvite',
      'beginAddMember',
      'selectYou',
      'showSettings',
      'beginEditMember',
      'removeMember',
      'showGroups',
    ]);
    expect(
      actions
        .describe()
        .filter((action) => action.suggested !== null)
        .every((action) => action.availability.available),
    ).toBe(true);
  });

  it('suggests preview, member choice, and join as the join form progresses', async () => {
    const { host } = createHost();
    const actions = createDispatcher(host);

    const next = () =>
      browseActions(actions.describe(), { group: 'Suggested' }).map(
        (action) => action.name,
      );

    const link = `https://splitnext.test/join/uy9ogmKJRD2VRfbN4PDsAw#${'w'.repeat(43)}`;

    await actions.dispatch('showJoinGroup', {});
    expect(next()).toEqual(['showGroups']);
    await actions.dispatch('changeDraft', { field: 'join.link', value: link });
    expect(next()).toEqual(['checkInvite', 'showGroups']);
    await actions.dispatch('checkInvite', { link });
    expect(next()).toEqual(['chooseJoinMember', 'showGroups']);
    await actions.dispatch('chooseJoinMember', { as: { kind: 'new' } });
    expect(next()).toEqual(['submitJoin', 'chooseJoinMember', 'showGroups']);
    await actions.dispatch('changeDraft', { field: 'join.name', value: '' });
    expect(next()).toEqual(['chooseJoinMember', 'showGroups']);
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
    expect(group('selectYou')).toBe('Ledger changes');
    expect(group('submitCreateGroup')).toBe('Access & sync');
    expect(group('submitJoin')).toBe('Access & sync');
    expect(group('replaceInviteLink')).toBe('Access & sync');
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
    expect(actions.availability('addMember')).toEqual({ available: true });
    expect(actions.availability('addMember', { name: '' })).toMatchObject({
      available: false,
      error: 'invalid_input',
    });
    expect(actions.availability('addMember', { name: 'Dev' })).toEqual({
      available: true,
    });
    expect(actions.availability('replaceInviteLink')).toMatchObject({
      available: false,
      error: 'client_offline',
    });
    const snapshot = state.group?.projected_snapshot;

    if (!snapshot) throw new Error('missing_fixture');
    snapshot.members[1]!.status = 'archived';
    const input = { memberId: 'member-2______________' };
    expect(actions.availability('selectYou', input)).toMatchObject({
      available: false,
      error: 'member_not_found',
    });
    expect(await actions.dispatch('selectYou', input)).toMatchObject({
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
    expect(actions.availability('showNotices')).toMatchObject({
      available: false,
      error: 'notice_not_found',
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
      copyLink: async () => undefined,
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

  it('fades approval when its original action becomes unavailable but still allows cancellation', async () => {
    const { host, state, calls } = createHost();
    const actions = createDispatcher(host);
    await actions.dispatch('replaceInviteLink', {});
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
    expect(calls).toEqual(['renameGroup New trip Workbench trip']);
    expect(actions.ui.snapshot().view).toBe('home');
    expect(views).toContain('settings');
    stop();
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
    expect(calls).toEqual(['renamePerson member-2______________ Benjamin Ben']);
  });

  it('protects the saving editor and permits another editor after completion', async () => {
    const { host } = createHost();
    let release: () => void = () => undefined;

    const saved = new Promise<void>((resolve) => {
      release = resolve;
    });

    const actions = createDispatcher({ ...host, renamePerson: () => saved });

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

          return { group: { id: groupId, name: 'Trip' }, members: [] };
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

    await actions.dispatch('replaceInviteLink', {}, { origin: 'ui' });
    const first = actions.state().ui.confirmation;
    expect(first?.name).toBe('replaceInviteLink');
    await actions.dispatch(
      'cancelConfirmation',
      { requestId: first?.id ?? '' },
      { origin: 'devtools' },
    );
    expect(actions.state().ui.confirmation).toBeNull();
    expect(calls).toEqual([]);
    await actions.dispatch('replaceInviteLink', {}, { origin: 'devtools' });
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
    await actions.dispatch('replaceInviteLink', {});
    const requestId = actions.state().ui.confirmation?.id ?? '';
    state.online = false;
    expect(
      await actions.dispatch('confirmAction', { requestId }),
    ).toMatchObject({ status: 'failed', error: 'client_offline' });
    expect(calls).toEqual([]);
  });

  it('does not let a caller mutate the input of a pending confirmation', async () => {
    const { host, calls } = createHost({ others: ['Ben'] });
    const actions = createDispatcher(host);
    const input = { memberId: 'member-2______________' };
    await actions.dispatch('selectYou', input);
    input.memberId = 'member-1______________';
    const requestId = actions.state().ui.confirmation?.id ?? '';
    await actions.dispatch('confirmAction', { requestId });
    expect(calls).toEqual(['selectPerson member-2______________']);
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

  it('uses platform adapters for copy and share while reporting copied state', async () => {
    const { host } = createHost();
    const copied: string[] = [];
    const shared: string[] = [];

    const actions = createDispatcher(host, {
      appUrl: 'https://splitnext.test',
      copyLink: async (link) => {
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

    expect(await actions.dispatch('addMember', { name: '   ' })).toMatchObject({
      status: 'failed',
      error: 'invalid_input',
    });
    expect(await actions.dispatchJson('addMember', { name: 42 })).toMatchObject(
      { status: 'failed', error: 'invalid_input' },
    );
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
      await createDispatcher(closed.host).dispatch('addMember', {
        name: 'Ben',
      }),
    ).toMatchObject({ status: 'failed', error: 'no_open_group' });
    expect([...offline.calls, ...closed.calls]).toEqual([]);
  });

  it('returns a confirmation request until the call is confirmed', async () => {
    const { host, calls } = createHost();
    const actions = createDispatcher(host);

    expect(await actions.dispatch('replaceInviteLink', {})).toMatchObject({
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
      await actions.dispatch('selectYou', { memberId: 'member-2______________' }),
    ).toMatchObject({
      status: 'needs_confirmation',
      message: 'Participant 1 already uses this name.',
    });
    expect(
      await actions.dispatch('selectYou', { memberId: 'member-1______________' }),
    ).toMatchObject({ status: 'done' });
    expect(calls).toEqual(['selectPerson member-1______________']);
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

    await actions.dispatch('renameMember', {
      memberId: 'member-2______________',
      name: 'Benji',
    });
    await actions.dispatch('joinGroup', {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Dev' },
      token: 't',
    });

    expect(calls).toEqual([
      'renamePerson member-2______________ Benji Ben',
      'joinGroup uy9ogmKJRD2VRfbN4PDsAw Dev t',
    ]);
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
    ).toEqual(['selectYou', 'replaceInviteLink', 'leaveGroup']);
  });
});
