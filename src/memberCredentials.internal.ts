import {
  type AccessCredential,
  accessCredentialSchema,
  type MemberPrincipal,
} from './accessCredential';

export type PreparedCredentialIssue = {
  accessToken: string;
  tokenHash: string;
  deviceUserId: string;
};

export type PreparedAuthorization = {
  tokenHash: string;
  deviceUserId: string;
} | null;

type MemberAccessRow = { member_id: string };

/** Private credential implementation used only through MemberDirectory. */
export class MemberCredentials {
  constructor(private readonly sql: SqlStorage) {}

  provision(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS member_access (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      device_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id)
    )`);
  }

  async prepareIssue(deviceUserId: string): Promise<PreparedCredentialIssue> {
    const accessToken = generateAccessToken();

    return {
      accessToken,
      tokenHash: await hashAccessToken(accessToken),
      deviceUserId,
    };
  }

  issue(
    prepared: PreparedCredentialIssue,
    memberId: string,
    createdAt: string,
  ): string {
    this.sql.exec(
      `INSERT INTO member_access
        (token_hash, member_id, device_user_id, created_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`,
      prepared.tokenHash,
      memberId,
      prepared.deviceUserId,
      createdAt,
    );

    return prepared.accessToken;
  }

  async prepareAuthorization(
    rawCredential: AccessCredential,
  ): Promise<PreparedAuthorization> {
    const parsed = accessCredentialSchema.safeParse(rawCredential);

    if (!parsed.success) return null;

    return {
      tokenHash: await hashAccessToken(parsed.data.accessToken),
      deviceUserId: parsed.data.deviceUserId,
    };
  }

  authenticate(prepared: PreparedAuthorization): MemberPrincipal | null {
    if (!prepared || !this.isProvisioned()) return null;

    const access = this.sql
      .exec<MemberAccessRow>(
        `SELECT access.member_id
         FROM member_access AS access
         INNER JOIN members AS member ON member.id = access.member_id
         WHERE access.token_hash = ?
           AND access.device_user_id = ?
           AND access.revoked_at IS NULL
           AND member.deleted_at IS NULL`,
        prepared.tokenHash,
        prepared.deviceUserId,
      )
      .toArray()[0];

    return access ? { memberId: access.member_id } : null;
  }

  revokeMember(memberId: string, revokedAt: string): void {
    this.sql.exec(
      `UPDATE member_access
       SET revoked_at = ?
       WHERE member_id = ? AND revoked_at IS NULL`,
      revokedAt,
      memberId,
    );
  }

  private isProvisioned(): boolean {
    const table = this.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'member_access'",
      )
      .toArray()[0];

    return table !== undefined;
  }
}

function generateAccessToken(): string {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return toHex(bytes);
}

async function hashAccessToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);

  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
