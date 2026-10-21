import type { ActionHost } from './actions';

import { RefreshCoordinator } from './refresh';
import {
  preferredMember,
  SplitnextNetworkError,
  ClientOfflineError,
  ClientStorageError,
  SplitnextSyncClient,
  type ClientGroupSummary,
  type ClientPreferredMemberChoice,
  type ClientReplicaState,
  type CommandIntent,
} from '@splitnext/client';

export type ActionInvocation = { id: string; groupId: string | undefined };

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
  private reading = 0;
  private readonly refreshInvocationIds = new Set<string>();
  private disposed = false;
  private readonly refreshCoordinator = new RefreshCoordinator({
    run: () => this.refreshOnce(),
    failed: (error) => this.reportSyncError(error),
    needsRetry: () => this.state.online && !this.state.syncError &&
      (!this.state.reachable || this.state.groups.some((group) => group.pending_commands > 0)),
  });

  constructor(
    readonly client: SplitnextSyncClient,
    private readonly preferences: AppPreferences,
    private readonly notifications: AppNotifications = {
      changed: () => undefined,
      dispose: () => undefined,
    },
  ) {}

  snapshot = (): AppState => this.state;

  forInvocation(invocation: ActionInvocation): ActionHost {
    return {
      snapshot: this.snapshot,
      lastYouName: () => this.lastYouName(),
      refresh: () => this.refresh(invocation),
      createGroup: (input) => this.createGroup(input, invocation),
      joinGroup: (groupId, choice, token) => this.joinGroup(groupId, choice, token, invocation),
      openGroup: (groupId, isCurrent) => this.openGroup(groupId, isCurrent, invocation),
      openJoinedGroup: (groupId, isCurrent) => this.openJoinedGroup(groupId, isCurrent, invocation),
      showGroups: () => this.showGroups(),
      submit: (intent) => this.submit(intent, invocation),
      regenerateInvite: () => this.regenerateInvite(invocation),
      retryNotice: (commandId) => this.retryNotice(commandId, invocation),
      dismissNotice: (commandId) => this.dismissNotice(commandId, invocation),
      client: { activity: async (groupId) => {
        const replica = await this.client.activity(groupId);
        await this.readStorage();

        return replica;
      }, previewInvite: (groupId, token) => this.client.previewInvite(groupId, token, invocation.id) },
    };
  }

  /** The group on this installation whose current invite link uses this secret. */
  groupWithInvite(token: string): Promise<string | null> {
    return this.client.groupWithInvite(token);
  }

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

    this.refreshCoordinator.schedule();
  }

  reportSyncError(cause: unknown): void {
    this.publish({ ...this.state, syncError: cause instanceof Error ? cause : new Error('sync_failed') });
  }

  async setOnline(online: boolean): Promise<void> {
    this.client.setOnline(online);
    this.publish({ ...this.state, online });

    if (online) await this.refreshCoordinator.request(true);
    else this.refreshCoordinator.cancelTimer();
  }

  refresh(invocation?: ActionInvocation): Promise<void> {
    if (!invocation) return this.refreshCoordinator.request();
    this.refreshInvocationIds.add(invocation.id);

    return this.refreshCoordinator.request().finally(() => this.refreshInvocationIds.delete(invocation.id));
  }

  private async refreshOnce(): Promise<void> {
    const invocationIds = [...this.refreshInvocationIds];

    if (this.disposed) return;

    if (!this.state.online) {
      await this.readStorage();

      return;
    }

    this.client.setOnline(true);
    this.publish({ ...this.state, syncError: null });
    const groups = await this.client.listGroups(invocationIds);

    this.publish({ ...this.state, groups });
    this.watch(groups);

    for (const group of groups) {
      if (this.disposed || !this.state.online) break;

      if (group.status !== 'active' && group.pending_commands === 0) continue;

      try {
        const synced =
          group.status === 'left'
            ? await this.client.refreshGroup(group.group_id, invocationIds)
            : await this.client.syncGroup(group.group_id, invocationIds);

        await this.receive(synced);
      } catch (error) {
        if (!(error instanceof SplitnextNetworkError)) {
          this.reportSyncError(error);
          throw error;
        }

        this.setReachable(false);
        break;
      }
    }
  }

  async openGroup(
    groupId: string,
    isCurrent: () => boolean = () => true,
    invocation?: ActionInvocation,
  ): Promise<void> {
    const opening = ++this.opening;
    let group = await this.client.inspect(groupId);

    if (this.client.isOnline()) {
      try {
        group = group.hidden
          ? await this.client.refreshGroup(groupId, invocation?.id)
          : await this.client.syncGroup(groupId, invocation?.id);
      } catch (error) {
        if (!(error instanceof SplitnextNetworkError) || !group.projected_snapshot)
          throw error;

        this.setReachable(false);
      }
    }

    if (!group.projected_snapshot) throw new Error('group_unavailable_offline');

    const groups = await this.client.knownGroups();

    if (opening !== this.opening || !isCurrent()) return;

    this.publish({
      ...this.state,
      group,
      groups,
    });

    if (!group.hidden) this.preferences.rememberGroup(groupId);
  }

  /** Invite entry opens an already joined group without redeeming its token. */
  async openJoinedGroup(
    groupId: string,
    isCurrent: () => boolean = () => true,
    invocation?: ActionInvocation,
  ): Promise<boolean> {
    const opening = this.opening;
    let groups = await this.client.knownGroups();

    if (
      !groups.some((group) => group.group_id === groupId) &&
      this.client.isOnline()
    )
      groups = await this.client.listGroups(invocation?.id);

    if (
      !groups.some(
        (group) => group.group_id === groupId && group.status === 'active',
      )
    )
      return false;

    if (opening !== this.opening || !isCurrent()) return false;

    if (this.state.group?.group_id !== groupId)
      await this.openGroup(groupId, isCurrent, invocation);

    return (
      isCurrent() &&
      this.state.group?.group_id === groupId &&
      !this.state.group.hidden
    );
  }

  showGroups(): void {
    this.opening += 1;
    this.publish({ ...this.state, group: null });
  }

  presenceChanged(groupId: string): void {
    if (this.state.group?.group_id === groupId) this.publish({ ...this.state });
  }

  async createGroup(input: NewGroup, invocation?: ActionInvocation): Promise<void> {
    await this.openResult(await this.client.createGroup(input, invocation?.id));
  }

  async joinGroup(
    groupId: string,
    choice: ClientPreferredMemberChoice,
    token?: string,
    invocation?: ActionInvocation,
  ): Promise<void> {
    await this.openResult(await this.client.joinGroup(groupId, choice, token, invocation?.id));
  }

  /** Submits one command to the selected group, such as renaming a member or leaving. */
  async submit(intent: CommandIntent, invocation?: ActionInvocation): Promise<void> {
    const opening = this.opening;

    await this.settle(await this.client.submit(this.groupId(invocation), intent, invocation?.id), opening);
  }

  async retryNotice(commandId: string, invocation?: ActionInvocation): Promise<void> {
    const opening = this.opening;

    await this.settle(await this.client.retryNotice(this.groupId(invocation), commandId, invocation?.id), opening);
  }

  /**
   * Publishes a command's result. One that hid the open group, such as
   * leaving, returns to the groups list unless the person already moved on.
   */
  private async settle(group: ClientReplicaState, opening: number): Promise<void> {
    await this.receive(group);

    if (group.hidden && opening === this.opening && this.state.group?.group_id === group.group_id) {
      this.preferences.rememberGroup(null);
      this.showGroups();
    }
  }

  async regenerateInvite(invocation?: ActionInvocation): Promise<void> {
    await this.receive(await this.client.regenerateInvite(this.groupId(invocation), invocation?.id));
  }

  async dismissNotice(commandId: string, invocation?: ActionInvocation): Promise<void> {
    await this.receive(
      await this.client.dismissNotice(this.groupId(invocation), commandId),
    );
  }

  async receive(group: ClientReplicaState): Promise<void> {
    if (this.disposed) return;

    // The supplied replica can already be superseded by another tab or command.
    await this.readStorage();

    if (!this.disposed) this.notifications.changed(group.group_id);
  }

  /** Another tab changed shared storage; publish one coherent installation view. */
  async readStorage(): Promise<void> {
    if (this.disposed) return;
    const reading = ++this.reading;
    const opening = this.opening;
    const groupId = this.state.group?.group_id;
    const installation = await this.client.installationState(groupId ? [groupId] : []);

    if (this.disposed || reading !== this.reading) return;

    if (opening !== this.opening) {
      await this.readStorage();

      return;
    }

    this.publish({
      ...this.state,
      groups: installation.groups,
      group: installation.replicas[0] ?? null,
      reviewGroups: Object.entries(installation.notice_counts).flatMap(([id, count]) => count > 0 ? [id] : []),
    });
    this.watch(installation.groups);
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.refreshCoordinator.dispose();
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

  private groupId(invocation?: ActionInvocation): string {
    if (invocation?.groupId) return invocation.groupId;

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

    const name = preferredMember(snapshot, group?.session?.identity.id)?.display_name;

    if (name && !group?.hidden && name !== this.preferences.lastYouName())
      this.preferences.rememberYouName(name);

    this.state = state;

    for (const listener of this.listeners) listener();
  }
}
