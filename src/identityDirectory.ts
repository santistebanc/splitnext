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
  device_id: string | null;
  device_created_at: string | null;
  device_revoked_at: string | null;
};

export class IdentityDirectory {
  constructor(private readonly database: D1Database) {}

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

  async inspect(): Promise<IdentityDirectoryInspection> {
    const { results } = await this.database
      .prepare(
        `SELECT
           identity.id AS identity_id,
           identity.created_at AS identity_created_at,
           device.id AS device_id,
           device.created_at AS device_created_at,
           device.revoked_at AS device_revoked_at
         FROM access_identities AS identity
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
          devices: [],
        };
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
}

async function hashCredential(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
