import { DevCapturePanel } from './DevCapturePanel';
import { ReviewScreen } from './review/ReviewScreen';
import { useSessionStore } from './stores/use-session-store';

export function App() {
  const draft = useSessionStore((s) => (s.session?.state === 'REVIEW' ? s.draft : null));
  return (
    <main>
      <h1>Nova Capture</h1>
      {/* Keyed by session so a new draft never inherits another note's unsaved edits. */}
      {draft ? <ReviewScreen key={draft.sessionId} draft={draft} /> : <DevCapturePanel />}
    </main>
  );
}
