// @ai
//
// scripts/signals/lib/asc-reports.mjs
// -----------------------------------
// Read the App Store Connect analytics reports that Phase 0
// (scripts/signals/asc-reports-copy.mjs) copies into the signals bucket:
//
//   asc/<report-slug>/<granularity>/<processingDate>/<instanceId>/<segmentId>.csv.gz
//
// Apple's rules (developer.apple.com/documentation/analytics-reports,
// "Data Completeness and Corrections"), and how this file obeys them:
//
//   - An instance is a set of segments. Read every segment of an instance.
//   - A daily instance can hold rows for more than one Date (late events).
//     For one Date, use the rows of ONE instance only: the instance with the
//     newest processingDate that holds that Date. Never add rows of two
//     instances for the same Date (double counts).
//   - The ONGOING request and the one-time snapshot request can both hold an
//     instance with the same processingDate. Then the instance with more rows
//     for that Date wins; on a tie, the larger instance id wins (stable).
//   - Read columns by name, not by position. Names and values are not case
//     sensitive. The files are gzip text with a header row; this parser
//     accepts a tab or a comma as the delimiter.
//
// The functions here are pure, except loadReport(), which reads the bucket.

import {gunzipSync} from 'node:zlib';
import {compareVersions, IOS_V2_MIN_VERSION} from '../../lib/anr-card.mjs';

export {IOS_V2_MIN_VERSION};

/** The bucket slugs of the reports (slug() in asc-reports-copy.mjs). */
export const SESSIONS_SLUG = 'app-sessions-standard';
export const INSTALLS_SLUG = 'app-store-installation-and-deletion-standard';

const KEY_RE =
  /^asc\/([^/]+)\/([^/]+)\/(\d{4}-\d{2}-\d{2}|undated)\/([^/]+)\/([^/]+)\.csv\.gz$/;

/** A bucket key → its parts, or null when the key has another shape. */
export function parseKey(key) {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return {
    slug: m[1],
    granularity: m[2],
    processingDate: m[3],
    instanceId: m[4],
    segmentId: m[5],
  };
}

/** A header name in one form: lower case, single spaces, no BOM or quotes. */
export const normHeader = h =>
  String(h)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^"|"$/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Split one line on `delim`, with "quoted" fields and "" as an escaped quote. */
export function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The delimiter of a header line: a tab when it has tabs and no fewer tabs than commas. */
export function detectDelimiter(header) {
  const tabs = (header.match(/\t/g) || []).length;
  const commas = (header.match(/,/g) || []).length;
  return tabs > 0 && tabs >= commas ? '\t' : ',';
}

/**
 * A report file (text) → {headers, rows}. Each row is an object keyed by the
 * normalised header. `keep(row)` drops rows early (for a large snapshot file).
 */
export function parseReport(text, keep = () => true) {
  const lines = String(text).split(/\r?\n/);
  let h = 0;
  while (h < lines.length && !lines[h].trim()) h++;
  if (h >= lines.length) return {headers: [], rows: []};
  const delim = detectDelimiter(lines[h]);
  const headers = splitLine(lines[h], delim).map(normHeader);
  const rows = [];
  for (let i = h + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitLine(lines[i], delim);
    const row = {};
    headers.forEach((k, j) => (row[k] = (cells[j] ?? '').trim()));
    if (keep(row)) rows.push(row);
  }
  return {headers, rows};
}

/** A Date cell → 'YYYY-MM-DD', or null. Accepts ISO, YYYY/MM/DD and MM/DD/YYYY. */
export function normDate(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

/** A count cell → a number (0 when empty). Throws on text that is not a number. */
export function num(v) {
  const s = String(v ?? '')
    .trim()
    .replace(/,/g, '');
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`not a number in a report: ${v}`);
  return n;
}

/** Throw when a column that the reader needs is missing. */
export function requireColumns(report, headers, need) {
  const missing = need.filter(c => !headers.includes(c));
  if (missing.length)
    throw new Error(
      `${report}: column(s) ${missing.join(', ')} missing (found: ${headers.slice(0, 20).join(', ')})`,
    );
}

/**
 * Instances [{instanceId, processingDate, rows}] → Map(date → rows), with
 * Apple's rule: for each Date, the rows of the newest instance only.
 */
export function rowsByDate(instances) {
  const best = new Map(); // date → {inst, rows}
  for (const inst of instances) {
    const byDate = new Map();
    for (const r of inst.rows) {
      const d = normDate(r.date);
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    }
    for (const [d, rows] of byDate) {
      const cur = best.get(d);
      if (!cur || newer({inst, rows}, cur)) best.set(d, {inst, rows});
    }
  }
  return new Map([...best].map(([d, v]) => [d, v.rows]));
}

function newer(a, b) {
  if (a.inst.processingDate !== b.inst.processingDate)
    return a.inst.processingDate > b.inst.processingDate;
  if (a.rows.length !== b.rows.length) return a.rows.length > b.rows.length;
  return String(a.inst.instanceId) > String(b.inst.instanceId);
}

/** 'v1' (app version < 3.1.0), 'v2', or null for a version that is not a number. */
export function versionLine(v, min = IOS_V2_MIN_VERSION) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d+)*$/.test(s)) return null;
  return compareVersions(s, min) < 0 ? 'v1' : 'v2';
}

/**
 * Read one report from the bucket. Returns {keys, instances, newestProcessingDate}.
 * Only instances with processingDate >= fromProcessingDate are downloaded:
 * an older instance cannot hold a Date in the window. Rows outside
 * [from, to] are dropped while the file is parsed.
 */
export async function loadReport(
  bucket,
  slug,
  {from, to, granularity = 'daily'},
) {
  const keys = (await bucket.list(`asc/${slug}/${granularity}/`))
    .map(k => ({key: k, ...parseKey(k)}))
    .filter(k => k.slug === slug);
  const newestProcessingDate =
    keys.reduce(
      (m, k) =>
        k.processingDate !== 'undated' && k.processingDate > m
          ? k.processingDate
          : m,
      '',
    ) || null;
  const byInst = new Map();
  for (const k of keys) {
    if (k.processingDate === 'undated' || k.processingDate < from) continue;
    if (!byInst.has(k.instanceId))
      byInst.set(k.instanceId, {
        instanceId: k.instanceId,
        processingDate: k.processingDate,
        keys: [],
      });
    byInst.get(k.instanceId).keys.push(k.key);
  }
  const instances = [];
  let headers = null;
  for (const inst of [...byInst.values()].sort((a, b) =>
    a.instanceId.localeCompare(b.instanceId),
  )) {
    const rows = [];
    for (const key of inst.keys.sort()) {
      const buf = await bucket.getBuffer(key);
      if (!buf) continue;
      const text = (
        buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf
      ).toString('utf8');
      const parsed = parseReport(text, r => {
        const d = normDate(r.date);
        return d !== null && d >= from && d <= to;
      });
      if (parsed.headers.length) headers ||= parsed.headers;
      rows.push(...parsed.rows);
    }
    instances.push({
      instanceId: inst.instanceId,
      processingDate: inst.processingDate,
      rows,
    });
  }
  return {keys: keys.length, instances, headers, newestProcessingDate};
}
