import type { DatabaseSync } from 'node:sqlite';

import type { SecretId, SecretsSetResponse } from '@nova/core';

/** The subset of Electron's `safeStorage` we use; injected so tests can run without Electron. */
export type Encryptor = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

/**
 * API keys, encrypted with safeStorage (DPAPI on Windows) before they touch the database.
 * Main-process only: nothing here is exposed over IPC except {@link SecretStore.set}
 * (AGENTS.md §4.4, SECURITY.md §5).
 */
export class SecretStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly encryptor: Encryptor,
    private readonly now: () => number = Date.now,
  ) {}

  /** Encrypts and stores `apiKey`. Refuses, rather than storing plaintext, when encryption is unavailable. */
  set(id: SecretId, apiKey: string): SecretsSetResponse {
    if (!this.encryptor.isEncryptionAvailable()) {
      return { ok: false, reason: 'encryption-unavailable' };
    }
    const ciphertext = this.encryptor.encryptString(apiKey);
    this.db
      .prepare(
        `INSERT INTO secrets (id, ciphertext, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(id, ciphertext, this.now());
    return { ok: true };
  }

  has(id: SecretId): boolean {
    return this.db.prepare('SELECT 1 FROM secrets WHERE id = ?').get(id) !== undefined;
  }

  /** Decrypts the key for a provider call. Call it right before the request; do not cache the result. */
  reveal(id: SecretId): string | undefined {
    const row = this.db.prepare('SELECT ciphertext FROM secrets WHERE id = ?').get(id);
    const ciphertext = row?.['ciphertext'];
    if (ciphertext === undefined) {
      return undefined;
    }
    if (!(ciphertext instanceof Uint8Array)) {
      throw new Error(`Stored secret ${id} is not a blob`);
    }
    return this.encryptor.decryptString(Buffer.from(ciphertext));
  }
}
