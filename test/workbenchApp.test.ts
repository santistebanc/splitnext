import { describe, expect, it } from 'vitest';
import { SplitnextNetworkError, SplitnextProtocolError, ClientStorageError } from '../src/client';
import { createWorkbenchApp, type FakeAppOptions } from '../apps/client/src/workbench/app';
import { createDispatcher } from '../apps/client/src/model/actions';
import { fixtureGroupId } from '../apps/client/src/workbench/memberListFixture';

const options: FakeAppOptions = {
  scenario: { members: ['Ana', 'Ben'], you: 'Ana', others: ['Ana'], presence: 'realtime', othersOnline: true, connection: 'online' },
  connection: 'online', latency: 0, failure: 'none', log: () => undefined,
};

describe('workbench through production logic', () => {
  it('keeps newer navigation when a delayed leave finishes', async () => {
    const app = await createWorkbenchApp(options);
    const first = app.snapshot().group?.group_id;

    if (!first) throw new Error('missing first group');
    await app.createGroup({ name: 'Second', creator_member_name: 'Ana' });
    const second = app.snapshot().group?.group_id;

    if (!second) throw new Error('missing second group');
    await app.openGroup(first);
    const actions = createDispatcher(app);
    const leave = app.client.leaveGroup.bind(app.client);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    app.client.leaveGroup = async (groupId) => { await gate;

 return leave(groupId); };

    const pending = actions.dispatch('leaveGroup', {}, { confirmed: true });

    await actions.dispatch('openGroup', { groupId: second });
    await actions.dispatch('showSettings', {});
    release();
    expect((await pending).status).toBe('done');
    expect(app.snapshot().group?.group_id).toBe(second);
    expect(actions.state().ui.view).toBe('settings');
    app.dispose();
  });

  it('rejects approval after the selected group changes and isolates log observers', async () => {
    const app = await createWorkbenchApp(options);
    const actions = createDispatcher(app);
    const records: string[] = [];

    actions.observe(() => { throw new Error('observer_failed'); });
    actions.observe((record) => { records.push(record.status); });
    const pending = await actions.dispatch('leaveGroup', {});

    if (pending.status !== 'needs_confirmation' || !pending.requestId) throw new Error('missing confirmation');
    await app.createGroup({ name: 'Second', creator_member_name: 'Ana' });
    const approved = await actions.dispatch('confirmAction', { requestId: pending.requestId });

    expect(approved).toMatchObject({ status: 'failed', error: 'confirmation_context_changed' });
    expect(app.snapshot().group?.hidden).toBe(false);
    expect(records).toEqual(['needs_confirmation', 'failed']);
    app.dispose();
  });

  it('uses cached state only for connection failures and reports other refresh failures', async () => {
    const app = await createWorkbenchApp(options);

    for (const error of [new ClientStorageError('storage_unavailable'), new SplitnextProtocolError('invalid_response', null), new Error('programmer_error')]) {
      app.client.syncGroup = async () => { throw error; };

      await expect(app.refresh()).rejects.toBe(error);
      expect(app.snapshot().syncError).toBe(error);
      expect(app.snapshot().reachable).toBe(true);
    }

    app.client.syncGroup = async () => { throw new SplitnextNetworkError(new Error('connection_lost')); };

    await app.refresh();
    expect(app.snapshot().reachable).toBe(false);
    app.dispose();
  });

  it('merges duplicate names, retains offline intent, and clears every preference when archiving', async () => {
    const app = await createWorkbenchApp(options);
    const groupId = app.snapshot().group?.group_id;

    if (!groupId) throw new Error('missing group');
    await app.setOnline(false);
    await app.addPerson(' ana ');
    expect(app.snapshot().group?.projected_snapshot?.members).toHaveLength(2);
    expect(app.snapshot().group?.outbox).toHaveLength(1);
    await app.setOnline(true);
    expect(app.snapshot().group?.outbox).toHaveLength(0);
    const member = app.snapshot().group?.projected_snapshot?.members[0];

    if (!member) throw new Error('missing member');
    await app.archivePerson(member.id);
    expect(app.snapshot().group?.projected_snapshot?.access_grants.map((grant) => grant.preferred_member_id)).toEqual([null, null]);
    expect(app.snapshot().group?.projected_snapshot?.members[0]?.status).toBe('archived');
    app.dispose();
  });

  it('creates, replaces links, leaves, and rejoins through the real action catalog', async () => {
    const app = await createWorkbenchApp(options);
    const actions = createDispatcher(app);

    expect((await actions.dispatch('createGroup', { name: 'New trip', yourName: 'Dev' })).status).toBe('done');
    const group = app.snapshot().group;
    const member = group?.projected_snapshot?.members[0];
    const invite = group?.projected_snapshot?.invite;

    if (!group || !member || !invite) throw new Error('missing new group');
    expect(group.group_id).not.toBe(fixtureGroupId);
    await app.regenerateInvite();
    expect(app.snapshot().group?.projected_snapshot?.invite.id).not.toBe(invite.id);
    await expect(app.client.previewInvite(group.group_id, invite.token)).rejects.toThrow('invite_replaced');
    await app.leaveGroup();
    expect(app.snapshot().group).toBeNull();
    expect(app.snapshot().groups.find((entry) => entry.group_id === group.group_id)?.status).toBe('left');
    await app.openGroup(group.group_id);
    await app.joinGroup(group.group_id, { kind: 'new', display_name: ' dev ' });
    expect(app.snapshot().group?.hidden).toBe(false);
    expect(app.snapshot().group?.projected_snapshot?.members).toHaveLength(1);
    app.dispose();
  });

  it('previews and joins as a visitor without granting access until joining', async () => {
    const app = await createWorkbenchApp({ ...options, visitor: true });

    expect(app.snapshot().groups).toHaveLength(0);
    const preview = await app.client.previewInvite(fixtureGroupId, 'w'.repeat(43));
    const member = preview.members[0];

    if (!member) throw new Error('missing preview member');
    await app.joinGroup(fixtureGroupId, { kind: 'existing', member_id: member.id }, 'w'.repeat(43));
    expect(app.snapshot().groups).toHaveLength(1);
    expect(app.snapshot().group?.projected_snapshot?.members).toHaveLength(2);
    app.dispose();
  });
});
