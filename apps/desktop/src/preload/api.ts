/**
 * The API the main UI preload exposes as `window.nova`.
 * Empty for now; each IPC channel adds one narrow function here (AGENTS.md §5).
 */
export type NovaApi = Readonly<Record<string, never>>;
