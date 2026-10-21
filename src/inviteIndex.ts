/**
 * The D1 index from an invite secret's hash to its group, so a short link
 * needs no group id. Each group's Durable Object still decides whether the
 * secret is current; the index only routes to it.
 */
export class InviteIndex {
  constructor(private readonly database: D1Database) {}

  /**
   * Records that a hash opens a group before the group stores it. False when
   * the hash already opens another group.
   */
  async claim(tokenHash: string, groupId: string): Promise<boolean> {
    await this.database
      .prepare(
        `INSERT INTO invite_codes (token_hash, group_id) VALUES (?, ?)
         ON CONFLICT (token_hash) DO NOTHING`,
      )
      .bind(tokenHash, groupId)
      .run();

    return (await this.find(tokenHash)) === groupId;
  }

  /** The group a hash opens, if any. */
  async find(tokenHash: string): Promise<string | null> {
    const row = await this.database
      .prepare('SELECT group_id FROM invite_codes WHERE token_hash = ?')
      .bind(tokenHash)
      .first<{ group_id: string }>();

    return row?.group_id ?? null;
  }
}
