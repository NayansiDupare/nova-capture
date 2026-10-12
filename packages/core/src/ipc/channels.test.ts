import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, MAX_API_KEY_LENGTH } from './channels';
import { DEFAULT_SETTINGS } from '../settings/settings';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('IPC channel contracts', () => {
  describe('settings:get', () => {
    const { request, response } = IPC_CHANNELS['settings:get'];

    it('takes no payload', () => {
      expect(accepts(request, undefined)).toBe(true);
      expect(accepts(request, {})).toBe(false);
    });

    it('returns full settings', () => {
      expect(accepts(response, DEFAULT_SETTINGS)).toBe(true);
      expect(accepts(response, { sttProvider: 'groq' })).toBe(false);
    });
  });

  describe('settings:set', () => {
    const { request } = IPC_CHANNELS['settings:set'];

    it.each([{}, { sttProvider: 'deepgram' }, { sttProvider: 'groq', llmProvider: 'gemini' }])(
      'accepts the patch %o',
      (patch) => {
        expect(accepts(request, patch)).toBe(true);
      },
    );

    it.each([
      ['an unknown provider', { sttProvider: 'whisper-local' }],
      ['an unknown key', { theme: 'dark' }],
      ['a non-object', 'groq'],
      ['nothing', undefined],
    ])('rejects %s', (_label, patch) => {
      expect(accepts(request, patch)).toBe(false);
    });
  });

  describe('secrets:set', () => {
    const { request, response } = IPC_CHANNELS['secrets:set'];

    it('accepts a key for a known provider and trims it', () => {
      expect(request.parse({ id: 'deepgram', apiKey: '  dg_123abc \n' })).toEqual({
        id: 'deepgram',
        apiKey: 'dg_123abc',
      });
    });

    it.each([
      ['an unknown provider', { id: 'openai', apiKey: 'k' }],
      ['an empty key', { id: 'groq', apiKey: '   ' }],
      ['a key with spaces', { id: 'groq', apiKey: 'two words' }],
      ['an oversized key', { id: 'groq', apiKey: 'k'.repeat(MAX_API_KEY_LENGTH + 1) }],
      ['extra fields', { id: 'groq', apiKey: 'k', persist: false }],
      ['a missing key', { id: 'groq' }],
    ])('rejects %s', (_label, payload) => {
      expect(accepts(request, payload)).toBe(false);
    });

    it('never carries the key back', () => {
      expect(accepts(response, { ok: true })).toBe(true);
      expect(accepts(response, { ok: false, reason: 'encryption-unavailable' })).toBe(true);
      expect(accepts(response, { ok: true, apiKey: 'dg_123abc' })).toBe(false);
    });
  });
});
