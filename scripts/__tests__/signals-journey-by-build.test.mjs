// @ai
// Tests for the signals snapshot section `journeyByBuild` (owner decisions
// 2026-10-25, D1 and D2): the queries (cut-off, lab exclusion, LA days, v2
// builds, quoted keys), the grouping of the builds (production, older with 25
// or more installs, beta, other), the cell rule, the schema, and collect()
// with a fake HogQL. The data is synthetic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composeSchema, validateSnapshot} from '../signals/schema.mjs';
import {findSmallCells, SMALL} from '../signals/lib/rules.mjs';
import * as card from '../signals/sections/card.mjs';
import * as jbb from '../signals/sections/journey-by-build.mjs';

const TO = '2026-10-24';
const ASOF = "created_at <= toDateTime('2026-10-25 18:00:00')";
const PROD = [
  {platform: 'iOS', version: '3.2.1', build: '1718'},
  {platform: 'Android', version: '3.2.1', build: '2027'},
  {platform: 'Android', version: '3.2.0', build: '1717', anrScore: false},
];

/** Validate the section data as the snapshot would; return the errors. */
function errorsOf(data) {
  const schema = composeSchema([{name: jbb.name, schema: jbb.schema}]);
  const v = validateSnapshot(
    {
      schemaVersion: 1,
      generatedAt: '2026-10-25T19:30:00.000Z',
      date: '2026-10-25',
      dataThrough: TO,
      asOf: '2026-10-25T18:00:00.000Z',
      tz: 'America/Los_Angeles',
      git: {sha: 'test'},
      rules: {},
      sections: {journeyByBuild: {status: 'ok', source: 't', ms: 1, data}},
    },
    schema,
  );
  assert.deepEqual(findSmallCells(data), [], 'no people count of 1 to 4');
  return v.errors;
}

// buildsQuery rows: plat, build, version, installs, then the 5 steps.
const row = (plat, build, version, installs, steps = []) => [
  plat,
  build,
  version,
  installs,
  ...[0, 1, 2, 3, 4].map(i => steps[i] ?? installs),
];
const BUILD_ROWS = [
  row('iOS', '1718', '3.2.1', 4565, [4561, 4561, 249, 3022, 2868]),
  row('Android', '1717', '3.2.0', 2729),
  row('Android', '2027', '3.2.1', 1575),
  row('iOS', '1713', '3.2.0', 866),
  row('iOS', '1705', '3.2.0', 24),
  row('iOS', '3506', '3.2.2', 6, [6, 6, 2, 5, 3]),
  row('Android', '3506', '3.2.2', 30),
  row('Android', '1712', '3.2.0', 1),
];

test('journeyByBuild: the journey steps are the Daily card steps without Installed', () => {
  assert.deepEqual(
    jbb.JOURNEY.map(s => s.key),
    card.JOURNEY.map(s => s.key),
  );
});

test('journeyByBuild: compareVersions compares numbers, not text', () => {
  assert.equal(jbb.compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(jbb.compareVersions('3.2.2', '3.2.1'), 1);
  assert.equal(jbb.compareVersions('3.2.0', '3.2.1'), -1);
  assert.equal(jbb.compareVersions('3.2', '3.2.0'), 0);
  assert.equal(jbb.productionVersion(PROD), '3.2.1');
  assert.equal(jbb.productionVersion([]), null);
});

test('journeyByBuild: classify puts production first, then older builds with 25 or more; beta and other are grouped', () => {
  const c = jbb.classify(BUILD_ROWS, PROD);
  assert.deepEqual(
    c.rows.map(r => [r.key, r.production]),
    [
      ['iOS-1718', true],
      ['Android-2027', true],
      ['Android-1717', true],
      ['iOS-1713', false],
    ],
  );
  // a beta is a version above the newest production version, whatever its size
  assert.deepEqual(c.beta, ['iOS-3506', 'Android-3506']);
  // under 25 installs and not a beta: other (24 is under the line)
  assert.deepEqual(c.other, ['iOS-1705', 'Android-1712']);
  assert.deepEqual(c.rows[0], {
    key: 'iOS-1718',
    kind: 'build',
    platform: 'iOS',
    version: '3.2.1',
    build: '1718',
    production: true,
    installs: 4565,
    opened: 4561,
    past_loading: 4561,
    logged_in: 249,
    started: 3022,
    used_it: 2868,
  });
});

test('journeyByBuild: a production build under 25 installs keeps its own row', () => {
  const c = jbb.classify([row('Android', '2027', '3.2.1', 7)], PROD);
  assert.deepEqual(
    c.rows.map(r => r.key),
    ['Android-2027'],
  );
  assert.deepEqual(c.other, []);
});

test('journeyByBuild: shapeWindow adds the group rows, the totals, and the cell rule', () => {
  const c = jbb.classify(BUILD_ROWS, PROD);
  const groups = [
    ['all', 8333, 8260, 8266, 534, 5713, 5393],
    ['all-Android', 3738, 0, 0, 0, 0, 0],
    ['all-iOS', 4595, 0, 0, 0, 0, 0],
    ['beta', 14, 14, 14, 3, 10, 8],
    ['other', 25, 25, 25, 0, 17, 2],
  ];
  const w = jbb.shapeWindow({from: '2026-09-25', to: TO}, c, groups);
  assert.deepEqual(w.all, {
    installs: 8333,
    opened: 8260,
    past_loading: 8266,
    logged_in: 534,
    started: 5713,
    used_it: 5393,
    iOS: 4595,
    Android: 3738,
  });
  assert.deepEqual(w.rows.at(-2), {
    key: 'beta',
    kind: 'beta',
    builds: 2,
    installs: 14,
    opened: 14,
    past_loading: 14,
    logged_in: SMALL,
    started: 10,
    used_it: 8,
  });
  assert.equal(w.rows.at(-1).key, 'other');
  assert.equal(w.rows.at(-1).builds, 2);
  assert.equal(w.rows.at(-1).used_it, SMALL);
  // no beta or other build: no group row; no rows at all: zeros, not errors
  const empty = jbb.shapeWindow(
    {from: '2026-09-25', to: TO},
    jbb.classify([], PROD),
    [],
  );
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.all.installs, 0);
  assert.equal(empty.all.iOS, 0);
});

test('journeyByBuild: the queries keep the cut-off, the lab exclusion, LA days and v2 builds', () => {
  const b = jbb.buildsQuery('2026-09-25', TO, ASOF);
  assert.ok(b.includes(ASOF));
  assert.match(
    b,
    /toTimeZone\(timestamp, 'America\/Los_Angeles'\)\) >= toDate\('2026-09-25'\)/,
  );
  assert.match(b, /<= toDate\('2026-10-24'\)/);
  assert.match(b, /toIntOrZero\(toString\(properties\.\$app_build\)\) >= 500/);
  assert.match(b, /GROUP BY person_id, build/);
  assert.doesNotMatch(b, /\bLIMIT\b/i, 'collect passes {limit}');
  const g = jbb.groupsQuery(
    '2026-08-02',
    TO,
    {beta: ["iOS-35'06"], other: []},
    ASOF,
  );
  assert.ok(g.includes(ASOF));
  assert.ok(g.includes("key IN ('iOS-35''06')"), 'keys are quoted');
  assert.match(
    g,
    /multiIf\(key IN \('iOS-35''06'\), 'beta', false, 'other', ''\)/,
  );
  assert.match(g, /concat\('all-', plat\)/);
});

test('journeyByBuild: collect gives both windows, passes the schema, and caps the rows', async () => {
  const calls = [];
  const ctx = {
    dataThrough: TO,
    asOfSQL: ASOF,
    cfg: {
      card: {
        builds: [
          {platform: 'iOS', release: 'com.qariah.app@3.2.1+1718'},
          {platform: 'Android', release: 'com.qariah.app@3.2.1+2027'},
          {
            platform: 'Android',
            release: 'com.qariah.app@3.2.0+1717',
            anrScore: false,
          },
        ],
      },
    },
    async hogql(q, o) {
      calls.push([q.includes('arrayJoin') ? 'groups' : 'builds', o]);
      if (!q.includes('arrayJoin')) return BUILD_ROWS;
      return [
        ['all', 8333, 8260, 8266, 534, 5713, 5393],
        ['all-iOS', 4595, 0, 0, 0, 0, 0],
        ['all-Android', 3738, 0, 0, 0, 0, 0],
        ['beta', 36, 36, 36, 3, 30, 20],
        ['other', 25, 25, 25, 0, 17, 15],
      ];
    },
  };
  const r = await jbb.collect(ctx);
  assert.equal(r.status, 'ok');
  assert.deepEqual(Object.keys(r.data.windows), ['d7', 'd30', 'launch']);
  assert.equal(r.data.windows.d7.from, '2026-10-18');
  assert.equal(r.data.windows.d30.from, '2026-09-25');
  assert.equal(r.data.windows.launch.from, '2026-08-02');
  assert.equal(r.data.productionVersion, '3.2.1');
  assert.equal(r.data.minInstalls, 25);
  assert.deepEqual(
    calls.map(c => [c[0], c[1].limit]),
    [
      ['builds', jbb.ROW_LIMIT],
      ['groups', 10],
      ['builds', jbb.ROW_LIMIT],
      ['groups', 10],
      ['builds', jbb.ROW_LIMIT],
      ['groups', 10],
    ],
  );
  assert.deepEqual(errorsOf(r.data), []);
});

test('journeyByBuild: an older snapshot file without the section stays valid', () => {
  assert.equal(jbb.addedAt, '2026-10-25');
  const schema = composeSchema([
    {name: jbb.name, schema: jbb.schema, addedAt: jbb.addedAt},
  ]);
  assert.deepEqual(schema.properties.sections.required, []);
});
