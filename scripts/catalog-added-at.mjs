#!/usr/bin/env node
// @ai-start
/**
 * Backfills `added_at` (`YYYY-MM-DD`, a UTC date) on each recitation of the
 * live catalog from the immutable catalog history (Sprint 48 Task 6, S48.2).
 *
 * A recitation is (reciter id, rewayah id, surah, range.from, range.to): the
 * key of the ops console (`functions/_lib/added-at.ts`, qariah-ops-console
 * PR #20). A range change is a new recitation, and so is a surah that the
 * catalog removed and then lists again. The ops console stamps new uploads
 * itself; this script fills the rest.
 *
 * Use it as the transform of scripts/catalog-r2-mutate.mjs:
 *   set -a; . ./.env.local; set +a
 *   node --dns-result-order=ipv4first scripts/catalog-r2-mutate.mjs \
 *     --transform=scripts/catalog-added-at.mjs --dry-run --out=<dir>
 *
 * Read only: it reads catalog-version.json and catalog/history/v{k}.json from
 * the public origin and writes only its local cache. The version URL comes
 * from EXPO_PUBLIC_CATALOG_VERSION_URL, else from EXPO_PUBLIC_CATALOG_URL
 * (same folder, file catalog-version.json); each is read from the environment
 * first, then from .env.local. The history URLs come from the `url` field of
 * catalog-version.json, so this file names no storage host.
 *
 * Cache: CATALOG_HISTORY_CACHE, else ~/claude/.scratch/sprint-48/catalog/history.
 * Each version is v{k}.json (the body as served) plus v{k}.meta.json (its
 * Last-Modified). History versions never change, so a cached file stays valid.
 *
 * The rules (computeAddedAt):
 *   1. The date of a version is the UTC date of its Last-Modified header; when
 *      the header is missing, the `updated_at` of the file (only a file that
 *      is an object has one). A version with neither is skipped and counted.
 *      A version that is dated later than a newer version gets the date of the
 *      newer version (a later re-upload cannot make it newer).
 *   2. The range of a listed surah is the range of its FIRST `surah_metadata`
 *      row, as in the ops console: a row with `is_full: false` and a `range`
 *      is the partial `from-to`; no row, or any other row, is a complete
 *      surah. A version "matches" a live recitation when the same reciter id
 *      and rewayah id list the surah with the same range. Before 2026-05-18
 *      (v10) the rewayat had no `surah_metadata` array, so the range is
 *      unknown: such a version matches any range.
 *   3. Walk back from the newest version while each version matches. The
 *      oldest version of that unbroken run gives the date. So a range change
 *      or a gap (the surah not listed) starts a new recitation, as in the ops
 *      console.
 *      A run that starts at the OLDEST version read means that the recitation
 *      is older than the history: its true date is unknown, but no later than
 *      the date of that version. It gets the rewayah `created_at` as a UTC
 *      date when that is valid and not later than the oldest version's date,
 *      else the oldest version's date (the plan: "a recitation older than the
 *      history gets its rewayah created_at").
 *   4. No run (the newest version does not list it): the rewayah `created_at`
 *      as a UTC date. When that is missing, invalid or later than today: the
 *      date of the oldest version read. (`transform` refuses a live catalog
 *      that differs from the newest version, so this is only a safety net.)
 *   5. The first live row of a listed surah gets `added_at` at the end of its
 *      fields. A listed surah with no row gets a new row {surah, is_full:
 *      true, added_at} (the shape of the ops console). Order rule: each new
 *      row goes right before the first existing row with a larger surah
 *      number, else at the end; existing rows keep their order (for sorted
 *      rows, the result is the same as the sort of the ops console). An
 *      `added_at` that exists is never changed, so a second run changes
 *      nothing. A row whose surah is not listed (an orphan) and a second row
 *      of the same surah are left alone. No other field changes.
 *
 * Plain Node (>= 18), no dependencies.
 */
/* global AbortSignal -- the Node 18+ global, for the time limit of each fetch */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The only reciter field that this transform changes. */
export const ALLOWED_FIELDS = ['rewayat'];

export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_CONCURRENCY = 4;
const FETCH_TRIES = 3;
const NEWEST_SHOWN = 10;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Dates

/** The UTC `YYYY-MM-DD` of a date string or Date; null when invalid. */
export function utcDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/** True for a real calendar date in the `YYYY-MM-DD` form. */
export function isIsoDate(value) {
  return (
    typeof value === 'string' &&
    DATE_PATTERN.test(value) &&
    utcDate(`${value}T00:00:00Z`) === value
  );
}

// ---------------------------------------------------------------------------
// Ranges

/**
 * The range key of a surah's first catalog row, as `recitationKey` of the ops
 * console: `${from}-${to}` for a row with `is_full: false` and a `range`, else
 * 'full' (no row means a complete surah).
 */
export function rangeKey(row) {
  return row && row.is_full === false && row.range
    ? `${row.range.from}-${row.range.to}`
    : 'full';
}

/** The listed surahs of a rewayah: the integers of `surah_list`, once each. */
export function listedSurahs(rewayah) {
  const list = Array.isArray(rewayah?.surah_list) ? rewayah.surah_list : [];
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (Number.isInteger(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// History index

/**
 * A compact index of one catalog version: `reciterId|rewayahId` → {listed:
 * Set of surahs, ranges: Map surah → range key of its first row, or null when
 * the rewayah has no `surah_metadata` array (range unknown)}.
 */
export function indexVersion(reciters) {
  const index = new Map();
  const list = Array.isArray(reciters) ? reciters : reciters?.reciters;
  for (const reciter of Array.isArray(list) ? list : []) {
    for (const rewayah of reciter?.rewayat ?? []) {
      if (!rewayah || typeof rewayah.id !== 'string') continue;
      const key = `${reciter.id}|${rewayah.id}`;
      if (index.has(key)) continue; // a duplicate rewayah: the first one wins
      let ranges = null;
      if (Array.isArray(rewayah.surah_metadata)) {
        ranges = new Map();
        for (const row of rewayah.surah_metadata) {
          if (row && Number.isInteger(row.surah) && !ranges.has(row.surah)) {
            ranges.set(row.surah, rangeKey(row));
          }
        }
      }
      index.set(key, {listed: new Set(listedSurahs(rewayah)), ranges});
    }
  }
  return index;
}

/**
 * Dated, ordered history from raw versions [{version, lastModified?, body}].
 * Returns {versions: [{version, date, index}], undated: [version numbers],
 * clamped: [{version, from, to}]}.
 */
export function prepareHistory(raw) {
  const sorted = [...raw].sort((a, b) => a.version - b.version);
  const dated = [];
  const undated = [];
  for (const v of sorted) {
    const fileDate =
      v.body && !Array.isArray(v.body) ? utcDate(v.body.updated_at) : null;
    const date = utcDate(v.lastModified) ?? fileDate;
    if (!date) {
      undated.push(v.version);
      continue;
    }
    dated.push({version: v.version, date, index: indexVersion(v.body)});
  }
  // A version cannot be newer than the version after it.
  const clamped = [];
  for (let i = dated.length - 2; i >= 0; i--) {
    if (dated[i].date > dated[i + 1].date) {
      clamped.push({
        version: dated[i].version,
        from: dated[i].date,
        to: dated[i + 1].date,
      });
      dated[i].date = dated[i + 1].date;
    }
  }
  return {versions: dated, undated, clamped: clamped.reverse()};
}

/**
 * True when one version has the recitation: the surah is listed with the
 * same range, or listed in a rewayah with no `surah_metadata` (range unknown).
 */
function hasRecitation(index, rewayahKey, surah, liveRange) {
  const entry = index.get(rewayahKey);
  if (!entry || !entry.listed.has(surah)) return false;
  if (entry.ranges === null) return true;
  return (entry.ranges.get(surah) ?? 'full') === liveRange;
}

/**
 * The oldest version of the unbroken run of versions, back from the newest,
 * that have the recitation (rule 3); null when the newest one does not.
 */
export function runStart(versions, rewayahKey, surah, liveRange) {
  let start = null;
  for (let i = versions.length - 1; i >= 0; i--) {
    if (!hasRecitation(versions[i].index, rewayahKey, surah, liveRange)) break;
    start = versions[i];
  }
  return start;
}

// ---------------------------------------------------------------------------
// The pure core

/**
 * `row` with `added_at` set at the end of its fields (the input is not
 * changed).
 */
function withAddedAt(row, date) {
  return {...row, added_at: date};
}

/**
 * Stamps `added_at` on every listed surah of every rewayah.
 *
 * @param {object[]} liveReciters the live catalog (not changed)
 * @param {object} history the output of `prepareHistory`, or a list of
 *   {version, date, reciters} (dates already known)
 * @param {object} [options]
 * @param {string} [options.today] `YYYY-MM-DD`; a later `created_at` is invalid
 * @returns {{reciters: object[], report: object}}
 */
export function computeAddedAt(liveReciters, history, options = {}) {
  const today = options.today ?? utcDate(new Date());
  const prepared = Array.isArray(history)
    ? {
        versions: [...history]
          .sort((a, b) => a.version - b.version)
          .map(v => ({
            version: v.version,
            date: v.date,
            index: indexVersion(v.reciters),
          })),
        undated: [],
        clamped: [],
      }
    : history;
  const {versions} = prepared;
  const oldest = versions[0] ?? null;

  const report = {
    // The run starts after the oldest version: that version's date.
    fromHistory: 0,
    // The run starts at the oldest version (older than the history).
    oldestFromCreatedAt: 0,
    oldestAtOldestDate: 0, // `created_at` missing, invalid or later
    // No run (a safety net; see rule 4).
    fromCreatedAt: 0,
    fromOldestVersion: 0,
    rowsAdded: 0,
    alreadyDated: 0,
    alreadyDatedInvalid: 0,
    orphanRows: 0,
    duplicateRows: 0,
    oldestVersion: oldest ? {version: oldest.version, date: oldest.date} : null,
    newestVersion: versions.length
      ? {
          version: versions.at(-1).version,
          date: versions.at(-1).date,
        }
      : null,
    stampedByVersion: {},
    stamped: [],
  };

  const dateFor = (reciter, rewayah, surah, liveRange) => {
    const key = `${reciter.id}|${rewayah.id}`;
    const hit = runStart(versions, key, surah, liveRange);
    const created = utcDate(rewayah.created_at);
    if (hit) {
      report.stampedByVersion[hit.version] =
        (report.stampedByVersion[hit.version] ?? 0) + 1;
      if (hit !== oldest) {
        report.fromHistory++;
        return {date: hit.date, source: `v${hit.version}`};
      }
      // Older than the history (rule 3).
      if (created && created <= hit.date) {
        report.oldestFromCreatedAt++;
        return {date: created, source: `v${hit.version} created_at`};
      }
      report.oldestAtOldestDate++;
      return {date: hit.date, source: `v${hit.version} date`};
    }
    if (created && created <= today) {
      report.fromCreatedAt++;
      return {date: created, source: 'created_at'};
    }
    if (!oldest) {
      throw new Error(
        `${reciter.id} / ${rewayah.id} / surah ${surah}: no history version and no valid created_at`,
      );
    }
    report.fromOldestVersion++;
    return {date: oldest.date, source: `oldest v${oldest.version}`};
  };

  const record = (reciter, rewayah, surah, liveRange, stamp) => {
    report.stamped.push({
      reciterId: reciter.id,
      slug: reciter.slug ?? null,
      rewayahId: rewayah.id,
      surah,
      range: liveRange,
      date: stamp.date,
      source: stamp.source,
    });
  };

  const reciters = liveReciters.map(reciter => {
    if (!Array.isArray(reciter?.rewayat)) return reciter;
    let reciterChanged = false;
    const rewayat = reciter.rewayat.map(rewayah => {
      if (!rewayah || typeof rewayah.id !== 'string') return rewayah;
      const listed = listedSurahs(rewayah);
      const listedSet = new Set(listed);
      const oldRows = Array.isArray(rewayah.surah_metadata)
        ? rewayah.surah_metadata
        : [];
      let changed = false;
      const rowSurahs = new Set();

      const rows = oldRows.map(row => {
        if (!row || !Number.isInteger(row.surah)) return row;
        if (rowSurahs.has(row.surah)) {
          report.duplicateRows++; // the first row of the surah holds the date
          return row;
        }
        rowSurahs.add(row.surah);
        if (!listedSet.has(row.surah)) {
          report.orphanRows++;
          return row;
        }
        if (row.added_at !== undefined) {
          report.alreadyDated++;
          if (!isIsoDate(row.added_at)) report.alreadyDatedInvalid++;
          return row;
        }
        const liveRange = rangeKey(row);
        const stamp = dateFor(reciter, rewayah, row.surah, liveRange);
        record(reciter, rewayah, row.surah, liveRange, stamp);
        changed = true;
        return withAddedAt(row, stamp.date);
      });

      // Listed surahs with no row: complete; each gets a new row (rule 5).
      const added = [];
      for (const surah of listed) {
        if (rowSurahs.has(surah)) continue;
        const stamp = dateFor(reciter, rewayah, surah, 'full');
        record(reciter, rewayah, surah, 'full', stamp);
        added.push({surah, is_full: true, added_at: stamp.date});
      }
      if (added.length > 0) {
        report.rowsAdded += added.length;
        changed = true;
        added.sort((a, b) => a.surah - b.surah);
        for (const newRow of added) {
          const at = rows.findIndex(
            r => r && Number.isInteger(r.surah) && r.surah > newRow.surah,
          );
          if (at < 0) rows.push(newRow);
          else rows.splice(at, 0, newRow);
        }
      }

      if (!changed) return rewayah;
      reciterChanged = true;
      return {...rewayah, surah_metadata: rows};
    });
    return reciterChanged ? {...reciter, rewayat} : reciter;
  });

  return {reciters, report};
}

/** The newest stamped recitations, newest first (ties: reciter, rewayah, surah). */
export function newestStamped(report, count = NEWEST_SHOWN) {
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...report.stamped]
    .sort(
      (a, b) =>
        compare(b.date, a.date) ||
        compare(a.reciterId, b.reciterId) ||
        compare(a.rewayahId, b.rewayahId) ||
        a.surah - b.surah,
    )
    .slice(0, count);
}

/** One line per finding, for the console and the R2 audit detail. */
export function formatReport(report, fetchInfo = null) {
  const oldestName = report.oldestVersion
    ? `v${report.oldestVersion.version}`
    : 'the oldest version';
  const lines = [
    `stamped with a version date (run starts after ${oldestName}) ${report.fromHistory}; in every version since ${oldestName} (older than the history): from rewayah created_at ${report.oldestFromCreatedAt}, at the ${oldestName} date (created_at missing, invalid or later) ${report.oldestAtOldestDate}; no run: from created_at ${report.fromCreatedAt}, from the oldest version date ${report.fromOldestVersion}`,
    `rows added for complete surahs ${report.rowsAdded}; rows that already had added_at ${report.alreadyDated} (invalid ${report.alreadyDatedInvalid}); orphan rows ${report.orphanRows}; duplicate rows ${report.duplicateRows}`,
  ];
  if (fetchInfo) {
    lines.push(
      `history: ${fetchInfo.read} versions read (v${fetchInfo.first}-v${fetchInfo.last}), missing ${fetchInfo.missing.length}${fetchInfo.missing.length ? ` [${fetchInfo.missing.join(',')}]` : ''}, undated ${fetchInfo.undated.length}, re-dated ${fetchInfo.clamped.length}; date = Last-Modified (UTC); the live catalog equals v${fetchInfo.last}`,
    );
  }
  if (report.oldestVersion) {
    lines.push(
      `oldest version v${report.oldestVersion.version} ${report.oldestVersion.date}, newest v${report.newestVersion.version} ${report.newestVersion.date}`,
    );
  }
  const newest = newestStamped(report);
  if (newest.length > 0) {
    lines.push(
      `newest stamped: ${newest
        .map(
          s =>
            `${s.date} ${s.reciterId} (${s.slug ?? '-'}) rewayah ${s.rewayahId} surah ${s.surah}${s.range === 'full' ? '' : ` ayat ${s.range}`} [${s.source}]`,
        )
        .join('; ')}`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Fetch and cache (the only part with I/O)

/** The value of `name`: the environment first, then .env.local. */
export function envValue(name, env = process.env, root = REPO_ROOT) {
  if (env[name]) return env[name].trim();
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return null;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(pattern);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

/** The catalog-version.json URL (see the header). */
export function versionUrl(env = process.env, root = REPO_ROOT) {
  const direct = envValue('EXPO_PUBLIC_CATALOG_VERSION_URL', env, root);
  if (direct) return direct;
  const catalog = envValue('EXPO_PUBLIC_CATALOG_URL', env, root);
  if (!catalog) return null;
  return new URL('catalog-version.json', catalog).href;
}

/** The cache folder (see the header). */
export function cacheDir(env = process.env, root = REPO_ROOT) {
  return (
    envValue('CATALOG_HISTORY_CACHE', env, root) ??
    path.join(
      os.homedir(),
      'claude',
      '.scratch',
      'sprint-48',
      'catalog',
      'history',
    )
  );
}

async function fetchWithTries(fetchImpl, url, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_TRIES; attempt++) {
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return {status: 404};
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        status: res.status,
        lastModified: res.headers.get('last-modified'),
        text: await res.text(),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${url.replace(/^https?:\/\/[^/]+/, '<origin>')}: ${lastError?.message ?? lastError}`,
  );
}

/** Runs `worker` on each item, at most `limit` at a time, in input order. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run));
  return out;
}

/**
 * Reads catalog-version.json and every history version from v1 to vN, from
 * the cache when it has the version. Returns {versionDoc, raw: [{version,
 * lastModified, body}], missing: [k]}.
 */
export async function loadHistory({
  fetchImpl = fetch,
  url = versionUrl(),
  dir = cacheDir(),
  concurrency = FETCH_CONCURRENCY,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  if (!url) {
    throw new Error(
      'no catalog version URL: set EXPO_PUBLIC_CATALOG_VERSION_URL or EXPO_PUBLIC_CATALOG_URL (.env.local)',
    );
  }
  const pointer = await fetchWithTries(fetchImpl, url, timeoutMs);
  if (pointer.status === 404) throw new Error('catalog-version.json: HTTP 404');
  const versionDoc = JSON.parse(pointer.text);
  const newest = versionDoc.version;
  if (!Number.isInteger(newest) || newest < 1) {
    throw new Error('catalog-version.json has no valid version');
  }
  // `url` is <origin>/catalog/history/v{N}.json; the folder holds every version.
  const historyBase = new URL('.', versionDoc.url).href;

  mkdirSync(dir, {recursive: true});
  const numbers = Array.from({length: newest}, (_, i) => i + 1);
  const results = await mapLimit(numbers, concurrency, async k => {
    const file = path.join(dir, `v${k}.json`);
    const metaFile = path.join(dir, `v${k}.meta.json`);
    if (existsSync(file) && existsSync(metaFile)) {
      const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      return {
        version: k,
        lastModified: meta.lastModified ?? null,
        body: JSON.parse(readFileSync(file, 'utf8')),
      };
    }
    const res = await fetchWithTries(
      fetchImpl,
      new URL(`v${k}.json`, historyBase).href,
      timeoutMs,
    );
    if (res.status === 404) return {version: k, missing: true};
    const body = JSON.parse(res.text);
    writeFileSync(file, res.text);
    writeFileSync(
      metaFile,
      `${JSON.stringify({version: k, lastModified: res.lastModified, fetchedAt: new Date().toISOString()}, null, 2)}\n`,
    );
    return {version: k, lastModified: res.lastModified, body};
  });
  return {
    versionDoc,
    raw: results.filter(r => !r.missing),
    missing: results.filter(r => r.missing).map(r => r.version),
  };
}

/** Transform entry point for scripts/catalog-r2-mutate.mjs. */
export default async function transform(reciters) {
  const {versionDoc, raw, missing} = await loadHistory();
  const newestRaw = raw.find(r => r.version === versionDoc.version);
  const newestList = Array.isArray(newestRaw?.body)
    ? newestRaw.body
    : newestRaw?.body?.reciters;
  // The walk starts at the newest version, so it must be the live catalog.
  // A difference means that a write landed after catalog-version.json was
  // read (or a stale cache): stop, so that no recitation gets a wrong date.
  if (JSON.stringify(newestList) !== JSON.stringify(reciters)) {
    throw new Error(
      `the live catalog differs from history v${versionDoc.version} (the version in catalog-version.json). Another write may have landed; run again`,
    );
  }
  const history = prepareHistory(raw);
  if (history.versions.length === 0) {
    throw new Error('no dated history version could be read');
  }
  const {reciters: out, report} = computeAddedAt(reciters, history);
  const fetchInfo = {
    read: raw.length,
    first: raw[0]?.version,
    last: versionDoc.version,
    missing,
    undated: history.undated,
    clamped: history.clamped,
  };
  return {
    reciters: out,
    allowedFields: ALLOWED_FIELDS,
    summary: `added_at backfill (Sprint 48): ${formatReport(report, fetchInfo).join(' | ')}`,
    report,
    fetchInfo,
  };
}
// @ai-end
