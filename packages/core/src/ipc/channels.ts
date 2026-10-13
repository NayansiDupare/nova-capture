import { z } from 'zod';

import { SessionStateSchema } from '../session/session-machine';
import { SecretIdSchema, SettingsPatchSchema, SettingsSchema } from '../settings/settings';

/** Longest API key we accept. Real keys are well under this; the cap bounds what main will encrypt. */
export const MAX_API_KEY_LENGTH = 512;

export const SecretsSetRequestSchema = z.strictObject({
  id: SecretIdSchema,
  apiKey: z
    .string()
    .trim()
    .min(1, 'API key is empty')
    .max(MAX_API_KEY_LENGTH, 'API key is too long')
    .regex(/^\S+$/, 'API key must not contain spaces'),
});
export type SecretsSetRequest = z.input<typeof SecretsSetRequestSchema>;

/** Write-only: the response never contains the key (AGENTS.md §4.4). */
export const SecretsSetResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.literal('encryption-unavailable') }),
]);
export type SecretsSetResponse = z.infer<typeof SecretsSetResponseSchema>;

export const SessionIdSchema = z.string().min(1).max(100);

const SessionRefSchema = z.strictObject({ sessionId: SessionIdSchema });
const EmptySchema = z.strictObject({});

export const TranscriptSegmentSchema = z.strictObject({
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string(),
  confidence: z.number().optional(),
});

/**
 * Every renderer → main invoke channel (ARCHITECTURE.md §11).
 * Main validates `request` before calling a handler and `response` before replying.
 */
export const IPC_CHANNELS = {
  'settings:get': { request: z.undefined(), response: SettingsSchema },
  'settings:set': { request: SettingsPatchSchema, response: SettingsSchema },
  'secrets:set': { request: SecretsSetRequestSchema, response: SecretsSetResponseSchema },
  /** Starts a capture, or returns the running one. Failures arrive as `session:state` FAILED. */
  'capture:start': {
    request: z.undefined(),
    response: z.strictObject({ sessionId: SessionIdSchema }),
  },
  /** Stop, pause and resume act on the running capture and do nothing without one. */
  'capture:stop': { request: z.undefined(), response: EmptySchema },
  'capture:pause': { request: z.undefined(), response: EmptySchema },
  'capture:resume': { request: z.undefined(), response: EmptySchema },
  /** Re-runs failed transcription jobs. */
  'sessions:retry': { request: SessionRefSchema, response: EmptySchema },
  'sessions:discard': { request: SessionRefSchema, response: EmptySchema },
  /** The transcript assembled so far. Temporary view until notes exist (Phase 3). */
  'sessions:transcript': {
    request: SessionRefSchema,
    response: z.strictObject({ segments: z.array(TranscriptSegmentSchema) }),
  },
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export type IpcChannel = keyof typeof IPC_CHANNELS;

/** What the renderer sends. */
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IPC_CHANNELS)[C]['request']>;
/** What a main handler receives after validation. */
export type IpcParsedRequest<C extends IpcChannel> = z.output<(typeof IPC_CHANNELS)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.output<(typeof IPC_CHANNELS)[C]['response']>;

/** Main → renderer events (ARCHITECTURE.md §11). Main validates each payload before sending. */
export const IPC_EVENTS = {
  'session:state': z.strictObject({
    sessionId: SessionIdSchema,
    state: SessionStateSchema,
    error: z.string().nullable(),
  }),
  /** Throttled audio level for the meter, about 3 per second while recording. */
  'capture:level': z.strictObject({ dbfs: z.number() }),
} as const satisfies Record<string, z.ZodType>;

export type IpcEvent = keyof typeof IPC_EVENTS;
export type IpcEventPayload<E extends IpcEvent> = z.infer<(typeof IPC_EVENTS)[E]>;
