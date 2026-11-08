// Tests for scripts/signals/anomaly.mjs: the baseline rules on synthetic
// series, and the other checks on small snapshot parts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  issueFor,
  judgeAnr,
  judgeBuilds,
  judgeFreezes,
  judgeSeries,
  mad,
  median,
  parseArgs,
  seriesOf,
} from '../signals/anomaly.mjs';

// 60 days that end on 2026-11-03, with a weekly shape: weekends carry 1.3x.
function days(n = 60, end = '2026-11-03') {
  const out = [];
  const d = new Date(`${end}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getTime() - i * 86_400_000);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}
function series(base, {weekend = 1.3, n = 60, on = days(n)} = {}) {
  return on.map(d => {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    const v = w === 0 || w === 6 ? base * weekend : base;
    return Math.round(v + ((d.charCodeAt(9) % 5) - 2) * (base / 100));
  });
}

test('median and mad', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, 5]), 5);
  assert.equal(median([]), null);
  assert.ok(Math.abs(mad([1, 2, 3, 4, 100]) - 1.4826) < 1e-9);
});

test('a steady series is ok, with the same-weekday baseline', () => {
  const d = days();
  const v = series(700);
  const j = judgeSeries(d, v);
  assert.equal(j.verdict, 'ok');
  assert.equal(j.day, '2026-11-03');
  assert.ok(Math.abs(j.baseline - 700) <= 14, `baseline ${j.baseline}`);
});

test('a drop of 80% fires drop; a doubled day fires rise', () => {
  const d = days();
  const v = series(700);
  const drop = [...v.slice(0, -1), 140];
  const jd = judgeSeries(d, drop);
  assert.equal(jd.verdict, 'drop');
  assert.ok(jd.pct < -0.7, `pct ${jd.pct}`);
  const rise = [...v.slice(0, -1), 1500];
  assert.equal(judgeSeries(d, rise).verdict, 'rise');
});

test('a "<5" day where hundreds are expected fires drop, and reads "<5"', () => {
  const d = days();
  const v = [...series(700).slice(0, -1), '<5'];
  const j = judgeSeries(d, v);
  assert.equal(j.verdict, 'drop');
  assert.equal(j.today, '<5');
});

test('a small series never fires; a noisy series needs more than 20%', () => {
  const d = days();
  const small = [...series(10).slice(0, -1), 1];
  assert.equal(judgeSeries(d, small).verdict, 'low');
  // Noise of about 40% around 700: the 3-MAD band is wider than 20%.
  const noisy = days().map((x, i) => 700 + (i % 2 ? 280 : -280));
  const j = judgeSeries(d, [...noisy.slice(0, -1), 500]);
  assert.equal(j.verdict, 'ok');
});

test('three days 15% or more below the median fire slide, one day does not', () => {
  const d = days();
  const v = series(1000, {weekend: 1});
  const slide = [...v.slice(0, -3), 820, 810, 830];
  assert.equal(judgeSeries(d, slide).verdict, 'slide');
  const one = [...v.slice(0, -1), 830];
  assert.equal(judgeSeries(d, one).verdict, 'ok');
});

test('a weekend day is judged against weekends, not the week', () => {
  // 2026-11-01 is a Sunday.
  const d = days(60, '2026-11-01');
  const v = series(700, {on: d}); // Sunday value about 910
  const j = judgeSeries(d, v);
  assert.equal(j.verdict, 'ok');
  assert.ok(j.baseline > 850, `baseline ${j.baseline}`);
});

test('too little history is no-data', () => {
  assert.equal(judgeSeries(days(5), [1, 2, 3, 4, 5]).verdict, 'no-data');
  assert.equal(
    judgeSeries(days(40), [...series(700, {n: 40}).slice(0, -1), null]).verdict,
    'no-data',
  );
});

test('freezes fire only on WORSE, with the worst builds first', () => {
  const card = {
    data: {
      anr: {
        sentry: {
          week: {
            from: '2026-10-29',
            to: '2026-11-04',
            android: {
              users: 1442,
              frozeUsers: 12,
              prevUsers: 1646,
              prevFrozeUsers: 9,
              verdict: 'WORSE',
              byBuild: [
                {build: 3763, users: 26, frozeUsers: 0},
                {build: 2027, users: 900, frozeUsers: 9},
                {build: 1717, users: 60, frozeUsers: 3},
              ],
            },
            ios: {verdict: 'SAME'},
          },
        },
      },
    },
  };
  const out = judgeFreezes(card);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'freezes.android');
  assert.match(out[0].detail, /by build: 2027 9\/900, 1717 3\/60, 3763 0\/26/);
  assert.deepEqual(
    judgeFreezes({
      data: {anr: {sentry: {week: {android: {unavailable: true}}}}},
    }),
    [],
  );
});

test('the Play ANR score fires on a rise against d28, not on its level', () => {
  const at = (d7, d28) => ({
    data: {
      anr: {
        play: {
          d7,
          d28,
          day: d7,
          date: '2026-11-03',
          dailyUsers: 200,
          codes: [2027],
        },
      },
    },
  });
  assert.equal(
    judgeAnr(at(0.0174, 0.0187)).length,
    0,
    'chronic level: not an anomaly',
  );
  assert.equal(judgeAnr(at(0.03, 0.0187)).length, 1);
  assert.equal(judgeAnr(at(0.03, 0)).length, 0);
  assert.equal(judgeAnr({data: {anr: {play: null}}}).length, 0);
});

test('a production build that loses 10 points at loading fires', () => {
  const row = (platform, build, installs, past) => ({
    kind: 'build',
    production: true,
    platform,
    version: '3.2.x',
    build,
    installs,
    past_loading: past,
  });
  const jbb = {
    data: {
      windows: {
        d7: {
          rows: [
            row('iOS', '3772', 72, 72),
            row('iOS', '1718', 875, 846),
            row('Android', '2027', 659, 611),
            row('Android', '3763', 120, 90),
            row('Android', '1717', 30, 10),
          ],
        },
      },
    },
  };
  const out = judgeBuilds(jbb);
  assert.deepEqual(
    out.map(o => o.key),
    ['build.Android.3763'],
    '1717 is under 50 installs; 1718 is within 10 points',
  );
});

test('analyze: the ingestion hint when PostHog fell and the App Store did not', () => {
  const d = days();
  const posthog = series(700);
  const out = [...posthog.slice(0, -1), 20];
  const snapshot = {
    date: '2026-11-04',
    dataThrough: '2026-11-03',
    sections: {
      active: {
        data: {
          days: d,
          total: {dau: out},
          iOS: {dau: out},
          Android: {dau: out},
        },
      },
      use: {
        data: {
          days: d,
          daily: {
            playback_started: {events: out},
            meaningful_listen: {events: out},
          },
        },
      },
      stores: {data: {ios: {days: d, v2Devices: series(80)}}},
    },
  };
  const r = analyze(snapshot);
  assert.equal(r.fired.length, 5);
  assert.equal(r.hints.length, 1);
  assert.match(r.hints[0], /PostHog ingestion/);
  const it = issueFor(r.fired[0], r);
  assert.equal(it.title, '[Anomaly] Daily active installs');
  assert.deepEqual(it.labels, ['anomaly', 'investigate']);
  assert.match(it.body, /<!-- anomaly:active\.dau\.total -->/);
  assert.match(it.body, /baseline of/);
  // The App Store series fell too → the other hint.
  snapshot.sections.stores.data.ios.v2Devices = [
    ...series(80).slice(0, -1),
    10,
  ];
  assert.match(analyze(snapshot).hints[0], /real loss of users/);
});

test('seriesOf leaves the Play user count out', () => {
  const d = days();
  const s = seriesOf({
    sections: {
      stores: {
        data: {
          android: {days: d, v2Users: series(200)},
          ios: {days: d, v2Devices: series(80)},
        },
      },
    },
  });
  assert.deepEqual(
    s.map(x => x.key),
    ['stores.ios.devices'],
  );
});

test('parseArgs wants exactly one source', () => {
  assert.throws(() => parseArgs([]), /exactly one/);
  assert.throws(
    () => parseArgs(['--latest', '--date=2026-11-04']),
    /exactly one/,
  );
  assert.throws(() => parseArgs(['--date=11-04']), /YYYY-MM-DD/);
  assert.deepEqual(parseArgs(['--latest', '--issue', '--dry-run']).issue, true);
});
