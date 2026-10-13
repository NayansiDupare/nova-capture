import { describe, expect, it } from 'vitest';

import { openDatabase } from './open-database';
import { TranscriptChunksRepo } from './transcript-chunks-repo';
import { UsageRepo } from './usage-repo';

const setup = () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'TRANSCRIBING', 1)").run();
  return { db, repo: new TranscriptChunksRepo(db, () => 42) };
};

describe('TranscriptChunksRepo', () => {
  it('saves chunks and lists them in order', () => {
    const { repo } = setup();
    repo.save('s1', 'groq', {
      chunk: { index: 1, startMs: 30_000, endMs: 60_000 },
      result: { segments: [{ startMs: 0, endMs: 2000, text: 'second' }] },
    });
    repo.save('s1', 'groq', {
      chunk: { index: 0, startMs: 0, endMs: 30_000 },
      result: {
        segments: [{ startMs: 0, endMs: 1000, text: 'first', confidence: 0.9 }],
        language: 'en',
      },
    });

    expect(repo.listBySession('s1')).toEqual([
      {
        chunk: { index: 0, startMs: 0, endMs: 30_000 },
        result: {
          segments: [{ startMs: 0, endMs: 1000, text: 'first', confidence: 0.9 }],
          language: 'en',
        },
      },
      {
        chunk: { index: 1, startMs: 30_000, endMs: 60_000 },
        result: { segments: [{ startMs: 0, endMs: 2000, text: 'second' }] },
      },
    ]);
  });

  it('replaces a chunk saved twice', () => {
    const { repo } = setup();
    const chunk = { index: 0, startMs: 0, endMs: 30_000 };
    repo.save('s1', 'groq', {
      chunk,
      result: { segments: [{ startMs: 0, endMs: 1, text: 'old' }] },
    });
    repo.save('s1', 'groq', {
      chunk,
      result: { segments: [{ startMs: 0, endMs: 1, text: 'new' }] },
    });
    expect(repo.listBySession('s1').map((c) => c.result.segments[0]?.text)).toEqual(['new']);
  });

  it('requires an existing session', () => {
    const { repo } = setup();
    expect(() => {
      repo.save('missing', 'groq', {
        chunk: { index: 0, startMs: 0, endMs: 1 },
        result: { segments: [] },
      });
    }).toThrow(/FOREIGN KEY/);
  });
});

describe('UsageRepo', () => {
  it('records usage and sums cost since a time', () => {
    const { db } = setup();
    const usage = new UsageRepo(db);
    const entry = { sessionId: 's1', provider: 'groq', kind: 'stt' as const, units: 30 };
    usage.record({ ...entry, costEstimateUsd: 0.001, at: 100 });
    usage.record({ ...entry, costEstimateUsd: 0.002, at: 200 });
    usage.record({ ...entry, costEstimateUsd: null, at: 300 });

    expect(usage.totalCostUsdSince(150)).toBeCloseTo(0.002);
    expect(usage.totalCostUsdSince(0)).toBeCloseTo(0.003);
    expect(usage.totalCostUsdSince(1000)).toBe(0);
  });
});
