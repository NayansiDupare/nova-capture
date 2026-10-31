import { useEffect, useRef } from 'react';

import { formatTime } from '../format-time';
import type { Segment } from '../stores/session-store';

export type TimeRange = { readonly startMs: number; readonly endMs: number };

type TranscriptPaneProps = {
  segments: readonly Segment[];
  /** The range a clicked timestamp points to; matching segments are highlighted. */
  highlight: TimeRange | undefined;
};

const overlaps = (segment: Segment, range: TimeRange) =>
  segment.startMs <= range.endMs && segment.endMs >= range.startMs;

/** The transcript next to the note, so every key point can be checked against what was said. */
export function TranscriptPane({ segments, highlight }: TranscriptPaneProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlight) return;
    listRef.current?.querySelector('[data-highlight="true"]')?.scrollIntoView({ block: 'center' });
  }, [highlight]);

  return (
    <section className="review__pane review__transcript" aria-labelledby="transcript-title">
      <h3 id="transcript-title">Transcript</h3>
      {segments.length === 0 ? (
        <p className="review__muted">No transcript text.</p>
      ) : (
        <ol ref={listRef}>
          {segments.map((segment) => {
            const isHighlighted = highlight !== undefined && overlaps(segment, highlight);
            return (
              <li
                key={`${String(segment.startMs)}-${String(segment.endMs)}`}
                data-highlight={isHighlighted}
                className={isHighlighted ? 'review__segment--highlight' : undefined}
              >
                <time className="review__time">{formatTime(segment.startMs)}</time> {segment.text}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
