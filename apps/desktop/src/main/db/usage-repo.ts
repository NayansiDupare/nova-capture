import type { DatabaseSync } from 'node:sqlite';

export type UsageKind = 'stt' | 'llm';

/** Provider usage for the spend view and spend cap (PRD.md FR-14). Units: audio seconds or tokens. */
export class UsageRepo {
  constructor(private readonly db: DatabaseSync) {}

  record(entry: {
    sessionId: string;
    provider: string;
    kind: UsageKind;
    units: number;
    costEstimateUsd: number | null;
    at: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO usage_log (session_id, provider, kind, units, cost_estimate_usd, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.sessionId,
        entry.provider,
        entry.kind,
        entry.units,
        entry.costEstimateUsd,
        entry.at,
      );
  }

  /** Estimated spend since `fromMs` (inclusive), in USD. Unknown costs count as 0. */
  totalCostUsdSince(fromMs: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(cost_estimate_usd), 0) AS total FROM usage_log WHERE at >= ?')
      .get(fromMs);
    return typeof row?.['total'] === 'number' ? row['total'] : 0;
  }
}
