// Two STT adapters returning the same shape, a rough preview of
// SpeechToTextProvider (ARCHITECTURE §7):
// { provider, model, language, text, segments: [{ startMs, endMs, text }], latencyMs, costUsd }

const TIMEOUT_MS = 120_000;
const GROQ_MAX_BYTES = 25 * 1024 * 1024;

function requireKey(name) {
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set. Copy .env.example to .env and add it.`);
  return key;
}

async function failOnHttpError(res, provider) {
  if (res.ok) return;
  // Error bodies are provider messages, not transcript text, so printing them is fine.
  const body = (await res.text()).slice(0, 500);
  throw new Error(`${provider} HTTP ${res.status}: ${body}`);
}

export async function transcribeDeepgram(wav) {
  const key = requireKey('DEEPGRAM_API_KEY');
  const model = process.env.DEEPGRAM_MODEL || 'nova-3';
  const base = process.env.DEEPGRAM_BASE_URL || 'https://api.deepgram.com';

  const params = new URLSearchParams({ model, smart_format: 'true', utterances: 'true' });
  if (process.env.DEEPGRAM_LANGUAGE) params.set('language', process.env.DEEPGRAM_LANGUAGE);
  else params.set('detect_language', 'true');

  const started = performance.now();
  const res = await fetch(`${base}/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: wav.bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await failOnHttpError(res, 'deepgram');
  const json = await res.json();
  const latencyMs = performance.now() - started;

  const channel = json.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const segments = (json.results?.utterances ?? []).map((u) => ({
    startMs: Math.round(u.start * 1000),
    endMs: Math.round(u.end * 1000),
    text: u.transcript,
  }));
  const usdPerMin = Number(process.env.DEEPGRAM_USD_PER_MIN || 0.0043);

  return {
    provider: 'deepgram',
    model,
    language: channel?.detected_language ?? process.env.DEEPGRAM_LANGUAGE ?? null,
    text: alt?.transcript ?? '',
    segments,
    latencyMs,
    costUsd: (wav.durationSec / 60) * usdPerMin,
  };
}

export async function transcribeGroq(wav) {
  const key = requireKey('GROQ_API_KEY');
  const model = process.env.GROQ_MODEL || 'whisper-large-v3-turbo';
  const base = process.env.GROQ_BASE_URL || 'https://api.groq.com';
  if (wav.bytes.length > GROQ_MAX_BYTES) {
    throw new Error('groq: file over 25 MB. Chunking comes in Phase 2; use a shorter clip.');
  }

  const form = new FormData();
  form.set('file', new Blob([wav.bytes], { type: 'audio/wav' }), 'audio.wav');
  form.set('model', model);
  form.set('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const started = performance.now();
  const res = await fetch(`${base}/openai/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await failOnHttpError(res, 'groq');
  const json = await res.json();
  const latencyMs = performance.now() - started;

  // Published rates per audio hour; Groq bills a minimum of 10 s per request.
  const usdPerHour = model === 'whisper-large-v3' ? 0.111 : 0.04;
  const billedSec = Math.max(10, wav.durationSec);

  return {
    provider: 'groq',
    model,
    language: json.language ?? null,
    text: (json.text ?? '').trim(),
    segments: (json.segments ?? []).map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    })),
    latencyMs,
    costUsd: (billedSec / 3600) * usdPerHour,
  };
}

export const PROVIDERS = { deepgram: transcribeDeepgram, groq: transcribeGroq };
