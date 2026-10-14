import {
  SplitnextRequestError,
  ClientOfflineError,
  ClientStorageError,
  SplitnextSyncClient,
  type ClientGroupSummary,
  type ClientPreferredMemberChoice,
  type ClientReplicaState,
} from '@splitnext/client';

export type NewGroup = {
  name: string;
  creator_member_name: string;
};

export type AppPreferences = {
  lastGroup(): string | null;
  rememberGroup(groupId: string | null): void;
  lastYouName(): string | null;
  rememberYouName(name: string): void;
};

export type AppState = {
  ready: boolean;
  online: boolean;
  reachable: boolean;
  groups: ClientGroupSummary[];
  group: ClientReplicaState | null;
  reviewGroups: string[];
  syncError: Error | null;
};

export type AppNotifications = {
  changed(groupId: string): void;
  dispose(): void;
};

/** App navigation and SDK orchestration; React and browser storage stay outside. */
export class AppController {
  private state: AppState = {
    ready: false,
    online: true,
    reachable: true,
    groups: [],
    group: null,
    reviewGroups: [],
    syncError: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly watched = new Set<string>();
  private opening = 0;
  private disposed = false;

  constructor(
    readonly client: SplitnextSyncClient,
    private readonly preferences: AppPreferences,
    private readonly notifications: AppNotifications = {
      changed: () => undefined,
      dispose: () => undefined,
    },
  ) {}

  snapshot = (): AppState => this.state;

  lastYouName(): string | null {
    return this.preferences.lastYouName();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  async start(online: boolean): Promise<void> {
    // Restore the installation and replicas before making a network request.
    // A stalled server must never block access to already saved groups.
    this.client.setOnline(false);
    this.publish({ ...this.state, online });

    try {
      await this.client.initializeIdentity();
    } catch (error) {
      const needsConnection =
        error instanceof ClientOfflineError ||
        (error instanceof ClientStorageError &&
          error.code === 'upgrade_requires_connection');

      if (!needsConnection || !online) throw error;

      this.client.setOnline(true);
      await this.client.initializeIdentity();
      this.client.setOnline(false);
    }

    const groups = await this.client.knownGroups();

    const remembered = groups.find(
      (group) =>
        group.group_id === this.preferences.lastGroup() &&
        group.status === 'active',
    );

    this.publish({ ...this.state, groups, ready: true });
    this.watch(groups);

    await this.readStorage();

    if (remembered) await this.openGroup(remembered.group_id);

    if (this.disposed) return;

    this.client.setOnline(online);

    if (online) {
      void this.refresh().catch((cause) => {
        this.publish({
          ...this.state,
          syncError: cause instanceof Error ? cause : new Error('sync_failed'),
        });
      });
    }
  }

  setReachable(reachable: boolean): void {
    if (this.disposed) return;

    this.client.setOnline(this.state.online && reachable);

    if (reachable !== this.state.reachable)
      this.publish({ ...this.state, reachable });
  }

  async setOnline(online: boolean): Promise<void> {
    this.client.setOnline(online);
    this.publish({ ...this.state, online });

    if (online) await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;

    if (!this.state.online) {
      await this.readStorage();

      return;
    }

    this.client.setOnline(true);
    this.publish({ ...this.state, syncError: null });
    const groups = await this.client.listGroups();

    this.publish({ ...this.state, groups });
    this.watch(groups);

    for (const group of groups) {
      if (this.disposed) break;

      if (group.status !== 'active' && group.pending_commands === 0) continue;

      try {
        const synced =
          group.status === 'left'
            ? await this.client.refreshGroup(group.group_id)
            : await this.client.syncGroup(group.group_id);

        await this.receive(synced);
      } catch (error) {
        if (error instanceof SplitnextRequestError) throw error;

        this.setReachable(false);
        break;
      }
    }
  }

  async openGroup(groupId: string): Promise<void> {
    const opening = ++this.opening;
    let group = await this.client.inspect(groupId);

    if (this.client.isOnline()) {
      try {
        group = group.hidden
          ? await this.client.refreshGroup(groupId)
          : await this.client.syncGroup(groupId);
      } catch (error) {
        if (error instanceof SplitnextRequestError || !group.projected_snapshot)
          throw error;

        this.setReachable(false);
      }
    }

    if (!group.projected_snapshot) throw new Error('group_unavailable_offline');

    if (opening !== this.opening) return;

    this.publish({
      ...this.state,
      group,
      groups: await this.client.knownGroups(),
    });

    if (!group.hidden) this.preferences.rememberGroup(groupId);
  }

  /** Invite entry opens an already joined group without redeeming its token. */
  async openJoinedGroup(groupId: string): Promise<boolean> {
    let groups = await this.client.knownGroups();

    if (
      !groups.some((group) => group.group_id === groupId) &&
      this.client.isOnline()
    )
      groups = await this.client.listGroups();

    if (
      !groups.some(
        (group) => group.group_id === groupId && group.status === 'active',
      )
    )
      return false;

    if (this.state.group?.group_id !== groupId) await this.openGroup(groupId);

    return this.state.group?.group_id === groupId && !this.state.group.hidden;
  }

  showGroups(): void {
    this.opening += 1;
    this.publish({ ...this.state, group: null });
  }

  presenceChanged(groupId: string): void {
    if (this.state.group?.group_id === groupId) this.publish({ ...this.state });
  }

  async createGroup(input: NewGroup): Promise<void> {
    await this.openResult(await this.client.createGroup(input));
  }

  async joinGroup(
    groupId: string,
    choice: ClientPreferredMemberChoice,
    token?: string,
  ): Promise<void> {
    await this.openResult(await this.client.joinGroup(groupId, choice, token));
  }

  async addPerson(name: string): Promise<void> {
    await this.receive(await this.client.addMember(this.groupId(), name));
  }

  async renameGroup(name: string, observedName: string): Promise<void> {
    await this.receive(
      await this.client.renameGroup(this.groupId(), name, observedName),
    );
  }

  async renamePerson(
    memberId: string,
    name: string,
    observedName: string,
  ): Promise<void> {
    await this.receive(
      await this.client.renameMember(
        this.groupId(),
        memberId,
        name,
        observedName,
      ),
    );
  }

  async archivePerson(memberId: string): Promise<void> {
    await this.receive(
      await this.client.removeMember(this.groupId(), memberId),
    );
  }

  async selectPerson(memberId: string): Promise<void> {
    await this.receive(
      await this.client.selectPreferredMember(this.groupId(), memberId),
    );
  }

  async regenerateInvite(): Promise<void> {
    await this.receive(await this.client.regenerateInvite(this.groupId()));
  }

  async leaveGroup(): Promise<void> {
    const group = await this.client.leaveGroup(this.groupId());

    await this.receive(group);

    if (group.hidden) {
      this.preferences.rememberGroup(null);
      this.showGroups();
    }
  }

  async dismissNotice(commandId: string): Promise<void> {
    await this.receive(
      await this.client.dismissNotice(this.groupId(), commandId),
    );
  }

  async applyAgain(commandId: string): Promise<void> {
    const notice = this.state.group?.notices.find(
      (candidate) => candidate.command.command_id === commandId,
    );

    if (!notice) return;

    const command = notice.command;
    const groupId = this.groupId();
    let result: ClientReplicaState;

    switch (command.type) {
      case 'group.rename':
        result = await this.client.renameGroup(groupId, command.payload.name);
        break;
      case 'member.create':
        result = await this.client.addMember(
          groupId,
          command.payload.display_name,
        );
        break;
      case 'member.rename':
        result = await this.client.renameMember(
          groupId,
          command.payload.member_id,
          command.payload.display_name,
        );
        break;
      case 'member.archive':
        result = await this.client.removeMember(
          groupId,
          command.payload.member_id,
        );
        break;
      case 'preference.set':
        result = await this.client.selectPreferredMember(
          groupId,
          command.payload.member_id,
        );
        break;
      case 'group.leave':
        result = await this.client.leaveGroup(groupId);
        break;
    }

    await this.receive(result);
    await this.dismissNotice(commandId);
  }

  async receive(group: ClientReplicaState): Promise<void> {
    if (this.disposed) return;

    const groups = await this.client.knownGroups();

    const reviewGroups = new Set(this.state.reviewGroups);

    if (group.notices.length) reviewGroups.add(group.group_id);
    else reviewGroups.delete(group.group_id);

    this.publish({
      ...this.state,
      groups,
      reviewGroups: [...reviewGroups],
      group:
        this.state.group?.group_id === group.group_id
          ? group
          : this.state.group,
    });
    this.watch(groups);

    if (!this.disposed) this.notifications.changed(group.group_id);
  }

  /** Another tab changed the shared replica; reread without broadcasting again. */
  async readStorage(): Promise<void> {
    if (this.disposed) return;

    const groups = await this.client.knownGroups();

    const reviewGroups: string[] = [];

    for (const group of groups) {
      const replica = await this.client.inspect(group.group_id);

      if (replica.notices.length) reviewGroups.push(group.group_id);
    }

    const group = this.state.group
      ? await this.client.inspect(this.state.group.group_id)
      : null;

    this.publish({
      ...this.state,
      groups,
      group,
      reviewGroups,
    });
    this.watch(groups);
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.client.setOnline(false);

    for (const groupId of this.watched) this.client.unwatchGroup(groupId);

    this.watched.clear();
    this.listeners.clear();
    this.notifications.dispose();
  }

  private async openResult(group: ClientReplicaState): Promise<void> {
    this.opening += 1;
    this.preferences.rememberGroup(group.group_id);
    this.publish({ ...this.state, group });
    await this.receive(group);
  }

  private groupId(): string {
    if (!this.state.group) throw new Error('no_group_selected');

    return this.state.group.group_id;
  }

  private watch(groups: ClientGroupSummary[]): void {
    if (this.disposed) return;

    const active = new Set<string>();

    for (const group of groups) {
      if (group.status === 'active') active.add(group.group_id);
    }

    for (const groupId of this.watched) {
      if (!active.has(groupId)) {
        this.client.unwatchGroup(groupId);
        this.watched.delete(groupId);
      }
    }

    for (const groupId of active) {
      if (!this.watched.has(groupId)) {
        this.client.watchGroup(groupId);
        this.watched.add(groupId);
      }
    }
  }

  private publish(state: AppState): void {
    if (this.disposed) return;

    const group = state.group;
    const snapshot = group?.projected_snapshot;

    const preferred = snapshot?.access_grants.find(
      (grant) => grant.identity_id === group?.session?.identity.id,
    )?.preferred_member_id;

    const name = snapshot?.members.find(
      (member) => member.id === preferred && member.status === 'active',
    )?.display_name;

    if (name && !group?.hidden && name !== this.preferences.lastYouName())
      this.preferences.rememberYouName(name);

    this.state = state;

    for (const listener of this.listeners) listener();
  }
}
