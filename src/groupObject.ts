import { DurableObject } from 'cloudflare:workers';

type ProbeRow = { ok: number };

/** Cloudflare will later instantiate one of these consistency boundaries per group. */
export class GroupObject extends DurableObject<Env> {
  async health(): Promise<boolean> {
    const probe = this.ctx.storage.sql.exec<ProbeRow>('SELECT 1 AS ok').toArray()[0];

    return probe?.ok === 1;
  }
}
