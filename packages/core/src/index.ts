export { AUDIO_FORMAT, samplesForDurationMs } from './audio-format';
export type { AudioFormat } from './audio-format';

export {
  bytesToPcm,
  decodeWav,
  encodeWav,
  pcmToBytes,
  WAV_HEADER_BYTES,
  wavHeader,
  WavFormatError,
} from './audio/wav';
export type { DecodedWav } from './audio/wav';
export {
  DEFAULT_VAD_OPTIONS,
  detectSpeech,
  FRAME_MS,
  frameLevelDbfs,
  speechRatio,
} from './audio/vad';
export type { SpeechSpan, VadOptions } from './audio/vad';
export type { AudioSource, CaptureTarget } from './audio/audio-source';
export { DEFAULT_CHUNK_PLAN_OPTIONS, planChunks } from './audio/chunk-planner';
export type { ChunkPlan, ChunkPlanOptions } from './audio/chunk-planner';
export { assembleTranscript } from './transcript/assembler';
export type { TranscribedChunk } from './transcript/assembler';
export { backoffDelayMs, DEFAULT_BACKOFF } from './jobs/backoff';

export {
  chooseNoteMode,
  FullNoteOutputSchema,
  GROUNDING_FLAGS,
  GroundingFlagSchema,
  KeyPointEditSchema,
  KeyPointSchema,
  MAX_KEY_POINT_LENGTH,
  MAX_KEY_POINTS,
  MAX_SUMMARY_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  NOTE_MODES,
  NOTE_OUTPUT_SCHEMAS,
  NoteContentSchema,
  NoteDraftSchema,
  NoteEditsSchema,
  NoteModeSchema,
  normalizeTags,
  QUICK_MAX_SPEECH_MS,
  QuickNoteOutputSchema,
  speechDurationMs,
  toNoteContent,
} from './notes/note';
export type {
  FullNoteOutput,
  GroundingFlag,
  KeyPoint,
  KeyPointEdit,
  NoteContent,
  NoteDraft,
  NoteEdits,
  NoteMode,
  QuickNoteOutput,
} from './notes/note';
export { groundKeyPoints, quotedTerms } from './notes/ground-check';
export { generateNote } from './notes/generate-note';
export type { GenerateNoteInput, GeneratedNote } from './notes/generate-note';
export {
  buildNotePrompt,
  buildRepairPrompt,
  describeIssues,
  formatTranscriptLines,
  NOTE_MAX_OUTPUT_TOKENS,
  NOTE_PROMPT_VERSION,
} from './prompts/note-prompt';
export type { NotePrompt } from './prompts/note-prompt';
export { buildSttPrompt, MAX_STT_PROMPT_LENGTH } from './prompts/stt-prompt';
export type { BackoffOptions } from './jobs/backoff';

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
  MAX_VOCABULARY_TERM_LENGTH,
  MAX_VOCABULARY_TERMS,
  parseVocabulary,
  SECRET_IDS,
  SecretIdSchema,
  SettingsPatchSchema,
  SettingsSchema,
  STT_PROVIDER_IDS,
  SttProviderIdSchema,
  VocabularySchema,
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
  IPC_EVENTS,
  MAX_API_KEY_LENGTH,
  MAX_NOTES_PAGE_SIZE,
  MAX_SEARCH_QUERY_LENGTH,
  NoteChangesSchema,
  NoteIdSchema,
  NoteSearchHitSchema,
  NoteSummarySchema,
  SavedNoteSchema,
  SecretsSetRequestSchema,
  SecretsSetResponseSchema,
  SessionIdSchema,
  TranscriptSegmentSchema,
} from './ipc/channels';
export type {
  IpcChannel,
  IpcEvent,
  IpcEventPayload,
  IpcParsedRequest,
  IpcRequest,
  IpcResponse,
  NoteChanges,
  NoteListQuery,
  NoteSearchHit,
  NoteSearchQuery,
  NoteSummary,
  SavedNote,
  SecretsSetRequest,
  SecretsSetResponse,
} from './ipc/channels';

export { CAPTURE_HOST_CHANNELS, CaptureHostEndedSchema } from './ipc/capture-host';
export type { CaptureHostEnded } from './ipc/capture-host';
export { MainToWorkerSchema, SILENT_LEVEL_DBFS, WorkerToMainSchema } from './ipc/worker-protocol';
export type { MainToWorker, WorkerToMain } from './ipc/worker-protocol';

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
