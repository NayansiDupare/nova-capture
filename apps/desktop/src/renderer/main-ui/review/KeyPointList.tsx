import type { GroundingFlag, KeyPoint } from '@nova/core';

import { formatTime } from '../format-time';
import type { TimeRange } from './TranscriptPane';

const FLAG_TEXT: Record<GroundingFlag, string> = {
  'time-range-not-in-transcript': 'No transcript at this time',
  'quoted-term-missing': 'Quoted words not found in transcript',
};

type KeyPointListProps = {
  points: readonly KeyPoint[];
  onChange: (index: number, text: string) => void;
  onRemove: (index: number) => void;
  onJump: (range: TimeRange) => void;
};

/** Editable key points with their time ranges and ground-check flags (DESIGN_SYSTEM.md §7). */
export function KeyPointList({ points, onChange, onRemove, onJump }: KeyPointListProps) {
  if (points.length === 0) {
    return <p className="review__muted">No key points.</p>;
  }
  return (
    <ol className="review__key-points">
      {points.map((point, index) => {
        const label = `Key point ${String(index + 1)}`;
        const range = `${formatTime(point.startMs)}–${formatTime(point.endMs)}`;
        return (
          <li key={`${String(point.startMs)}-${String(index)}`} className="review__key-point">
            <div className="review__key-point-meta">
              <button
                type="button"
                className="review__chip"
                onClick={() => {
                  onJump(point);
                }}
                aria-label={`Show transcript at ${range}`}
              >
                {range}
              </button>
              {point.flags.map((flag) => (
                <span key={flag} className="review__flag" role="note">
                  ⚠ {FLAG_TEXT[flag]}
                </span>
              ))}
              <button
                type="button"
                className="review__ghost"
                onClick={() => {
                  onRemove(index);
                }}
                aria-label={`Remove ${label.toLowerCase()}`}
              >
                Remove
              </button>
            </div>
            <textarea
              aria-label={label}
              value={point.text}
              rows={2}
              onChange={(event) => {
                onChange(index, event.target.value);
              }}
            />
          </li>
        );
      })}
    </ol>
  );
}
