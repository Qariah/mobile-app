// @ai
//
// scripts/lib/anr-card.mjs
// ------------------------
// The FREEZES (ANR) block of the daily card, and the sources behind it. v2
// builds only. planning/signals-anr-listens-design.md section 1 defines the
// block (owner, 2026-10-20).
//
// THE CARD BLOCK (renderAnrCard) prints two measures, one definition each:
//   users who froze   Sentry, production: the distinct users with at least
//                     one freeze in the last 7 complete UTC days, out of the
//                     distinct session users of the same releases in the same
//                     days, and the same for the 7 days before, with a fixed
//                     verdict (freezeVerdict). The releases are the
//                     production builds (active-rollout.json card.builds).
//                     Android freeze = ApplicationNotResponding; iOS freeze =
//                     "App Hanging" or WatchdogTermination. fetchSentryWeek.
//   Google's score    Play, Android only: the user-perceived ANR rate over 7
//                     days, against Google's 0.47% limit. fetchPlayAnr.
//
// THE JSON keeps every source (daily-card.mjs --json → anr), also the ones the
// card no longer prints:
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

import {ANDROID_PACKAGE_NAME, APP_STORE_ID} from './app-ids.mjs';
import {ascJwt} from './asc-client.mjs';
import {getPlayAccessToken} from './google-play-auth.mjs';

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

const mmdd = d => String(d).slice(5, 10);

// --- the FREEZES (ANR) block ---------------------------------------------------
//
// planning/signals-anr-listens-design.md section 1 and its "Decisions from the
// test-plan review (2026-10-20)", which replace the text above them.

// The card's phone width.
const W = 44;

// A count from 1 to this prints as "fewer than 5", and its share is not
// printed (the small-cell rule of the signals snapshot).
const SMALL_MAX = 4;
const isSmall = n => n >= 1 && n <= SMALL_MAX;

// The verdict rule (owner, 2026-10-20, G-V1): with a of b users this week and
// c of d the week before, BETTER when 5·a·d <= 4·c·b (at most 80% of last
// week's share), WORSE when 5·a·d >= 6·c·b (at least 120%), else SAME.
// TOO FEW when a < 5 and c < 5.
export const TOO_FEW_BELOW = 5;

/**
 * The fixed verdict of one platform's 7-day freeze share.
 * w: {users, frozeUsers, prevUsers, prevFrozeUsers} (exact counts; a/b this
 *   week = frozeUsers/users, c/d the week before = prevFrozeUsers/prevUsers).
 * → 'TOO FEW' when both weeks have fewer than 5 users who froze; else
 *   'BETTER' | 'WORSE' | 'SAME' by integer arithmetic only, so a share of
 *   exactly 80% or 120% of last week's has no rounding error. Last week 0 and
 *   this week 5 or more is WORSE. 'NO DATA' when a week has no session users
 *   (fetchSentryWeek marks such a platform unavailable, so the card never
 *   prints it).
 */
export function freezeVerdict(w) {
  const b = Number(w && w.users) || 0;
  const a = Number(w && w.frozeUsers) || 0;
  const d = Number(w && w.prevUsers) || 0;
  const c = Number(w && w.prevFrozeUsers) || 0;
  if (a < TOO_FEW_BELOW && c < TOO_FEW_BELOW) return 'TOO FEW';
  if (!b || !d) return 'NO DATA';
  if (5 * a * d <= 4 * c * b) return 'BETTER';
  if (5 * a * d >= 6 * c * b) return 'WORSE';
  return 'SAME';
}

// A share for the card: "0%" for 0, else one decimal ("0.4%"). The caller
// prints no share for a count from 1 to 4.
const shareText = (n, d) => (n ? `${((n / d) * 100).toFixed(1)}%` : '0%');

// Google's score: always two decimals ("2.19%", G-G1). The text and
// overLimit() round the same integer (basis points), so the printed score and
// OVER/UNDER cannot disagree (0.00475 prints "0.48%" and is OVER).
export const scorePct = v => `${(Math.round(v * 1e4) / 100).toFixed(2)}%`;

/**
 * OVER or UNDER Google's limit (G-G2): OVER when the rate rounded to 4
 * decimals is above 0.0047; exactly 0.47% is UNDER. Integer compare, so
 * 0.0047000001 is not OVER.
 */
export const overLimit = (rate, limit = PLAY_BAD_BAR) =>
  Math.round(rate * 1e4) > Math.round(limit * 1e4);

// "15 of 1496 users froze (1.0%)", "fewer than 5 of 707 users froze" or
// "0 of 707 users froze (0%)".
function countLine(p) {
  if (isSmall(p.frozeUsers)) return `fewer than 5 of ${p.users} users froze`;
  return `${p.frozeUsers} of ${p.users} users froze (${shareText(p.frozeUsers, p.users)})`;
}

// "week before 1.4% · BETTER" or "week before: fewer than 5 · TOO FEW".
function weekBeforeLine(p) {
  const v = p.verdict || freezeVerdict(p);
  if (isSmall(p.prevFrozeUsers)) return `week before: fewer than 5 · ${v}`;
  return `week before ${shareText(p.prevFrozeUsers, p.prevUsers)} · ${v}`;
}

// "2027 0.4% · 1717 1.4%": this week's share of each production build.
function byBuildLine(byBuild) {
  return byBuild
    .map(b => {
      if (!b.users) return `${b.build} no users`;
      if (isSmall(b.frozeUsers)) return `${b.build} fewer than 5`;
      return `${b.build} ${shareText(b.frozeUsers, b.users)}`;
    })
    .join(' · ');
}

// Break a line longer than the card width at its last space that fits; the
// next lines get `indent`. A line that fits is not changed (its column
// spaces stay).
function wrapTo(text, indent) {
  const out = [];
  let rest = String(text);
  while (rest.length > W) {
    const cut = rest.lastIndexOf(' ', W);
    if (cut <= indent.length) break; // one word longer than the width
    out.push(rest.slice(0, cut).trimEnd());
    rest = indent + rest.slice(cut + 1).trimStart();
  }
  out.push(rest);
  return out;
}

/**
 * The options of renderAnrCard from the rollout state.
 *   active        active-rollout.json `active === true`
 *   builds        the production builds (card-layout.mjs cardBuilds)
 *   abConditions  ab-card.mjs blockingStopConditions() of the A/B model ([]
 *                 when no A/B runs)
 * → {staged, abFailed, abNoData}, all off while the rollout is not active:
 *   staged = two or more Android production builds; abFailed = the labels of
 *   the FAIL conditions; abNoData = a blocking condition has NO DATA.
 */
export function freezeOptions({active, builds = [], abConditions = []}) {
  const android = builds.filter(b => b.platform === 'Android');
  const on = !!active;
  return {
    staged: on && android.length >= 2,
    abFailed: on
      ? abConditions.filter(c => c.state === 'FAIL').map(c => c.label)
      : [],
    abNoData: on && abConditions.some(c => c.state === 'NO DATA'),
  };
}

/**
 * The card's FREEZES (ANR) block. Every line fits 44 columns.
 *
 * model: {play, sentry, appStore} from collectAnr(); the block reads
 *   sentry.week (fetchSentryWeek) and play (fetchPlayAnr, the production
 *   versionCodes pooled). A source that is null (no key), carries `error`, or
 *   a platform that is {unavailable: true} prints `unavailable` on its own
 *   line, never 0.
 * opts.staged:   a staged rollout runs (active-rollout.json `active: true` and
 *   two Android production builds): one more line gives each build's share.
 * opts.abFailed: the labels of the blocking A/B stop conditions that FAIL
 *   while the rollout is active: one ⛔ line for each, directly under the
 *   header.
 * opts.abNoData: while active, a blocking condition has NO DATA: the line
 *   `A/B check: no data` under the header.
 * The App Store hang rate stays in the JSON only (the Engagement page shows
 * it under Details).
 */
export function renderAnrCard(
  model,
  {staged = false, abFailed = [], abNoData = false} = {},
) {
  const {play, sentry} = model || {};
  const L = ['FREEZES (ANR) · last 7 days'];
  for (const label of abFailed)
    L.push(...wrapTo(`⛔ A/B: ${label} FAILED · see page`, '  '));
  if (abNoData) L.push('A/B check: no data');
  const week = sentry && sentry.week && !sentry.week.error ? sentry.week : null;

  const platform = (label, p) => {
    const head = label.padEnd(9);
    const pad = ' '.repeat(9);
    if (!p || p.unavailable) {
      L.push(`${head}unavailable`);
      return;
    }
    L.push(...wrapTo(`${head}${countLine(p)}`, pad));
    L.push(...wrapTo(`${pad}${weekBeforeLine(p)}`, pad));
    if (staged && (p.byBuild || []).length >= 2)
      L.push(...wrapTo(`  ${byBuildLine(p.byBuild)}`, '  '));
  };

  // A platform with no production build is left out (week[platform] is null).
  if (!week || week.android) {
    platform('Android', week && week.android);
    // Google's score: Play's 7-day rate of the production versionCodes.
    if (play && !play.error && play.d7 != null) {
      L.push(
        `  Google's score ${scorePct(play.d7)} · limit ${scorePct(PLAY_BAD_BAR)} · ${
          overLimit(play.d7) ? 'OVER' : 'UNDER'
        }`,
      );
      L.push(`  (7-day; a sample of users; data to ${mmdd(play.date)})`);
    } else L.push("  Google's score unavailable");
  }
  if (!week || week.ios) platform('iOS', week && week.ios);
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

/**
 * Play's user-perceived ANR rate for a pooled list of v2 versionCodes: the
 * last day, the user-weighted 7-day and 28-day rates, and the daily series.
 *   codes       the versionCodes to pool. Omit it to pool every v2 versionCode
 *               that Play has data for (the card); the signals focus passes
 *               the production versionCodes of active-rollout.json.
 *   seriesDays  how many of the newest Play days `series` keeps (default 7)
 *   token       a reporting-scope token that the caller minted already
 * → null when no service account is configured, {error} on a failure.
 */
export async function fetchPlayAnr({
  saPath, // a file path; omit it to use the helper's default order
  pkg = process.env.PLAY_PACKAGE || ANDROID_PACKAGE_NAME,
  codes: onlyCodes = null,
  seriesDays = 7,
  token = null,
} = {}) {
  try {
    let tk = token;
    if (!tk)
      try {
        tk = await getPlayAccessToken({scope: 'reporting', saFile: saPath});
      } catch (e) {
        // No service account configured: no Play line on the card, not an error.
        if (e.code === 'no-service-account') return null;
        if (e.code === 'token-mint-failed')
          throw new Error('Play token mint failed');
        throw e;
      }
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

    let codes;
    if (Array.isArray(onlyCodes)) {
      codes = v2VersionCodes(onlyCodes);
      if (!codes.length) return {error: 'no v2 versionCode given'};
    } else {
      const byCode = await query({
        dimensions: ['versionCode'],
        metrics: ['distinctUsers'],
      });
      codes = v2VersionCodes(
        byCode.map(
          r => r.dimensions?.[0]?.int64Value ?? r.dimensions?.[0]?.stringValue,
        ),
      );
      if (!codes.length) return {error: 'no v2 versionCode in Play data'};
    }

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
      series: rows.slice(-seriesDays).map(r => ({date: r.date, rate: r.rate})),
    };
  } catch (e) {
    return {error: e.message};
  }
}

// --- Sentry: daily rates (JSON only) -------------------------------------------

// The card no longer prints these rates; the JSON keeps them for the signals
// snapshot (scripts/signals/sections/card.mjs).
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

// --- Sentry: users who froze in the last 7 days -------------------------------

// Each platform's freeze, as a Sentry search term.
export const FREEZE_QUERY = {
  android: 'error.type:ApplicationNotResponding',
  ios: 'error.type:["App Hanging",WatchdogTermination]',
};

// Why a platform is unavailable (week.<platform> = {unavailable: true,
// reason}). The signals snapshot keeps only these fixed texts.
export const UNAVAILABLE = {
  failed: 'the Sentry request failed',
  missed: 'Sentry missed days in the two weeks',
  noUsers: 'no session users in a week',
};

const utcPlus = (d, n) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * The last 7 complete UTC days and the 7 days before them, as UTC dates
 * (YYYY-MM-DD, both ends included). Today (UTC) is still filling, so it is
 * never in a window.
 */
export function weekWindows(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return {
    from: utcPlus(today, -7),
    to: utcPlus(today, -1),
    prevFrom: utcPlus(today, -14),
    prevTo: utcPlus(today, -8),
  };
}

/** The Sentry release of a card build: com.qariah.app@<version>+<build>. */
export const releaseOf = b => `com.qariah.app@${b.version}+${b.build}`;

/**
 * The days of the two weeks that Sentry did not really see (the observed-days
 * check of fetchSentryAnr: markObserved on the users with any production
 * error, 30 complete UTC days).
 * daily: {date: users with any production error}; win: weekWindows().
 * → the missed dates of prevFrom..to (a date with no bucket is missed).
 */
export function missedDays(daily, win) {
  const observed = markObserved(daily);
  const out = [];
  for (let d = win.prevFrom; d <= win.to; d = utcPlus(d, 1))
    if (!observed[d]) out.push(d);
  return out;
}

/**
 * Users who froze, for each platform, in the last 7 complete UTC days and the
 * 7 days before (planning/signals-anr-listens-design.md, section 1 and the
 * decisions G-C1, G-C5, G-C6, G-M1).
 *   builds  the production builds, [{platform: 'iOS'|'Android', version,
 *           build}] (scripts/lib/card-layout.mjs cardBuilds)
 * Each count is ONE distinct-user count over the whole window and all the
 * production releases of the platform (the union), never a sum of days or of
 * releases: a user who updated from 1717 to 2027 in the week is one user.
 * Production environment only.
 * → {from, to, prevFrom, prevTo, android, ios}. A platform with no production
 *   build is null. Else {users, frozeUsers, prevUsers, prevFrozeUsers,
 *   verdict, byBuild: [{build, users, frozeUsers}]} (byBuild = this week,
 *   newest build first), or {unavailable: true, reason} when a request
 *   failed, when Sentry missed a day of the two weeks, or when a week has no
 *   session users. null without a token.
 * Requests: 1 for the observed days, 1 for the build sessions, then 5 for
 * each platform (one platform at a time).
 */
export async function fetchSentryWeek({
  token,
  org,
  host = 'https://sentry.io',
  builds,
  now = new Date(),
}) {
  if (!token) return null;
  const win = weekWindows(now);
  const all = (builds || []).map(b => ({...b, release: releaseOf(b)}));
  const ofPlatform = label =>
    all
      .filter(b => b.platform === label)
      .sort((a, b) => Number(b.build) - Number(a.build));
  const down = reason => ({unavailable: true, reason});
  try {
    const get = async path => {
      const r = await fetch(`${host}/api/0/organizations/${org}/${path}`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      if (!r.ok) throw new Error(`Sentry ${r.status}`);
      return r.json();
    };
    const enc = encodeURIComponent;
    const span = (from, to) =>
      `start=${from}T00:00:00&end=${utcPlus(to, 1)}T00:00:00`;
    const thisWeek = span(win.from, win.to);
    const prevWeek = span(win.prevFrom, win.prevTo);
    const inReleases = rs =>
      `release:[${rs.map(r => `"${r.replace(/"/g, '')}"`).join(',')}]`;
    const USERS = enc('count_unique(user)');
    const BASE = 'project=-1&environment=production';

    // The observed-days check over 30 complete UTC days.
    const today = now.toISOString().slice(0, 10);
    const stats = await get(
      `events-stats/?yAxis=${USERS}&dataset=errors&${BASE}&${span(utcPlus(today, -30), utcPlus(today, -1))}&interval=1d`,
    );
    const daily = Object.fromEntries(
      (stats?.data || [])
        .map(([t, v]) => [
          new Date(Number(t) * 1000).toISOString().slice(0, 10),
          Number(v?.[0]?.count) || 0,
        ])
        .filter(([d]) => d < today),
    );
    const missed = missedDays(daily, win);

    // Distinct users with the freeze, all the releases together.
    const frozeUsers = async (p, rs, s) => {
      const j = await get(
        `events/?field=${USERS}&dataset=errors&${BASE}&query=${enc(`${FREEZE_QUERY[p]} ${inReleases(rs)}`)}&${s}`,
      );
      return Number(j?.data?.[0]?.['count_unique(user)']) || 0;
    };
    // Distinct session users, all the releases together.
    const sessionUsers = async (rs, s) => {
      const j = await get(
        `sessions/?field=${USERS}&${BASE}&query=${enc(inReleases(rs))}&${s}&interval=1d`,
      );
      return Number(j?.groups?.[0]?.totals?.['count_unique(user)']) || 0;
    };

    // Session users of each release, this week.
    const sessByRelease = new Map();
    if (all.length) {
      const j = await get(
        `sessions/?field=${USERS}&groupBy=release&${BASE}&query=${enc(inReleases(all.map(b => b.release)))}&${thisWeek}&interval=1d`,
      );
      for (const g of j?.groups || [])
        sessByRelease.set(
          g.by?.release,
          Number(g.totals?.['count_unique(user)']) || 0,
        );
    }

    const platform = async (p, label) => {
      const bs = ofPlatform(label);
      if (!bs.length) return null;
      if (missed.length) return down(UNAVAILABLE.missed);
      const rs = bs.map(b => b.release);
      const [users, froze, prevUsers, prevFroze, byRelease] = await Promise.all(
        [
          sessionUsers(rs, thisWeek),
          frozeUsers(p, rs, thisWeek),
          sessionUsers(rs, prevWeek),
          frozeUsers(p, rs, prevWeek),
          get(
            `events/?field=release&field=${USERS}&dataset=errors&${BASE}&query=${enc(`${FREEZE_QUERY[p]} ${inReleases(rs)}`)}&${thisWeek}`,
          ),
        ],
      );
      if (!users || !prevUsers) return down(UNAVAILABLE.noUsers);
      const frozeOf = new Map(
        (byRelease?.data || []).map(r => [
          r.release,
          Number(r['count_unique(user)']) || 0,
        ]),
      );
      const counts = {
        users,
        frozeUsers: froze,
        prevUsers,
        prevFrozeUsers: prevFroze,
      };
      return {
        ...counts,
        verdict: freezeVerdict(counts),
        byBuild: bs.map(b => ({
          build: String(b.build),
          users: sessByRelease.get(b.release) || 0,
          frozeUsers: frozeOf.get(b.release) || 0,
        })),
      };
    };

    // One platform at a time: at most 5 Sentry requests run together.
    const android = await platform('android', 'Android');
    const ios = await platform('ios', 'iOS');
    return {...win, android, ios};
  } catch (e) {
    // A failed request: each platform that has a production build is
    // unavailable, never a zero.
    const reason = `${UNAVAILABLE.failed} (${String(e.message || e).slice(0, 40)})`;
    return {
      ...win,
      android: ofPlatform('Android').length ? down(reason) : null,
      ios: ofPlatform('iOS').length ? down(reason) : null,
    };
  }
}

// --- App Store Connect -------------------------------------------------------

export async function fetchAscHang({appId = APP_STORE_ID} = {}) {
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
