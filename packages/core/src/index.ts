export { AUDIO_FORMAT, samplesForDurationMs } from './audio-format';
export type { AudioFormat } from './audio-format';

export {
  INITIAL_SNAPSHOT,
  InvalidTransitionError,
  isTerminalState,
  reduce,
  SESSION_STATES,
  SessionSnapshotSchema,
  SessionStateSchema,
  TERMINAL_STATES,
} from './session/session-machine';
export type {
  SessionEvent,
  SessionEventType,
  SessionSnapshot,
  SessionState,
} from './session/session-machine';

export {
  DEFAULT_SETTINGS,
  LLM_PROVIDER_IDS,
  LlmProviderIdSchema,
  SECRET_IDS,
  SecretIdSchema,
  SettingsPatchSchema,
  SettingsSchema,
  STT_PROVIDER_IDS,
  SttProviderIdSchema,
} from './settings/settings';
export type {
  LlmProviderId,
  SecretId,
  Settings,
  SettingsPatch,
  SttProviderId,
} from './settings/settings';

export {
  IPC_CHANNELS,
  MAX_API_KEY_LENGTH,
  SecretsSetRequestSchema,
  SecretsSetResponseSchema,
} from './ipc/channels';
export type {
  IpcChannel,
  IpcParsedRequest,
  IpcRequest,
  IpcResponse,
  SecretsSetRequest,
  SecretsSetResponse,
} from './ipc/channels';

export { InvalidOutputError, ProviderError } from './providers/providers';
export type {
  AudioChunk,
  CancelSignal,
  ChunkResult,
  LLMProvider,
  LlmUsage,
  SpeechToTextProvider,
  StructuredRequest,
  TranscribeOptions,
  TranscriptSegment,
} from './providers/providers';
