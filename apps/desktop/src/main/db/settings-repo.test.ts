import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@nova/core';

import { log } from '../log';
import { openDatabase } from './open-database';
import { SettingsRepo } from './settings-repo';

const setup = () => {
  const db = openDatabase(':memory:');
  const store = (key: string, value: string) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return { repo: new SettingsRepo(db), store };
};

describe('SettingsRepo', () => {
  it('returns defaults when nothing is stored', () => {
    expect(setup().repo.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves a patch and returns the merged settings', () => {
    const { repo } = setup();
    expect(repo.update({ sttProvider: 'deepgram' })).toEqual({
      ...DEFAULT_SETTINGS,
      sttProvider: 'deepgram',
    });
    expect(repo.get().sttProvider).toBe('deepgram');
  });

  it('overwrites an existing value', () => {
    const { repo } = setup();
    repo.update({ sttProvider: 'deepgram' });
    repo.update({ sttProvider: 'groq' });
    expect(repo.get().sttProvider).toBe('groq');
  });

  it('treats an undefined value in a patch as unchanged', () => {
    const { repo } = setup();
    repo.update({ sttProvider: 'deepgram' });
    expect(repo.update({ sttProvider: undefined }).sttProvider).toBe('deepgram');
  });

  it('ignores unknown stored keys', () => {
    const { repo, store } = setup();
    store('theme', '"dark"');
    expect(repo.get()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([
    ['a value outside the schema', '"whisper-local"'],
    ['malformed JSON', '{not json'],
  ])('falls back to the default for %s and logs only the key', (_label, value) => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const { repo, store } = setup();
    store('sttProvider', value);

    expect(repo.get()).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledWith('ignoring invalid stored setting', { key: 'sttProvider' });
    warn.mockRestore();
  });
});
