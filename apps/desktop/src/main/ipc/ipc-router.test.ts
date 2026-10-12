import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { DEFAULT_SETTINGS, IPC_CHANNELS } from '@nova/core';

import { openDatabase } from '../db/open-database';
import { SettingsRepo } from '../db/settings-repo';
import { log } from '../log';
import { createIpcHandlers } from './handlers';
import { IpcRequestError, registerIpcHandlers } from './ipc-router';
import type { InvokeEvent } from './ipc-router';
import { isTrustedSender } from './trusted-sender';
import type { Encryptor } from '../secrets/secret-store';
import { SecretStore } from '../secrets/secret-store';

type Listener = (event: InvokeEvent, ...args: unknown[]) => unknown;

const TRUSTED_ID = 1;
const fromMainWindow: InvokeEvent = { sender: { id: TRUSTED_ID }, senderFrame: { parent: null } };

const encryptor: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
  decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
};

const setup = () => {
  const db = openDatabase(':memory:');
  const secrets = new SecretStore(db, encryptor);
  const listeners = new Map<string, Listener>();
  registerIpcHandlers(
    { handle: (channel, listener) => listeners.set(channel, listener) },
    createIpcHandlers({ settings: new SettingsRepo(db), secrets }),
    (event) => isTrustedSender(event, new Set([TRUSTED_ID])),
  );
  const invoke = (channel: string, event: InvokeEvent, ...args: unknown[]) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}`);
    return Promise.resolve(listener(event, ...args));
  };
  return { listeners, secrets, invoke };
};

describe('IPC router', () => {
  let warn: MockInstance<typeof log.warn>;

  beforeEach(() => {
    warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('registers exactly the channels defined in core', () => {
    expect([...setup().listeners.keys()].sort()).toEqual(Object.keys(IPC_CHANNELS).sort());
  });

  it('serves settings:get and settings:set', async () => {
    const { invoke } = setup();
    await expect(invoke('settings:get', fromMainWindow)).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(
      invoke('settings:set', fromMainWindow, { sttProvider: 'deepgram' }),
    ).resolves.toEqual({ ...DEFAULT_SETTINGS, sttProvider: 'deepgram' });
  });

  it('stores a secret without returning it', async () => {
    const { invoke, secrets } = setup();
    const reply = await invoke('secrets:set', fromMainWindow, { id: 'groq', apiKey: ' gsk_abc ' });
    expect(reply).toEqual({ ok: true });
    expect(secrets.reveal('groq')).toBe('gsk_abc');
  });

  it('rejects an invalid payload without logging its contents', async () => {
    const { invoke, secrets } = setup();
    const payload = { id: 'openai', apiKey: 'sk_leak_me' };

    await expect(invoke('secrets:set', fromMainWindow, payload)).rejects.toThrow(IpcRequestError);

    expect(secrets.has('groq')).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk_leak_me');
    expect(warn).toHaveBeenCalledWith('rejected invalid IPC payload', {
      channel: 'secrets:set',
      issues: [{ path: 'id', code: 'invalid_value' }],
    });
  });

  it('rejects extra arguments', async () => {
    const { invoke } = setup();
    await expect(invoke('settings:set', fromMainWindow, {}, 'extra')).rejects.toThrow(
      /unexpected arguments/,
    );
  });

  it.each([
    ['an unknown window', { sender: { id: 99 }, senderFrame: { parent: null } }],
    ['a subframe', { sender: { id: TRUSTED_ID }, senderFrame: { parent: {} } }],
    ['a destroyed frame', { sender: { id: TRUSTED_ID }, senderFrame: null }],
  ])('rejects calls from %s', async (_label, event: InvokeEvent) => {
    const { invoke } = setup();
    await expect(invoke('settings:get', event)).rejects.toThrow(/untrusted sender/);
  });

  it('refuses to send a reply that breaks the response schema', async () => {
    const listeners = new Map<string, Listener>();
    registerIpcHandlers(
      { handle: (channel, listener) => listeners.set(channel, listener) },
      {
        'settings:get': () => ({ ...DEFAULT_SETTINGS, apiKey: 'oops' }),
        'settings:set': () => DEFAULT_SETTINGS,
        'secrets:set': () => ({ ok: true }),
      },
      () => true,
    );
    await expect(listeners.get('settings:get')?.(fromMainWindow)).rejects.toThrow();
  });
});
