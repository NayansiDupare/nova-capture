import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import type { ChunkPlan, TranscribedChunk, TranscriptSegment } from '@nova/core';

const SegmentsSchema = z.array(
  z.object({
    startMs: z.number(),
    endMs: z.number(),
    text: z.string(),
    confidence: z.number().optional(),
  }),
);

const RowSchema = z.object({
  chunk_index: z.number(),
  start_ms: z.number(),
  end_ms: z.number(),
  segments: z.string(),
  language: z.string().nullable(),
});

/**
 * Each chunk's transcript, saved as soon as its STT job succeeds. Never deleted before the
 * note is saved (AGENTS.md §4.5). Segment text is transcript content: never log it.
 */
export class TranscriptChunksRepo {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /** Saves (or replaces, if a job ran twice) one chunk's result. */
  save(sessionId: string, provider: string, { chunk, result }: TranscribedChunk): void {
    this.db
      .prepare(
        `INSERT INTO transcript_chunks
           (session_id, chunk_index, start_ms, end_ms, provider, segments, language, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, chunk_index) DO UPDATE SET
           start_ms = excluded.start_ms, end_ms = excluded.end_ms, provider = excluded.provider,
           segments = excluded.segments, language = excluded.language,
           created_at = excluded.created_at`,
      )
      .run(
        sessionId,
        chunk.index,
        chunk.startMs,
        chunk.endMs,
        provider,
        JSON.stringify(result.segments),
        result.language ?? null,
        this.now(),
      );
  }

  /** All saved chunks of a session, in chunk order, ready for `assembleTranscript`. */
  listBySession(sessionId: string): TranscribedChunk[] {
    return this.db
      .prepare(
        `SELECT chunk_index, start_ms, end_ms, segments, language FROM transcript_chunks
         WHERE session_id = ? ORDER BY chunk_index`,
      )
      .all(sessionId)
      .map((row) => {
        const parsed = RowSchema.parse(row);
        const chunk: ChunkPlan = {
          index: parsed.chunk_index,
          startMs: parsed.start_ms,
          endMs: parsed.end_ms,
        };
        // Rebuilt so an absent confidence is omitted rather than `undefined` (exactOptionalPropertyTypes).
        const segments: TranscriptSegment[] = SegmentsSchema.parse(JSON.parse(parsed.segments)).map(
          ({ confidence, ...segment }) =>
            confidence === undefined ? segment : { ...segment, confidence },
        );
        return {
          chunk,
          result: parsed.language === null ? { segments } : { segments, language: parsed.language },
        };
      });
  }
}
