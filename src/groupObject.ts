import { DurableObject } from 'cloudflare:workers';
import { joinGroupCommandSchema, type JoinGroupCommand } from './domain/access';
import {
  initializeGroup,
  initializeGroupCommandSchema,
  type InitializeGroupCommand,
} from './domain/groups';
import { identifierSchema } from './domain/ids';
import {
  regenerateInviteCommandSchema,
  type RegenerateInviteCommand,
} from './domain/invites';
import {
  realtimeGroupHiddenCode,
  realtimeProtocol,
  type RevisionAnnouncement,
} from './domain/realtime';
import {
  syncGroupCommandSchema,
  type SyncGroupCommand,
  type SyncGroupResponse,
} from './domain/sync';
import { GroupStore } from './groupStore';
import { DurableObjectGroupRepository } from './groupRepository';

type ProbeRow = { ok: number };

/** The Worker names the authenticated identity when it forwards an upgrade. */
export const realtimeIdentityHeader = 'x-splitnext-identity';

const subscriptionFailureStatus = {
  group_not_found: 404,
  unauthorized: 401,
  group_hidden: 403,
} as const;

/** Cloudflare will later instantiate one of these consistency boundaries per group. */
export class GroupObject extends DurableObject<Env> {
  private readonly store = this.createStore();

  async health(): Promise<boolean> {
    const probe = this.ctx.storage.sql
      .exec<ProbeRow>('SELECT 1 AS ok')
      .toArray()[0];

    return probe?.ok === 1;
  }

  /**
   * Accepts a realtime subscription. Hibernatable sockets keep idle groups
   * free of compute; the first announcement lets a reconnecting client catch
   * up on anything it missed while disconnected.
   */
  async fetch(request: Request): Promise<Response> {
    const identityId = identifierSchema.safeParse(
      request.headers.get(realtimeIdentityHeader),
    );

    if (
      !identityId.success ||
      request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
    ) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    const access = this.store.subscriptionAccess(identityId.data);

    if (!access.ok) {
      return Response.json(
        { error: access.error },
        { status: subscriptionFailureStatus[access.error] },
      );
    }

    const pair = new WebSocketPair();

    this.ctx.acceptWebSocket(pair[1], [identityId.data]);
    pair[1].send(announcement(access.revision));
    this.announcePresence();

    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { 'sec-websocket-protocol': realtimeProtocol },
    });
  }

  /** Clients only listen; anything they send is ignored. */
  webSocketMessage(): void {}

  webSocketClose(socket: WebSocket): void {
    this.announcePresence(socket);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'connection_error');
    this.announcePresence(socket);
  }

  createGroup(command: InitializeGroupCommand) {
    const parsed = initializeGroupCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    return this.store.create(initializeGroup(parsed.data));
  }

  groupActivity(identityId: string) {
    return this.store.activity(identifierSchema.parse(identityId));
  }

  syncGroup(command: SyncGroupCommand) {
    const parsed = syncGroupCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    const result = this.store.sync(parsed.data, new Date().toISOString());

    if (result.ok) this.announceSync(parsed.data.identity_id, result.response);

    return result;
  }

  joinGroup(command: JoinGroupCommand) {
    const parsed = joinGroupCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    const result = this.store.join(parsed.data);

    // A retried join repeats its announcement, which subscribers tolerate.
    if (result.ok) this.announce(result.revision);

    return result;
  }

  regenerateInvite(command: RegenerateInviteCommand) {
    const parsed = regenerateInviteCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    const result = this.store.regenerateInvite(parsed.data);

    // A retried creation repeats its announcement, which subscribers tolerate.
    if (result.ok) this.announce(result.revision);

    return result;
  }

  previewInvite(groupId: string, tokenHash: string) {
    if (this.ctx.id.name !== groupId) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    return this.store.previewInvite(tokenHash);
  }

  inspectGroup(groupId: string) {
    if (this.ctx.id.name !== groupId) return null;

    const inspection = this.store.inspect();

    return inspection
      ? {
          ...inspection,
          subscribers: this.ctx
            .getWebSockets()
            .flatMap((socket) => this.ctx.getTags(socket)),
        }
      : null;
  }

  private createStore(): GroupStore {
    return new GroupStore(new DurableObjectGroupRepository(this.ctx.storage));
  }

  private announceSync(identityId: string, response: SyncGroupResponse): void {
    const applied = response.outcomes.filter(
      (outcome) => outcome.status === 'applied',
    );

    if (applied.length === 0) return;

    // Leaving hides the group, so that identity stops receiving announcements.
    if (applied.some((outcome) => outcome.command_type === 'group.leave')) {
      for (const socket of this.ctx.getWebSockets(identityId)) {
        socket.close(realtimeGroupHiddenCode, 'group_hidden');
      }

      this.announcePresence();
    }

    this.announce(response.revision);
  }

  private announce(revision: number): void {
    const message = announcement(revision);

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A closing socket cannot receive; its client catches up on reconnect.
      }
    }
  }

  private announcePresence(excluded?: WebSocket): void {
    const sockets = this.ctx
      .getWebSockets()
      .filter(
        (socket) => socket !== excluded && socket.readyState === WebSocket.OPEN,
      );

    const identityIds = [
      ...new Set(sockets.flatMap((socket) => this.ctx.getTags(socket))),
    ].sort();

    const message = JSON.stringify({
      type: 'presence',
      identity_ids: identityIds,
    });

    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        // Closing connections receive a fresh roster after reconnecting.
      }
    }
  }
}

function announcement(revision: number): string {
  const message: RevisionAnnouncement = { type: 'revision', revision };

  return JSON.stringify(message);
}
