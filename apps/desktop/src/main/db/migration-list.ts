import initial from './migrations/001_initial.sql?raw';
import transcriptChunks from './migrations/002_transcript_chunks.sql?raw';

export type Migration = { readonly version: number; readonly name: string; readonly sql: string };

/** Applied in order at startup. Append only; never edit or reorder (AGENTS.md §4.7). */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '001_initial', sql: initial },
  { version: 2, name: '002_transcript_chunks', sql: transcriptChunks },
];
