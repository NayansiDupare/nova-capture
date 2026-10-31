# Nova Capture — Product Requirements Document (PRD)

> Version 1.0 · 11 October 2026 · Owner: Chip
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) · [SECURITY.md](../SECURITY.md) · [TESTING.md](./TESTING.md)

---

## 1. Summary

Nova Capture is a Windows desktop app that listens to whatever audio is playing on your computer (a YouTube lecture, a course video, a podcast in VLC), and on demand turns it into a transcript and a structured, searchable note. Everything is stored locally.

**One-line pitch:** *Press a hotkey while watching anything, and get clean, searchable notes when you stop.*

---

## 2. Problem

- Learning from videos and courses is passive. Taking notes means pausing, switching windows and typing, which breaks focus.
- Existing AI note-takers focus on **meetings** (Zoom, Meet, Teams) and often need bots, accounts or uploads.
- There is no simple tool that captures **any** playback audio on the PC and turns it into notes you can search later.

---

## 3. Target users

| Persona | Description | Primary need |
|---|---|---|
| **Self-learner (primary)** | Student or developer watching courses, tutorials, lectures | Notes without breaking focus; find "that thing from that video" later |
| **Podcast / talk listener** | Listens to long-form content while working | Quick gist and key points saved automatically |
| **The builder (Chip)** | Uses the app daily and showcases it on a resume | Reliable tool, clean engineering to talk about |

---

## 4. Goals and non-goals

### Goals (v1)

1. Capture system playback audio on Windows with one action (hotkey or tray).
2. Never lose a capture, even if the app crashes or the network fails.
3. Produce an accurate transcript and a structured note grounded only in the transcript.
4. Store everything locally and make it instantly searchable.
5. Keep the app lightweight and out of the way while content plays.

### Non-goals (v1)

- Meeting bots or calendar integration
- Live (real-time) transcription
- Microphone capture or speaker diarization
- Cloud sync, accounts, sharing
- macOS, Linux, Android
- Public distribution (v1 is personal use; distribution needs the proxy backend)

---

## 5. User stories

### Capture
- **US-1** As a learner, I press a global hotkey to start capturing, so I don't leave the video.
- **US-2** As a learner, I can pause and resume a capture, so ads or off-topic parts are skipped.
- **US-3** As a learner, I always see a clear indicator while recording, so I never record by accident.
- **US-4** As a learner, I'm warned when little or no speech was detected, so I don't waste money on music or silence.

### Notes
- **US-5** As a learner, I get a note with a title, summary, key points (with timestamps) and tags after stopping.
- **US-6** As a learner, short captures produce a quick note (title, gist, tags) instead of a full one.
- **US-7** As a learner, I can review and edit a note before saving, or discard it.
- **US-8** As a learner, I can see which terms the AI wasn't sure about.

### Library and search
- **US-9** As a learner, I can browse all notes, newest first, and mark favorites.
- **US-10** As a learner, I can search across titles, summaries, key points, tags and transcripts.
- **US-11** As a learner, I can click a key point's timestamp to see the matching transcript section.
- **US-12** As a learner, I can export a note as Markdown.

### Reliability
- **US-13** As a learner, if the app crashes mid-capture, I'm offered recovery on the next launch.
- **US-14** As a learner, if the network fails, my note is delayed, not lost, and retried automatically.

### Settings
- **US-15** As a user, I can enter API keys securely and never see them in plain text again.
- **US-16** As a user, I can choose the STT provider and set a monthly spend cap.

---

## 6. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Capture whole-system playback audio via Electron loopback | P0 |
| FR-2 | Start, stop, pause, resume capture from tray, hotkey and main UI | P0 |
| FR-3 | Persist session state at every transition | P0 |
| FR-4 | Spool all audio to a temp file during capture | P0 |
| FR-5 | VAD-based chunking (~30 s, silence cuts, 1–2 s overlap) | P0 |
| FR-6 | Transcribe chunks via a pluggable STT provider, with retries | P0 |
| FR-7 | Assemble chunks into one de-duplicated, timestamped transcript | P0 |
| FR-8 | Generate Quick or Full notes via a pluggable LLM provider, validated against a schema | P0 |
| FR-9 | Review screen: edit, save, discard | P0 |
| FR-10 | Local SQLite storage with FTS5 search | P0 |
| FR-11 | Recovery screen for interrupted sessions | P0 |
| FR-12 | API keys stored in safeStorage; write-only from the UI | P0 |
| FR-13 | Low-speech warning before spending STT money | P1 |
| FR-14 | Spend cap with usage log | P1 |
| FR-15 | Ground check: flag key points without matching transcript evidence | P1 |
| FR-16 | Markdown export | P1 |
| FR-17 | Source app and window title detection (best effort) | P2 |
| FR-18 | Floating overlay control | P2 |
| FR-19 | Second STT provider for comparison | P2 |

**P0** = required for v1 · **P1** = should have · **P2** = nice to have

---

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Reliability | Zero capture loss on app crash; at most a few seconds lost on hard power-off |
| Performance | Idle < 200 MB RAM total; low single-digit CPU while capturing; 10-min session → saved note in ~60 s typical |
| Search | Instant results for thousands of notes |
| Privacy | All notes local; raw audio deleted after note is saved; no telemetry |
| Security | Electron hardening per [SECURITY.md](../SECURITY.md) |
| Accessibility | Keyboard-operable UI, visible focus, WCAG AA contrast |
| Platform | Windows 10/11 (exact minimum build confirmed in spike) |

---

## 8. Key user flow

```
Watching a video
   │
   ├─ Press hotkey ──► Recording indicator on ──► (pause/resume as needed)
   │
   ├─ Press hotkey again ──► "Processing…" ──► Transcribing ──► Generating note
   │
   └─ Review screen ──► Edit ──► Save ──► Note appears in Library, searchable
```

---

## 9. Success metrics

| Metric | Target |
|---|---|
| Personal usage | Used ≥ 3 times a week for 4 weeks after v1 |
| Capture reliability | 0 lost captures across all sessions |
| Note usefulness | ≥ 80% of notes saved without major edits |
| Stop → saved note | ≤ 60 s for a 10-min session |
| STT accuracy | Acceptable on the 3–5 clip spike set (measured in Phase 0) |
| Cost | Under a self-set monthly cap |

---

## 10. Milestones

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Spike** | Loopback capture → WAV → STT → LLM → markdown | A real lecture becomes a usable note |
| **M1 — Foundation** | Monorepo, core package, IPC, SQLite, settings | Tests green, keys stored securely |
| **M2 — Pipeline** | Worker, VAD, chunker, spool, STT, job queue | Fixture audio → transcript in CI |
| **M3 — Notes** | LLM pipeline, prompts, review screen | Full and Quick notes validated and saved |
| **M4 — Library** | List, search, detail, export | Search finds notes instantly |
| **M5 — Integration** | Tray, hotkey, indicator | Daily use without opening the main window |
| **M6 — v1 Release** | Recovery, error matrix, CI, installer, README, demo video | Installer works on a clean machine |

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Electron loopback unreliable on some setups | High | Spike first; native helper fallback |
| STT cost higher than expected | Medium | Silence trimming, low-speech warning, spend cap |
| LLM hallucination in notes | Medium | Transcript-only prompts, schema validation, ground check |
| Scope creep (solo developer) | High | Strict v1 scope; deferred list in ARCHITECTURE §24 |
| Captured content rights and privacy | Medium | Personal use only; recording indicator; local storage |

---

## 12. Open questions

- [x] Which two STT providers to compare in the spike? **Deepgram (nova-3) and Groq (Whisper large-v3 turbo)**, see `spikes/stt-llm/`. Winner picked after the spike.
- [x] Which LLM provider and model for v1? **Google Gemini `gemini-3.8-flash`**, confirmed for Phase 3 (13 Oct 2026). Roughly $0.001–0.005 per note at the spike's token counts.
- [x] Keep raw audio after saving by default, or delete? **Delete.** Only the text is kept once a note is saved, with no setting to keep the audio (31 Oct 2026).
- [ ] Default hotkey? (Must not clash with common apps.)
- [ ] Note language: always transcript language, or user-selectable?
