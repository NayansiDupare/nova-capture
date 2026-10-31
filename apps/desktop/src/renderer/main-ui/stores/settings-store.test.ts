import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@nova/core';
import type { Settings, SettingsPatch } from '@nova/core';

import { createSettingsStore } from './settings-store';
import type { SettingsApi } from './settings-store';

const fakeApi = (initial: Settings = DEFAULT_SETTINGS) => {
  let settings = initial;
  const patches: SettingsPatch[] = [];
  let failNext: Error | undefined;
  const api: SettingsApi = {
    settings: {
      get: () => Promise.resolve(settings),
      set: (patch) => {
        patches.push(patch);
        if (failNext) return Promise.reject(failNext);
        settings = { ...settings, ...patch } as Settings;
        return Promise.resolve(settings);
      },
    },
  };
  return {
    api,
    patches,
    failNextSet: (error: Error) => {
      failNext = error;
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings store', () => {
  it('loads the saved vocabulary', async () => {
    const { api } = fakeApi({ ...DEFAULT_SETTINGS, vocabulary: ['RAG'] });
    const store = createSettingsStore(api);
    store.getState().load();
    await flush();
    expect(store.getState().vocabulary).toEqual(['RAG']);
  });

  it('parses and saves the vocabulary, keeping what main returns', async () => {
    const { api, patches } = fakeApi();
    const store = createSettingsStore(api);

    store.getState().saveVocabulary('RAG, LangChain\nrag');
    expect(store.getState().status).toBe('saving');
    await flush();

    expect(patches).toEqual([{ vocabulary: ['RAG', 'LangChain'] }]);
    expect(store.getState()).toMatchObject({ vocabulary: ['RAG', 'LangChain'], status: 'saved' });
  });

  it('reports a failed save in plain language', async () => {
    const { api, failNextSet } = fakeApi();
    failNextSet(new Error("Error invoking remote method 'settings:set': Error: invalid payload"));
    const store = createSettingsStore(api);

    store.getState().saveVocabulary('RAG');
    await flush();

    expect(store.getState()).toMatchObject({ status: 'idle', error: 'invalid payload' });
  });
});
