import {
  type AccessCredential,
  accessCredentialSchema,
  type MemberPrincipal,
} from './accessCredential';
import { generateSecretToken, hashSecretToken } from './secretToken.internal';

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

  async prepareIssue(deviceUserId: string): Promise<PreparedCredentialIssue> {
    const accessToken = generateSecretToken();

    return {
      accessToken,
      tokenHash: await hashSecretToken(accessToken),
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
      tokenHash: await hashSecretToken(parsed.data.accessToken),
      deviceUserId: parsed.data.deviceUserId,
    };
  }

  authenticate(prepared: PreparedAuthorization): MemberPrincipal | null {
    if (!prepared) return null;

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
}
