// @ai-start
/**
 * The probe logic of scripts/audit-partial-audio-paths.mjs (TECH_DEBT #224).
 *
 * The audit sends a HEAD request for the audio file of each partial
 * recitation, at two keys, and puts the row in a bucket. The first version
 * sent 20 requests at once. The CDN answered 429, and the script read each
 * 429 as "the file is absent". On 2026-09-23 it reported `suffixedOnly: 0` and
 * `neither: 215`, when the true state was `suffixedOnly: 2` and
 * `neither: 0`. That is a false all-clear, and the audit is the trigger gate
 * for TECH_DEBT #70.
 *
 * The rule of this module: a status that does not show whether the file
 * exists is UNKNOWN. It is never "absent". A row with an UNKNOWN probe is an
 * UNKNOWN row, and the audit exits non-zero while one row stays UNKNOWN.
 *
 * Statuses:
 *   - 2xx                       the file is present
 *   - 404, 410                  the file is absent
 *   - 429, 5xx, 408, 425, or a
 *     network error or timeout  not a clear answer: retry, then UNKNOWN
 *   - any other status          not a clear answer: UNKNOWN, no retry
 *
 * Total time limit: the whole audit has a deadline (20 minutes by default).
 * The CDN can answer `Retry-After: 60` on every request. Without a deadline,
 * 328 rows x 2 probes x 3 waits of 60 s run for about 8 hours, and a
 * scheduled caller waits for that long. After the deadline no new request
 * starts, no retry waits, and the rows that are not finished are UNKNOWN. So
 * the exit code is 3.
 *
 * This module has no side effects. `fetch`, `sleep` and the clock are
 * parameters, so the tests need no network and no real wait.
 */
/* global AbortSignal -- the Node 18+ global, for the time limit of each request */

/** Requests at one time. The CDN answers 429 above about 5 requests per second. */
export const CONCURRENCY = 4;
/** Wait after each row in a worker, in ms. */
export const PACE_MS = 250;
/** Tries for one URL, the first try included. */
export const MAX_TRIES = 4;
/** Wait after the first failed try, in ms. It doubles after each failed try. */
export const RETRY_BASE_MS = 1000;
/** The longest wait between two tries, in ms. It also limits Retry-After. */
export const MAX_RETRY_DELAY_MS = 60_000;
/** Time limit of one request, in ms. */
export const PROBE_TIMEOUT_MS = 30_000;
/** Time limit of the whole audit, in minutes. The script option --deadline-minutes sets it. */
export const DEFAULT_DEADLINE_MINUTES = 20;

/** The result buckets of a row. */
export const BUCKETS = [
  'bothExist',
  'unsuffixedOnly',
  'suffixedOnly',
  'neither',
  'unknown',
];

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * What an HTTP status says about the file.
 * @param {number} status the HTTP status, or 0 for a network error
 * @returns {'present' | 'absent' | 'retry' | 'unknown'} `retry` means a new
 *   try can give a clear answer. `unknown` means that it cannot.
 */
export function classifyStatus(status) {
  if (status >= 200 && status < 300) return 'present';
  if (status === 404 || status === 410) return 'absent';
  if (
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  ) {
    return 'retry';
  }
  return 'unknown';
}

/**
 * The wait in ms that a Retry-After header asks for.
 * @param {string | null | undefined} value the header: seconds, or an HTTP date
 * @param {number} [nowMs] the time now, for an HTTP date
 * @returns {number | null} null when the header is missing or not valid
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * The wait in ms before the next try. Retry-After wins when it is valid.
 * Without it, the wait doubles: `baseMs`, 2 x `baseMs`, 4 x `baseMs`. The
 * result never exceeds `maxMs`.
 * @param {object} options
 * @param {number} options.attempt the number of the try that failed, from 1
 * @param {string | null} [options.retryAfter] the Retry-After header
 * @param {number} [options.nowMs] the time now, for an HTTP date
 * @param {number} [options.baseMs]
 * @param {number} [options.maxMs]
 */
export function retryDelayMs({
  attempt,
  retryAfter = null,
  nowMs = Date.now(),
  baseMs = RETRY_BASE_MS,
  maxMs = MAX_RETRY_DELAY_MS,
}) {
  const asked = parseRetryAfter(retryAfter, nowMs);
  const delay = asked !== null ? asked : baseMs * 2 ** (attempt - 1);
  return Math.min(delay, maxMs);
}

/**
 * HEAD one URL. Retry while the answer is 429, 5xx, 408, 425 or a network
 * error, with a wait that doubles and honours Retry-After.
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] a fake in tests
 * @param {(ms: number) => Promise<void>} [options.sleep] a fake in tests
 * @param {() => number} [options.now]
 * @param {number} [options.maxTries]
 * @param {number} [options.baseMs]
 * @param {number} [options.maxDelayMs]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.deadlineAt] the time (ms, as `now()`) after which
 *   the function sends no request and does not wait for a retry. A request in
 *   progress stops at the deadline.
 * @returns {Promise<{state: 'present' | 'absent' | 'unknown', status: number, tries: number, deadline?: true}>}
 *   `status` is the last HTTP status, or 0 for a network error. `state` is
 *   `unknown` when no clear answer came in `maxTries` tries. `deadline` is
 *   true (and only then present) when the deadline stopped the function.
 */
export async function probeWithRetry(
  url,
  {
    fetchImpl = fetch,
    sleep = defaultSleep,
    now = Date.now,
    maxTries = MAX_TRIES,
    baseMs = RETRY_BASE_MS,
    maxDelayMs = MAX_RETRY_DELAY_MS,
    timeoutMs = PROBE_TIMEOUT_MS,
    deadlineAt = Infinity,
  } = {},
) {
  let status = 0;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const remaining = deadlineAt - now();
    if (remaining <= 0) {
      return {state: 'unknown', status, tries: attempt - 1, deadline: true};
    }
    let retryAfter = null;
    try {
      const res = await fetchImpl(url, {
        method: 'HEAD',
        // A request never runs past the deadline.
        signal: AbortSignal.timeout(Math.ceil(Math.min(timeoutMs, remaining))),
      });
      status = res.status;
      retryAfter = res.headers?.get?.('retry-after') ?? null;
    } catch {
      status = 0;
    }
    const kind = classifyStatus(status);
    if (kind === 'present' || kind === 'absent') {
      return {state: kind, status, tries: attempt};
    }
    if (kind === 'unknown') return {state: 'unknown', status, tries: attempt};
    if (attempt < maxTries) {
      const wait = retryDelayMs({
        attempt,
        retryAfter,
        nowMs: now(),
        baseMs,
        maxMs: maxDelayMs,
      });
      // A wait that ends after the deadline cannot lead to a new try.
      if (now() + wait >= deadlineAt) {
        return {state: 'unknown', status, tries: attempt, deadline: true};
      }
      await sleep(wait);
    }
  }
  return {state: 'unknown', status, tries: maxTries};
}

/**
 * The bucket of a row, from the state of its two probes.
 *
 * A row is `unknown` when one probe is not clear. That holds even when the
 * other probe finds a file: `bothExist` and `unsuffixedOnly` differ in the
 * probe that is not clear, and `suffixedOnly` is the bucket that TECH_DEBT
 * #70 waits for.
 * @param {'present' | 'absent' | 'unknown'} unsuffixed the legacy key
 * @param {'present' | 'absent' | 'unknown'} suffixed the key with the range
 * @returns {'bothExist' | 'unsuffixedOnly' | 'suffixedOnly' | 'neither' | 'unknown'}
 */
export function classifyRow(unsuffixed, suffixed) {
  const clear = state => state === 'present' || state === 'absent';
  if (!clear(unsuffixed) || !clear(suffixed)) return 'unknown';
  if (unsuffixed === 'present' && suffixed === 'present') return 'bothExist';
  if (unsuffixed === 'present') return 'unsuffixedOnly';
  if (suffixed === 'present') return 'suffixedOnly';
  return 'neither';
}

/** The two keys of a partial row: the legacy key and the key with the range. */
export function rowUrls(row) {
  const surah = String(row.surah).padStart(3, '0');
  return {
    unsuffixed: `${row.server}/${surah}.mp3`,
    suffixed: `${row.server}/${surah}-${row.range.from}-${row.range.to}.mp3`,
  };
}

/**
 * Probe both keys of one row.
 *
 * `probe` gets the URL and the options `{deadlineAt, now}`. When the first
 * probe stops at the deadline, the second probe does not run. The row then has
 * `stoppedByDeadline: true`, and it is UNKNOWN.
 * @param {object} row a partial row: server, surah, range
 * @param {(url: string, options: object) => Promise<{state: string, status: number, deadline?: boolean}>} probe
 * @param {{deadlineAt?: number, now?: () => number}} [clock]
 */
export async function probeRow(row, probe = probeWithRetry, clock = {}) {
  const urls = rowUrls(row);
  const u = await probe(urls.unsuffixed, clock);
  const s = u.deadline
    ? {state: 'unknown', status: 0, tries: 0, deadline: true}
    : await probe(urls.suffixed, clock);
  const stopped = u.deadline || s.deadline ? {stoppedByDeadline: true} : {};
  return {
    bucket: classifyRow(u.state, s.state),
    row: {
      ...row,
      statusUnsuffixed: u.status,
      statusSuffixed: s.status,
      ...stopped,
    },
  };
}

/**
 * Probe all rows with a small pool of workers.
 * @param {object[]} rows the partial rows
 * @param {object} [options]
 * @param {(url: string, options: object) => Promise<{state: string, status: number, deadline?: boolean}>} [options.probe]
 * @param {number} [options.concurrency] workers at one time
 * @param {number} [options.paceMs] wait after each row in a worker
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.deadlineAt] the time (ms, as `now()`) of the total
 *   time limit. After it, a row that was not started goes to `unknown` with
 *   `stoppedByDeadline: true` and null statuses. A row in progress stops at
 *   the deadline too (see `probeWithRetry`).
 * @param {() => number} [options.now] the clock (a fake in tests)
 * @returns {Promise<Record<string, object[]>>} the rows in each bucket
 */
export async function auditRows(
  rows,
  {
    probe = probeWithRetry,
    concurrency = CONCURRENCY,
    paceMs = PACE_MS,
    sleep = defaultSleep,
    deadlineAt = Infinity,
    now = Date.now,
  } = {},
) {
  const results = Object.fromEntries(BUCKETS.map(b => [b, []]));
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const current = rows[next++];
      if (now() >= deadlineAt) {
        // No time left: the row is not probed, and it is not clean.
        results.unknown.push({
          ...current,
          statusUnsuffixed: null,
          statusSuffixed: null,
          stoppedByDeadline: true,
        });
        continue;
      }
      const {bucket, row} = await probeRow(current, probe, {deadlineAt, now});
      results[bucket].push(row);
      if (paceMs > 0 && now() < deadlineAt) await sleep(paceMs);
    }
  };
  await Promise.all(Array.from({length: concurrency}, worker));
  return results;
}

/**
 * Read --deadline-minutes=N from the arguments.
 * @param {string[]} args the command-line arguments
 * @returns {{minutes: number} | {error: string}} `minutes` is the default
 *   when the option is missing. An option that is not a number above 0 is an
 *   error.
 */
export function parseDeadlineMinutes(args) {
  const arg = args.find(a => a.startsWith('--deadline-minutes='));
  if (arg === undefined) return {minutes: DEFAULT_DEADLINE_MINUTES};
  const minutes = Number(arg.slice('--deadline-minutes='.length));
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return {
      error: `${arg} is not valid. Use a number above 0, for example --deadline-minutes=20`,
    };
  }
  return {minutes};
}

/**
 * The exit code of the audit, from the bucket counts.
 *   0  no row is broken, and no row is UNKNOWN
 *   1  one row or more is broken (`neither`)
 *   3  no row is broken, but one row or more is UNKNOWN (also when the
 *      deadline stopped the audit): the audit is not complete, and a clean
 *      result is not shown
 * (Exit code 2 is for a catalog that cannot be read. The script sets it.)
 * @param {{neither: number, unknown: number}} counts
 */
export function exitCodeFor({neither, unknown}) {
  if (neither > 0) return 1;
  if (unknown > 0) return 3;
  return 0;
}
// @ai-end
