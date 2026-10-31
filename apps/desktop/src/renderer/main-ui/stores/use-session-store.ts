import { useStore } from 'zustand';

import { createSessionStore } from './session-store';
import type { SessionStoreState } from './session-store';

/** The app's one session store, fed by the preload API. `main.tsx` connects it. */
export const sessionStore = createSessionStore(window.nova);

/** Reads from the session store; pass a selector so components re-render only on what they use. */
export function useSessionStore<T>(selector: (state: SessionStoreState) => T): T {
  return useStore(sessionStore.store, selector);
}
