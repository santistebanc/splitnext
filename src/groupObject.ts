import { DurableObject } from 'cloudflare:workers';
import {
  initializeGroup,
  initializeGroupCommandSchema,
  type InitializeGroupCommand,
} from './domain/groups';
import { GroupStore } from './groupStore';

type ProbeRow = { ok: number };

/** Cloudflare will later instantiate one of these consistency boundaries per group. */
export class GroupObject extends DurableObject<Env> {
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

    const store = new GroupStore(this.ctx.storage);

    return store.create(initializeGroup(parsed.data));
  }
}
