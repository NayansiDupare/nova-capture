import { useEffect, useState } from 'react';

import type { KeyPoint, NoteDraft } from '@nova/core';

import { KeyPointList } from './KeyPointList';
import { TranscriptPane } from './TranscriptPane';
import type { TimeRange } from './TranscriptPane';
import { useSessionStore } from '../stores/use-session-store';

type ReviewScreenProps = { draft: NoteDraft };

/**
 * Review a generated note before it is saved (PRD.md US-7, DESIGN_SYSTEM.md §9): the editable
 * note on the left, the transcript on the right. Edits stay local until Save.
 */
export function ReviewScreen({ draft }: ReviewScreenProps) {
  const transcript = useSessionStore((s) => s.transcript);
  const isSaving = useSessionStore((s) => s.isSaving);
  const actionError = useSessionStore((s) => s.actionError);
  const save = useSessionStore((s) => s.save);
  const discard = useSessionStore((s) => s.discard);

  const { content } = draft;
  const [title, setTitle] = useState(content.title);
  const [summary, setSummary] = useState(content.summary);
  const [keyPoints, setKeyPoints] = useState<KeyPoint[]>(content.keyPoints);
  const [tags, setTags] = useState(content.tags.join(', '));
  const [highlight, setHighlight] = useState<TimeRange>();
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  const canSave = title.trim() !== '' && summary.trim() !== '' && !isSaving;
  const submit = () => {
    if (!canSave) return;
    save({
      title,
      summary,
      keyPoints: keyPoints
        .filter((p) => p.text.trim() !== '')
        .map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
      tags: tags.split(',').filter((t) => t.trim() !== ''),
    });
  };

  // Ctrl+S saves (DESIGN_SYSTEM.md §10).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  const isQuick = content.mode === 'quick';
  return (
    <section className="review" aria-labelledby="review-title">
      <header className="review__header">
        <h2 id="review-title">Review note</h2>
        <span className="review__badge">{isQuick ? 'Quick save' : 'Full note'}</span>
        <p className="review__muted">
          AI-generated from the transcript. Check flagged points before saving.
        </p>
      </header>

      <div className="review__panes">
        <form
          className="review__pane review__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          aria-label="Note"
        >
          <label>
            Title
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              required
            />
          </label>
          <label>
            {isQuick ? 'Gist' : 'Summary'}
            <textarea
              value={summary}
              rows={isQuick ? 2 : 5}
              onChange={(e) => {
                setSummary(e.target.value);
              }}
              required
            />
          </label>

          {!isQuick && (
            <fieldset>
              <legend>Key points</legend>
              <KeyPointList
                points={keyPoints}
                onChange={(index, text) => {
                  setKeyPoints((points) =>
                    points.map((p, i) => (i === index ? { ...p, text } : p)),
                  );
                }}
                onRemove={(index) => {
                  setKeyPoints((points) => points.filter((_, i) => i !== index));
                }}
                onJump={setHighlight}
              />
            </fieldset>
          )}

          <label>
            Tags <span className="review__muted">(comma-separated)</span>
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
              }}
            />
          </label>

          {content.uncertainTerms.length > 0 && (
            <div>
              <h3>Possibly misheard</h3>
              <ul className="review__uncertain">
                {content.uncertainTerms.map((term) => (
                  <li key={term}>{term}</li>
                ))}
              </ul>
            </div>
          )}

          {actionError && (
            <p role="alert" className="review__error">
              {actionError}
            </p>
          )}

          <div className="review__actions">
            <button type="submit" className="review__primary" disabled={!canSave}>
              {isSaving ? 'Saving…' : 'Save note'}
            </button>
            {isConfirmingDiscard ? (
              <>
                <span>Discard this note?</span>
                <button type="button" className="review__danger" onClick={discard}>
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmingDiscard(false);
                  }}
                >
                  Keep reviewing
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsConfirmingDiscard(true);
                }}
              >
                Discard…
              </button>
            )}
          </div>
        </form>

        <TranscriptPane segments={transcript} highlight={highlight} />
      </div>
    </section>
  );
}
