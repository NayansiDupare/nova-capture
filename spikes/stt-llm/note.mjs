// Usage: pnpm note <out/name.provider.json> [--mode quick|full]
//
// Sends the transcript to Gemini with a JSON schema, validates the result,
// makes one repair call if it is invalid (ARCHITECTURE §9), and writes
// out/<name>.<provider>.note.md and .note.json. Prints metrics only.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  PROMPT_VERSION,
  SCHEMAS,
  buildPrompt,
  chooseMode,
  renderMarkdown,
  speechSeconds,
  validateNote,
} from './lib/note.mjs';

const OUT_DIR = join(import.meta.dirname, 'out');
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 60_000;
const MAX_ATTEMPTS = 3;

function isRetryable(err) {
  return (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    /HTTP (429|5\d\d)/.test(err.message) ||
    /fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message)
  );
}

// Gemini sometimes stalls or returns 429/5xx; retry with backoff before giving up.
async function callGemini(req) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callGeminiOnce(req);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS && isRetryable(err)) {
        throw new Error(
          `Gemini did not answer after ${MAX_ATTEMPTS} attempts (${err.message}). It is probably overloaded; try again in a few minutes, or set GEMINI_MODEL=gemini-3.5-flash-lite in .env.`,
        );
      }
      if (!isRetryable(err)) throw err;
      const waitMs = 2000 * 2 ** (attempt - 1);
      console.log(`gemini attempt ${attempt} failed (${err.message}). Retrying in ${waitMs / 1000} s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function callGeminiOnce({ system, user, schema }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set. Copy .env.example to .env and add it.');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';

  const started = performance.now();
  const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.2,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const json = await res.json();
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return {
    model,
    text,
    finishReason: candidate?.finishReason ?? 'unknown',
    latencyMs: performance.now() - started,
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  let input = null;
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') mode = argv[++i];
    else input = argv[i];
  }
  if (!input) throw new Error('Usage: pnpm note <out/name.provider.json> [--mode quick|full]');
  if (mode !== null && mode !== 'quick' && mode !== 'full') {
    throw new Error('--mode must be quick or full');
  }
  return { input, mode };
}

async function main() {
  const { input, mode: forcedMode } = parseArgs(process.argv.slice(2));
  const transcript = JSON.parse(readFileSync(input, 'utf8'));
  if (!transcript.text?.trim()) throw new Error(`${input} has an empty transcript`);

  const mode = forcedMode ?? chooseMode(transcript.segments);
  const schema = SCHEMAS[mode];
  const prompt = buildPrompt(transcript, mode);
  console.log(
    `mode: ${mode} (speech ${speechSeconds(transcript.segments).toFixed(0)} s, ${transcript.segments.length} segments)`,
  );

  const calls = [];
  let call = await callGemini({ ...prompt, schema });
  calls.push(call);
  let note = parseJson(call.text);
  let problem = note === null ? `not valid JSON (finishReason ${call.finishReason})` : validateNote(note, mode);

  if (problem) {
    console.log(`first response invalid: ${problem}. Making one repair call.`);
    call = await callGemini({
      system: prompt.system,
      user: `${prompt.user}

Your previous answer was invalid: ${problem}
Previous answer:
${call.text.slice(0, 4000)}

Return a corrected answer that satisfies the schema.`,
      schema,
    });
    calls.push(call);
    note = parseJson(call.text);
    problem = note === null ? `not valid JSON (finishReason ${call.finishReason})` : validateNote(note, mode);
  }

  const totals = {
    calls: calls.length,
    latencySec: calls.reduce((s, c) => s + c.latencyMs, 0) / 1000,
    inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
    outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
  };
  console.log(
    `gemini ${call.model}: ${totals.calls} call(s), ${totals.latencySec.toFixed(2)} s, ` +
      `${totals.inputTokens} in / ${totals.outputTokens} out tokens`,
  );

  if (problem) {
    // §9: fail visibly; the transcript is untouched.
    console.error(`FAILED: still invalid after repair: ${problem}`);
    process.exit(1);
  }

  const name = basename(input, '.json');
  mkdirSync(OUT_DIR, { recursive: true });
  const meta = {
    source: transcript.source ?? name,
    sttProvider: transcript.provider,
    sttModel: transcript.model,
    llmModel: call.model,
  };
  writeFileSync(
    join(OUT_DIR, `${name}.note.json`),
    JSON.stringify({ mode, promptVersion: PROMPT_VERSION, ...meta, usage: totals, note }, null, 2),
  );
  writeFileSync(join(OUT_DIR, `${name}.note.md`), renderMarkdown(note, mode, meta));
  console.log(`wrote out/${name}.note.md`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
