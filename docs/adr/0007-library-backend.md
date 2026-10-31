# 0007. Library backend: real deletion, quoted search and list indexes

- Status: Accepted
- Date: 2026-10-31

## Context

Phase 4 adds list, get, search, edit and delete for saved notes (ARCHITECTURE §11). The open questions were:

1. What "delete" means. The schema has `notes.deleted_at`, which suggests a soft delete, but nothing sets it, and SECURITY §6 says "Delete note" removes the note, segments, FTS entry and any remaining audio.
2. How text the user types reaches FTS5 `MATCH`. Raw text can raise a syntax error (`"`, `AND`, `NEAR(`) or target a column (`title:x`).
3. How fast the Library lists notes. `created_at` sits after the transcript in each row, so sorting by it reads every transcript.
4. What an edit may change after save, and whether marking a favorite counts as an edit.

## Decision

- **Delete is permanent and follows SECURITY §6.** It removes the note, segments, tag links, FTS row, the session's `transcript_chunks` (they hold the same text as the note) and any spool file still there. Tags no note uses any more are removed as well. `deleted_at` stays unused.
- **Audio goes first, then the database in one transaction.** If the file cannot be removed, the call fails, the note stays and the user can retry. The other order could leave audio that nothing points to, with no way to find it again. A missing file is not an error.
- **Saving a note removes its audio.** Only the text is needed after that, so PRD §12's open question is closed: delete, with no setting to keep it. The removal runs after the save commits (AGENTS §4.5) and never fails the save. `spool_path` is cleared once the file is gone; if the file is locked, the path stays and the next launch tries again. This also holds the disk use down, at about 115 MB per hour of capture.
- **Only letters, marks and digits reach `MATCH`,** each run quoted, so FTS5 syntax is searched as plain words and can never raise an error. All words must match.
- **The last word matches as a prefix only from 4 characters,** so results appear while typing without freezing the app. A prefix costs as much as the share of spoken words it covers (see the table below). A prefix is compared with the stemmed form, so "runni" misses "running" while "run" and "running" find it.
- **Ranking weighs where a word appears.** A match in the title counts 10 times a match in the transcript; summary, key points and tags count 5 times. A long transcript mentions a lot in passing. The query uses `ORDER BY rank`, not `ORDER BY bm25()`: FTS5 then sorts first and builds snippets only for the rows returned.
- **Edit and delete find the FTS row through `notes_fts_content`.** `WHERE note_id = ?` on the FTS table loads every transcript. This reads an FTS5 shadow table, whose layout is documented; the repository tests would fail if it changed.
- **Snippets are plain text.** No `<b>` markers, so the renderer never needs to treat transcript text as HTML (SECURITY §7). Highlighting can be added in the renderer.
- **Two indexes (migration 004)**, for newest first and for favorites. With 5,000 notes of 60 KB each, the newest page took about 1,050 ms without an index and about 10 ms with one.
- **Offset paging** with `limit` + `offset`, and `hasMore` from fetching one extra row. It is simple, and one person's library rarely changes while they page through it.
- **Edits use the Review fields** (title, summary, key points, tags). Mode, language, model and transcript never change. Edited key points are ground-checked again and tags normalized, as on save. A favorite mark does not change `updatedAt`, so "last edited" stays true.

## Measurements

3,000 notes of about 9,000 words each (one hour of speech, 241 MB), on the development laptop with synthetic text. Word frequencies are skewed like speech, but they are not real English.

| Operation | Time |
|---|---|
| Search, `ORDER BY bm25()`: word covering 5% of all spoken words | about 1,900 ms |
| Search, `ORDER BY rank`: same word | about 450 ms |
| Search: word covering under 1% | about 100 ms |
| Search: word in 3 notes | about 8 ms |
| Search: prefix covering about 9% (like `the*`) | about 3,500 ms |
| Search: prefix covering about 3% | about 1,000 ms |
| Search: prefix covering about 1.5% | about 400 ms |
| FTS row update, by `note_id` / through `notes_fts_content` | about 490 ms / about 55 ms |
| FTS row delete, by `note_id` / through `notes_fts_content` | about 520 ms / about 50 ms |

## Consequences

- Searching for a very common word still takes about 0.4 s at this size, and database calls block the main process while they run. The Library screen should search only when typing pauses. A much larger library would need search on a separate thread.
- Deleting cannot be undone. The Library screen must confirm with the destructive Dialog (DESIGN_SYSTEM §7).
- The `sessions` row and `usage_log` entries stay after a delete. They hold no note text today, but Phase 5 stores the window title on the session, so it must clear that on delete.
- Deleted text can stay in free SQLite pages until they are reused, because `secure_delete` is off. This protects against casual access, not disk forensics.
- A saved note cannot be transcribed again, because its audio is gone.
- Discarded and failed sessions still keep their audio, transcript chunks and drafts, because AGENTS §4.5 forbids deleting them unless a note was saved. They build up until that rule or a cleanup changes.
- There is no channel yet that lists all tags. The Library's tag filter will need one.
