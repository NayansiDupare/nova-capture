# Spike: STT comparison + LLM note

Phase 0 throwaway (ARCHITECTURE §25). Takes WAV files from the loopback spike, transcribes them with **Deepgram** and **Groq (Whisper)**, compares them, and turns a transcript into a note with **Gemini**.

Plain Node 24, no npm dependencies. Not production code: only `note` retries (Gemini timeouts, 429 and 5xx, 3 attempts), no chunking (Groq's limit is 25 MB, about 13 min of 16 kHz WAV). Never import from here.

## Setup

1. Get API keys:
   - Deepgram: https://console.deepgram.com (free starter credit)
   - Groq: https://console.groq.com/keys (free tier)
   - Gemini: https://aistudio.google.com/apikey
2. `copy .env.example .env` and paste the keys into `.env`. It is gitignored; never commit it.

## Run

```powershell
cd spikes\stt-llm

# 1. Transcribe one or more clips with both providers (or --provider deepgram|groq)
pnpm transcribe ..\loopback-capture\out\capture-XXXX.wav

# 2. Turn a transcript into a note (mode picked from speech length; override with --mode quick|full)
pnpm note out\capture-XXXX.deepgram.json
```

Outputs in `out/` (gitignored):

| File | Contents |
|---|---|
| `<clip>.<provider>.json` / `.txt` | Segments with timestamps, metrics / plain transcript |
| `comparison.csv` | One row per run: latency, speed, cost, WER, language |
| `<clip>.<provider>.note.md` / `.note.json` | The note, plus model, prompt version, token usage |

The console shows metrics only, never transcript text.

## Measuring accuracy (WER)

For each clip, write what was actually said in a text file next to the WAV with the same name: `capture-XXXX.wav` → `capture-XXXX.ref.txt`. Then `transcribe` reports **word error rate** (lower is better; under ~10% is good). A 1–2 minute excerpt typed by hand is enough. Copying YouTube's own captions works but they contain errors too.

## What to test (Phase 0 exit criteria)

1. Record 3–5 clips with the loopback spike, 1–10 min each: a clear lecture, a fast talker, a technical tutorial with jargon, one with background music, and one non-English clip if you need that.
2. `pnpm transcribe` all of them in one command and compare the table: WER, speed, cost, how technical terms came out.
3. `pnpm note` on each provider's transcript of the best clip. Check:
   - Does the note contain anything **not** said in the video? (should be never)
   - Are technical terms spelled the way they were spoken?
   - Do the key point timestamps point to the right moments?
   - Is a short clip (< 2 min speech) a quick note and a long one a full note?
4. Write the result into `docs/PRD.md` §9 / §12 and pick the default STT provider.

## Options (`.env`)

| Variable | Default |
|---|---|
| `GROQ_MODEL` | `whisper-large-v3-turbo` ($0.04/h). Try `whisper-large-v3` ($0.111/h) for accuracy |
| `DEEPGRAM_MODEL` | `nova-3` |
| `DEEPGRAM_LANGUAGE` | auto-detect; set e.g. `en` to force |
| `GEMINI_MODEL` | `gemini-3.8-flash`; `gemini-3.5-flash-lite` is cheaper |
| `GEMINI_TIMEOUT_MS` | `60000` per attempt |
| `DEEPGRAM_USD_PER_MIN` | `0.0043`. Costs are estimates: check each provider's pricing page |

## Verified API details (11 Oct 2026)

- Deepgram: `POST /v1/listen?model=nova-3&smart_format=true&utterances=true`, raw WAV body, `Authorization: Token <key>`. Segments from `results.utterances`.
- Groq: `POST /openai/v1/audio/transcriptions`, multipart, `response_format=verbose_json`, `timestamp_granularities[]=segment`. 25 MB limit, 10 s minimum billing.
- Gemini: `POST /v1beta/models/{model}:generateContent`, `x-goog-api-key` header, `responseMimeType: application/json` + `responseSchema`.

Only tested against a local fake server with the same response shapes so far. The first real run with keys is the real test.
