#!/usr/bin/env node
/**
 * One-shot: extract Zaynab Talha's per-ayah timing data from the archived
 * RN Qariah repo's bundled SQLite DB and bridge it into the qariah-v2
 * bundled-timings registry.
 *
 * Why one-shot: this is a one-time migration. The data lives at
 *   ~/claude/quran-core-archived-sprint-10/apps/qariah/assets/db/ayah_timings.db
 * in a `q{mongoId}` table format (see apps/qariah/src/db/timingDb.ts in
 * the archived repo). Reciter ID `61ad039da929bc988c156540` is Zaynab
 * Talha (confirmed in the archived repo's Qariah-Dev-Plan.md:1172).
 *
 * Output: writes per-surah AyahTimestamp[] JSON files into a tmp dir,
 * then invokes `scripts/import-bundled-timings.ts` to fold them into
 * `assets/data/timings/index.ts`. We could write directly into index.ts,
 * but the existing importer already has format detection + prettier-on-
 * write + idempotency, so we just feed it normalized data.
 *
 * Usage:
 *   node scripts/import-zaynab-talha-timings-from-archive.mjs
 */

import {DatabaseSync} from 'node:sqlite';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {homedir, tmpdir} from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ARCHIVE_DB = join(
  homedir(),
  'claude',
  'quran-core-archived-sprint-10',
  'apps',
  'qariah',
  'assets',
  'db',
  'ayah_timings.db',
);
const ZAYNAB_RECITER_ID = '61ad039da929bc988c156540';
const ZAYNAB_TABLE = `q${ZAYNAB_RECITER_ID}`;
const ZAYNAB_REWAYAT_ID = 'f543c610-837d-5fc5-825f-0b51752aa3a4';

// End-time fallback for the very last ayah of each surah — the archive
// stores only start times, so the last ayah's `timestampTo` must be
// extrapolated. The archived repo's `timingDb.ts` uses `start + 10s`
// (apps/qariah/src/db/timingDb.ts:77). We mirror that — empirically the
// follow-along player tolerates a slight overshoot at end-of-surah, and
// our SQLite cache writes the same shape regardless.
const LAST_AYAH_TAIL_MS = 10_000;

function main() {
  const db = new DatabaseSync(ARCHIVE_DB, {readOnly: true});
  const rows = db
    .prepare(
      `SELECT surah, ayah, time FROM "${ZAYNAB_TABLE}" ORDER BY surah ASC, ayah ASC`,
    )
    .all();
  db.close();

  if (rows.length === 0) {
    throw new Error(
      `No rows in ${ZAYNAB_TABLE} of ${ARCHIVE_DB}. Aborting — has the archive been moved?`,
    );
  }

  // Group by surah
  /** @type {Map<number, Array<{surah:number, ayah:number, time:number}>>} */
  const bySurah = new Map();
  for (const row of rows) {
    const list = bySurah.get(row.surah) ?? [];
    list.push(row);
    bySurah.set(row.surah, list);
  }

  // Write one normalized JSON file per surah
  const outDir = join(tmpdir(), `zaynab-talha-timings-${process.pid}`);
  mkdirSync(outDir, {recursive: true});

  for (const [surah, list] of bySurah) {
    /** @type {Array<{surahNumber:number, ayahNumber:number, timestampFrom:number, timestampTo:number, durationMs:number}>} */
    const normalized = list.map((r, i) => {
      const next = list[i + 1];
      const timestampFrom = r.time;
      const timestampTo = next ? next.time : r.time + LAST_AYAH_TAIL_MS;
      return {
        surahNumber: r.surah,
        ayahNumber: r.ayah,
        timestampFrom,
        timestampTo,
        durationMs: timestampTo - timestampFrom,
      };
    });
    writeFileSync(
      join(outDir, `${surah}.json`),
      JSON.stringify(normalized, null, 2),
    );
  }

  console.log(
    `Extracted ${rows.length} ayah timings across ${bySurah.size} surahs to ${outDir}.`,
  );

  // Hand off to the existing importer to do the index.ts fold-in
  execFileSync(
    'npx',
    [
      'tsx',
      join(__dirname, 'import-bundled-timings.ts'),
      '--rewayat-id',
      ZAYNAB_REWAYAT_ID,
      '--input-dir',
      outDir,
      '--format',
      'normalized',
    ],
    {stdio: 'inherit'},
  );

  // Clean up the tmp dir — file is now baked into index.ts
  rmSync(outDir, {recursive: true, force: true});
  console.log(`Cleaned up ${outDir}.`);
}

main();
