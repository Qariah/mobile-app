// @ai-generated
// Tests for scripts/lib/partial-audio-probe.mjs (TECH_DEBT #224): the probe
// logic of scripts/audit-partial-audio-paths.mjs. A fake fetch and a fake
// sleep stand in for the CDN and the clock. No test uses the network. Run
// with node --test.
/* global Response, AbortSignal -- Node 18+ globals; the fake fetch builds its answers with Response */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  BUCKETS,
  CONCURRENCY,
  DEFAULT_DEADLINE_MINUTES,
  MAX_RETRY_DELAY_MS,
  MAX_TRIES,
  auditRows,
  classifyRow,
  classifyStatus,
  exitCodeFor,
  parseDeadlineMinutes,
  parseRetryAfter,
  probeRow,
  probeWithRetry,
  retryDelayMs,
  rowUrls,
} from '../lib/partial-audio-probe.mjs';

/** A fake fetch. `answers` is a list of statuses, numbers or {status, headers} or Error. */
function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    const {status, headers} =
      typeof answer === 'number' ? {status: answer, headers: {}} : answer;
    return new Response(null, {status, headers});
  };
  return {fetchImpl, calls};
}

const noSleep = async () => undefined;

function fakeSleep() {
  const waits = [];
  return {
    waits,
    sleep: async ms => {
      waits.push(ms);
    },
  };
}

test('classifyStatus: 2xx is present, 404 and 410 are absent', () => {
  for (const s of [200, 204, 206]) assert.equal(classifyStatus(s), 'present');
  for (const s of [404, 410]) assert.equal(classifyStatus(s), 'absent');
});

test('classifyStatus: 429, 5xx, 408, 425 and a network error are retried (never absent)', () => {
  for (const s of [0, 408, 425, 429, 500, 502, 503, 504, 599]) {
    assert.equal(classifyStatus(s), 'retry', `status ${s}`);
  }
});

test('classifyStatus: any other status is unknown, with no retry', () => {
  for (const s of [301, 304, 400, 401, 403, 405, 409, 416]) {
    assert.equal(classifyStatus(s), 'unknown', `status ${s}`);
  }
});

test('parseRetryAfter reads seconds and an HTTP date, and ignores bad values', () => {
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(parseRetryAfter(' 5 '), 5_000);
  assert.equal(parseRetryAfter('0'), 0);
  const now = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 10:00:30 GMT', now), 30_000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 09:00:00 GMT', now), 0);
  for (const bad of [null, undefined, '', 'soon', '1.5x']) {
    assert.equal(parseRetryAfter(bad), null, String(bad));
  }
});

test('retryDelayMs doubles, honours Retry-After, and has a limit', () => {
  assert.deepEqual(
    [1, 2, 3].map(attempt => retryDelayMs({attempt})),
    [1000, 2000, 4000],
  );
  assert.equal(retryDelayMs({attempt: 1, retryAfter: '7'}), 7000);
  // A valid Retry-After wins, also when it is shorter than the backoff.
  assert.equal(retryDelayMs({attempt: 3, retryAfter: '1'}), 1000);
  // A header that is not valid falls back to the backoff.
  assert.equal(retryDelayMs({attempt: 2, retryAfter: 'soon'}), 2000);
  // The limit applies to both.
  assert.equal(
    retryDelayMs({attempt: 1, retryAfter: '3600'}),
    MAX_RETRY_DELAY_MS,
  );
  assert.equal(retryDelayMs({attempt: 30}), MAX_RETRY_DELAY_MS);
});

test('probeWithRetry: a 429 is retried with a doubling wait until the answer is clear', async () => {
  const {fetchImpl, calls} = fakeFetch([429, 429, 200]);
  const {sleep, waits} = fakeSleep();
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep,
  });
  assert.deepEqual(result, {state: 'present', status: 200, tries: 3});
  assert.deepEqual(waits, [1000, 2000]);
  // A HEAD request with a time limit.
  assert.equal(calls[0].init.method, 'HEAD');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('probeWithRetry: Retry-After sets the wait', async () => {
  const {fetchImpl} = fakeFetch([
    {status: 429, headers: {'retry-after': '3'}},
    404,
  ]);
  const {sleep, waits} = fakeSleep();
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep,
  });
  assert.deepEqual(result, {state: 'absent', status: 404, tries: 2});
  assert.deepEqual(waits, [3000]);
});

test('probeWithRetry: a 429 on every try is UNKNOWN, not absent (the 2026-09-23 case)', async () => {
  const {fetchImpl, calls} = fakeFetch([429]);
  const {sleep, waits} = fakeSleep();
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep,
  });
  assert.deepEqual(result, {state: 'unknown', status: 429, tries: MAX_TRIES});
  assert.equal(calls.length, MAX_TRIES);
  // No wait after the last try.
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('probeWithRetry: a 5xx on every try is UNKNOWN, with the last status', async () => {
  const {fetchImpl} = fakeFetch([503, 500, 502, 504]);
  const {sleep} = fakeSleep();
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep,
  });
  assert.deepEqual(result, {state: 'unknown', status: 504, tries: 4});
});

test('probeWithRetry: a network error is retried, and a timeout counts as one', async () => {
  const {fetchImpl} = fakeFetch([new Error('ECONNRESET'), 200]);
  const {sleep, waits} = fakeSleep();
  assert.deepEqual(
    await probeWithRetry('https://cdn.example/x', {fetchImpl, sleep}),
    {state: 'present', status: 200, tries: 2},
  );
  assert.deepEqual(waits, [1000]);

  const always = fakeFetch([new Error('timeout')]);
  const last = await probeWithRetry('https://cdn.example/x', {
    fetchImpl: always.fetchImpl,
    sleep: fakeSleep().sleep,
  });
  assert.deepEqual(last, {state: 'unknown', status: 0, tries: MAX_TRIES});
});

test('probeWithRetry: a clear 404 stops at once; a 403 is UNKNOWN with no retry', async () => {
  const absent = fakeFetch([404]);
  const waits1 = fakeSleep();
  assert.deepEqual(
    await probeWithRetry('https://cdn.example/x', {
      fetchImpl: absent.fetchImpl,
      sleep: waits1.sleep,
    }),
    {state: 'absent', status: 404, tries: 1},
  );
  assert.equal(waits1.waits.length, 0);

  const blocked = fakeFetch([403]);
  const waits2 = fakeSleep();
  assert.deepEqual(
    await probeWithRetry('https://cdn.example/x', {
      fetchImpl: blocked.fetchImpl,
      sleep: waits2.sleep,
    }),
    {state: 'unknown', status: 403, tries: 1},
  );
  assert.equal(blocked.calls.length, 1);
  assert.equal(waits2.waits.length, 0);
});

test('probeWithRetry: maxTries sets the number of tries', async () => {
  const {fetchImpl, calls} = fakeFetch([429]);
  const result = await probeWithRetry('https://cdn.example/x', {
    fetchImpl,
    sleep: fakeSleep().sleep,
    maxTries: 2,
  });
  assert.equal(result.tries, 2);
  assert.equal(calls.length, 2);
});

test('classifyRow: all nine combinations; an unknown probe makes an unknown row', () => {
  const table = [
    ['present', 'present', 'bothExist'],
    ['present', 'absent', 'unsuffixedOnly'],
    ['absent', 'present', 'suffixedOnly'],
    ['absent', 'absent', 'neither'],
    ['unknown', 'present', 'unknown'],
    ['unknown', 'absent', 'unknown'],
    ['present', 'unknown', 'unknown'],
    ['absent', 'unknown', 'unknown'],
    ['unknown', 'unknown', 'unknown'],
  ];
  for (const [u, s, bucket] of table) {
    assert.equal(classifyRow(u, s), bucket, `${u} + ${s}`);
  }
  // A state that is not clear is never "absent".
  assert.equal(classifyRow('retry', 'absent'), 'unknown');
  assert.equal(classifyRow(undefined, 'absent'), 'unknown');
});

test('exitCodeFor: 0 only when complete and clean; 1 for broken; 3 for unknown', () => {
  assert.equal(exitCodeFor({neither: 0, unknown: 0}), 0);
  assert.equal(exitCodeFor({neither: 2, unknown: 0}), 1);
  assert.equal(exitCodeFor({neither: 0, unknown: 1}), 3);
  // A broken row is a finding even when other rows are unknown.
  assert.equal(exitCodeFor({neither: 1, unknown: 5}), 1);
});

const row = (surah, from, to, extra = {}) => ({
  reciter: 'R',
  rewayatName: 'W',
  server: 'https://cdn.example/r/w',
  surah,
  range: {from, to},
  ...extra,
});

test('rowUrls pads the surah and names the range', () => {
  assert.deepEqual(rowUrls(row(2, 1, 16)), {
    unsuffixed: 'https://cdn.example/r/w/002.mp3',
    suffixed: 'https://cdn.example/r/w/002-1-16.mp3',
  });
  assert.equal(
    rowUrls(row(114, 1, 2)).unsuffixed,
    'https://cdn.example/r/w/114.mp3',
  );
});

/** A fake CDN: `files` is the set of URLs that exist; everything else is a 404. */
function fakeProbe(files, {overrides = {}} = {}) {
  return async url => {
    const status = overrides[url] ?? (files.has(url) ? 200 : 404);
    const kind = classifyStatus(status);
    return {
      state: kind === 'retry' ? 'unknown' : kind,
      status,
      tries: 1,
    };
  };
}

test('probeRow puts a row in its bucket and keeps both statuses', async () => {
  const urls = rowUrls(row(2, 1, 16));
  const only = await probeRow(
    row(2, 1, 16),
    fakeProbe(new Set([urls.suffixed])),
  );
  assert.equal(only.bucket, 'suffixedOnly');
  assert.equal(only.row.statusUnsuffixed, 404);
  assert.equal(only.row.statusSuffixed, 200);
  const none = await probeRow(row(2, 1, 16), fakeProbe(new Set()));
  assert.equal(none.bucket, 'neither');
});

test('auditRows: a CDN that answers 429 to everything gives UNKNOWN rows and exit 3, never "neither"', async () => {
  // The 2026-09-23 failure: 215 rows, every probe rate-limited.
  const rows = Array.from({length: 215}, (_, i) => row((i % 114) + 1, 1, 5));
  const fetchImpl = async () => new Response(null, {status: 429});
  const results = await auditRows(rows, {
    probe: url => probeWithRetry(url, {fetchImpl, sleep: noSleep, maxTries: 2}),
    paceMs: 0,
  });
  assert.equal(results.unknown.length, 215);
  assert.equal(results.neither.length, 0);
  assert.equal(results.suffixedOnly.length, 0);
  assert.equal(
    exitCodeFor({
      neither: results.neither.length,
      unknown: results.unknown.length,
    }),
    3,
  );
});

test('auditRows: the true state is found when the CDN is rate-limited once per URL', async () => {
  // 3 rows: one suffixed-only, one legacy, one broken. Each URL answers 429 on
  // its first request and the real answer after that.
  const rows = [row(2, 1, 16), row(3, 1, 5), row(4, 1, 5)];
  const exists = new Set([
    rowUrls(rows[0]).suffixed,
    rowUrls(rows[1]).unsuffixed,
  ]);
  const seen = new Map();
  const fetchImpl = async url => {
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    if (n === 1) return new Response(null, {status: 429});
    return new Response(null, {status: exists.has(url) ? 200 : 404});
  };
  const results = await auditRows(rows, {
    probe: url => probeWithRetry(url, {fetchImpl, sleep: noSleep}),
    paceMs: 0,
  });
  assert.equal(results.suffixedOnly.length, 1);
  assert.equal(results.unsuffixedOnly.length, 1);
  assert.equal(results.neither.length, 1);
  assert.equal(results.unknown.length, 0);
});

test('auditRows: at most 4 probes at one time by default, and every row is probed once', async () => {
  assert.equal(CONCURRENCY, 4);
  const rows = Array.from({length: 20}, (_, i) => row(i + 1, 1, 5));
  let inFlight = 0;
  let maxInFlight = 0;
  let probes = 0;
  const probe = async () => {
    probes++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
    inFlight--;
    return {state: 'present', status: 200, tries: 1};
  };
  const results = await auditRows(rows, {probe, paceMs: 0});
  assert.equal(maxInFlight, 4);
  assert.equal(probes, 40, 'two probes for each row');
  assert.equal(results.bothExist.length, 20);
  assert.deepEqual(Object.keys(results), BUCKETS);
});

test('auditRows waits paceMs after each row', async () => {
  const waits = [];
  const probe = async () => ({state: 'present', status: 200, tries: 1});
  await auditRows([row(1, 1, 2), row(2, 1, 2), row(3, 1, 2)], {
    probe,
    concurrency: 1,
    paceMs: 250,
    sleep: async ms => {
      waits.push(ms);
    },
  });
  assert.deepEqual(waits, [250, 250, 250]);
});

// ---------------------------------------------------------------------------
// The total time limit

/** A fake clock. `sleep` moves it forward. */
function fakeClock(start = 0) {
  const clock = {
    t: start,
    now: () => clock.t,
    sleep: async ms => {
      clock.t += ms;
    },
  };
  return clock;
}

test('parseDeadlineMinutes: the default is 20, and a bad value is an error', () => {
  assert.equal(DEFAULT_DEADLINE_MINUTES, 20);
  assert.deepEqual(parseDeadlineMinutes([]), {minutes: 20});
  assert.deepEqual(parseDeadlineMinutes(['--json', '--fast']), {minutes: 20});
  assert.deepEqual(parseDeadlineMinutes(['--deadline-minutes=5']), {
    minutes: 5,
  });
  assert.deepEqual(parseDeadlineMinutes(['--json', '--deadline-minutes=0.5']), {
    minutes: 0.5,
  });
  for (const bad of ['', '0', '-3', 'abc', 'Infinity', 'NaN']) {
    const result = parseDeadlineMinutes([`--deadline-minutes=${bad}`]);
    assert.match(result.error, /is not valid/, bad);
  }
});

test('probeWithRetry: a retry wait that would end after the deadline is not taken', async () => {
  const clock = fakeClock();
  const {fetchImpl, calls} = fakeFetch([
    {status: 429, headers: {'retry-after': '60'}},
  ]);
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep: clock.sleep,
    now: clock.now,
    deadlineAt: 100_000,
  });
  // Try 1 at 0 s, wait 60 s, try 2 at 60 s. The next wait ends at 120 s,
  // which is after the deadline at 100 s: the function stops.
  assert.deepEqual(result, {
    state: 'unknown',
    status: 429,
    tries: 2,
    deadline: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(clock.t, 60_000);
});

test('probeWithRetry: no request starts after the deadline', async () => {
  const clock = fakeClock(500);
  const {fetchImpl, calls} = fakeFetch([200]);
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep: clock.sleep,
    now: clock.now,
    deadlineAt: 500,
  });
  assert.deepEqual(result, {
    state: 'unknown',
    status: 0,
    tries: 0,
    deadline: true,
  });
  assert.equal(calls.length, 0);
});

test('probeWithRetry: a request in progress stops at the deadline, not at the request limit', async () => {
  // A request that never answers. Only its abort signal ends it.
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  // The timer of AbortSignal.timeout does not keep Node alive: keep it alive.
  const keepAlive = setInterval(() => undefined, 20);
  const started = Date.now();
  try {
    const result = await probeWithRetry('https://cdn.example/001.mp3', {
      fetchImpl,
      sleep: async () => undefined,
      deadlineAt: Date.now() + 40,
    });
    assert.equal(result.state, 'unknown');
    assert.equal(result.deadline, true);
    assert.ok(
      Date.now() - started < 2000,
      'the 30 s request limit did not apply',
    );
  } finally {
    clearInterval(keepAlive);
  }
});

test('a try that gives a clear answer before the deadline is not marked', async () => {
  const clock = fakeClock();
  const {fetchImpl} = fakeFetch([429, 200]);
  const result = await probeWithRetry('https://cdn.example/001.mp3', {
    fetchImpl,
    sleep: clock.sleep,
    now: clock.now,
    deadlineAt: 60_000,
  });
  assert.deepEqual(result, {state: 'present', status: 200, tries: 2});
});

test('probeRow: when the first probe stops at the deadline, the second probe does not run', async () => {
  const seen = [];
  const probe = async url => {
    seen.push(url);
    return {state: 'unknown', status: 429, tries: 2, deadline: true};
  };
  const {bucket, row: out} = await probeRow(row(2, 1, 16), probe, {
    deadlineAt: 1,
    now: () => 0,
  });
  assert.equal(seen.length, 1);
  assert.equal(bucket, 'unknown');
  assert.equal(out.stoppedByDeadline, true);
  assert.equal(out.statusUnsuffixed, 429);
  assert.equal(out.statusSuffixed, 0);
});

test('auditRows: after the deadline the rows that are left are UNKNOWN and not probed; the exit code is 3', async () => {
  const clock = fakeClock();
  const rows = Array.from({length: 10}, (_, i) => row(i + 1, 1, 5));
  // Each probe takes 10 s. A row takes 20 s. The deadline is at 45 s.
  const probe = async () => {
    clock.t += 10_000;
    return {state: 'present', status: 200, tries: 1};
  };
  const results = await auditRows(rows, {
    probe,
    concurrency: 1,
    paceMs: 0,
    now: clock.now,
    deadlineAt: 45_000,
  });
  // Rows 1 and 2 end at 40 s. Row 3 starts at 40 s, before the deadline.
  // Row 4 would start at 60 s: it and the 6 rows after it are not probed.
  assert.equal(results.bothExist.length, 3);
  assert.equal(results.unknown.length, 7);
  assert.ok(results.unknown.every(r => r.stoppedByDeadline === true));
  assert.ok(results.unknown.every(r => r.statusUnsuffixed === null));
  assert.equal(
    exitCodeFor({
      neither: results.neither.length,
      unknown: results.unknown.length,
    }),
    3,
  );
});

test('auditRows: Retry-After 60 on every request ends at the deadline, not after hours', async () => {
  // The case of the code review: 328 rows, 2 probes each, 3 waits of 60 s for
  // each probe. Without a deadline, that is about 33 hours of waiting for one
  // worker, and 8 hours for 4 workers.
  const clock = fakeClock();
  const rows = Array.from({length: 328}, (_, i) => row((i % 114) + 1, 1, 5));
  const {fetchImpl, calls} = fakeFetch([
    {status: 429, headers: {'retry-after': '60'}},
  ]);
  const deadlineAt = DEFAULT_DEADLINE_MINUTES * 60_000;
  const probe = (url, options) =>
    probeWithRetry(url, {...options, fetchImpl, sleep: clock.sleep});
  const results = await auditRows(rows, {
    probe,
    paceMs: 0,
    now: clock.now,
    deadlineAt,
  });
  assert.equal(results.unknown.length, 328, 'every row is UNKNOWN');
  assert.equal(results.neither.length, 0);
  assert.equal(results.suffixedOnly.length, 0);
  assert.ok(clock.t < deadlineAt, 'no wait ended after the deadline');
  assert.ok(
    calls.length < 328 * 2 * MAX_TRIES,
    `fewer requests than without a deadline (${calls.length})`,
  );
  assert.ok(
    results.unknown.some(r => r.stoppedByDeadline && r.statusSuffixed === 0),
    'some rows were stopped by the deadline, with the second probe not run',
  );
  assert.equal(
    exitCodeFor({
      neither: results.neither.length,
      unknown: results.unknown.length,
    }),
    3,
  );
});

test('auditRows: without a deadline all rows are probed, as before', async () => {
  const clock = fakeClock();
  const rows = Array.from({length: 6}, (_, i) => row(i + 1, 1, 5));
  const probe = async () => ({state: 'present', status: 200, tries: 1});
  const results = await auditRows(rows, {
    probe,
    paceMs: 0,
    now: clock.now,
  });
  assert.equal(results.bothExist.length, 6);
  assert.equal(results.unknown.length, 0);
});
