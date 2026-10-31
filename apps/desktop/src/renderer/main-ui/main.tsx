import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { sessionStore } from './stores/use-session-store';
import './tokens.css';
import './dev-panel.css';
import './review/review.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element in index.html');
}

// The store lives as long as the window, so it is never disconnected.
sessionStore.connect();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
