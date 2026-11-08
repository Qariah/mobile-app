#!/usr/bin/env node
// @ai
//
// scripts/signals/anomaly.mjs
// ---------------------------
// Compare the newest day of the signals snapshot with its own baseline, with no
// model. The graph fires an agent only when this script fires, and the agent
// investigates one anomaly issue per signal, not one issue per event
// (docs/operations/feedback-graph.md, "Anomaly detection").
//
//   node scripts/signals/anomaly.mjs --file=build/signals/snapshot-2026-11-04.json
//   node scripts/signals/anomaly.mjs --latest            # the newest build/signals/snapshot-*.json
//   node scripts/signals/anomaly.mjs --date=2026-11-04   # snapshots/daily/<date>.json from the bucket
//   node scripts/signals/anomaly.mjs --latest --json     # the result as JSON on stdout
//   node scripts/signals/anomaly.mjs --latest --upload   # also anomalies/<date>.json in the bucket
//   node scripts/signals/anomaly.mjs --latest --issue    # file or update one GitHub issue per fired signal
//   node scripts/signals/anomaly.mjs --latest --issue --dry-run
//
// Exit 0 = nothing fired, 2 = at least one signal fired, 1 = an error.
//
// The checks (every number comes from one snapshot file; a daily series in it
// holds 120 days, so no history of files is needed):
//   series   each daily series ends at dataThrough (date - 1). The baseline is
//            the median of the same weekday in the 4 weeks before, the spread is
//            the MAD of the 28 days before. A day fires as `drop` or `rise` when it
//            is outside baseline ± max(3 spread, RELATIVE_FLOOR of the baseline),
//            and also outside the 28-day median by the same relative floor, and
//            the baseline is at least MIN_BASELINE (a small series never fires).
//            A `slide` fires when the last SLIDE_DAYS days all sit below the
//            28-day median by more than the floor. A "<5" cell counts as 4.
//   freezes  a platform whose FREEZES (ANR) verdict is WORSE (a change week
//            over week; the card computes it).
//   anr      the Play user-perceived ANR score of the last 7 days at
//            ANR_SPIKE times the 28-day score or more (a change; the chronic
//            level above Google's bar is the release-health lane's business).
//   builds   a production build (7 days, 50 or more installs) whose
//            "past loading" share sits BUILD_GAP points or more below the best
//            production build of the same platform.
// Not here: the crash-free gate (scripts/release-health.mjs files it; a level,
// not a change) and the Play daily user count (Play rounds it to hundreds).
// A hint names the cause to check first when most PostHog series fell on the
// same day while the App Store count did not (2026-10-28: the PostHog event quota).
// The repo's eslint config declares no Node globals; these are Node builtins.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from './lib/context.mjs';
import {signalsBucket} from './lib/bucket.mjs';
import {SMALL} from './lib/rules.mjs';
import {
  commentOnIssue,
  createIssue,
  ensureLabels,
  getIssue,
  GH_REPO,
  listIssues,
  markersIn,
} from '../lib/triage-common.mjs';

export const LOCAL_DIR = resolve(ROOT, 'build/signals');
export const MARKER = 'anomaly:';
export const LABEL = 'anomaly';
export const MIN_BASELINE = 20;
export const RELATIVE_FLOOR = 0.2;
export const SPREAD_K = 3;
export const SLIDE_DAYS = 3;
export const SLIDE_FLOOR = 0.15;
export const BUILD_GAP = 0.1;
export const BUILD_MIN_INSTALLS = 50;
export const ANR_SPIKE = 1.5;
export const COMMENT_GAP_DAYS = 3;

// ---------------------------------------------------------------------------
// The series
// ---------------------------------------------------------------------------

const USE_EVENTS = [
  ['playback_started', 'Recitations started'],
  ['meaningful_listen', 'Heard properly'],
  ['playback_completed', 'Recitations finished'],
  ['mushaf_page_opened', 'Mushaf pages opened'],
  ['mushaf_page_read', 'Mushaf pages read'],
];

/**
 * The daily series of a snapshot: {key, label, source, platform, days, values}.
 * The Play user count stays out: Play rounds it to hundreds, so 200 → 100 is
 * rounding, not a change.
 */
export function seriesOf(snapshot) {
  const s = snapshot.sections || {};
  const out = [];
  const active = s.active?.data;
  if (active?.days) {
    for (const [p, label] of [
      ['total', 'Daily active installs'],
      ['iOS', 'Daily active installs, iOS'],
      ['Android', 'Daily active installs, Android'],
    ]) {
      if (active[p]?.dau)
        out.push({
          key: `active.dau.${p}`,
          label,
          source: 'posthog',
          platform: p === 'total' ? null : p,
          days: active.days,
          values: active[p].dau,
        });
    }
  }
  const use = s.use?.data;
  if (use?.days) {
    for (const [ev, label] of USE_EVENTS) {
      const d = use.daily?.[ev];
      if (d?.events)
        out.push({
          key: `use.${ev}`,
          label,
          source: 'posthog',
          platform: null,
          days: use.days,
          values: d.events,
        });
    }
  }
  const stores = s.stores?.data;
  if (stores?.ios?.days && stores.ios.v2Devices)
    out.push({
      key: 'stores.ios.devices',
      label: 'App Store devices on v2 (Apple)',
      source: 'app-store',
      platform: 'iOS',
      days: stores.ios.days,
      values: stores.ios.v2Devices,
    });
  return out;
}

const num = v => {
  if (v === null || v === undefined) return null;
  if (v === SMALL) return 4;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function median(xs) {
  const a = xs.filter(x => x !== null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** The median absolute deviation, scaled to a standard deviation. */
export function mad(xs) {
  const med = median(xs);
  if (med === null) return null;
  const dev = xs.filter(x => x !== null).map(x => Math.abs(x - med));
  return 1.4826 * median(dev);
}

const round = (x, d = 3) =>
  x === null ? null : Math.round(x * 10 ** d) / 10 ** d;

/**
 * Judge the last day of a daily series. Returns {verdict, ...} where verdict
 * is 'drop', 'rise', 'slide', 'ok', 'low' (the baseline is under MIN_BASELINE)
 * or 'no-data' (the day is null, or fewer than 8 days before it).
 */
export function judgeSeries(days, values, o = {}) {
  const minBase = o.minBaseline ?? MIN_BASELINE;
  const floor = o.relativeFloor ?? RELATIVE_FLOOR;
  const k = o.spreadK ?? SPREAD_K;
  const n = days.length;
  const v = values.map(num);
  const i = n - 1;
  const day = days[i];
  const today = v[i];
  const prev28 = v.slice(Math.max(0, i - 28), i);
  const weekday = [7, 14, 21, 28].map(d => (i - d >= 0 ? v[i - d] : null));
  const baseline = median(weekday) ?? median(prev28);
  const median28 = median(prev28);
  const spread = mad(prev28);
  const base = {
    day,
    today: values[i] === SMALL ? SMALL : today,
    baseline: round(baseline, 1),
    median28: round(median28, 1),
    spread: round(spread, 1),
  };
  if (today === null || prev28.filter(x => x !== null).length < 8)
    return {...base, verdict: 'no-data'};
  if (baseline === null || baseline < minBase || median28 < minBase)
    return {...base, verdict: 'low'};
  const band = Math.max(k * (spread ?? 0), floor * baseline);
  const delta = today - baseline;
  const pct = delta / baseline;
  const pct28 = (today - median28) / median28;
  const r = {...base, delta: round(delta, 1), pct: round(pct)};
  if (Math.abs(delta) > band && Math.abs(pct28) > floor)
    return {...r, verdict: delta < 0 ? 'drop' : 'rise'};
  // A slide: the last SLIDE_DAYS days all below the 28-day median by the slide floor.
  const slideDays = o.slideDays ?? SLIDE_DAYS;
  const slideFloor = o.slideFloor ?? SLIDE_FLOOR;
  const tail = v.slice(i - slideDays + 1, i + 1);
  const base28 = median(
    v.slice(Math.max(0, i - slideDays + 1 - 28), i - slideDays + 1),
  );
  if (
    tail.length === slideDays &&
    base28 !== null &&
    base28 >= minBase &&
    tail.every(x => x !== null && (x - base28) / base28 < -slideFloor)
  )
    return {
      ...r,
      verdict: 'slide',
      slide: {days: slideDays, median28: round(base28, 1), values: tail},
    };
  return {...r, verdict: 'ok'};
}

// ---------------------------------------------------------------------------
// The other checks
// ---------------------------------------------------------------------------

export function judgeFreezes(card) {
  const w = card?.data?.anr?.sentry?.week;
  if (!w) return [];
  const out = [];
  for (const [p, label] of [
    ['android', 'Android'],
    ['ios', 'iOS'],
  ]) {
    const x = w[p];
    if (!x || x.unavailable || x.verdict !== 'WORSE') continue;
    out.push({
      key: `freezes.${p}`,
      label: `Freezes (ANR) WORSE on ${label}`,
      source: 'sentry',
      platform: label,
      verdict: 'worse',
      detail: `${x.frozeUsers} of ${x.users} users froze in ${w.from}..${w.to}; ${x.prevFrozeUsers} of ${x.prevUsers} the week before${
        x.byBuild?.length
          ? `; by build: ${[...x.byBuild]
              .sort((x1, x2) => num(x2.frozeUsers) - num(x1.frozeUsers))
              .slice(0, 4)
              .map(b => `${b.build} ${b.frozeUsers}/${b.users}`)
              .join(', ')}`
          : ''
      }`,
    });
  }
  return out;
}

export function judgeAnr(card) {
  const p = card?.data?.anr?.play;
  if (!p || p.d7 == null || p.d28 == null || !(p.d28 > 0)) return [];
  if (p.d7 < ANR_SPIKE * p.d28) return [];
  return [
    {
      key: 'anr.play',
      label: 'Play ANR score rose',
      source: 'play',
      platform: 'Android',
      verdict: 'spike',
      detail: `user-perceived ANR d7 ${pctText(p.d7)} against d28 ${pctText(p.d28)} (${ANR_SPIKE}x or more), day ${pctText(p.day)} on ${p.date}, ${p.dailyUsers} users; version codes ${(p.codes || []).join(', ')}`,
    },
  ];
}

export function judgeBuilds(journeyByBuild) {
  const rows = journeyByBuild?.data?.windows?.d7?.rows;
  if (!rows) return [];
  const prod = rows.filter(
    r =>
      r.kind === 'build' &&
      r.production &&
      num(r.installs) >= BUILD_MIN_INSTALLS,
  );
  const share = r => num(r.past_loading) / num(r.installs);
  const out = [];
  for (const platform of ['iOS', 'Android']) {
    const mine = prod.filter(r => r.platform === platform);
    if (mine.length < 2) continue;
    const best = Math.max(...mine.map(share));
    for (const r of mine) {
      const gap = best - share(r);
      if (gap >= BUILD_GAP)
        out.push({
          key: `build.${platform}.${r.build}`,
          label: `Build ${r.build} (${r.version}, ${platform}) loses users at loading`,
          source: 'posthog',
          platform,
          verdict: 'gap',
          detail: `past loading ${r.past_loading} of ${r.installs} installs (${pctText(share(r))}) in the last 7 days; the best ${platform} production build reaches ${pctText(best)}`,
        });
    }
  }
  return out;
}

const pctText = x =>
  x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(2)}%`;

// ---------------------------------------------------------------------------
// The whole judgement
// ---------------------------------------------------------------------------

export function analyze(snapshot, o = {}) {
  const checked = [];
  const fired = [];
  for (const s of seriesOf(snapshot)) {
    const j = judgeSeries(s.days, s.values, o);
    const row = {
      key: s.key,
      label: s.label,
      source: s.source,
      platform: s.platform,
      ...j,
    };
    checked.push(row);
    if (['drop', 'rise', 'slide'].includes(j.verdict)) fired.push(row);
  }
  const sec = snapshot.sections || {};
  for (const r of [
    ...judgeFreezes(sec.card),
    ...judgeAnr(sec.card),
    ...judgeBuilds(sec.journeyByBuild),
  ]) {
    checked.push(r);
    fired.push(r);
  }
  const hints = [];
  const posthogDrops = fired.filter(
    f => f.source === 'posthog' && f.verdict === 'drop',
  );
  const posthogSeries = checked.filter(
    c => c.source === 'posthog' && c.baseline !== undefined,
  );
  const storeDrops = fired.filter(
    f => f.source === 'app-store' && f.verdict === 'drop',
  );
  if (
    posthogDrops.length >= 3 &&
    posthogDrops.length >= posthogSeries.length / 2
  )
    hints.push(
      storeDrops.length
        ? `${posthogDrops.length} PostHog series and the App Store device count fell on the same day: a real loss of users is likely; check the stores and the newest build first.`
        : `${posthogDrops.length} PostHog series fell on the same day and the App Store device count did not: check the PostHog ingestion and the event quota before the app (2026-10-28 precedent: the free event quota ran out).`,
    );
  return {
    date: snapshot.date,
    dataThrough: snapshot.dataThrough,
    fired,
    checked,
    hints,
  };
}

const fmt = x => (x === null || x === undefined ? 'n/a' : String(x));

export function renderText(r) {
  const lines = [
    `ANOMALY · snapshot ${r.date} · series end ${r.dataThrough} · ${r.fired.length} fired of ${r.checked.length} checks`,
  ];
  for (const h of r.hints) lines.push(`hint: ${h}`);
  lines.push('');
  for (const c of r.checked) {
    const flag = r.fired.includes(c) ? '!!' : '  ';
    if (c.baseline !== undefined) {
      const tail =
        c.pct === undefined
          ? ''
          : ` (${c.pct >= 0 ? '+' : ''}${Math.round(c.pct * 100)}%)`;
      lines.push(
        `${flag} ${c.verdict.padEnd(7)} ${c.label.padEnd(36)} ${fmt(c.today).padStart(7)} vs ${fmt(c.baseline).padStart(7)}${tail}`,
      );
    } else {
      lines.push(`${flag} ${c.verdict.padEnd(7)} ${c.label}: ${c.detail}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Issues: one open issue per signal key, a comment for each later day
// ---------------------------------------------------------------------------

export function issueFor(f, r) {
  const marker = `<!-- ${MARKER}${f.key} -->`;
  const reading =
    f.baseline !== undefined
      ? `${f.day}: ${fmt(f.today)} against a baseline of ${fmt(f.baseline)} (same weekday, 4 weeks), ${f.pct >= 0 ? '+' : ''}${Math.round((f.pct ?? 0) * 100)}%; 28-day median ${fmt(f.median28)}, spread ${fmt(f.spread)}${
          f.slide
            ? `; the last ${f.slide.days} days ${f.slide.values.join(', ')} all below ${f.slide.median28}`
            : ''
        }`
      : f.detail;
  const title = `[Anomaly] ${f.label}`;
  const body = [
    marker,
    `**${f.verdict.toUpperCase()}** on snapshot ${r.date} (series end ${r.dataThrough}). Source: ${f.source}.`,
    '',
    `- ${reading}`,
    ...r.hints.map(h => `- Hint: ${h}`),
    '',
    'An agent investigates this issue the same day (the cloud triage routine, Step 2.5): find the cause, or close it as noise with the reason. One issue per signal; a later day adds a comment here.',
    '',
    `> Filed automatically by \`scripts/signals/anomaly.mjs\` (see \`.github/workflows/signals-snapshot.yml\`).`,
  ].join('\n');
  const labels = [LABEL, 'investigate'];
  if (f.platform) labels.push(f.platform.toLowerCase());
  return {
    marker,
    key: f.key,
    title,
    body,
    labels,
    comment: `${marker}\n${f.verdict.toUpperCase()} again on snapshot ${r.date}: ${reading}`,
  };
}

export function fileIssues(r, {dryRun} = {}) {
  const open = listIssues({state: 'open', labels: LABEL});
  const out = [];
  for (const f of r.fired) {
    const it = issueFor(f, r);
    const hit = open.find(i => markersIn([i], MARKER).has(f.key));
    if (hit) {
      // A signal that stays fired comments once in COMMENT_GAP_DAYS, not daily.
      const last = getIssue(hit.number, {comments: true})
        .comments.filter(c => c.body.includes(it.marker))
        .pop();
      const recent =
        last &&
        Date.now() - Date.parse(last.createdAt) < COMMENT_GAP_DAYS * 86_400_000;
      if (recent) {
        console.log(
          `#${hit.number} ${f.key}: commented ${last.createdAt.slice(0, 10)}, no new comment`,
        );
        out.push({
          key: f.key,
          number: hit.number,
          created: false,
          skipped: true,
        });
        continue;
      }
      if (dryRun)
        console.log(
          `WOULD COMMENT on #${hit.number}: ${it.comment.split('\n')[1]}`,
        );
      else commentOnIssue(hit.number, it.comment);
      out.push({key: f.key, number: hit.number, created: false});
      continue;
    }
    if (dryRun) {
      console.log(
        `WOULD FILE: ${it.title}\n  labels: ${it.labels.join(', ')}\n${it.body
          .split('\n')
          .map(l => '  ' + l)
          .join('\n')}`,
      );
      out.push({key: f.key, number: null, created: true});
      continue;
    }
    ensureLabels(it.labels, false);
    const made = createIssue({
      title: it.title,
      body: it.body,
      labels: it.labels,
    });
    console.log(`  ✅ filed → ${made.url}`);
    out.push({key: f.key, number: made.number, created: true});
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const a = {
    file: null,
    latest: false,
    date: null,
    json: false,
    upload: false,
    issue: false,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--file=')) a.file = arg.slice(7);
    else if (arg === '--latest') a.latest = true;
    else if (arg.startsWith('--date=')) a.date = arg.slice(7);
    else if (arg === '--json') a.json = true;
    else if (arg === '--upload') a.upload = true;
    else if (arg === '--issue') a.issue = true;
    else if (arg === '--dry-run') a.dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if ([a.file, a.latest, a.date].filter(Boolean).length !== 1)
    throw new Error(
      'give exactly one of --file=<path>, --latest, --date=<YYYY-MM-DD>',
    );
  if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date))
    throw new Error(`--date must be YYYY-MM-DD: ${a.date}`);
  return a;
}

export function newestLocal(dir = LOCAL_DIR) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter(n => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort();
  return names.length ? resolve(dir, names[names.length - 1]) : null;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let snapshot;
  if (a.date) {
    const b = await signalsBucket();
    if (!b) throw new Error('--date needs the SIGNALS_R2_* keys');
    snapshot = await b.getJson(`snapshots/daily/${a.date}.json`);
    if (!snapshot) throw new Error(`no snapshot for ${a.date} in the bucket`);
  } else {
    const file = a.file ? resolve(a.file) : newestLocal();
    if (!file || !existsSync(file))
      throw new Error(
        a.file
          ? `no such file: ${a.file}`
          : `no snapshot-*.json in ${LOCAL_DIR}`,
      );
    snapshot = JSON.parse(readFileSync(file, 'utf8'));
  }
  const r = analyze(snapshot);
  if (a.json) console.log(JSON.stringify(r, null, 2));
  else console.log(renderText(r));
  mkdirSync(LOCAL_DIR, {recursive: true});
  writeFileSync(
    resolve(LOCAL_DIR, `anomaly-${r.date}.json`),
    JSON.stringify(r, null, 2),
  );
  if (a.upload) {
    const b = await signalsBucket();
    if (!b) throw new Error('--upload needs the SIGNALS_R2_* keys');
    await b.putJson(`anomalies/${r.date}.json`, r);
    console.error(`uploaded anomalies/${r.date}.json`);
  }
  if (a.issue && r.fired.length) {
    console.error(`${a.dryRun ? 'dry run: ' : ''}filing on ${GH_REPO}`);
    fileIssues(r, {dryRun: a.dryRun});
  }
  process.exit(r.fired.length ? 2 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
