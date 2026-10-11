// Usage: pnpm transcribe <file.wav> [more.wav ...] [--provider deepgram|groq|both]
//
// Writes out/<name>.<provider>.json (segments + metrics) and .txt (plain transcript).
// If <name>.ref.txt sits next to the WAV, also reports word error rate against it.
// Prints metrics only, never transcript text.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { PROVIDERS } from './lib/stt.mjs';
import { readWav } from './lib/wav.mjs';
import { wordErrorRate } from './lib/wer.mjs';

const OUT_DIR = join(import.meta.dirname, 'out');

function parseArgs(argv) {
  const files = [];
  let provider = 'both';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') provider = argv[++i];
    else files.push(argv[i]);
  }
  const names = provider === 'both' ? Object.keys(PROVIDERS) : [provider];
  for (const n of names) {
    if (!PROVIDERS[n]) throw new Error(`Unknown provider "${n}". Use deepgram, groq or both.`);
  }
  if (files.length === 0) {
    throw new Error('Usage: pnpm transcribe <file.wav> [more.wav ...] [--provider deepgram|groq|both]');
  }
  return { files, providers: names };
}

function referenceFor(wavPath) {
  const refPath = join(dirname(wavPath), `${basename(wavPath, extname(wavPath))}.ref.txt`);
  return existsSync(refPath) ? readFileSync(refPath, 'utf8') : null;
}

async function main() {
  const { files, providers } = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  const csvPath = join(OUT_DIR, 'comparison.csv');
  if (!existsSync(csvPath)) {
    appendFileSync(csvPath, 'at,file,provider,model,audio_sec,latency_s,rtf,cost_usd,wer,segments,language\n');
  }

  const rows = [];
  for (const file of files) {
    const wav = readWav(file);
    if (wav.audioFormat !== 1) throw new Error(`${file}: only PCM WAV is supported`);
    const name = basename(file, extname(file));
    const reference = referenceFor(file);

    for (const provider of providers) {
      process.stdout.write(`${name} -> ${provider} ... `);
      try {
        const result = await PROVIDERS[provider](wav);
        const wer = reference === null ? null : wordErrorRate(reference, result.text);
        const out = { source: basename(file), audioSec: wav.durationSec, wer, ...result };
        writeFileSync(join(OUT_DIR, `${name}.${provider}.json`), JSON.stringify(out, null, 2));
        writeFileSync(join(OUT_DIR, `${name}.${provider}.txt`), `${result.text}\n`);

        const row = {
          file: name,
          provider,
          model: result.model,
          audioSec: wav.durationSec,
          latencySec: result.latencyMs / 1000,
          rtf: result.latencyMs / 1000 / wav.durationSec,
          costUsd: result.costUsd,
          wer,
          segments: result.segments.length,
          language: result.language ?? '',
        };
        rows.push(row);
        appendFileSync(
          csvPath,
          [
            new Date().toISOString(),
            row.file,
            row.provider,
            row.model,
            row.audioSec.toFixed(1),
            row.latencySec.toFixed(2),
            row.rtf.toFixed(3),
            row.costUsd.toFixed(5),
            row.wer === null ? '' : row.wer.toFixed(3),
            row.segments,
            row.language,
          ].join(',') + '\n',
        );
        console.log('ok');
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
      }
    }
  }

  if (rows.length === 0) process.exit(1);
  console.log();
  console.table(
    rows.map((r) => ({
      file: r.file,
      provider: r.provider,
      'audio s': r.audioSec.toFixed(1),
      'latency s': r.latencySec.toFixed(2),
      'speed (x realtime)': (1 / r.rtf).toFixed(1),
      'cost $': r.costUsd.toFixed(5),
      WER: r.wer === null ? '(no .ref.txt)' : `${(r.wer * 100).toFixed(1)}%`,
      segments: r.segments,
      lang: r.language,
    })),
  );
  console.log(`Transcripts in ${OUT_DIR}. Rows appended to comparison.csv.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
