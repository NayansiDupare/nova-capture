import { useStore } from 'zustand';

import { createSettingsStore } from './settings-store';
import type { SettingsStoreState } from './settings-store';

/** The app's one settings store, fed by the preload API. */
export const settingsStore = createSettingsStore(window.nova);

export function useSettingsStore<T>(selector: (state: SettingsStoreState) => T): T {
  return useStore(settingsStore, selector);
}
