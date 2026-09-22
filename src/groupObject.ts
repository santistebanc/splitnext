import { DurableObject } from 'cloudflare:workers';
import {
  initializeGroup,
  initializeGroupCommandSchema,
  type InitializeGroupCommand,
} from './domain/groups';
import {
  redeemGroupLinkCommandSchema,
  rotateGroupLinkCommandSchema,
  type RedeemGroupLinkCommand,
  type RotateGroupLinkCommand,
} from './domain/invites';
import {
  syncGroupCommandSchema,
  type SyncGroupCommand,
} from './domain/sync';
import { GroupStore } from './groupStore';

type ProbeRow = { ok: number };

/** Cloudflare will later instantiate one of these consistency boundaries per group. */
export class GroupObject extends DurableObject<Env> {
  private readonly store = new GroupStore(this.ctx.storage);

  async health(): Promise<boolean> {
    const probe = this.ctx.storage.sql.exec<ProbeRow>('SELECT 1 AS ok').toArray()[0];

    return probe?.ok === 1;
  }

  createGroup(command: InitializeGroupCommand) {
    const parsed = initializeGroupCommandSchema.safeParse(command);

    if (!parsed.success) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    if (this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    return this.store.create(initializeGroup(parsed.data));
  }

  syncGroup(command: SyncGroupCommand) {
    const parsed = syncGroupCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    return this.store.sync(parsed.data, new Date().toISOString());
  }

  rotateGroupLink(command: RotateGroupLinkCommand) {
    const parsed = rotateGroupLinkCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    return this.store.rotateGroupLink(parsed.data);
  }

  redeemGroupLink(command: RedeemGroupLinkCommand) {
    const parsed = redeemGroupLinkCommandSchema.safeParse(command);

    if (!parsed.success || this.ctx.id.name !== parsed.data.group_id) {
      return { ok: false as const, error: 'invalid_request' as const };
    }

    return this.store.redeemGroupLink(parsed.data);
  }
}
