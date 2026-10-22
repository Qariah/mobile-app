// Tests for the signals engagement sections (planning/signals-phase1-design.md):
// use, weekly, retention, funnel, content and restore. Each test builds the
// section data from synthetic HogQL rows (fixtures/signals/engagement/rows.json),
// validates it against the section schema, and checks the edge cases (small
// cells, empty rows, gaps, maturity). The queries are checked for the
// ingestion cut-off, the lab exclusion and their date bounds.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeSchema, validateSnapshot} from '../signals/schema.mjs';
import {judge, RULES} from '../signals/snapshot.mjs';
import {findSmallCells, SMALL} from '../signals/lib/rules.mjs';
import {SECTIONS} from '../signals/sections/index.mjs';
import * as use from '../signals/sections/use.mjs';
import * as weekly from '../signals/sections/weekly.mjs';
import * as retention from '../signals/sections/retention.mjs';
import * as funnel from '../signals/sections/funnel.mjs';
import * as content from '../signals/sections/content.mjs';
import * as restore from '../signals/sections/restore.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(
  readFileSync(resolve(HERE, 'fixtures/signals/engagement/rows.json'), 'utf8'),
);
const TO = '2026-10-17'; // a Saturday
const ASOF = "created_at <= toDateTime('2026-10-18 18:00:00')";
const LAB = /\$device_name NOT ILIKE '%simulator%'/;

const envelope = sections => ({
  schemaVersion: 1,
  generatedAt: '2026-10-18T19:30:00.000Z',
  date: '2026-10-18',
  dataThrough: TO,
  asOf: '2026-10-18T18:00:00.000Z',
  tz: 'America/Los_Angeles',
  git: {sha: 'abc'},
  rules: RULES,
  sections,
});
/** Validate one section's data against its schema; return the errors. */
const errorsOf = (mod, data) => {
  const schema = composeSchema([{name: mod.name, schema: mod.schema}]);
  const v = validateSnapshot(
    envelope({[mod.name]: {status: 'ok', source: 'f', ms: 1, data}}),
    schema,
  );
  assert.deepEqual(findSmallCells(data), [], 'no people count of 1 to 4');
  return v.errors;
};

// --- use -------------------------------------------------------------------

test('use: the query has the cut-off, the lab exclusion and the 120 + 30 day bounds', () => {
  const q = use.usageQuery('2026-10-18', ASOF);
  assert.ok(q.includes(ASOF));
  assert.match(q, LAB);
  assert.match(q, /2026-06-20 00:00:00/); // 2026-06-21 (120 days) − 1 day margin
  assert.match(q, /day >= toDate\('2026-09-19'\)/); // last30d = 30 LA days to 2026-10-18
  assert.match(q, /uniqExact\(person_id\)/);
});

test('use: shape fills gaps, suppresses small cells and flags core events', () => {
  const d = use.shape(F.use, TO);
  assert.deepEqual(errorsOf(use, d), []);
  assert.equal(d.days.length, 120);
  assert.equal(d.days[0], '2026-06-20');
  assert.equal(d.days[119], TO);
  const ml = d.daily.meaningful_listen;
  assert.equal(ml.events[119], 2271);
  assert.equal(ml.installs[119], 400);
  assert.equal(ml.installs[118], SMALL); // 3 installs
  assert.equal(ml.events[118], SMALL); // behind 3 installs
  assert.equal(ml.events[0], 0); // a gap is 0
  assert.equal(d.daily.mushaf_page_read.events[0], 50);
  assert.equal(d.daily.mushaf_page_read.events[1], SMALL);
  assert.deepEqual(d.last30d.events.meaningful_listen, {
    events: 74121,
    installs: 4610,
    core: true,
  });
  assert.equal(d.last30d.events.playback_started.core, false);
  assert.equal(d.last30d.events.mushaf_page_opened.installs, 0); // absent → 0
  assert.equal(d.last30d.from, '2026-09-18');
});

test('use: empty rows give zeros that pass the schema', () => {
  const d = use.shape([], TO);
  assert.deepEqual(errorsOf(use, d), []);
  assert.ok(d.daily.playback_completed.events.every(n => n === 0));
});

// --- weekly ----------------------------------------------------------------

test('weekly: the query has the cut-off, the lab exclusion and a full-history scan', () => {
  const q = weekly.weeklyQuery(TO, ASOF);
  assert.ok(q.includes(ASOF));
  assert.match(q, LAB);
  assert.match(q, /2026-04-30 00:00:00/); // SCAN_FROM − 1 day margin
  assert.match(q, /OVER \(PARTITION BY person_id\)/);
  assert.match(q, /toMonday/);
});

test('weekly: shape keeps the top 8, folds the rest and unknown into other, marks the partial week', () => {
  const d = weekly.shape(F.weekly, TO);
  assert.deepEqual(errorsOf(weekly, d), []);
  // A week before SCAN_FROM and a week after TO are dropped.
  assert.deepEqual(d.weeks, ['2026-09-28', '2026-10-05', '2026-10-12']);
  assert.equal(d.partialLastWeek, '2026-10-12'); // TO is a Saturday
  assert.deepEqual(d.total.newInstalls, [1127, 1396, 1071]);
  assert.deepEqual(d.byPlatform.unknown.newInstalls, [SMALL, 0, 0]);
  assert.equal(d.byPlatform.iOS.pagesRead[1], SMALL); // 30 pages behind 2 readers
  // byBuild: 1718, 1717, 2027 and 1001–1005 are the top 8; 1006–1008 and unknown are other.
  assert.equal(d.byBuild.length, 9);
  assert.deepEqual(d.byBuild.map(r => r.label).slice(0, 3), [
    '1718',
    '1717',
    '2027',
  ]);
  const other = d.byBuild.at(-1);
  assert.equal(other.label, 'other');
  assert.deepEqual(other.newInstalls, [12, SMALL, 0]); // unknown 12; 2 + 1 + 1 = 4 → "<5"
  assert.equal(d.byBuild.find(r => r.label === '2027').listeners[0], 14);
  assert.deepEqual(
    d.byMaker.map(r => r.label),
    ['Samsung', 'TECNO', 'other'],
  );
  assert.deepEqual(d.byOsMajor.find(r => r.label === 'iPadOS 26').listeners, [
    0,
    0,
    SMALL,
  ]);
  assert.match(d.definitions.week, /partialLastWeek/);
});

test('weekly: a Sunday closes the week; empty rows still validate', () => {
  assert.equal(weekly.shape(F.weekly, '2026-10-18').partialLastWeek, null);
  const d = weekly.shape([], TO);
  assert.deepEqual(errorsOf(weekly, d), []);
  assert.deepEqual(d.weeks, ['2026-10-12']);
  assert.deepEqual(d.byBuild, [
    {label: 'other', newInstalls: [0], listeners: [0]},
  ]);
});

// --- retention -------------------------------------------------------------

test('retention: the query has the cut-off and the day windows of the spec', () => {
  const q = retention.retentionQuery(TO, ASOF);
  assert.ok(q.includes(ASOF));
  assert.match(q, LAB);
  assert.match(q, /has\(offs, 1\)/);
  assert.match(q, /x >= 6 AND x <= 8/);
  assert.match(q, /x >= 27 AND x <= 29/);
  assert.match(q, /arrayCount\(x -> x <= 29, offs\) >= 2/);
});

test('retention: maturity is measured at the end of dataThrough', () => {
  // End of 2026-10-17 in LA = 2026-10-18T07:00Z (PDT); 48 h before = 2026-10-16T07:00Z.
  assert.equal(
    new Date(retention.endOfDay(TO)).toISOString(),
    '2026-10-18T07:00:00.000Z',
  );
  const c = (ts, day0) => ({lastFirstSeen: ts, lastDay0: day0});
  assert.equal(
    retention.isMature(
      'd2',
      c('2026-10-16T06:59:59.999000Z', '2026-10-15'),
      TO,
    ),
    true,
  );
  assert.equal(
    retention.isMature(
      'd2',
      c('2026-10-16T07:00:01.000000Z', '2026-10-16'),
      TO,
    ),
    false,
  );
  assert.equal(retention.isMature('d7', c('', '2026-10-09'), TO), true); // day 8 = TO
  assert.equal(retention.isMature('d7', c('', '2026-10-10'), TO), false);
  assert.equal(retention.isMature('d28', c('', '2026-09-18'), TO), true); // day 29 = TO
  assert.equal(
    retention.isMature('cameBack2ndDay', c('', '2026-09-19'), TO),
    false,
  );
  // Winter time: end of 2026-12-01 = 2026-12-02T08:00Z (PST).
  assert.equal(
    new Date(retention.endOfDay('2026-12-01')).toISOString(),
    '2026-12-02T08:00:00.000Z',
  );
});

test('retention: shape gives rates for mature cohorts and null otherwise', () => {
  const d = retention.shape(F.retention, TO);
  assert.deepEqual(errorsOf(retention, d), []);
  assert.deepEqual(
    d.cohorts.map(c => c.week),
    [
      '2026-06-29',
      '2026-07-27',
      '2026-08-31',
      '2026-09-14',
      '2026-10-05',
      '2026-10-12',
    ],
  );
  const by = Object.fromEntries(d.cohorts.map(c => [c.week, c]));
  assert.deepEqual(by['2026-08-31'].d2, {
    num: 237,
    den: 1061,
    value: 0.2234,
    lowN: false,
  });
  assert.equal(by['2026-08-31'].d28.value, 0.1423);
  assert.equal(by['2026-09-14'].d7.num, 205);
  assert.equal(by['2026-09-14'].d28, null); // 2026-09-20 + 29 > TO
  assert.equal(by['2026-10-05'].d2.num, 239);
  assert.equal(by['2026-10-05'].d7, null); // 2026-10-11 + 8 > TO
  assert.equal(by['2026-10-12'].d2, null); // last first seen < 48 h before the end of TO
  assert.equal(by['2026-07-27'].cohort, SMALL);
  assert.deepEqual(by['2026-07-27'].d2, {
    num: 0,
    den: SMALL,
    value: null,
    lowN: false,
  });
  assert.deepEqual(by['2026-06-29'].d28, {
    num: SMALL,
    den: 7,
    value: null,
    lowN: true,
  });
  assert.deepEqual(errorsOf(retention, retention.shape([], TO)), []);
});

// --- funnel ----------------------------------------------------------------

/** The STEPS array literal of scripts/daily-card.mjs, evaluated. */
function cardSteps() {
  const src = readFileSync(resolve(HERE, '../daily-card.mjs'), 'utf8');
  const m = src.match(/const STEPS = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'daily-card.mjs STEPS not found');
  // JSON round trip: the objects of another realm fail deepStrictEqual.
  return JSON.parse(JSON.stringify(runInNewContext(`(${m[1]})`)));
}

test('funnel: the card-rule rows use the Daily card conditions exactly', () => {
  const card = Object.fromEntries(cardSteps().map(s => [s.key, s]));
  for (const s of funnel.EVENT_STEPS.filter(x => x.card)) {
    const c = card[s.card];
    assert.ok(c, `card step ${s.card}`);
    assert.deepEqual(s.events, c.events, s.key);
    assert.equal(s.or, c.or, s.key);
    assert.equal(
      funnel.stepCond(s),
      [`event IN (${c.events.map(e => `'${e}'`).join(', ')})`, c.or]
        .filter(Boolean)
        .join(' OR '),
    );
  }
  // The reference steps (posthog.json funnel.definitions).
  const step = k => funnel.EVENT_STEPS.find(s => s.key === k);
  assert.deepEqual(step('installed').events, ['Application Installed']);
  assert.deepEqual(step('loggedIn').events, ['sign_in_succeeded']);
  assert.equal(step('loggedIn').or, undefined);
  // Past loading = a first screen rendered (ColdStartBeganProps in
  // services/analytics/qariahEvents.ts), the same as the card.
  assert.equal(step('pastLoading').card, 'past_loading');
  assert.deepEqual(step('pastLoading').events, [
    'splash_hidden',
    'screen_content_rendered',
  ]);
});

test('funnel: the query has the cut-off, aged30 and the 30-day MAU window', () => {
  const q = funnel.funnelQuery(TO, ASOF);
  assert.ok(q.includes(ASOF));
  assert.match(q, LAB);
  assert.match(q, /day0 <= toDate\('2026-09-17'\)/); // aged30: day 0 <= TO − 30
  assert.match(q, /last_day >= toDate\('2026-09-18'\)/); // MAU: 30 LA days to TO
  assert.match(q, /argMinIf\(properties\.\$os_name, timestamp/);
  assert.ok(funnel.firstSeenQuery(TO, ASOF).includes(ASOF));
});

test('funnel: shape computes churned, fills a missing platform and names instrumentation dates', () => {
  const d = funnel.shape(F.funnel.rows, F.funnel.first, TO);
  assert.deepEqual(errorsOf(funnel, d), []);
  const get = (c, k) => c.steps.find(s => s.key === k).installs;
  assert.equal(d.all.total.installs, 11950);
  assert.equal(get(d.all.total, 'churned'), 11950 - 8057);
  assert.equal(get(d.aged30.total, 'churned'), get(d.all.total, 'churned'));
  assert.equal(get(d.all.total, 'loggedInCardRule'), 1065);
  assert.equal(d.all.byPlatform.unknown.installs, SMALL);
  assert.equal(d.aged30.byPlatform.unknown.installs, 0); // no row → 0
  assert.deepEqual(
    d.steps.map(s => s.key),
    funnel.STEPS.map(s => s.key),
  );
  assert.match(d.definitions.opened, /cold_start_began 2026-06-17/);
  assert.match(
    d.definitions.pastLoading,
    /ever sent splash_hidden or screen_content_rendered — the Daily card's "past_loading" condition \(first organic event: splash_hidden 2026-06-08, screen_content_rendered 2026-06-17\)/,
  );
  assert.match(
    d.definitions.loggedInCardRule,
    /onboarding_completed \(signed_in\) 2026-06-20/,
  );
  assert.match(d.definitions.mushafPageRead, /mushaf_page_read none yet/);
  assert.deepEqual(errorsOf(funnel, funnel.shape([], [], TO)), []);
});

// --- content ---------------------------------------------------------------

const NAMES = content.catalogNames(F.content.catalog);

test('content: catalog names fold the Hafs spellings and map slugs to ids', () => {
  assert.equal(NAMES.riwayah.get('rw-3'), content.HAFS);
  assert.equal(NAMES.riwayah.get('rw-4'), 'English Translation');
  assert.equal(NAMES.slugs.get('zaynab-talha'), 'r-zaynab');
  assert.equal(NAMES.reciters.get('r-maria'), 'Hajjah Maria Ulfah');
});

test('content: the listen query never reads reciter_name and keys reciters by the catalog', () => {
  const q = content.listenQuery(TO, ASOF, NAMES);
  assert.ok(q.includes(ASOF));
  assert.match(q, LAB);
  assert.doesNotMatch(q, /reciter_name/);
  assert.match(q, /'zaynab-talha'/); // a slug is a key
  assert.match(q, /'__other__'/);
  assert.match(q, /2026-08-02 00:00:00/); // since 2026-08-03 − 1 day margin
  assert.match(q, />= toDate\('2026-09-18'\)/); // last30d
  const m = content.mushafQuery(TO, ASOF);
  assert.ok(m.includes(ASOF));
  assert.match(m, /page BETWEEN 1 AND 604/);
});

test('content: unknown riwayah ids form one last row; a small part keeps it "<5" (N-1)', () => {
  const listen = [
    ...F.content.listen.filter(r => r[1] !== 'riwayah'),
    ['last30d', 'riwayah', "Hafs A'n Assem", 4101, 56923, 0, 0, 0],
    [
      'last30d',
      'riwayah',
      '00000000-0000-4000-8000-00000000000a',
      3,
      4,
      0,
      0,
      0,
    ],
    [
      'last30d',
      'riwayah',
      '00000000-0000-4000-8000-00000000000b',
      3,
      3,
      0,
      0,
      0,
    ],
  ];
  const {data} = content.shape(listen, F.content.mushaf, TO, NAMES);
  assert.deepEqual(errorsOf(content, data), []);
  const other = data.last30d.riwayah.at(-1);
  assert.deepEqual(other, {
    label: content.OTHER_RECITER,
    installs: SMALL,
    events: SMALL,
  });
  const big = [
    ...F.content.listen.filter(r => r[1] !== 'riwayah'),
    [
      'last30d',
      'riwayah',
      '00000000-0000-4000-8000-00000000000a',
      9000,
      9000,
      0,
      0,
      0,
    ],
    ['last30d', 'riwayah', "Hafs A'n Assem", 4101, 56923, 0, 0, 0],
  ];
  const r = content.shape(big, F.content.mushaf, TO, NAMES).data.last30d
    .riwayah;
  assert.equal(r.at(-1).label, content.OTHER_RECITER); // last, even when larger
  assert.equal(r.at(-1).installs, 9000);
});

test('content: shape ranks, puts non-catalog reciters in one unnamed row, and keeps labels of small rows', () => {
  const {data, notes} = content.shape(
    F.content.listen,
    F.content.mushaf,
    TO,
    NAMES,
  );
  assert.deepEqual(errorsOf(content, data), []);
  const w = data.last30d;
  assert.deepEqual(
    w.reciters.map(r => r.label),
    [
      'Zaynab Talha',
      'Hajjah Maria Ulfah',
      'Small Reciter',
      content.OTHER_RECITER,
    ],
  );
  assert.deepEqual(w.reciters[0].finish, {
    num: 1561,
    den: 2610,
    value: 0.5981,
    lowN: false,
  });
  assert.deepEqual(w.reciters[2], {
    label: 'Small Reciter',
    installs: SMALL,
    events: SMALL,
    finish: {num: SMALL, den: SMALL, value: null, lowN: false},
  });
  assert.equal(w.reciters.at(-1).installs, SMALL);
  assert.equal(w.distinct.reciters, 3); // catalog reciters only
  // An id that the catalog does not know is never a label (T-PRIV-03).
  assert.deepEqual(w.riwayah.at(-1), {
    label: 'other (not in catalog)',
    installs: SMALL,
    events: SMALL,
  });
  assert.ok(!w.riwayah.some(r => /^[0-9a-f]{8}-/.test(r.label)));
  assert.deepEqual(w.mushafPagesRead[0], {
    id: 1,
    surah: 1,
    installs: 398,
    events: 707,
  });
  assert.deepEqual(w.mushafPagesRead.at(-1), {
    id: 263,
    surah: null,
    installs: SMALL,
    events: SMALL,
  });
  assert.deepEqual(w.totals, {
    listeners: 4610,
    listens: 74121,
    completers: 3068,
    completions: 65058,
    readers: 1698,
    pagesRead: 25739,
    openers: 2195,
    pagesOpened: 80333,
  });
  assert.equal(w.bookmarks, 'notInstrumented');
  assert.equal(data.since3_2_0.from, '2026-08-03');
  assert.equal(data.last30d.from, '2026-09-18');
  assert.match(notes.join('\n'), /TECH_DEBT #297/);
  assert.match(notes.join('\n'), /1 rewayah_id value/);
  // No reciter_name or id of a non-catalog reciter reaches the data.
  assert.doesNotMatch(JSON.stringify(data), /__other__|r-zaynab/);
});

test('content: the top 50 cut and an unreadable catalog', () => {
  const rows = Array.from({length: 60}, (_, i) => [
    'last30d',
    'surah',
    String(i + 1),
    100 + i,
    200,
    50,
    0,
    0,
  ]);
  const {data} = content.shape(rows, [], TO, NAMES);
  assert.equal(data.last30d.surahs.length, 50);
  assert.equal(data.last30d.surahs[0].id, 60);
  assert.equal(data.last30d.distinct.surahs, 60);
  const none = content.shape(
    F.content.listen,
    [],
    TO,
    content.catalogNames(null),
  );
  assert.deepEqual(errorsOf(content, none.data), []);
  assert.deepEqual(
    none.data.last30d.reciters.map(r => r.label),
    [content.OTHER_RECITER],
  );
  assert.match(none.notes.join('\n'), /not readable/);
  assert.ok(
    content.loadCatalogNames().reciters.size > 0,
    'the bundled catalog loads',
  );
});

// --- restore ---------------------------------------------------------------

test('restore: the queries have the cut-off, the window and every skip counter', () => {
  const d = restore.dailyQuery(TO, ASOF);
  assert.ok(d.includes(ASOF));
  assert.match(d, LAB);
  assert.match(d, /2026-09-17 00:00:00/); // 2026-09-18 (30 days) − 1 day margin
  const t = restore.totalsQuery(TO, ASOF);
  assert.ok(t.includes(ASOF));
  assert.match(t, /toDate\('2026-08-12'\)/);
  for (const c of restore.SKIP_COUNTERS)
    assert.ok(t.includes(`properties.${c}`), c);
  assert.match(t, /properties\.candidate_total/);
  assert.match(t, /HAVING any_restore > 0/);
});

test('restore: shape fills 30 days, splits by platform and suppresses small cells', () => {
  const d = restore.shape(F.restore.daily, F.restore.totals, TO);
  assert.deepEqual(errorsOf(restore, d), []);
  assert.equal(d.days.length, 30);
  assert.equal(d.days[0], '2026-09-18');
  assert.equal(d.daily.sign_in_started.installs[29], 44);
  assert.equal(d.daily.v1_restore_merged.installs[28], SMALL);
  assert.equal(d.daily.sign_in_abandoned.installs[0], 28); // 2026-09-17 is outside
  assert.deepEqual(d.totals.total.events.v1_restore_merged, {
    installs: 108,
    events: 113,
  });
  assert.deepEqual(d.totals.total.mergesWithSkips, {
    installs: SMALL,
    events: SMALL,
  });
  assert.deepEqual(d.totals.iOS.mergesWithCandidates, {
    installs: 58,
    events: 61,
  });
  assert.equal(d.totals.unknown.installs, SMALL);
  assert.equal(d.totals.unknown.events.v1_restore_checked.events, SMALL);
  assert.deepEqual(errorsOf(restore, restore.shape([], [], TO)), []);
});

// --- the whole file ----------------------------------------------------------

test('judge passes a snapshot with the six sections built from the fixtures', () => {
  const data = {
    use: use.shape(F.use, TO),
    weekly: weekly.shape(F.weekly, TO),
    retention: retention.shape(F.retention, TO),
    funnel: funnel.shape(F.funnel.rows, F.funnel.first, TO),
    content: content.shape(F.content.listen, F.content.mushaf, TO, NAMES).data,
    restore: restore.shape(F.restore.daily, F.restore.totals, TO),
  };
  const sections = Object.fromEntries(
    SECTIONS.map(s => [
      s.name,
      data[s.name]
        ? {status: 'ok', source: 'f', ms: 1, data: data[s.name]}
        : {status: 'pending', source: 'x', ms: 0, data: null},
    ]),
  );
  const j = judge(envelope(sections), SECTIONS, {full: false});
  assert.deepEqual(j.problems, []);
  for (const [n, d] of Object.entries(data))
    assert.ok(
      Buffer.byteLength(JSON.stringify(d)) < 150_000,
      `${n} is under 150 KB`,
    );
});
