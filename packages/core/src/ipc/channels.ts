import { z } from 'zod';

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

/**
 * Every renderer → main invoke channel (ARCHITECTURE.md §11).
 * Main validates `request` before calling a handler and `response` before replying.
 */
export const IPC_CHANNELS = {
  'settings:get': { request: z.undefined(), response: SettingsSchema },
  'settings:set': { request: SettingsPatchSchema, response: SettingsSchema },
  'secrets:set': { request: SecretsSetRequestSchema, response: SecretsSetResponseSchema },
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export type IpcChannel = keyof typeof IPC_CHANNELS;

/** What the renderer sends. */
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IPC_CHANNELS)[C]['request']>;
/** What a main handler receives after validation. */
export type IpcParsedRequest<C extends IpcChannel> = z.output<(typeof IPC_CHANNELS)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.output<(typeof IPC_CHANNELS)[C]['response']>;
