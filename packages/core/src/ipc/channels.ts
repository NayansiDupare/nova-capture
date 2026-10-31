import { z } from 'zod';

import {
  KeyPointSchema,
  MAX_TAG_LENGTH,
  NoteDraftSchema,
  NoteEditsSchema,
  NoteModeSchema,
} from '../notes/note';
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

export const NoteIdSchema = z.string().min(1).max(100);

const NoteRefSchema = z.strictObject({ noteId: NoteIdSchema });

export const MAX_NOTES_PAGE_SIZE = 100;
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** One page of notes. The reply's `hasMore` says whether another page follows. */
const PageShape = {
  limit: z.number().int().min(1).max(MAX_NOTES_PAGE_SIZE).default(50),
  offset: z.number().int().nonnegative().default(0),
};

/** A saved note as the Library lists it. `summary` holds a Quick Save's gist. */
export const NoteSummarySchema = z.strictObject({
  id: z.string().min(1),
  mode: NoteModeSchema,
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  sourceApp: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

/** A saved note with everything the Note detail screen shows. */
export const SavedNoteSchema = NoteSummarySchema.extend({
  sessionId: z.string().nullable(),
  keyPoints: z.array(KeyPointSchema),
  language: z.string().nullable(),
  uncertainTerms: z.array(z.string()),
  segments: z.array(TranscriptSegmentSchema),
  aiModel: z.string().nullable(),
  promptVersion: z.string().nullable(),
  sttProvider: z.string().nullable(),
});
export type SavedNote = z.infer<typeof SavedNoteSchema>;

/** A search result. `snippet` is plain text around the match: render it as text, never as HTML. */
export const NoteSearchHitSchema = NoteSummarySchema.extend({ snippet: z.string() });
export type NoteSearchHit = z.infer<typeof NoteSearchHitSchema>;

/**
 * What `notes:update` can change: any field from Review, plus the favorite mark. Mode, language,
 * model and transcript never change after save.
 */
export const NoteChangesSchema = NoteEditsSchema.partial()
  .extend({ favorite: z.boolean().optional() })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), 'No changes');
export type NoteChanges = z.output<typeof NoteChangesSchema>;

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
  /** Re-runs a failed transcription or note generation. */
  'sessions:retry': { request: SessionRefSchema, response: EmptySchema },
  'sessions:discard': { request: SessionRefSchema, response: EmptySchema },
  /** The transcript assembled so far. The Review screen shows it next to the note. */
  'sessions:transcript': {
    request: SessionRefSchema,
    response: z.strictObject({ segments: z.array(TranscriptSegmentSchema) }),
  },
  /** The generated note waiting for review, or null when the session has none (yet). */
  'notes:draft': {
    request: SessionRefSchema,
    response: z.strictObject({ draft: NoteDraftSchema.nullable() }),
  },
  /**
   * Saves the reviewed note and moves the session to SAVED. Mode, language and model come
   * from the stored draft, never from the renderer.
   */
  'notes:save': {
    request: z.strictObject({ sessionId: SessionIdSchema, note: NoteEditsSchema }),
    response: z.strictObject({ noteId: z.string().min(1) }),
  },
  /** Saved notes, newest first. The filters can be combined. */
  'notes:list': {
    request: z.strictObject({
      ...PageShape,
      favoritesOnly: z.boolean().default(false),
      tag: z.string().min(1).max(MAX_TAG_LENGTH).optional(),
    }),
    response: z.strictObject({ notes: z.array(NoteSummarySchema), hasMore: z.boolean() }),
  },
  /** One saved note, or null when it does not exist (any more). */
  'notes:get': {
    request: NoteRefSchema,
    response: z.strictObject({ note: SavedNoteSchema.nullable() }),
  },
  /** Saved notes matching what the user typed, best match first. */
  'notes:search': {
    request: z.strictObject({
      ...PageShape,
      query: z.string().trim().min(1).max(MAX_SEARCH_QUERY_LENGTH),
    }),
    response: z.strictObject({ notes: z.array(NoteSearchHitSchema), hasMore: z.boolean() }),
  },
  /** Edits a saved note or its favorite mark and returns the result. */
  'notes:update': {
    request: z.strictObject({ noteId: NoteIdSchema, changes: NoteChangesSchema }),
    response: z.strictObject({ note: SavedNoteSchema }),
  },
  /** Permanently removes a note, its transcript and any remaining audio (SECURITY.md §6). */
  'notes:delete': { request: NoteRefSchema, response: EmptySchema },
} as const satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export type IpcChannel = keyof typeof IPC_CHANNELS;

/** What the renderer sends. */
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IPC_CHANNELS)[C]['request']>;
/** What a main handler receives after validation. */
export type IpcParsedRequest<C extends IpcChannel> = z.output<(typeof IPC_CHANNELS)[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.output<(typeof IPC_CHANNELS)[C]['response']>;

export type NoteListQuery = IpcParsedRequest<'notes:list'>;
export type NoteSearchQuery = IpcParsedRequest<'notes:search'>;

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
