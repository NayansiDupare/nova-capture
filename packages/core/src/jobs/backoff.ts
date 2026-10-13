export type BackoffOptions = {
  readonly baseMs: number;
  readonly maxMs: number;
  /** Returns a number in [0, 1). Injected so tests are deterministic (CODE_STYLE.md §5). */
  readonly random: () => number;
};

export const DEFAULT_BACKOFF: Omit<BackoffOptions, 'random'> = { baseMs: 2_000, maxMs: 5 * 60_000 };

/**
 * Delay before retry number `attempt` (1 = first retry): exponential growth capped at `maxMs`,
 * with "equal jitter" (half fixed, half random) so delays still grow while retries from
 * parallel jobs spread out.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${String(attempt)}`);
  }
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + options.random() * (ceiling / 2));
}
