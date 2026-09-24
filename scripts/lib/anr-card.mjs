// @ai
//
// scripts/lib/anr-card.mjs
// ------------------------
// The ANR section of the daily card: what share of people hit a freeze, from
// three independent sources, as a daily rate, a trailing 7-day rate and a
// trailing 28-day rate. v2 builds only.
//
//   ANDROID  Play Reporting API  userPerceivedAnrRate (+7d/+28d user-weighted)
//            Sentry              ApplicationNotResponding users / session users
//   IPHONE   Sentry              "App Hanging" users and WatchdogTermination
//                                users / session users
//            App Store Connect   hang rate, ONE value per app version (Apple
//                                publishes no daily series and no ANR rate)
//
// v1 EXCLUSION. v1 Flutter still has live Android installs (vc35, vc1255), and
// Play's app-wide ANR rate mixes them in. On 2026-09-16 the app-wide 28d rate
// read 1.40% while v2 alone was 2.14% — the v1 users had fewer ANRs and hid the
// v2 problem. So the Play query is filtered to an explicit list of v2
// versionCodes, discovered from Play itself each run. Play's filter accepts
// `versionCode = A OR versionCode = B` and returns ONE pooled rate for the list;
// it rejects `!=` and `>=`, which is why the list has to be built. Sentry needs
// no filter for lineage: v1 never reported to this Sentry project.
//
// Pure functions are exported for scripts/__tests__/anr-card.test.mjs.

import {Buffer} from 'node:buffer';
import {createSign} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {ascJwt} from './asc-client.mjs';

// Google's "bad behavior" threshold for user-perceived ANR rate.
export const PLAY_BAD_BAR = 0.0047;

// The first v2 Android versionCode. v1 Flutter's highest was 1255, and v2 builds
// below 1257 are long out of users' hands. A LOWER v2 code would be mistaken for
// v1 here; the lineage test in play-vitals-lineage.test.mjs explains the overlap.
export const V2_MIN_VERSION_CODE = 1257;

// v1 iOS topped out at 3.0.1. Anything at or above this is the RN app.
export const IOS_V2_MIN_VERSION = '3.1.0';

// A trailing window needs at least this share of its days observed, or the
// rate prints as a dash.
const MIN_OBSERVED_SHARE = 0.5;

// Sentry's error quota ran out on 2026-08-26. Until 09-01 it kept errors from
// only 3-11 users a day, against a normal 30-140. Those days are not zero, so a
// zero test misses them, and their near-empty ANR counts would drag every
// trailing rate down. A day whose error-user count is below this share of the
// median day is treated as not observed. Users, not events: one device can
// send 23 hangs in a day, which makes event counts too spiky to judge by.
const OBSERVED_SHARE_OF_MEDIAN = 0.2;

// --- pure --------------------------------------------------------------------

export function v2VersionCodes(codes, min = V2_MIN_VERSION_CODE) {
  return [...new Set(codes.map(Number))]
    .filter(c => Number.isFinite(c) && c >= min)
    .sort((a, b) => a - b);
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// days: [{date, hit, active, observed}] ascending. Returns the user-day-weighted
// rate over the last `len` days ending at the final entry — the same weighting
// Play uses for its 7d/28d metrics — or null when too few days were observed.
export function pooledRate(days, len) {
  const win = days.slice(-len);
  const seen = win.filter(d => d.observed);
  if (!win.length || seen.length < Math.ceil(len * MIN_OBSERVED_SHARE)) {
    return null;
  }
  const active = seen.reduce((a, d) => a + d.active, 0);
  if (!active) return null;
  return seen.reduce((a, d) => a + d.hit, 0) / active;
}

// totals: {date: users with any production error}. → {date: observed}
export function markObserved(totals) {
  const vals = Object.values(totals).sort((a, b) => a - b);
  if (!vals.length) return {};
  const median = vals[Math.floor(vals.length / 2)];
  const floor = Math.max(1, median * OBSERVED_SHARE_OF_MEDIAN);
  return Object.fromEntries(
    Object.entries(totals).map(([d, n]) => [d, n >= floor]),
  );
}

export function observedDays(days, len) {
  return days.slice(-len).filter(d => d.observed).length;
}

// "com.qariah.app@3.2.0+1717" → "1717"
export const buildOfRelease = r => (String(r).match(/\+(\d+)$/) || [])[1];

// Newest v2 version that Apple has hang data for, from a perfPowerMetrics body.
export function latestV2Hang(body, minVersion = IOS_V2_MIN_VERSION) {
  const byVersion = new Map();
  let newestAny = null;
  for (const p of body.productData || []) {
    for (const c of p.metricCategories || []) {
      if (c.identifier !== 'HANG') continue;
      for (const m of c.metrics || []) {
        for (const ds of m.datasets || []) {
          const f = ds.filterCriteria || {};
          if (f.device !== 'all_iphones') continue;
          const key = f.percentile === 'percentile.ninety' ? 'p90' : 'p50';
          for (const pt of ds.points || []) {
            if (!newestAny || compareVersions(pt.version, newestAny) > 0) {
              newestAny = pt.version;
            }
            if (compareVersions(pt.version, minVersion) < 0) continue;
            const row = byVersion.get(pt.version) || {version: pt.version};
            row[key] = Number(pt.value);
            byVersion.set(pt.version, row);
          }
        }
      }
    }
  }
  const newest = [...byVersion.values()].sort((a, b) =>
    compareVersions(b.version, a.version),
  )[0];
  return newest || {none: true, newestAny};
}

const pct = v => (v == null ? '—' : (v * 100).toFixed(2));
const mmdd = d => String(d).slice(5, 10);
const row = (label, a, b, c) =>
  `${label.padEnd(17)}${pct(a).padStart(5)}${pct(b).padStart(7)}${pct(c).padStart(7)}`;
const head = label =>
  `${label.padEnd(17)}${'day'.padStart(5)}${'7d'.padStart(7)}${'28d'.padStart(7)}`;
const blocks = r =>
  r > 0 ? '▓'.repeat(Math.min(16, Math.max(1, Math.round(r / 0.005)))) : '';

// model: see collectAnr(). Every source may be null (not configured) or carry
// `error`; either prints as a line of its own, never as a zero.
export function renderAnrCard(model, today) {
  const {play, sentry, appStore} = model;
  const L = [];
  L.push(`ANR · ${today}`);
  L.push('people who hit a freeze, % of daily users');

  L.push('');
  L.push(head('ANDROID · v2 only'));
  if (play && !play.error) {
    L.push(row('Play · seen', play.day, play.d7, play.d28));
  } else {
    L.push(
      `${'Play · seen'.padEnd(17)}${play ? `error: ${play.error}` : 'unavailable'}`.slice(
        0,
        44,
      ),
    );
  }
  if (sentry && !sentry.error) {
    const a = sentry.android;
    L.push(row('Sentry', a.day, a.d7, a.d28));
  } else {
    L.push(
      `${'Sentry'.padEnd(17)}${sentry ? `error: ${sentry.error}` : 'unavailable'}`.slice(
        0,
        44,
      ),
    );
  }
  if (play && !play.error && play.d7 != null) {
    const over = play.d7 / PLAY_BAD_BAR;
    L.push(
      `${'Play bad bar'.padEnd(17)}${pct(PLAY_BAD_BAR).padStart(5)}   ${
        over > 1 ? `⛔ 7d is ${over.toFixed(1)}× over` : '✅ 7d under'
      }`,
    );
  }

  L.push('');
  L.push(head('IPHONE'));
  if (sentry && !sentry.error) {
    L.push(
      row(
        'Sentry · hangs',
        sentry.hangs.day,
        sentry.hangs.d7,
        sentry.hangs.d28,
      ),
    );
    L.push(
      row(
        'Sentry · killed',
        sentry.killed.day,
        sentry.killed.d7,
        sentry.killed.d28,
      ),
    );
  } else {
    L.push(
      `${'Sentry'.padEnd(17)}${sentry ? `error: ${sentry.error}` : 'unavailable'}`.slice(
        0,
        44,
      ),
    );
  }
  L.push(`${'App Store'.padEnd(17)}per version only`);
  if (!appStore) {
    L.push(`${''.padEnd(17)}unavailable`);
  } else if (appStore.error) {
    L.push(`${''.padEnd(17)}error: ${appStore.error}`.slice(0, 44));
  } else if (appStore.none) {
    L.push(`${''.padEnd(17)}v2: no data yet`);
  } else {
    // p90, not p50: the median user of a healthy app hangs for 0 s, so p50
    // stays at 0 and says nothing.
    L.push(
      `${''.padEnd(17)}${appStore.version} hangs ${appStore.p90 ?? '—'} s/h p90`,
    );
  }

  if (play && !play.error && play.series.length) {
    L.push('');
    L.push('LAST 7 DAYS · Android v2, Play · seen');
    for (const s of play.series) {
      L.push(`${mmdd(s.date)}  ${pct(s.rate).padStart(5)}  ${blocks(s.rate)}`);
    }
    L.push(`       ${pct(PLAY_BAD_BAR).padStart(5)}  ┆ bad bar`);
  }

  L.push('');
  const users = [];
  if (play && !play.error) users.push(`Play ~${play.users}`);
  if (sentry && !sentry.error) {
    users.push(
      `Android ${sentry.android.active}`,
      `iPhone ${sentry.hangs.active}`,
    );
  }
  L.push(`${'users/day'.padEnd(11)}${users.join(' · ') || 'unavailable'}`);
  const upTo = [];
  if (play && !play.error) upTo.push(`Play ${mmdd(play.date)}`);
  if (sentry && !sentry.error) upTo.push(`Sentry ${mmdd(sentry.date)}`);
  if (upTo.length) L.push(`${'data to'.padEnd(11)}${upTo.join(' · ')}`);
  if (sentry && !sentry.error && sentry.observed28 < 28) {
    L.push(`${''.padEnd(11)}Sentry saw ${sentry.observed28} of 28 days`);
  }
  return L;
}

// --- Play --------------------------------------------------------------------

const PLAY_API = 'https://playdeveloperreporting.googleapis.com/v1beta1/apps';
const FRESHNESS_RE = /current freshness (\d{4})-(\d{2})-(\d{2})/;
const ymd = d => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
  day: d.getUTCDate(),
});
const isoOf = t =>
  `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

async function playToken(saPath) {
  const sa = JSON.parse(readFileSync(saPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({alg: 'RS256', typ: 'JWT'})}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/playdeveloperreporting',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })}`;
  const sig = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key)
    .toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(`${unsigned}.${sig}`)}`,
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error('Play token mint failed');
  return tok.access_token;
}

export async function fetchPlayAnr({
  saPath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
    `${homedir()}/.android/play-service-account.json`,
  pkg = process.env.PLAY_PACKAGE || 'com.qariah.app',
} = {}) {
  if (!existsSync(saPath)) return null;
  try {
    const tk = await playToken(saPath);
    let end = new Date();
    // Play publishes on a lag and rejects a window that ends past its freshness
    // date; the error names that date, so clamp to it once and retry.
    const query = async body => {
      const run = () =>
        fetch(`${PLAY_API}/${pkg}/anrRateMetricSet:query`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tk}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timelineSpec: {
              aggregationPeriod: 'DAILY',
              startTime: ymd(new Date(end.getTime() - 34 * 86_400_000)),
              endTime: ymd(end),
            },
            pageSize: 1000,
            ...body,
          }),
        }).then(r => r.json());
      let out = await run();
      const m = out.error?.message?.match(FRESHNESS_RE);
      if (m) {
        end = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        out = await run();
      }
      if (out.error) throw new Error(out.error.message.slice(0, 80));
      return out.rows || [];
    };

    const byCode = await query({
      dimensions: ['versionCode'],
      metrics: ['distinctUsers'],
    });
    const codes = v2VersionCodes(
      byCode.map(
        r => r.dimensions?.[0]?.int64Value ?? r.dimensions?.[0]?.stringValue,
      ),
    );
    if (!codes.length) return {error: 'no v2 versionCode in Play data'};

    const rows = (
      await query({
        filter: codes.map(c => `versionCode = ${c}`).join(' OR '),
        metrics: [
          'userPerceivedAnrRate',
          'userPerceivedAnrRate7dUserWeighted',
          'userPerceivedAnrRate28dUserWeighted',
          'distinctUsers',
        ],
      })
    )
      .map(r => {
        const m = Object.fromEntries(
          (r.metrics || []).map(x => [x.metric, x.decimalValue?.value]),
        );
        const num = k => (m[k] == null ? null : Number(m[k]));
        return {
          date: isoOf(r.startTime),
          rate: num('userPerceivedAnrRate'),
          d7: num('userPerceivedAnrRate7dUserWeighted'),
          d28: num('userPerceivedAnrRate28dUserWeighted'),
          users: m.distinctUsers ?? '?',
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const last = rows[rows.length - 1];
    if (!last) return {error: 'no Play rows for v2'};
    return {
      codes,
      date: last.date,
      day: last.rate,
      d7: last.d7,
      d28: last.d28,
      users: last.users,
      series: rows.slice(-7).map(r => ({date: r.date, rate: r.rate})),
    };
  } catch (e) {
    return {error: e.message};
  }
}

// --- Sentry ------------------------------------------------------------------

// platformOfBuild: Map<build, 'iPhone'|'Android'>. Sentry sessions carry no OS,
// so the platform of each release comes from PostHog. A build number used on
// BOTH platforms (internal builds) is absent from the map and left out of the
// numerator and the denominator alike.
export async function fetchSentryAnr({
  token,
  org,
  host = 'https://sentry.io',
  platformOfBuild,
}) {
  if (!token) return null;
  try {
    const get = async path => {
      const r = await fetch(`${host}/api/0/organizations/${org}/${path}`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      if (!r.ok) throw new Error(`Sentry ${r.status}`);
      return r.json();
    };
    const PERIOD = 'statsPeriod=30d&interval=1d';
    // The last bucket is today, still filling. Every rate stops at yesterday.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const complete = d => d < todayUtc;

    const sessions = await get(
      `sessions/?field=count_unique(user)&groupBy=release&${PERIOD}&project=-1&environment=production`,
    );
    const dates = (sessions.intervals || []).map(t => t.slice(0, 10));
    const active = {iPhone: {}, Android: {}};
    const releases = {iPhone: [], Android: []};
    for (const g of sessions.groups || []) {
      const p = platformOfBuild.get(buildOfRelease(g.by.release));
      if (!p) continue;
      releases[p].push(g.by.release);
      (g.series['count_unique(user)'] || []).forEach((n, i) => {
        active[p][dates[i]] = (active[p][dates[i]] || 0) + n;
      });
    }

    const series = async query => {
      const j = await get(
        `events-stats/?yAxis=count_unique(user)&${PERIOD}&dataset=errors&query=${encodeURIComponent(query)}`,
      );
      return Object.fromEntries(
        (j.data || []).map(([t, v]) => [
          new Date(t * 1000).toISOString().slice(0, 10),
          v[0].count,
        ]),
      );
    };
    const inReleases = p =>
      releases[p].length
        ? `release:[${releases[p].map(r => `"${r}"`).join(',')}]`
        : 'release:"none"';

    // `all` is the users with any production error, used only to find the days
    // Sentry did not really see (see OBSERVED_SHARE_OF_MEDIAN).
    const [all, anr, hangs, killed] = await Promise.all([
      series('environment:production'),
      series(
        `environment:production error.type:ApplicationNotResponding ${inReleases('Android')}`,
      ),
      series(
        `environment:production error.type:"App Hanging" ${inReleases('iPhone')}`,
      ),
      series(
        `environment:production error.type:WatchdogTermination ${inReleases('iPhone')}`,
      ),
    ]);

    const days = Object.keys(all).filter(complete).sort();
    const observed = markObserved(
      Object.fromEntries(days.map(d => [d, all[d] || 0])),
    );
    const build = (hits, p) => {
      const ds = days.map(d => ({
        date: d,
        hit: hits[d] || 0,
        active: active[p][d] || 0,
        observed: observed[d],
      }));
      const last = ds[ds.length - 1];
      return {
        day:
          last && last.observed && last.active ? last.hit / last.active : null,
        d7: pooledRate(ds, 7),
        d28: pooledRate(ds, 28),
        active: last ? last.active : 0,
      };
    };
    const allDays = days.map(d => ({observed: observed[d]}));
    return {
      date: days[days.length - 1],
      observed28: observedDays(allDays, 28),
      android: build(anr, 'Android'),
      hangs: build(hangs, 'iPhone'),
      killed: build(killed, 'iPhone'),
    };
  } catch (e) {
    return {error: e.message};
  }
}

// --- App Store Connect -------------------------------------------------------

export async function fetchAscHang({appId = '1594917787'} = {}) {
  if (!process.env.APP_STORE_CONNECT_API_KEY_ID) return null;
  try {
    const r = await fetch(
      `https://api.appstoreconnect.apple.com/v1/apps/${appId}/perfPowerMetrics?filter[metricType]=HANG&filter[platform]=IOS`,
      {
        headers: {
          Authorization: `Bearer ${ascJwt()}`,
          Accept: 'application/vnd.apple.xcode-metrics+json,application/json',
        },
      },
    );
    if (!r.ok) return {error: `ASC ${r.status}`};
    return latestV2Hang(await r.json());
  } catch (e) {
    return {error: e.message};
  }
}
