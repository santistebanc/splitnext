import { createIdentifier } from './domain/ids';

export type AccessIdentity = {
  id: string;
  created_at: string;
};

export type IdentityDevice = {
  id: string;
  created_at: string;
};

export type IdentitySession = {
  identity: AccessIdentity;
  device: IdentityDevice;
};

export class MockAccountSignInError extends Error {
  constructor(readonly code: 'account_identity_conflict' | 'device_credential_revoked') {
    super(code);
    this.name = 'MockAccountSignInError';
  }
}

type StoredIdentitySession = {
  identity_id: string;
  identity_created_at: string;
  device_id: string;
  device_created_at: string;
  device_revoked_at: string | null;
};

type StoredCredential = {
  session: IdentitySession;
  revokedAt: string | null;
};

export type IdentityDirectoryInspection = {
  identities: Array<{
    id: string;
    created_at: string;
    mock_account: string | null;
    merged_into?: string | undefined;
    devices: Array<{
      id: string;
      created_at: string;
      revoked_at: string | null;
    }>;
  }>;
};

type IdentityDirectoryInspectionRow = {
  identity_id: string;
  identity_created_at: string;
  mock_account_name: string | null;
  merged_into: string | null;
  device_id: string | null;
  device_created_at: string | null;
  device_revoked_at: string | null;
};

type IdentityMergeRow = {
  source_identity_id: string;
  target_identity_id: string;
};

export class IdentityDirectory {
  constructor(private readonly database: D1Database) {}

  /** Development only: simulate account sign-in and issue this device a credential. */
  async signInWithMockAccount(
    accountName: string,
    deviceSecret: string,
    mergeIdentity: (
      sourceIdentityId: string,
      targetIdentityId: string,
    ) => Promise<D1PreparedStatement[]>,
  ): Promise<IdentitySession> {
    const normalizedAccount = normalizeMockAccountName(accountName);
    const credentialHash = await hashCredential(deviceSecret);
    const credential = await this.findByCredentialHash(credentialHash);

    if (credential?.revokedAt) {
      throw new MockAccountSignInError('device_credential_revoked');
    }

    const linkedIdentityId = await this.findMockAccountIdentity(normalizedAccount);

    if (linkedIdentityId) {
      if (credential && credential.session.identity.id !== linkedIdentityId) {
        const sourceAccount = await this.findMockAccountNameByIdentity(
          credential.session.identity.id,
        );

        if (sourceAccount) {
          throw new MockAccountSignInError('account_identity_conflict');
        }

        const groupIndexChanges = await mergeIdentity(
          credential.session.identity.id,
          linkedIdentityId,
        );

        await this.database.batch([
          ...groupIndexChanges,
          this.database
            .prepare(
              `INSERT INTO identity_merges (source_identity_id, target_identity_id, merged_at)
               VALUES (?, ?, ?)
               ON CONFLICT (source_identity_id) DO UPDATE SET
                 target_identity_id = excluded.target_identity_id,
                 merged_at = excluded.merged_at`,
            )
            .bind(
              credential.session.identity.id,
              linkedIdentityId,
              new Date().toISOString(),
            ),
          this.database
            .prepare('UPDATE identity_devices SET identity_id = ? WHERE identity_id = ?')
            .bind(linkedIdentityId, credential.session.identity.id),
        ]);

        const account = await this.database
          .prepare('SELECT created_at FROM access_identities WHERE id = ?')
          .bind(linkedIdentityId)
          .first<{ created_at: string }>();

        if (!account) throw new Error('identity_not_found');

        return {
          identity: { id: linkedIdentityId, created_at: account.created_at },
          device: credential.session.device,
        };
      }

      return credential?.session ?? this.addDeviceCredential(linkedIdentityId, deviceSecret);
    }

    if (credential) {
      await this.linkMockAccount(normalizedAccount, credential.session.identity.id);

      return credential.session;
    }

    return this.createMockAccountIdentity(normalizedAccount, deviceSecret, credentialHash);
  }

  async ensureAnonymousIdentity(deviceSecret: string): Promise<IdentitySession> {
    const credentialHash = await hashCredential(deviceSecret);
    const existing = await this.findByCredentialHash(credentialHash);

    if (existing) return existing.session;

    const createdAt = new Date().toISOString();
    const identityId = createIdentifier();
    const deviceId = createIdentifier();

    try {
      await this.database.batch([
        this.database
          .prepare('INSERT INTO access_identities (id, created_at) VALUES (?, ?)')
          .bind(identityId, createdAt),
        this.database
          .prepare(
            `INSERT INTO identity_devices
               (id, identity_id, credential_hash, created_at, revoked_at)
             VALUES (?, ?, ?, ?, NULL)`,
          )
          .bind(deviceId, identityId, credentialHash, createdAt),
      ]);
    } catch {
      const concurrentlyCreated = await this.findByCredentialHash(credentialHash);

      if (concurrentlyCreated) return concurrentlyCreated.session;

      throw new Error('identity_creation_failed');
    }

    return {
      identity: { id: identityId, created_at: createdAt },
      device: { id: deviceId, created_at: createdAt },
    };
  }

  async authenticateDevice(deviceSecret: string): Promise<IdentitySession | null> {
    const credentialHash = await hashCredential(deviceSecret);
    const stored = await this.findByCredentialHash(credentialHash);

    return stored?.revokedAt === null ? stored.session : null;
  }

  /** Development only: forgets every identity and device credential. */
  async clear(): Promise<void> {
    await this.database.batch([
      this.database.prepare('DELETE FROM mock_auth_accounts'),
      this.database.prepare('DELETE FROM identity_merges'),
      this.database.prepare('DELETE FROM identity_devices'),
      this.database.prepare('DELETE FROM access_identities'),
    ]);
  }

  async inspect(): Promise<IdentityDirectoryInspection> {
    const { results } = await this.database
      .prepare(
        `SELECT
           identity.id AS identity_id,
           identity.created_at AS identity_created_at,
           account.account_name AS mock_account_name,
           merge.target_identity_id AS merged_into,
           device.id AS device_id,
           device.created_at AS device_created_at,
           device.revoked_at AS device_revoked_at
         FROM access_identities AS identity
         LEFT JOIN mock_auth_accounts AS account
           ON account.identity_id = identity.id
         LEFT JOIN identity_merges AS merge
           ON merge.source_identity_id = identity.id
         LEFT JOIN identity_devices AS device
           ON device.identity_id = identity.id
         ORDER BY identity.created_at, identity.id, device.created_at, device.id`,
      )
      .all<IdentityDirectoryInspectionRow>();

    const identities = new Map<
      string,
      IdentityDirectoryInspection['identities'][number]
    >();

    for (const row of results) {
      let identity = identities.get(row.identity_id);

      if (!identity) {
        identity = {
          id: row.identity_id,
          created_at: row.identity_created_at,
          mock_account: row.mock_account_name,
          devices: [],
        };

        if (row.merged_into) identity.merged_into = row.merged_into;

        identities.set(row.identity_id, identity);
      }

      if (row.device_id && row.device_created_at) {
        identity.devices.push({
          id: row.device_id,
          created_at: row.device_created_at,
          revoked_at: row.device_revoked_at,
        });
      }
    }

    return { identities: [...identities.values()] };
  }

  /** Returns every historical identity now resolving to this identity. */
  async mergedSources(identityId: string): Promise<string[]> {
    const { results } = await this.database
      .prepare('SELECT source_identity_id, target_identity_id FROM identity_merges')
      .all<IdentityMergeRow>();

    const targets = new Map(
      results.map(({ source_identity_id, target_identity_id }) => [
        source_identity_id,
        target_identity_id,
      ]),
    );

    return results
      .map(({ source_identity_id }) => source_identity_id)
      .filter((source) => resolveMergedIdentity(source, targets) === identityId);
  }

  private async findByCredentialHash(
    credentialHash: string,
  ): Promise<StoredCredential | null> {
    const row = await this.database
      .prepare(
        `SELECT
           identity.id AS identity_id,
           identity.created_at AS identity_created_at,
           device.id AS device_id,
           device.created_at AS device_created_at,
           device.revoked_at AS device_revoked_at
         FROM identity_devices AS device
         JOIN access_identities AS identity ON identity.id = device.identity_id
         WHERE device.credential_hash = ?`,
      )
      .bind(credentialHash)
      .first<StoredIdentitySession>();

    if (!row) return null;

    return {
      session: {
        identity: {
          id: row.identity_id,
          created_at: row.identity_created_at,
        },
        device: {
          id: row.device_id,
          created_at: row.device_created_at,
        },
      },
      revokedAt: row.device_revoked_at,
    };
  }

  private async findMockAccountIdentity(accountName: string): Promise<string | null> {
    const row = await this.database
      .prepare('SELECT identity_id FROM mock_auth_accounts WHERE account_name = ?')
      .bind(accountName)
      .first<{ identity_id: string }>();

    return row?.identity_id ?? null;
  }

  private async findMockAccountNameByIdentity(identityId: string): Promise<string | null> {
    const row = await this.database
      .prepare('SELECT account_name FROM mock_auth_accounts WHERE identity_id = ?')
      .bind(identityId)
      .first<{ account_name: string }>();

    return row?.account_name ?? null;
  }

  private async linkMockAccount(accountName: string, identityId: string): Promise<void> {
    const createdAt = new Date().toISOString();

    try {
      await this.database
        .prepare(
          `INSERT INTO mock_auth_accounts (account_name, identity_id, created_at)
           VALUES (?, ?, ?)`,
        )
        .bind(accountName, identityId, createdAt)
        .run();
    } catch {
      const byName = await this.findMockAccountIdentity(accountName);

      if (byName === identityId) return;

      throw new MockAccountSignInError('account_identity_conflict');
    }
  }

  private async addDeviceCredential(
    identityId: string,
    deviceSecret: string,
  ): Promise<IdentitySession> {
    const existing = await this.findByCredentialHash(await hashCredential(deviceSecret));

    if (existing) {
      if (existing.revokedAt) {
        throw new MockAccountSignInError('device_credential_revoked');
      }

      if (existing.session.identity.id !== identityId) {
        throw new MockAccountSignInError('account_identity_conflict');
      }

      return existing.session;
    }

    const identity = await this.database
      .prepare('SELECT created_at FROM access_identities WHERE id = ?')
      .bind(identityId)
      .first<{ created_at: string }>();

    if (!identity) throw new Error('identity_not_found');

    const createdAt = new Date().toISOString();
    const deviceId = createIdentifier();
    const credentialHash = await hashCredential(deviceSecret);

    try {
      await this.database
        .prepare(
          `INSERT INTO identity_devices
             (id, identity_id, credential_hash, created_at, revoked_at)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .bind(deviceId, identityId, credentialHash, createdAt)
        .run();
    } catch {
      const concurrentlyRegistered = await this.findByCredentialHash(credentialHash);

      if (concurrentlyRegistered?.session.identity.id === identityId) {
        return concurrentlyRegistered.session;
      }

      throw new MockAccountSignInError('account_identity_conflict');
    }

    return {
      identity: { id: identityId, created_at: identity.created_at },
      device: { id: deviceId, created_at: createdAt },
    };
  }

  private async createMockAccountIdentity(
    accountName: string,
    deviceSecret: string,
    credentialHash: string,
  ): Promise<IdentitySession> {
    const createdAt = new Date().toISOString();
    const identityId = createIdentifier();
    const deviceId = createIdentifier();

    try {
      await this.database.batch([
        this.database
          .prepare('INSERT INTO access_identities (id, created_at) VALUES (?, ?)')
          .bind(identityId, createdAt),
        this.database
          .prepare(
            `INSERT INTO identity_devices
               (id, identity_id, credential_hash, created_at, revoked_at)
             VALUES (?, ?, ?, ?, NULL)`,
          )
          .bind(deviceId, identityId, credentialHash, createdAt),
        this.database
          .prepare(
            `INSERT INTO mock_auth_accounts (account_name, identity_id, created_at)
             VALUES (?, ?, ?)`,
          )
          .bind(accountName, identityId, createdAt),
      ]);
    } catch {
      const linkedIdentityId = await this.findMockAccountIdentity(accountName);

      if (linkedIdentityId) {
        return this.addDeviceCredential(linkedIdentityId, deviceSecret);
      }

      const concurrentlyRegistered = await this.findByCredentialHash(credentialHash);

      if (concurrentlyRegistered && !concurrentlyRegistered.revokedAt) {
        await this.linkMockAccount(
          accountName,
          concurrentlyRegistered.session.identity.id,
        );

        return concurrentlyRegistered.session;
      }

      throw new Error('mock_account_sign_in_failed');
    }

    return {
      identity: { id: identityId, created_at: createdAt },
      device: { id: deviceId, created_at: createdAt },
    };
  }
}

function normalizeMockAccountName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function resolveMergedIdentity(
  identityId: string,
  targets: ReadonlyMap<string, string>,
): string {
  let resolved = identityId;
  const visited = new Set<string>();

  while (targets.has(resolved)) {
    if (visited.has(resolved)) throw new Error('identity_merge_cycle');

    visited.add(resolved);
    resolved = targets.get(resolved)!;
  }

  return resolved;
}

async function hashCredential(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
