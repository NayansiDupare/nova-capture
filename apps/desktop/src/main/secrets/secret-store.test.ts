import { describe, expect, it } from 'vitest';

import { SecretStore } from './secret-store';
import type { Encryptor } from './secret-store';
import { openDatabase } from '../db/open-database';

/** Reversible stand-in for safeStorage: reverses the bytes so plaintext is never stored as-is. */
const fakeEncryptor = (isAvailable = true): Encryptor => ({
  isEncryptionAvailable: () => isAvailable,
  encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
  decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
});

const setup = (isAvailable = true) => {
  const db = openDatabase(':memory:');
  return { db, store: new SecretStore(db, fakeEncryptor(isAvailable), () => 42) };
};

describe('SecretStore', () => {
  it('stores a key encrypted and reveals it in main', () => {
    const { db, store } = setup();

    expect(store.set('groq', 'gsk_secret123')).toEqual({ ok: true });

    expect(store.has('groq')).toBe(true);
    expect(store.reveal('groq')).toBe('gsk_secret123');
    const raw = db.prepare('SELECT ciphertext, updated_at FROM secrets').get();
    expect(Buffer.from(raw?.['ciphertext'] as Uint8Array).toString('utf8')).not.toContain(
      'gsk_secret123',
    );
    expect(raw?.['updated_at']).toBe(42);
  });

  it('replaces an existing key', () => {
    const { store } = setup();
    store.set('deepgram', 'old');
    store.set('deepgram', 'new');
    expect(store.reveal('deepgram')).toBe('new');
  });

  it('refuses to store anything when encryption is unavailable', () => {
    const { db, store } = setup(false);

    expect(store.set('gemini', 'AIza_secret')).toEqual({
      ok: false,
      reason: 'encryption-unavailable',
    });
    expect(db.prepare('SELECT count(*) AS n FROM secrets').get()).toEqual({ n: 0 });
  });

  it('reports missing keys', () => {
    const { store } = setup();
    expect(store.has('gemini')).toBe(false);
    expect(store.reveal('gemini')).toBeUndefined();
  });
});
