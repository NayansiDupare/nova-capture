import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

import { parseVocabulary } from '@nova/core';

import { errorMessage } from './session-store';
import type { NovaApi } from '../../../preload/api';

export type SettingsApi = Pick<NovaApi, 'settings'>;

export type SettingsStoreState = {
  /** The saved vocabulary, as main last reported it. */
  readonly vocabulary: readonly string[];
  readonly status: 'idle' | 'saving' | 'saved';
  readonly error: string | undefined;
  readonly load: () => void;
  /** Parses comma- or line-separated terms and saves them. */
  readonly saveVocabulary: (text: string) => void;
};

/** User settings the UI edits. Main validates and stores them (ARCHITECTURE.md §11). */
export function createSettingsStore(api: SettingsApi): StoreApi<SettingsStoreState> {
  return createStore<SettingsStoreState>()((set) => ({
    vocabulary: [],
    status: 'idle',
    error: undefined,
    load: () => {
      api.settings.get().then(
        ({ vocabulary }) => {
          set({ vocabulary });
        },
        (error: unknown) => {
          set({ error: errorMessage(error) });
        },
      );
    },
    saveVocabulary: (text) => {
      set({ status: 'saving', error: undefined });
      api.settings.set({ vocabulary: parseVocabulary(text) }).then(
        ({ vocabulary }) => {
          set({ vocabulary, status: 'saved' });
        },
        (error: unknown) => {
          set({ status: 'idle', error: errorMessage(error) });
        },
      );
    },
  }));
}
