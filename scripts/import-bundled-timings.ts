#!/usr/bin/env tsx
/**
 * Import per-ayah timing data into the bundled timings registry.
 *
 * Sprint 8 — supports the `'local'` TimestampSource for reciters that
 * aren't in MP3Quran or QuranCDN (which is every Qariah reciter today).
 *
 * Input formats supported:
 *   1. MP3Quran-shaped JSON (an array of {ayah, start_time, end_time} per
 *      surah, one file per surah named `{surahNumber}.json`).
 *   2. QDC-shaped JSON (a `verse_timings` array of
 *      {verse_key, timestamp_from, timestamp_to}). One file per surah named
 *      `{surahNumber}.json`.
 *   3. Already-normalized AyahTimestamp[] JSON. One file per surah named
 *      `{surahNumber}.json`.
 *
 * Usage:
 *   npx tsx scripts/import-bundled-timings.ts \
 *     --rewayat-id <UUID> \
 *     --input-dir <path/with/{surahNumber}.json/files> \
 *     [--format auto|mp3quran|qdc|normalized]
 *
 * Example:
 *   npx tsx scripts/import-bundled-timings.ts \
 *     --rewayat-id f543c610-837d-5fc5-825f-0b51752aa3a4 \
 *     --input-dir ~/Desktop/zaynab-talha-timings
 *
 * Output:
 *   Mutates `assets/data/timings/index.ts` in-place, replacing the entry
 *   for the given rewayat-id (or appending a new one). Output is sorted
 *   by surah number → ayah number for stable diffs.
 */

import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join, basename} from 'node:path';
import {execFileSync} from 'node:child_process';

interface AyahTimestamp {
  surahNumber: number;
  ayahNumber: number;
  timestampFrom: number;
  timestampTo: number;
  durationMs: number;
}

type InputFormat = 'auto' | 'mp3quran' | 'qdc' | 'normalized';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function detectFormat(sample: unknown): InputFormat {
  if (Array.isArray(sample) && sample.length > 0) {
    const first = sample[0] as Record<string, unknown>;
    if ('start_time' in first && 'end_time' in first && 'ayah' in first) {
      return 'mp3quran';
    }
    if (
      'timestampFrom' in first &&
      'timestampTo' in first &&
      'ayahNumber' in first
    ) {
      return 'normalized';
    }
  } else if (
    sample &&
    typeof sample === 'object' &&
    'verse_timings' in (sample as Record<string, unknown>)
  ) {
    return 'qdc';
  }
  throw new Error(
    'Could not auto-detect format. Use --format mp3quran|qdc|normalized.',
  );
}

function normalize(
  raw: unknown,
  surahNumber: number,
  format: InputFormat,
): AyahTimestamp[] {
  const fmt = format === 'auto' ? detectFormat(raw) : format;

  if (fmt === 'mp3quran') {
    const data = raw as Array<{
      ayah: number;
      start_time: number;
      end_time: number;
    }>;
    return data.map(t => ({
      surahNumber,
      ayahNumber: t.ayah,
      timestampFrom: t.start_time,
      timestampTo: t.end_time,
      durationMs: t.end_time - t.start_time,
    }));
  }

  if (fmt === 'qdc') {
    const data = raw as {
      verse_timings: Array<{
        verse_key: string;
        timestamp_from: number;
        timestamp_to: number;
      }>;
    };
    return data.verse_timings.map(t => {
      const ayahNumber = parseInt(t.verse_key.split(':')[1], 10);
      return {
        surahNumber,
        ayahNumber,
        timestampFrom: t.timestamp_from,
        timestampTo: t.timestamp_to,
        durationMs: t.timestamp_to - t.timestamp_from,
      };
    });
  }

  // 'normalized' — pass-through but enforce surahNumber.
  const data = raw as AyahTimestamp[];
  return data.map(t => ({...t, surahNumber}));
}

function main() {
  const args = parseArgs(process.argv);
  const rewayatId = args['rewayat-id'];
  const inputDir = args['input-dir'];
  const format = (args['format'] ?? 'auto') as InputFormat;

  if (!rewayatId || !inputDir) {
    console.error(
      'Usage: --rewayat-id <UUID> --input-dir <path> [--format auto|mp3quran|qdc|normalized]',
    );
    process.exit(2);
  }

  const stats = statSync(inputDir);
  if (!stats.isDirectory()) {
    console.error(`--input-dir must be a directory: ${inputDir}`);
    process.exit(2);
  }

  const bySurah: Record<number, AyahTimestamp[]> = {};
  for (const file of readdirSync(inputDir).sort()) {
    if (!file.endsWith('.json')) continue;
    const surahNumber = parseInt(basename(file, '.json'), 10);
    if (
      !Number.isInteger(surahNumber) ||
      surahNumber < 1 ||
      surahNumber > 114
    ) {
      continue;
    }
    const raw = JSON.parse(readFileSync(join(inputDir, file), 'utf8'));
    const timestamps = normalize(raw, surahNumber, format);
    timestamps.sort((a, b) => a.ayahNumber - b.ayahNumber);
    bySurah[surahNumber] = timestamps;
  }

  const surahCount = Object.keys(bySurah).length;
  if (surahCount === 0) {
    console.error(`No usable {N}.json files found in ${inputDir}.`);
    process.exit(1);
  }

  // Mutate assets/data/timings/index.ts. We rewrite the BUNDLED_TIMINGS
  // entry for this rewayat in-place, leaving the rest of the file
  // (including the file header comment + helpers) untouched.
  const target = join(__dirname, '..', 'assets', 'data', 'timings', 'index.ts');
  const text = readFileSync(target, 'utf8');

  const sortedSurahs = Object.keys(bySurah)
    .map(Number)
    .sort((a, b) => a - b);
  const block = sortedSurahs
    .map(s => {
      const rows = bySurah[s]
        .map(
          t =>
            `        {surahNumber: ${t.surahNumber}, ayahNumber: ${t.ayahNumber}, timestampFrom: ${t.timestampFrom}, timestampTo: ${t.timestampTo}, durationMs: ${t.durationMs}},`,
        )
        .join('\n');
      return `      ${s}: [\n${rows}\n      ],`;
    })
    .join('\n');

  // Find-or-replace the rewayat block. We match `'<UUID>': { ... },` with a
  // dot-all-style regex (manual since JS doesn't have /s without ES2018).
  const startMarker = `'${rewayatId}': {`;
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) {
    console.error(
      `Could not find existing block for ${rewayatId} in ${target}. ` +
        `Add a placeholder entry first (see file template).`,
    );
    process.exit(1);
  }
  // Find the matching closing `},` by scanning braces.
  let depth = 0;
  let endIdx = startIdx + startMarker.length;
  for (; endIdx < text.length; endIdx++) {
    const ch = text[endIdx];
    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth === 0) {
        endIdx++;
        if (text[endIdx] === ',') endIdx++;
        break;
      }
      depth--;
    }
  }
  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx);
  const replacement = `'${rewayatId}': {\n${block}\n    },`;
  const next = `${before}${replacement}${after}`;
  writeFileSync(target, next, 'utf8');

  // Run prettier if available so we don't ship malformed indentation. Best-
  // effort — no-op if prettier isn't installed.
  try {
    execFileSync('npx', ['prettier', '--write', target], {stdio: 'ignore'});
  } catch {
    // ignore
  }

  console.log(
    `Imported ${surahCount} surahs (${Object.values(bySurah).reduce((s, a) => s + a.length, 0)} ayat total) for rewayat ${rewayatId}.`,
  );
}

main();
