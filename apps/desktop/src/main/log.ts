/* eslint-disable no-console -- The one place console is allowed until electron-log arrives in Phase 6. */

/**
 * Structured logger (CODE_STYLE.md §10). Context must never contain API keys or transcript text.
 */
export type Logger = {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
};

export const log: Logger = {
  info: (message, context = {}) => {
    console.info(message, context);
  },
  warn: (message, context = {}) => {
    console.warn(message, context);
  },
  error: (message, context = {}) => {
    console.error(message, context);
  },
};
