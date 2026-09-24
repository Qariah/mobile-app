/**
 * Estimate where an ayah boundary falls inside a KNOWN-GOOD outer window,
 * using recitation tempo derived from Arabic letter counts.
 *
 * Written for TECH_DEBT #205. Al-An'am (6) ayah 3 shipped `timestampFrom:
 * 406050` — a stray trailing zero on what the corruption implies was 40605.
 * That value is INFERRED from the typo, not measured, and `silencedetect`
 * could not measure it because the recitation is continuous. This script is
 * the second-best evidence: the surrounding boundaries are trusted, so ayahs
 * 2 and 3 together span an exactly known window, and only the split is open.
 *
 * The method is VALIDATED rather than asserted: it first predicts the split
 * for every adjacent pair in the same surah whose timings ARE trusted, and
 * reports the error distribution. A candidate boundary can then be scored
 * against real recitation variance instead of a hunch.
 *
 * It narrows the range. It does NOT replace the ear check — letter counts
 * cannot see madd, a pause for meaning, or a reciter slowing at a phrase end.
 *
 * Usage: node scripts/estimate-ayah-boundary.mjs [surah] [ayah] [candidate...]
 *
 * @ai
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surah = Number(process.argv[2] ?? 6);
const ayah = Number(process.argv[3] ?? 3);
const candidates = process.argv.slice(4).map(Number);

const quran = JSON.parse(
  fs.readFileSync(path.join(root, 'data/quran.json'), 'utf8'),
);
const text = new Map(
  Object.values(quran)
    .filter(v => v && v.surah_number === surah)
    .map(r => [r.ayah_number, r.text]),
);

const src = fs.readFileSync(
  path.join(root, 'assets/data/timings/index.ts'),
  'utf8',
);
const re = new RegExp(
  `surahNumber:\\s*${surah},\\s*ayahNumber:\\s*(\\d+),\\s*timestampFrom:\\s*(\\d+),\\s*timestampTo:\\s*(\\d+)`,
  'g',
);
const rows = new Map();
for (let m; (m = re.exec(src)); ) {
  rows.set(+m[1], {from: +m[2], to: +m[3]});
}

/** Consonantal skeleton length: diacritics and the ayah marker are not time. */
const letters = s =>
  s
    .replace(/[ً-ْٰۖ-ۭـ]/g, '')
    .replace(/[٠-٩۝]/g, '')
    .replace(/\s+/g, '').length;

// A row is usable as CALIBRATION only if it is not itself suspect. The bug
// this script exists for makes ayah 2's span 382 s, and the (2,3) pair alone
// contributed the single largest error in the validation set — a corrupt row
// silently widening the error band it is about to be judged against. Drop
// spans far outside the surah's own distribution before calibrating.
const spans = [...rows.values()]
  .filter(r => r.to > r.from)
  .map(r => r.to - r.from)
  .sort((a, b) => a - b);
const medianSpan = spans[Math.floor(spans.length / 2)];
const ABSURD_SPAN_FACTOR = 5;

const trusted = a => {
  const r = rows.get(a);
  if (!r || r.to <= r.from || !text.has(a)) return false;
  return r.to - r.from <= medianSpan * ABSURD_SPAN_FACTOR;
};

// --- Validate the method on pairs whose split is known -------------------
const errors = [];
for (const [a] of rows) {
  if (!trusted(a) || !trusted(a + 1)) continue;
  const [r1, r2] = [rows.get(a), rows.get(a + 1)];
  const [l1, l2] = [letters(text.get(a)), letters(text.get(a + 1))];
  const predicted = l1 / (l1 + l2);
  const actual = (r1.to - r1.from) / (r2.to - r1.from);
  errors.push(actual - predicted);
}
errors.sort((x, y) => x - y);
const pct = p => errors[Math.floor(p * (errors.length - 1))];

// --- Apply it to the pair in question ------------------------------------
const prev = rows.get(ayah - 1);
const next = rows.get(ayah + 1);
if (!prev || !next) throw new Error(`no surrounding rows for ${surah}:${ayah}`);
const windowStart = prev.from;
const windowEnd = next.from;
const span = windowEnd - windowStart;
const lPrev = letters(text.get(ayah - 1));
const lThis = letters(text.get(ayah));
const share = lPrev / (lPrev + lThis);

console.log(`surah ${surah}, boundary before ayah ${ayah}`);
console.log(`  window ${windowStart}..${windowEnd} (${span} ms, known-good)`);
console.log(`  letters: ayah ${ayah - 1} = ${lPrev}, ayah ${ayah} = ${lThis}`);
console.log(
  `  method validated on ${errors.length} trusted pairs in this surah`,
);
console.log(
  `    share error  p05 ${pct(0.05).toFixed(3)}  median ${pct(0.5).toFixed(
    3,
  )}  p95 ${pct(0.95).toFixed(3)}`,
);
console.log(`  best estimate  B = ${Math.round(windowStart + span * share)}`);
console.log(
  `  90% band       ${Math.round(
    windowStart + span * (share + pct(0.05)),
  )} .. ${Math.round(windowStart + span * (share + pct(0.95)))}`,
);

for (const c of candidates) {
  const implied = (c - windowStart) / span;
  const err = implied - share;
  const asExtreme = errors.filter(e => Math.abs(e) >= Math.abs(err)).length;
  console.log(
    `  candidate ${c}: implies share ${implied.toFixed(3)} (error ${
      err >= 0 ? '+' : ''
    }${err.toFixed(3)}) — ` +
      `${asExtreme}/${errors.length} trusted pairs deviate at least this much`,
  );
}
