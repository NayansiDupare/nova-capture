import { useEffect, useState } from 'react';

import { useSettingsStore } from './stores/use-settings-store';

/**
 * Terms the user expects to hear, so speech-to-text and the note spell them right
 * (RAG, not RAC). Temporary home until the Settings screen exists.
 */
export function VocabularyEditor() {
  const vocabulary = useSettingsStore((s) => s.vocabulary);
  const status = useSettingsStore((s) => s.status);
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  const saveVocabulary = useSettingsStore((s) => s.saveVocabulary);
  const [text, setText] = useState(() => vocabulary.join(', '));
  const [shownVocabulary, setShownVocabulary] = useState(vocabulary);

  useEffect(() => {
    load();
  }, [load]);
  // Show what main saved (normalized) whenever it changes, during render as React recommends.
  if (shownVocabulary !== vocabulary) {
    setShownVocabulary(vocabulary);
    setText(vocabulary.join(', '));
  }

  return (
    <form
      className="dev-panel__vocabulary"
      onSubmit={(event) => {
        event.preventDefault();
        saveVocabulary(text);
      }}
    >
      <label>
        Vocabulary <span className="dev-panel__hint">(comma-separated, e.g. RAG, LangChain)</span>
        <textarea
          rows={2}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </label>
      <div className="dev-panel__actions">
        <button type="submit" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save vocabulary'}
        </button>
        <span role="status" aria-live="polite" className="dev-panel__hint">
          {status === 'saved' && 'Saved. Used for the next transcription and note.'}
        </span>
      </div>
      {error && (
        <p role="alert" className="dev-panel__error">
          {error}
        </p>
      )}
    </form>
  );
}
