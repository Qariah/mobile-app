// Tests for scripts/signals/check.mjs (signals Phase 1, the card match).
// The repo's eslint config declares no Node globals; these are Node builtins.
/* global structuredClone */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  cardText,
  close,
  compareCard,
  parseArgs,
  parseCard,
  streak,
} from '../signals/check.mjs';

const fixture = name =>
  readFileSync(
    new URL(`./fixtures/signals/check/${name}`, import.meta.url),
    'utf8',
  );

test('parseCard reads the people line, journey, ACTIVE and USE of a real card', () => {
  const p = parseCard(cardText(fixture('card-2026-10-18.md')));
  assert.deepEqual(p.people, {
    total: 6414,
    iOS: 3579,
    Android: 2835,
    installed: 4086,
  });
  assert.deepEqual(p.journey, {
    Opened: 6372,
    'Past loading': 6237,
    'Logged in': 368,
    Started: 4445,
    'Really used': 4209,
  });
  assert.deepEqual(p.active.Today, [731, 3177, 8088]);
  assert.deepEqual(p.active['Day before'], [871, 3204, 8047]);
  assert.deepEqual(p.usage['Mushaf pages'], [2418, 18172, 79965]);
});

test('parseCard reads two more real cards (2026-10-16, 2026-10-17)', () => {
  const a = parseCard(cardText(fixture('card-2026-10-16.md')));
  assert.deepEqual(a.people, {
    total: 5949,
    iOS: 3336,
    Android: 2613,
    installed: 3657,
  });
  assert.deepEqual(a.journey, {
    Opened: 5915,
    'Past loading': 5785,
    'Logged in': 332,
    Started: 4138,
    'Really used': 3922,
  });
  assert.deepEqual(a.active, {
    Today: [847, 3178, 8030],
    Yesterday: [818, 3224, 8008],
    'Day before': [770, 3219, 7978],
  });
  assert.deepEqual(a.usage, {
    Recitations: [3184, 22585, 92020],
    'Heard properly': [2468, 17997, 74165],
    Finished: [1943, 14917, 65050],
    'Mushaf pages': [3392, 18619, 80716],
  });
  const b = parseCard(cardText(fixture('card-2026-10-17.md')));
  assert.deepEqual(b.people, {
    total: 6155,
    iOS: 3433,
    Android: 2722,
    installed: 3849,
  });
  assert.deepEqual(b.active.Today, [684, 3169, 8059]);
  assert.deepEqual(b.usage['Mushaf pages'], [2078, 17981, 80656]);
});

test('lagMinutes', async () => {
  const {lagMinutes} = await import('../signals/check.mjs');
  assert.equal(lagMinutes('2026-10-19T19:31:00Z', '2026-10-19T20:12:00Z'), 41);
  assert.equal(lagMinutes(null, '2026-10-19T20:12:00Z'), null);
});

test('parseCard on the old card format finds no ACTIVE table and does not throw', () => {
  const p = parseCard(cardText(fixture('card-2026-10-04-old-format.md')));
  assert.equal(p.active, null);
  assert.equal(p.people, null);
  assert.equal(parseCard(null), null);
  assert.equal(cardText('no block here'), null);
});

test('close: tolerance max(5, 3%) and "<5" against 1 to 4', () => {
  assert.equal(close(8088, 8068), true); // 20 <= 3% of 8068
  assert.equal(close(731, 700), false); // 31 > 21
  assert.equal(close(10, 6), true); // within 5
  assert.equal(close('<5', 4), true);
  assert.equal(close('<5', 5), false);
  assert.equal(close(null, 10), false);
  assert.equal(close(10, null), true); // the card does not print it
});

const snapshotCard = {
  people: {total: 6400, iOS: 3570, Android: 2830, installed: 4080},
  journey: [
    {label: 'Opened', installs: 6370},
    {label: 'Past loading', installs: 6230},
    {label: 'Logged in', installs: 368},
    {label: 'Started', installs: 4440},
    {label: 'Really used', installs: 4200},
  ],
  active: [
    {label: 'Today', dau: 725, wau: 3170, mau: 8080},
    {label: 'Yesterday', dau: 700, wau: 3179, mau: 8068},
    {label: 'Day before', dau: 871, wau: 3204, mau: 8047},
  ],
  usage: [
    {label: 'Recitations', key: 'plays', day: 2780, week: 21990, month: 91850},
    {
      label: 'Heard properly',
      key: 'heard',
      day: 2222,
      week: 17608,
      month: 74081,
    },
    {label: 'Finished', key: 'finished', day: 1604, week: 14419, month: 64527},
    {label: 'Mushaf pages', key: 'pages', day: 2418, week: 18172, month: 79965},
  ],
};

test('compareCard matches within tolerance and lists each diff', () => {
  const parsed = parseCard(cardText(fixture('card-2026-10-18.md')));
  const ok = compareCard(parsed, snapshotCard);
  assert.equal(ok.match, true, JSON.stringify(ok.diffs));
  assert.equal(ok.compared, 4 + 5 + 9 + 12);
  const bad = structuredClone(snapshotCard);
  bad.active[0].dau = 650;
  delete bad.usage[3];
  const r = compareCard(parsed, bad);
  assert.equal(r.match, false);
  assert.deepEqual(r.diffs.map(d => d.field).sort(), [
    'active.Today.dau',
    'usage.Mushaf pages.day',
    'usage.Mushaf pages.month',
    'usage.Mushaf pages.week',
  ]);
  assert.equal(
    compareCard(
      {people: null, journey: null, active: null, usage: null},
      snapshotCard,
    ).match,
    false,
  ); // nothing compared
});

test('streak counts valid+matching days back from the newest, and stops at a gap or a failure', () => {
  const day = (date, valid = true, match = true) => ({date, valid, match});
  assert.deepEqual(streak([]), {days: 0, through: null});
  assert.equal(
    streak([day('2026-10-20'), day('2026-10-21'), day('2026-10-22')]).days,
    3,
  );
  assert.equal(
    streak([day('2026-10-19'), day('2026-10-21'), day('2026-10-22')]).days,
    2,
  ); // 10-20 missing
  assert.equal(
    streak([
      day('2026-10-20'),
      day('2026-10-21', true, false),
      day('2026-10-22'),
    ]).days,
    1,
  );
  assert.equal(streak([day('2026-10-21'), day('2026-10-22', false)]).days, 0);
  assert.equal(
    streak([day('2026-10-21'), {date: '2026-10-22', valid: true, match: null}])
      .days,
    0,
  ); // no card
});

test('parseArgs', () => {
  assert.deepEqual(
    parseArgs(['--date=2026-10-19', '--upload', '--allow-missing'], {
      today: '2026-10-19',
    }),
    {
      date: '2026-10-19',
      file: null,
      upload: true,
      streak: false,
      days: 30,
      allowMissing: true,
    },
  );
  assert.equal(parseArgs(['--streak', '--days=7']).days, 7);
  assert.throws(() => parseArgs(['--date=2026/10/19']));
  // A future date would stop the streak at 0 until it passes (N-2).
  assert.throws(
    () => parseArgs(['--date=2026-12-01'], {today: '2026-10-19'}),
    /after today/,
  );
});
